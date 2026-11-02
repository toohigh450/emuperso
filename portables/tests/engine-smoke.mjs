// Vrai frontend versionné, sans démarrage de jeu ; fichiers externes au dépôt.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {startTestServer} from './server.mjs';
import {makeGba} from './helpers.mjs';
const fixtureDir=process.env.ENGINE_FIXTURE_DIR;
if(!fixtureDir)throw new Error('ENGINE_FIXTURE_DIR doit contenir les fichiers frontend de engine-lock.json, téléchargés séparément.');
const lock=JSON.parse(await readFile(new URL('../emulatorjs/engine-lock.json',import.meta.url),'utf8'));
const files=new Map();
for(const file of lock.files){const bytes=await readFile(resolve(fixtureDir,file.path));assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);files.set(file.path,bytes);}
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=await startTestServer();
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
try {
  const context=await browser.newContext({locale:'en-US'});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('https://cdn.emulatorjs.org/**', async route=>{
    const path=new URL(route.request().url()).pathname.replace('/4.2.3/data/','');
    const body=files.get(path);
    if(!body){await route.fulfill({status:404,headers:{'access-control-allow-origin':'*'},body:''});return;}
    await route.fulfill({contentType:path.endsWith('.css')?'text/css':'text/javascript',headers:{'access-control-allow-origin':'*'},body});
  });
  await page.goto(server.url);
  await page.locator('#romInput').setInputFiles({name:'frontend-only.gba',mimeType:'application/octet-stream',buffer:Buffer.from(makeGba())});
  await page.getByText('Moteur prêt. Appuie sur Démarrer').waitFor({timeout:15000});
  const frame=page.frames()[1];
  assert.equal(await frame.evaluate(()=>typeof EJS_emulator),'object');
  // L'événement réel 4.2.3 est transmis, avec données synthétiques, au miroir local.
  await frame.evaluate(()=>EJS_emulator.callEvent('saveSaveFiles',new Uint8Array([4,2,3])));
  await page.getByRole('tab',{name:'Sauvegardes',exact:true}).click();
  await page.getByRole('button',{name:'Exporter',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  await frame.evaluate(()=>{setTimeout(()=>EJS_emulator.callEvent('exit'),0);});
  await page.locator('#slotEmpty').waitFor({state:'visible'});
  assert.equal(await page.locator('iframe').count(),0);
  console.log('PASS : vrai frontend EmulatorJS 4.2.3 + SRI + ready + relais saveSaveFiles (données synthétiques) + exit. Aucun cœur ni jeu exécuté.');
  await context.close();
} finally {await browser.close();await server.close();}
