// Vérifie l'application avec un moteur simulé, sans ROM commerciale ni téléchargement.
// npm install --no-save playwright, puis npm run test:browser (Chromium requis).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { makeGb, makeGba, makeNds } from './helpers.mjs';
import { createHash } from 'node:crypto';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.mjs': 'text/javascript', '.css': 'text/css' })[extname(path)] || 'application/octet-stream');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext();
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  const mockEngine = `
    if (!(EJS_gameUrl instanceof File)) throw Error('ROM must be an iframe File');
    if (!EJS_gameUrl.name.endsWith('.' + (EJS_core === 'gb' ? (EJS_gameUrl.name.endsWith('.gbc') ? 'gbc' : 'gb') : EJS_core === 'gba' ? 'gba' : 'nds'))) throw Error('wrong ROM extension');
    window.testCheats = EJS_cheats;
    window.testGameName = EJS_gameName;
    const listeners = new Map();
    window.EJS_emulator = { on(name, fn) { listeners.set(name, fn); }, emit(name, value) { listeners.get(name)?.(value); } };
    document.getElementById('game').innerHTML = '<button id="start">Démarrer test</button>';
    document.getElementById('start').onclick = () => {
      EJS_onGameStart();
      EJS_emulator.emit('saveSaveFiles', new Uint8Array([1,2,3]));
    };
    EJS_ready();
  `;
  const mockIntegrity = 'sha256-' + createHash('sha256').update(mockEngine).digest('base64');
  await context.route('**/js/engine.mjs', route => route.fulfill({ contentType: 'text/javascript', body: `export const ENGINE_VERSION='test'; export const LOADER_INTEGRITY='${mockIntegrity}'; export const REMOTE_ENGINE={path:'https://cdn.emulatorjs.org/4.2.3/data/',integrity:LOADER_INTEGRITY};` }));
  await context.route('https://cdn.emulatorjs.org/**', route => route.fulfill({ contentType: 'text/javascript', headers: {'access-control-allow-origin':'*'}, body: mockEngine }));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByRole('button', { name: 'Choisir un jeu', exact: true }).waitFor();
  page.on('dialog', dialog => dialog.accept());
  const rom = makeGba({ title: 'IDENTITY', code: 'ABCE' });
  const upload = async (name, buffer) => {
    await page.locator('#romInput').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(buffer) });
    await page.waitForFunction(() => !document.getElementById('changeGame').disabled);
    await page.frameLocator('iframe').locator('#start').waitFor();
  };
  const cheats = () => page.frames()[1].evaluate(() => window.testCheats);
  await upload('Identity (USA).gba', rom);
  assert.deepEqual(await cheats(), []);
  await page.getByRole('tab', { name: 'Codes', exact: true }).click();
  await page.locator('#cheatFiles').setInputFiles({ name: 'Identity (USA).cht', mimeType: 'text/plain', buffer: Buffer.from('cheat0_desc = "Test"\ncheat0_code = "12345678+1234"') });
  await page.getByText('Même nom : région').waitFor();
  assert.deepEqual(await cheats(), []);
  await page.getByRole('button', { name: 'Associer à cette ROM', exact: true }).click();
  await page.getByText('Association enregistrée pour cette ROM :').waitFor();
  await upload('Renamed.gba', rom);
  assert.deepEqual(await cheats(), [['Test', '12345678+1234']]);
  await page.frameLocator('iframe').locator('#start').click();
  await page.getByRole('tab', { name: 'Sauvegardes', exact: true }).click();
  await page.getByRole('button', { name: 'Exporter', exact: true }).waitFor();
  // P03 : une erreur avant session.start ne doit déplacer ni la session ni ses outils.
  await page.evaluate(async () => {
    const {IdbAdapter} = await import('./js/store.mjs');
    const original = IdbAdapter.prototype.put;
    window.restoreHistory = () => { IdbAdapter.prototype.put = original; };
    IdbAdapter.prototype.put = function(bucket,key,value) {
      if (bucket === 'games' && value.title === 'BLOCKED') throw new Error('quota historique simulé');
      return original.call(this,bucket,key,value);
    };
  });
  await page.locator('#romInput').setInputFiles({ name:'Blocked.gba', mimeType:'application/octet-stream', buffer:Buffer.from(makeGba({title:'BLOCKED'})) });
  await page.getByText('Ouverture impossible : quota historique simulé').waitFor();
  assert.equal(await page.locator('#gameFile').textContent(),'Renamed.gba');
  assert.deepEqual(await cheats(), [['Test', '12345678+1234']]);
  await page.getByRole('tab',{name:'Codes',exact:true}).click();
  await page.locator('#cheatSearch').fill('identity');
  await page.getByText('Association enregistrée pour cette ROM :').waitFor();
  await page.evaluate(() => window.restoreHistory());
  const changed = rom.slice(); changed[1000] ^= 1;
  await upload('Identity (USA).gba', changed);
  assert.deepEqual(await cheats(), []);
  await page.getByRole('tab', { name: 'Codes', exact: true }).click();
  // Une déclaration d'empreinte permet de retrouver une ROM sans son nom original.
  const hash = createHash('sha256').update(changed).digest('hex');
  await page.locator('#cheatFiles').setInputFiles({ name: 'Other name.cht', mimeType: 'text/plain', buffer: Buffer.from(`rom_sha256 = "${hash}"\ncheat0_desc = "By hash"\ncheat0_code = "11111111+2222"`) });
  await page.getByText('identifié(s) par SHA-256 complet').waitFor();
  await upload('Encore renommé.gba', changed);
  assert.deepEqual(await cheats(), [['By hash', '11111111+2222']]);
  // Recharge du navigateur : association explicite et fichiers conservés dans IndexedDB.
  await page.reload();
  await upload('Persistent.gba', rom);
  assert.deepEqual(await cheats(), [['Test', '12345678+1234']]);
  // P06 : un fichier réimporté au même chemin doit être confirmé à nouveau.
  await page.getByRole('tab',{name:'Codes',exact:true}).click();
  await page.locator('#cheatFiles').setInputFiles({ name:'Identity (USA).cht', mimeType:'text/plain', buffer:Buffer.from('cheat0_desc = "Changed"\ncheat0_code = "00000000+3333"') });
  await page.getByRole('button',{name:'Confirmer les nouveaux codes',exact:true}).waitFor();
  await upload('Persistent.gba',rom);
  assert.deepEqual(await cheats(), []);
  await page.getByRole('button',{name:'Confirmer les nouveaux codes',exact:true}).click();
  await upload('Persistent.gba',rom);
  assert.deepEqual(await cheats(), [['Changed','00000000+3333']]);
  const legacyRom = rom.slice(); legacyRom[999] = 7;
  const legacyHash = createHash('sha256').update(legacyRom).digest('hex');
  await page.evaluate(async ({hash}) => {
    const { Store, IdbAdapter } = await import('./js/store.mjs');
    await new Store(new IdbAdapter()).recordGame({ gameKey: 'gba:' + hash.slice(0,32), title: 'ANCIEN', hash, coreId: 'mgba' });
  }, {hash: legacyHash});
  await upload('legacy.gba', legacyRom);
  assert.equal(await page.frames()[1].evaluate(() => window.testGameName), `ancien-${legacyHash.slice(0,8)}-mgba`);
  await upload('legacy-renamed.gba', legacyRom);
  assert.equal(await page.frames()[1].evaluate(() => window.testGameName), `ancien-${legacyHash.slice(0,8)}-mgba`);
  for (const [name, bytes, label] of [
    ['jeu.gb', makeGb(), 'Game Boy'],
    ['jeu.gbc', makeGb({ cgb: 0xc0 }), 'Game Boy Color'],
    ['jeu.nds', makeNds(), 'Nintendo DS'],
  ]) {
    await upload(name, bytes);
    assert.equal(await page.locator('#gameSystem').textContent(), label);
    assert.deepEqual(await cheats(), []);
    assert.equal(await page.locator('iframe').count(), 1);
  }
  await upload('mal-nommé.nds', rom);
  assert.equal(await page.locator('#gameSystem').textContent(), 'Game Boy Advance');
  await page.getByRole('button', { name: 'Fermer le jeu', exact: true }).click();
  await page.locator('#slotEmpty').waitFor({ state: 'visible' });
  assert.equal(await page.locator('iframe').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS Chromium : import GB/GBC/GBA/DS, suggestions, association SHA-256, renommage, ROM modifiée, persistance IndexedDB, miroir de sauvegarde, fermeture. Moteur simulé ; aucune émulation réelle validée.');
  // P04 : interruption après chacune des trois écritures d'une vraie transaction IDB.
  const atomic = await page.evaluate(async () => {
    const {Store,IdbAdapter} = await import('./js/store.mjs');
    const adapter = new IdbAdapter('audit-atomic-mirrors');
    const store = new Store(adapter);
    for (const n of [1,2,3]) await store.mirrorSave('A',new Uint8Array([n]),String(n));
    const before = await store.mirrorInfo('A');
    const results = [];
    for (const failAt of [1,2,3]) {
      const original = IDBObjectStore.prototype.put;
      let writes=0, rejected=false;
      IDBObjectStore.prototype.put = function(...args) {
        const request = original.apply(this,args);
        if (this.name==='saves' && this.transaction.db.name==='audit-atomic-mirrors' && ++writes===failAt) {
          const tx=this.transaction;request.addEventListener('success',()=>tx.abort());
        }
        return request;
      };
      try { await store.mirrorSave('A',new Uint8Array([4]),'4'); }
      catch { rejected=true; }
      finally { IDBObjectStore.prototype.put=original; }
      results.push(rejected && JSON.stringify(await store.mirrorInfo('A'))===JSON.stringify(before));
    }
    await store.mirrorSave('A',new Uint8Array([5]),'5');
    const recovered=(await store.getMirrorSave('A')).hash==='5';
    (await adapter.open()).close();
    return {results,recovered};
  });
  assert.deepEqual(atomic,{results:[true,true,true],recovered:true});
  const ids = await page.evaluate(async () => {
    const {Store,IdbAdapter}=await import('./js/store.mjs');
    const a=new IdbAdapter('audit-numeric-collisions'), b=new IdbAdapter('audit-numeric-collisions');
    const results=await Promise.all([new Store(a).engineNumericId('A',9),new Store(b).engineNumericId('B',9)]);
    const again=await new Store(b).engineNumericId('A',500);
    (await a.open()).close();(await b.open()).close();
    return {results,again};
  });
  assert.deepEqual(ids,{results:[9,10],again:9});
  // P07 : HTTP 200 sans ready, puis source saine dans une iframe neuve.
  await context.route('**/stuck/loader.js',route=>route.fulfill({contentType:'text/javascript',body:'window.stuckEngine=true;'}));
  const retry=await page.evaluate(async ({integrity,rom})=>{
    const {createBrowserHost}=await import('./js/player-host.mjs');
    const mount=document.createElement('div');document.body.append(mount);
    const host=createBrowserHost(mount,{timeoutMs:500});
    const boot={enginePaths:[{path:'stuck/'},{path:'https://cdn.emulatorjs.org/4.2.3/data/',integrity}],rom:{name:'test.gba',bytes:new Uint8Array(rom)},ejs:{EJS_core:'gba',EJS_cheats:[],EJS_gameName:'retry',EJS_gameID:9}};
    let readyResolve;const ready=new Promise(r=>readyResolve=r);
    const handle=await host.create(boot,{onReady:()=>readyResolve(),onStart(){},onExit(){},onError:e=>readyResolve(e)});
    const error=await ready;
    const child=mount.querySelector('iframe').contentWindow;
    const result={error:error||null,stale:!!child.stuckEngine,bytes:await child.EJS_gameUrl.arrayBuffer().then(b=>b.byteLength),frames:mount.querySelectorAll('iframe').length};
    handle.destroy();mount.remove();
    result.boots=Object.keys(window.__portablesBoots).length;
    return result;
  },{integrity:mockIntegrity,rom:[...rom]});
  assert.deepEqual(retry,{error:null,stale:false,bytes:rom.length,frames:1,boots:0});
  assert.deepEqual(errors,[]);
  console.log('PASS Chromium audits : quota historique A→B, .cht réimporté, rollback IndexedDB après écritures 1/2/3, reprise après abort, collisions multi-connexions et source 200 sans ready.');
  await context.close();
  const blocked = await browser.newContext();
  await blocked.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: { open() { throw new Error('blocked'); } } }));
  const fallback = await blocked.newPage();
  await fallback.goto(`http://127.0.0.1:${server.address().port}/`);
  await fallback.getByText('Stockage local indisponible : historique, codes et copies de sécurité temporaires').waitFor();
  assert.equal(await fallback.getByRole('tab', { name: 'Codes', exact: true }).getAttribute('aria-selected'), 'false');
  await blocked.close();
  console.log('PASS Chromium : démarrage avec IndexedDB bloqué et avertissement de stockage temporaire.');
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
}
