// Un seul jeu par processus ; le superviseur, hors du navigateur, impose le délai global.
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { config,readJSON,atomic,stamp,fileHash,hash,classify,inside,processInfo,sleep,ext } from './lib.mjs';

const [configPath,jobFile,token]=process.argv.slice(2);
const c=config(configPath),job=readJSON(jobFile),out=path.dirname(jobFile);
const temporary=path.join(c.stateDir,'tmp',token);
fs.mkdirSync(temporary,{recursive:true});
process.env.TEMP=temporary;process.env.TMP=temporary;
const r={version:1,id:job.item.id,attempt:job.attempt,token,system:job.item.system,name:job.item.name,entry:job.item.entry,mode:c.mode,start:new Date().toISOString(),errors:[],consoleErrors:[],blockedRequests:[],phase:'prepare',engineStarted:false,validation:{gameplay:false,nativeSave:false,saveState:false}};
r.runnerWorkerSha256=hash(fs.readFileSync(new URL('./worker.mjs',import.meta.url)));
// Si le superviseur meurt, ce worker ne doit pas poursuivre seul à l'infini.
let completed=false;
process.on('disconnect',()=>{if(completed)return;setTimeout(()=>process.exit(3),1000);browserServer?.close().catch(()=>{});});
const progress=()=>atomic(path.join(out,'progress.json'),r);
const phase=p=>{r.phase=p;progress();};
let server,browser,browserServer,page;
async function inputFile() {
  r.originalBefore=stamp(job.item.path);
  if(JSON.stringify(r.originalBefore)!==JSON.stringify(job.item.original))throw Error('Source modifiée depuis l’inventaire : refaire inventory.');
  r.originalSha256=await fileHash(job.item.path);
  if(!job.item.entry)return job.item.path;
  if(job.item.bytes>c.maxExtractMiB*1048576)throw Error('Entrée au-dessus du plafond de décompression.');
  const destination=path.join(temporary,'game.'+ext(job.item.entry));
  const handle=fs.openSync(destination,'wx');
  try {
    await new Promise((resolve,reject)=>{
      const child=spawn(c.sevenZip,['x','-so','-spd','--',job.item.path,job.item.entry],{windowsHide:true,stdio:['ignore','pipe','pipe']});
      let n=0,err='',failed=false;
      child.stdout.on('data',b=>{n+=b.length;if(n>c.maxExtractMiB*1048576||n>job.item.bytes){failed=true;child.kill();}else fs.writeSync(handle,b);});
      child.stderr.on('data',b=>{err=(err+b).slice(-4096);});
      child.on('error',reject);child.on('close',code=>code===0&&!failed&&n===job.item.bytes?resolve():reject(Error('Extraction refusée/incomplète : '+err)));
    });
  }finally{fs.closeSync(handle);}
  r.extractedSha256=await fileHash(destination);
  return destination;
}
async function localServer() {
  const manifest=readJSON(path.join(c.appDir,'PORTAIL-MANIFEST.json'));
  if(!manifest?.sha256)throw Error('Construire dist/ avec tools/build-portail.mjs avant le test.');
  r.appManifestSha256=hash(fs.readFileSync(path.join(c.appDir,'PORTAIL-MANIFEST.json')));
  const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.svg':'image/svg+xml'};
  const s=createServer((req,res)=>{
    try {
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
      let rel=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname).slice(1);
      if(!rel||rel.endsWith('/'))rel+='index.html';
      const file=path.resolve(c.appDir,rel);
      if(!inside(c.appDir,file)||!Object.hasOwn(manifest.sha256,rel)){res.writeHead(404).end();return;}
      const bytes=fs.readFileSync(file);
      if(hash(bytes)!==manifest.sha256[rel]){res.writeHead(409).end('Application modifiée après construction');return;}
      res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
      res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
      res.end(req.method==='HEAD'?undefined:bytes);
    }catch{res.writeHead(404).end();}
  });
  await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${s.address().port}/`,close:()=>new Promise(resolve=>{s.closeAllConnections();s.close(resolve);})};
}
async function engine(page) {
  for(const f of [...page.frames().filter(f=>f!==page.mainFrame()),page.mainFrame()])if(await f.evaluate(()=>!!window.EJS_emulator?.gameManager).catch(()=>false))return f;
  throw Error('Objet du moteur introuvable');
}
async function capture(page,label) {
  const f=await engine(page);
  // PNG fourni par le moteur pour les Nintendo 2D ; canvas seul, hors menu DOM, pour N64/PS1.
  const gpu=['n64','ps1'].includes(job.item.system);
  const png=gpu?await f.locator('canvas').first().screenshot():Buffer.from(await f.evaluate(async()=>Array.from(await window.EJS_emulator.gameManager.screenshot())));
  const facts=await page.evaluate(async b64=>{
    const bytes=Uint8Array.from(atob(b64),x=>x.charCodeAt(0));const bmp=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
    const ctx=new OffscreenCanvas(bmp.width,bmp.height).getContext('2d');ctx.drawImage(bmp,0,0);
    const d=ctx.getImageData(0,0,bmp.width,bmp.height).data,set=new Set();let samples=0;
    // Bordure extérieure exclue pour éviter qu'une bordure transforme un écran uni en réussite.
    const margin=Math.max(1,Math.floor(Math.min(bmp.width,bmp.height)*0.03));
    for(let y=margin;y<bmp.height-margin;y+=2)for(let x=margin;x<bmp.width-margin;x+=2){const i=(y*bmp.width+x)*4;set.add((d[i]>>3<<10)|(d[i+1]>>3<<5)|(d[i+2]>>3));samples++;}
    return {width:bmp.width,height:bmp.height,colors:set.size,samples,pixelHash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',d))].map(x=>x.toString(16).padStart(2,'0')).join('')};
  },png.toString('base64'));
  facts.frame=await f.evaluate(()=>window.EJS_emulator.gameManager.getFrameNum());
  facts.at=Date.now();facts.image=label+'.png';facts.method=gpu?'canvas DOM uniquement, sans interface autour':'PNG natif du moteur';
  fs.writeFileSync(path.join(out,facts.image),png);
  return facts;
}
try {
  phase('hash-and-extract');
  const input=await inputFile();
  // Pour les petites ROMs, éviter les erreurs NotFound de FileReader sur certains chemins Windows.
  // Les octets passent par le protocole LOCAL de Chrome, jamais par une requête HTTP distante.
  const selection=fs.statSync(input).size<=32*1048576?{name:path.basename(input),mimeType:'application/octet-stream',buffer:fs.readFileSync(input)}:input;
  r.inputMode=typeof selection==='string'?'fichier local en lecture seule':'octets vers Chrome local, fichier inférieur ou égal à 32 Mio';
  server=await localServer();
  let module=process.env.PLAYWRIGHT_MODULE;
  if(module&&path.isAbsolute(module))module=pathToFileURL(module).href;
  const {chromium}=await import(module||'playwright');
  browserServer=await chromium.launchServer({headless:true,executablePath:c.chrome,args:['--autoplay-policy=no-user-gesture-required','--emuperso-lab='+token]});
  const owner=await processInfo(browserServer.process().pid);
  if(owner){const rec={...owner,token};atomic(path.join(out,'browser-owner.json'),rec);process.send?.({browserOwner:rec});}
  browser=await chromium.connect(browserServer.wsEndpoint());
  r.chrome=browser.version();
  const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:false,serviceWorkers:'block'});
  await context.route('**/*',route=>{
    const q=route.request(),u=new URL(q.url());
    // Seuls des fichiers de distribution connus peuvent quitter localhost en lecture GET.
    const cdn=u.origin==='https://cdn.emulatorjs.org'&&!u.search&&(/^\/4\.2\.3\/data\/(?:loader\.js|emulator(?:\.min)?\.(?:js|css)|src\/[A-Za-z0-9_.-]+\.(?:js|css)|compression\/[A-Za-z0-9_.-]+\.(?:js|wasm)|cores\/(?:reports\/)?[A-Za-z0-9_.-]+\.(?:json|js|wasm|data|zip)|localization\/[A-Za-z0-9_.-]+\.json)$/.test(u.pathname)||u.pathname==='/stable/data/version.json');
    if(['GET','HEAD'].includes(q.method())&&(q.url().startsWith(server.url)||['blob:','data:'].includes(u.protocol)||cdn))return route.continue();
    if(r.blockedRequests.length<50)r.blockedRequests.push({method:q.method(),url:u.origin+u.pathname.slice(0,180)});
    progress();
    return route.abort();
  });
  page=await context.newPage();page.setDefaultTimeout(10000);
  page.on('pageerror',e=>{if(r.errors.length<50)r.errors.push(e.stack||e.message);});
  page.on('crash',()=>{r.crashed=true;progress();});
  page.on('console',m=>{if(m.type()==='error'&&r.consoleErrors.length<50)r.consoleErrors.push(m.text().slice(0,1500));});
  page.on('dialog',d=>d.dismiss());
  phase('boot');const began=Date.now(),s=job.item.system;
  await page.goto(server.url+(s==='ps1'?'ps1-web/':s==='n64'?'real-n64/':'portables/?console='+s),{waitUntil:'domcontentloaded'});
  if(!['ps1','n64'].includes(s)) {
    await page.waitForFunction(()=>document.body.dataset.ready==='true',null,{timeout:30000});
    await page.locator('#romInput').setInputFiles(selection);
    await page.waitForFunction(()=>document.querySelector('iframe.player-frame')||document.querySelector('#status')?.dataset.kind==='error',null,{timeout:90000});
    if(!await page.locator('iframe.player-frame').count())throw Error(await page.locator('#status').textContent()||'Fichier refusé avant le moteur');
    const button=page.frameLocator('iframe.player-frame').locator('.ejs_start_button');
    await button.waitFor({timeout:90000});
    for(let i=0;i<8;i++){
      await button.click({timeout:3000}).catch(()=>{});
      if(await page.waitForFunction(()=>document.body.dataset.state==='running',null,{timeout:3000}).then(()=>true,()=>false))break;
    }
    if(await page.evaluate(()=>document.body.dataset.state)!=='running')throw Error(await page.locator('#status').textContent()||'Démarrage non confirmé');
    r.identity=await page.evaluate(()=>Object.fromEntries(['gameSystem','gameCore','gameRegion','gameDetails'].map(id=>[id,document.getElementById(id)?.textContent])));
  } else {
    const ps=s==='ps1';await page.locator(ps?'#disc-file':'#rom-file').setInputFiles(selection);
    const launch=ps?'#launch':'#launch-local';
    await page.waitForFunction(id=>!document.querySelector(id).disabled,launch,{timeout:90000});await page.locator(launch).click();
    let ready=false;
    for(let i=0;i<90;i++){const f=await engine(page).catch(()=>null);if(f&&await f.evaluate(()=>window.EJS_emulator.gameManager.getFrameNum()>5).catch(()=>false)){ready=true;break;}await sleep(1000);}
    if(!ready)throw Error('Le moteur ne produit pas de progression du compteur.');
  }
  r.engineStarted=true;r.bootMs=Date.now()-began;
  if(c.diagnostics?.hangAfterBoot===true&&(!c.diagnostics.hangSystem||c.diagnostics.hangSystem===s)) {
    r.controlledFault='Boucle infinie injectée volontairement dans le renderer après le démarrage.';
    phase('controlled-renderer-hang');
    await page.evaluate(()=>{for(;;){} });
  }
  phase('observe');await sleep(s==='ps1'?12000:3000);
  r.before=await capture(page,'before');progress();
  await sleep(c.mode==='deep'?c.deepObservationMs:c.observationMs);
  r.after=await capture(page,'after');
  const elapsed=(r.after.at-r.before.at)/1000;
  r.frameRate=r.after.frame>=r.before.frame?(r.after.frame-r.before.frame)/elapsed:null;
  r.performanceMeaning='Incréments du compteur EmulatorJS par seconde observée ; ni FPS vidéo natifs ni preuve de gameplay.';
  r.imageChanged=r.before.pixelHash!==r.after.pixelHash;
  if(c.mode==='deep') {
    phase('inputs');const f=await engine(page);
    r.inputs=[];
    for(const key of [3,8,0,7]) {
      await f.evaluate(k=>window.EJS_emulator.gameManager.simulateInput(0,k,1),key);await sleep(180);
      await f.evaluate(k=>window.EJS_emulator.gameManager.simulateInput(0,k,0),key);await sleep(700);r.inputs.push({controller:0,key,heldMs:180});
    }
    r.afterInputs=await capture(page,'after-inputs');
    r.inputMeaning='Signaux envoyés ; réaction à vérifier dans les captures. Gameplay non validé.';
  }
  await page.screenshot({path:path.join(out,'interface.png'),fullPage:true});
  phase('finish');
} catch(e) {
  r.error=e.stack||e.message;
  if(page) {
    r.pageStatus=await page.locator('#status').textContent({timeout:2000}).catch(()=>null);
    await page.screenshot({path:path.join(out,'failure-interface.png'),fullPage:true,timeout:3000}).catch(()=>{});
  }
}
finally {
  try {r.originalAfter=stamp(job.item.path);r.originalSha256After=await fileHash(job.item.path);r.originalChanged=JSON.stringify(r.originalBefore)!==JSON.stringify(r.originalAfter)||r.originalSha256!==r.originalSha256After;}catch(e){r.originalChanged=true;r.verificationError=e.message;}
  r.end=new Date().toISOString();r.elapsedMs=Date.parse(r.end)-Date.parse(r.start);r.status=classify(r);progress();
  atomic(path.join(out,'result.json'),r);
  // La fermeture de Chrome ne doit pas consommer tout le délai du jeu.
  // Après huit secondes, le worker quitte et le superviseur ferme l'arbre Chrome identifié.
  let closeTimer;
  const close=async()=>{await browser?.close();await browserServer?.close();await server?.close();return true;};
  r.gracefulBrowserClose=await Promise.race([close().catch(()=>false),new Promise(resolve=>{closeTimer=setTimeout(()=>resolve(false),8000);})]);
  clearTimeout(closeTimer);atomic(path.join(out,'result.json'),r);
  completed=true;if(process.connected)process.disconnect();
  if(!r.gracefulBrowserClose)setTimeout(()=>process.exit(0),50);
}
