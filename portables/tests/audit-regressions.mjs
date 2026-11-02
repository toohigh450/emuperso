// Régressions des audits cloud : stockage réel IndexedDB, moteur simulé, profil isolé.
import assert from 'node:assert/strict';
import { startTestServer } from './server.mjs';
import { makeNesTestRom } from './test-roms.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = await startTestServer();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
const context = await browser.newContext();
const mock = `
  window.imports = [];
  window.codeCalls = [];
  let save = new Uint8Array([1,2,3]);
  window.EJS_emulator = { started: true, on() {}, gameManager: {
    resetCheat() { codeCalls = []; }, setCheat(i,on,code) { codeCalls.push(code); },
    getSaveFile() { return save; }, getSaveFilePath() { return '/test.sav'; },
    loadSaveFiles() {}, restart() {}, saveSaveFiles() {},
    FS: { analyzePath() { return {exists:true}; }, unlink() {},
      writeFile(path,bytes) { imports.push([...bytes]); save = bytes; }, syncfs(flag,done) { done(); } }
  } };
  document.querySelector('#game').innerHTML = '<button class="ejs_start_button">Démarrer</button>';
  document.querySelector('button').onclick = () => EJS_onGameStart();
  EJS_ready();
`;
try {
  await context.route('**/js/engine.mjs', route => route.fulfill({ contentType: 'text/javascript', body:
    `export const ENGINE_VERSION='test', LOADER_INTEGRITY=''; export const REMOTE_ENGINE={path:'https://engine.test/'};` }));
  await context.route('https://engine.test/**', route => route.fulfill({ contentType: 'text/javascript', headers: {'access-control-allow-origin':'*'}, body: mock }));
  const page = await context.newPage();
  page.on('dialog', d => d.accept());
  await page.goto(server.url);
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  const upload = async () => {
    await page.locator('#romInput').setInputFiles({ name: 'audit.nes', mimeType: 'application/octet-stream', buffer: Buffer.from(makeNesTestRom()) });
    await page.frameLocator('iframe.player-frame').locator('button').waitFor();
    await page.waitForFunction(() => !document.querySelector('#changeGame').disabled);
  };
  await upload();
  const frame = () => page.frames().find(f => f.url().includes('player.html'));
  // Refus du remplacement si le stockage refuse la copie ; export encore disponible.
  await page.evaluate(async () => {
    const { IdbAdapter } = await import('./js/store.mjs');
    window.rotate = IdbAdapter.prototype.rotateMirror;
    IdbAdapter.prototype.rotateMirror = async () => { throw new DOMException('quota', 'QuotaExceededError'); };
  });
  const importFile = () => page.locator('#saveImport').setInputFiles({ name: 'new.sav', mimeType: 'application/octet-stream', buffer: Buffer.from([9,9,9]) });
  await importFile();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Copie de sécurité impossible'));
  assert.deepEqual(await frame().evaluate(() => ({ imports, save: [...EJS_emulator.gameManager.getSaveFile()] })), { imports: [], save: [1,2,3] });
  await page.getByRole('tab', {name:'Sauvegardes',exact:true}).click();
  const download = page.waitForEvent('download');
  await page.locator('#saveExport').click();
  await download;
  await page.evaluate(async () => { const {IdbAdapter}=await import('./js/store.mjs'); IdbAdapter.prototype.rotateMirror=window.rotate; });
  await importFile();
  await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Sauvegarde importée'));
  assert.deepEqual(await frame().evaluate(() => imports), [[9,9,9]]);
  assert.deepEqual(await page.evaluate(async () => {
    const {Store,IdbAdapter}=await import('./js/store.mjs');
    const s=new Store(new IdbAdapter()); const g=(await s.listGames())[0];
    return [...(await s.getMirrorSave(g.spaceId)).bytes];
  }), [1,2,3]);
  console.log('PASS import : quota bloque le remplacement, export possible, reprise et ancienne sauvegarde vérifiée.');
  // Deux changements déclenchés dans la même tâche doivent rester actifs tous les deux.
  await page.getByRole('tab', {name:'Codes',exact:true}).click();
  for (const code of ['0300:16','0301:17']) {
    await page.locator('#codeValue').fill(code);
    await page.locator('#codeAddForm button[type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#codeValue').value === '');
  }
  await page.locator('#codeList input[type=checkbox]').evaluateAll(nodes => nodes.forEach(n => { n.checked=true; n.dispatchEvent(new Event('change')); }));
  await page.waitForFunction(() => document.querySelectorAll('#codeList input:checked').length === 2);
  assert.deepEqual(await frame().evaluate(() => codeCalls), ['0300:16','0301:17']);
  const other = await context.newPage();
  await other.goto(server.url);
  const update = (p, id) => p.evaluate(async id => {
    const {Store,IdbAdapter}=await import('./js/store.mjs');
    await new Store(new IdbAdapter()).updateCodes('multi-tab', entries => [...entries, {id}]);
  }, id);
  await Promise.all([update(page, 'A'), update(other, 'B')]);
  assert.deepEqual(await page.evaluate(async () => {
    const {Store,IdbAdapter}=await import('./js/store.mjs');
    return (await new Store(new IdbAdapter()).getCodes('multi-tab')).map(e=>e.id).sort();
  }), ['A','B']);
  assert.deepEqual(await page.evaluate(async () => {
    const {Store,IdbAdapter}=await import('./js/store.mjs');
    const s=new Store(new IdbAdapter());
    let rejected=false;
    try { await s.updateCodes('multi-tab', entries=>{entries.length=0;throw new Error('mutation annulée');}); }
    catch {rejected=true;}
    await s.updateCodes('multi-tab',entries=>[...entries,{id:'C'}]);
    return {rejected,ids:(await s.getCodes('multi-tab')).map(e=>e.id).sort()};
  }), {rejected:true,ids:['A','B','C']});
  await other.close();
  console.log('PASS codes : deux activations simultanées en interface et écritures dans deux onglets.');
  // Erreur et rejet après ready, puis erreur en exécution : retour visible au lanceur.
  for (const mode of ['error', 'rejection', 'running']) {
    if (mode === 'running') await page.frameLocator('iframe.player-frame').locator('button').click();
    await frame().evaluate(mode => {
      setTimeout(() => window.dispatchEvent(mode === 'rejection'
        ? new PromiseRejectionEvent('unhandledrejection', {reason: new Error('audit rejet'), promise: Promise.resolve()})
        : new ErrorEvent('error', {message:'audit erreur'})), 0);
    }, mode);
    await page.waitForFunction(() => document.body.dataset.state === 'idle');
    assert.match(await page.locator('#status').textContent(), /audit/);
    await upload();
  }
  // Un moteur prêt attend l'utilisateur sans délai ; le délai propre au cœur débute au clic.
  const result = await page.evaluate(async () => {
    const {createBrowserHost}=await import('./js/player-host.mjs');
    const mount=document.createElement('div'); document.body.append(mount);
    let error='', started=false;
    const h=await createBrowserHost(mount,{timeoutMs:500,startTimeoutMs:60}).create({
      enginePaths:[{path:'https://engine.test/'}], rom:{name:'test.nes',bytes:new Uint8Array([1])}, ejs:{}
    }, {onReady(){},onStarting(){started=true;},onStart(){},onExit(){},onError(e){error=e;}});
    while (!mount.querySelector('iframe')?.contentWindow.EJS_ready) await new Promise(r=>setTimeout(r,10));
    await new Promise(r=>setTimeout(r,150));
    const before=error;
    const w=mount.querySelector('iframe').contentWindow;
    w.document.querySelector('button').onclick=null;
    w.document.querySelector('button').click();
    await new Promise(r=>setTimeout(r,150));
    await h.destroy(); mount.remove(); return {before,error,started};
  });
  assert.equal(result.before,''); assert.equal(result.started,true); assert.match(result.error,/Délai de démarrage/);
  const cleared = await page.evaluate(async () => {
    const {createBrowserHost}=await import('./js/player-host.mjs');
    const mount=document.createElement('div');document.body.append(mount);
    let errors=0;
    const h=await createBrowserHost(mount,{startTimeoutMs:60}).create({enginePaths:[{path:'https://engine.test/'}],rom:{name:'test.nes',bytes:new Uint8Array([1])},ejs:{}},
      {onReady(){},onStarting(){},onStart(){},onExit(){},onError(){errors++;}});
    while(!mount.querySelector('iframe')?.contentWindow.EJS_ready)await new Promise(r=>setTimeout(r,10));
    mount.querySelector('iframe').contentDocument.querySelector('button').click();
    await new Promise(r=>setTimeout(r,150));
    await h.destroy();mount.remove();return errors;
  });
  assert.equal(cleared,0);
  console.log('PASS moteur : erreurs après ready et running, rejet asynchrone et délai de démarrage après clic.');
} finally { await context.close(); await browser.close(); await server.close(); }
