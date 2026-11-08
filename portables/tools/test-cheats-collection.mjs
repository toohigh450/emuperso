// Essai sans surveillance des jeux ET de leurs cheats, toutes consoles du lanceur, en LECTURE SEULE.
//   node tools/test-cheats-collection.mjs [--max=N] [--postes=2] [--console=nes,snes] [--jeu=motif] [--refaire]
// --jeu : seulement les jeux dont le nom contient ce motif (expression régulière, sans casse).
// EMUPERSO_SITE : autre copie du site (pour essayer une correction sans toucher à la campagne en cours).
// Pour chaque jeu qui a un fichier de codes publié sur le site, le déroulé est celui d'un joueur :
//   1. ouvrir la ROM (fenêtre de version : la version conseillée), démarrer, vérifier l'image ;
//   2. attendre les codes chargés automatiquement (cheat-autoload), les associer à la ROM ;
//   3. relancer le jeu (les codes associés s'appliquent au lancement), activer TOUS les codes valides ;
//   4. vérifier que l'image avance toujours et n'est pas uniforme, sans erreur de page.
// Un code peut être correct et pourtant ne rien montrer à l'écran : « tient » veut dire que le jeu
// supporte les codes sans planter ni se figer, pas que chaque code fait ce que son nom annonce.
// Dossiers des jeux et du site : %LOCALAPPDATA%\emuperso\tests-cheats\dossiers.json (hors dépôt) :
//   { "site": "…\\dist", "sources": { "nes": [["E:\\roms\\nes", "\\.zip$"]], … } }
// Résultats écrits après CHAQUE jeu dans ce même dossier ; une relance reprend là où l'essai s'est arrêté.
// Variables : PLAYWRIGHT_MODULE (chemin de playwright-core), CHROME_PATH. Voir TESTER-CHEATS.bat.
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findCheatCandidates, CHEAT_FOLDERS, titleKey } from '../js/cheat-autoload.mjs';
import { rankVersions } from '../js/version-picker.mjs';
import { limitActiveCodes } from '../js/codes.mjs';

const args = process.argv.slice(2);
const opt = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || '').slice(name.length + 3);
const redo = args.includes('--refaire');
const max = Number(opt('max')) || Infinity;
const workers = Math.max(1, Math.min(4, Number(opt('postes')) || 2));
const only = opt('console') ? new Set(opt('console').split(',')) : null;
const pattern = opt('jeu') ? new RegExp(opt('jeu'), 'i') : null;
const home = join(process.env.LOCALAPPDATA || '.', 'emuperso', 'tests-cheats');
const outDir = resolve(process.env.EMUPERSO_RESULTATS || home);
mkdirSync(join(outDir, 'captures'), { recursive: true });
const config = JSON.parse(readFileSync(join(home, 'dossiers.json'), 'utf8'));
const jsonPath = join(outDir, 'resultats.json');
const mdPath = join(outDir, 'RESULTATS-CHEATS.md');
const results = existsSync(jsonPath) && !redo ? JSON.parse(readFileSync(jsonPath, 'utf8')) : {};

const mod = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(mod ? pathToFileURL(mod).href : 'playwright-core');
const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const site = resolve(process.env.EMUPERSO_SITE || config.site);
const catalogue = JSON.parse(readFileSync(join(site, 'cheats-portables', 'catalogue.json'), 'utf8'));
const LABEL = { nes: 'NES', snes: 'Super Nintendo', gb: 'Game Boy', gbc: 'Game Boy Color', gba: 'Game Boy Advance', nds: 'Nintendo DS', genesis: 'Mega Drive / Genesis', psp: 'PSP', n64: 'Nintendo 64', ps1: 'PlayStation' };

// --- Liste des jeux : un par titre et par console (version conseillée), seulement ceux qui ont des codes.
const walk = (d, depth = 4) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (depth ? walk(join(d, e.name), depth - 1) : []) : [join(d, e.name)]));
const perSystem = {};
for (const [system, sources] of Object.entries(config.sources)) {
  if (only && !only.has(system)) continue;
  const files = sources.flatMap(([dir, re]) => (existsSync(dir) ? walk(dir).filter((f) => new RegExp(re, 'i').test(f)) : []));
  const groups = new Map();
  for (const path of files) {
    const name = path.replace(/^.*[\\/]/, '');
    if (pattern && !pattern.test(name)) continue;
    // Les archives portent le nom du jeu. La PSP est reconnue par son disque à l'ouverture, la N64 par
    // l'en-tête de la ROM (catalogue intégré à sa page) : tous leurs jeux sont essayés.
    const byFile = system === 'psp' || system === 'n64' || system === 'ps1';
    if (!byFile && !findCheatCandidates(system, name.replace(/\.(7z|zip)$/i, '.rom'), null, catalogue[CHEAT_FOLDERS[system]]).length) continue;
    const key = byFile ? name : titleKey(name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ name, path });
  }
  perSystem[system] = [...groups.values()].map((list) => ({ system, ...rankVersions(list)[0] }));
}
// Consoles en alternance : les premiers résultats couvrent déjà toutes les consoles.
const games = [];
for (let i = 0; Object.values(perSystem).some((l) => i < l.length); i++) for (const l of Object.values(perSystem)) if (i < l.length) games.push(l[i]);
const keyOf = (g) => `${g.system}|${g.name}`;
const todo = games.filter((g) => !results[keyOf(g)]).slice(0, max);
console.log(`${games.length} jeux avec codes (${Object.entries(perSystem).map(([s, l]) => `${s} ${l.length}`).join(', ')}), ${games.length - games.filter((g) => !results[keyOf(g)]).length} déjà notés, ${todo.length} à essayer, ${workers} poste(s). Résultats : ${outDir}`);

function save() {
  writeFileSync(jsonPath, JSON.stringify(results, null, 1));
  const rows = Object.values(results);
  const lines = [`# Essai des jeux et des cheats — ${new Date().toLocaleString('fr-CA')}`, '',
    'Déroulé de joueur dans Chrome sans fenêtre : ouverture, démarrage, codes trouvés par le site, association, relance, TOUS les codes valides activés ensemble.',
    '« tient » = le jeu continue d’afficher une image qui avance avec tous les codes actifs ; cela ne prouve pas que chaque code fait ce que son nom annonce.',
    'Un jeu qui plante seulement avec TOUS les codes peut très bien marcher avec ceux qu’on choisit : à revoir code par code.', '',
    '| Console | Essayés | Démarrent | Codes trouvés | Tiennent avec tous les codes | Plantent / figés avec les codes | Codes valides | Codes refusés |', '|---|---|---|---|---|---|---|---|'];
  const by = (s) => rows.filter((r) => r.system === s);
  for (const s of Object.keys(LABEL)) {
    const r = by(s);
    if (!r.length) continue;
    const sum = (f) => r.reduce((n, x) => n + (x.cheats?.[f] || 0), 0);
    lines.push(`| ${LABEL[s]} | ${r.length}/${(perSystem[s] || []).length || '?'} | ${r.filter((x) => x.boot === 'image').length} | ${r.filter((x) => x.cheats?.file).length} | ${r.filter((x) => x.cheats?.verdict === 'tient').length} | ${r.filter((x) => ['figé', 'noir', 'erreur'].includes(x.cheats?.verdict)).length} | ${sum('valid')} | ${sum('invalid')} |`);
  }
  lines.push('', '## Détail', '', '| Console | Jeu | Démarrage | Fichier de codes | Codes (valides / refusés) | Avec les codes | Détail |', '|---|---|---|---|---|---|---|');
  for (const r of rows.sort((a, b) => a.system.localeCompare(b.system) || a.name.localeCompare(b.name))) {
    const c = r.cheats || {};
    lines.push(`| ${LABEL[r.system]} | ${r.name} | ${r.boot}${r.fps != null ? ` (${r.fps} img/s)` : ''} | ${c.file || '—'}${c.match ? ` (${c.match})` : ''} | ${c.valid ?? '—'} / ${c.invalid ?? '—'} | ${c.verdict || '—'}${c.fps != null ? ` (${c.fps} img/s)` : ''} | ${(r.detail || '').replace(/\|/g, '/').slice(0, 200)} |`);
  }
  writeFileSync(mdPath, `${lines.join('\n')}\n`);
}

// --- Site servi tel que construit (dist), avec les en-têtes d'isolation de Vercel.
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.cht': 'text/plain; charset=utf-8' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let file = resolve(site, `.${path}`);
  if (!file.startsWith(site + sep) && file !== site) { res.writeHead(403).end(); return; }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}/`;
const launch = () => chromium.launch({ headless: true, executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });

// --- Un jeu.
async function openRom(page, g, timeout) {
  await page.locator('#romInput').setInputFiles(g.path);
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const pick = page.locator('.version-picker .btn.primary');
    if (await pick.isVisible().catch(() => false)) await pick.click().catch(() => {});
    const status = await page.locator('#status').textContent();
    if (/Moteur prêt/.test(status) && (await page.locator('iframe.player-frame').count())) return status;
    // « Mémoire estimée excessive » : garde-fou du lanceur (ROM DS de 512 Mio), refus voulu.
    if (/impossible|refus|non reconnu|incomplet|trop |annulée|Aucun jeu reconnu|BIOS|excessive/i.test(status)) throw Object.assign(new Error(status), { refused: true });
    await page.waitForTimeout(500);
  }
  throw new Error('moteur pas prêt à temps');
}
async function pressStart(page) {
  const button = page.frameLocator('iframe.player-frame').locator('.ejs_start_button');
  for (let i = 0; i < 10 && (await page.evaluate(() => document.body.dataset.state)) !== 'running'; i++) {
    await button.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }
}
// Lanceur : moteur dans l'iframe player.html, image dans #screen. N64 : moteur exposé par la page ;
// PS1 : moteur dans l'iframe engine.html visible ; image dans #game pour les deux.
const own = (page) => /\/(real-n64|ps1-web)\//.test(page.url());
const frameNum = (page) => (page.url().includes('/real-n64/')
  ? page.evaluate(() => window.EJS_emulator.gameManager.getFrameNum())
  : page.url().includes('/ps1-web/')
    ? page.evaluate(() => [...document.querySelectorAll('#game iframe')].filter((f) => !f.hidden).pop().contentWindow.EJS_emulator.gameManager.getFrameNum())
    : page.frames().find((f) => f.url().includes('player.html')).evaluate(() => window.EJS_emulator.gameManager.getFrameNum()));
const screenOf = (page) => page.locator(own(page) ? '#game' : '#screen');
async function colors(page) {
  const png = await screenOf(page).screenshot();
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const g2 = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d');
    g2.drawImage(bmp, 0, 0);
    const d = g2.getImageData(0, 0, bmp.width, bmp.height).data;
    const set = new Set();
    for (let i = 0; i < d.length; i += 16) set.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    return set.size;
  }, png.toString('base64'));
}
async function measure(page, seconds) {
  const f0 = await frameNum(page);
  await page.waitForTimeout(seconds * 1000);
  const f1 = await frameNum(page);
  let c = await colors(page);
  // Écran noir de chargement : seconde chance. Les disques PS1 ont souvent une intro noire de plus
  // d'une minute (Alien Resurrection : image vers 90 s), d'où une attente plus longue ; la N64 aussi
  // (logos noirs de Donkey Kong 64, Bottom of the 9th).
  if (c < 4 && f1 > f0) {
    for (let waited = 0, limit = page.url().includes('/ps1-web/') ? 75000 : page.url().includes('/real-n64/') ? 40000 : 8000; c < 4 && waited < limit; waited += 8000) {
      await page.waitForTimeout(8000); c = await colors(page);
    }
  }
  return { fps: Math.round((f1 - f0) / seconds), colors: c, verdict: f1 <= f0 ? 'figé' : c >= 4 ? 'image' : 'noir' };
}

// N64 : page à part, codes du catalogue intégré trouvés par l'en-tête de la ROM ; chaque code s'active
// au clic, un par un (point de retour créé avant le premier).
const n64Box = (id) => [...document.querySelectorAll('#cheat-list input[type=checkbox]')].find((x) => x.dataset.cheatId === id);
async function tryN64(page, g, r) {
  await page.goto(`${base}real-n64/`, { timeout: 90000 });
  await page.locator('#rom-file').setInputFiles(g.path);
  for (const t0 = Date.now(); Date.now() - t0 < 120000 && !(await page.locator('#launch-local').isEnabled()); await page.waitForTimeout(500)) {
    if (await page.locator('#zip-choice-panel').isVisible()) await page.locator('#zip-use').click().catch(() => {});
  }
  await page.locator('#launch-local').click();
  await page.waitForFunction(() => /Session lancée|refus|impossible|échec|erreur|invalide/i.test(document.getElementById('status').textContent), null, { timeout: 180000 });
  const status = await page.locator('#status').textContent();
  if (!/Session lancée/.test(status)) { r.boot = 'refusé'; r.detail = status; return r; }
  await page.waitForTimeout(3000);
  const boot = await measure(page, 6);
  r.boot = boot.verdict; r.fps = boot.fps;
  await page.waitForFunction(() => !/Recherche des codes/.test(document.getElementById('cheat-status').textContent), null, { timeout: 30000 });
  const info = await page.locator('#cheat-status').textContent();
  const ids = await page.$$eval('#cheat-list input[type=checkbox]', (l) => l.map((i) => ({ id: i.dataset.cheatId, ok: i.dataset.unsupported === 'false' })));
  const valid = ids.filter((x) => x.ok).map((x) => x.id);
  r.cheats = { file: ids.length ? 'catalogue N64 intégré (en-tête)' : '', total: ids.length, valid: valid.length, invalid: ids.length - valid.length };
  if (!ids.length) { r.cheats.verdict = /variante/i.test(info) ? 'variante à choisir' : 'aucun fichier trouvé'; r.detail = info.slice(0, 200); return r; }
  if (!valid.length) { r.cheats.verdict = 'aucun code valide'; return r; }
  for (const id of valid) {
    await page.waitForFunction(`(${n64Box})(${JSON.stringify(id)})?.disabled === false`, null, { timeout: 60000 });
    await page.evaluate(`(() => { const i = (${n64Box})(${JSON.stringify(id)}); if (!i.checked) i.click(); })()`);
    if (/arrêtée/.test(await page.locator('#rom-current').textContent())) break;
  }
  await page.waitForFunction(`[...document.querySelectorAll('#cheat-list input')].every((i) => !i.disabled) || /arrêtée/.test(document.getElementById('rom-current').textContent)`, null, { timeout: 60000 }).catch(() => {});
  if (/arrêtée/.test(await page.locator('#rom-current').textContent())) { r.cheats.verdict = 'erreur'; r.detail = await page.locator('#cheat-status').textContent(); return r; }
  return null; // suite commune : mesure avec les codes actifs
}

// PS1 : page à part, codes du catalogue intégré trouvés par le numéro de série du disque ; édition à
// choisir quand plusieurs correspondent (la première est prise) ; chaque code s'active au clic.
async function tryPS1(page, g, r) {
  await page.goto(`${base}ps1-web/`, { timeout: 90000 });
  await page.locator('#disc-file').setInputFiles(g.path);
  // « Aucune progression depuis N s » est un avertissement (rouge) de lecture lente, pas un échec :
  // avec 4 postes sur le même disque, la lecture d'un gros .rar marque parfois une pause.
  await page.waitForFunction(() => { const s = document.getElementById('status'); return /Disque prêt/.test(s.textContent) || (s.classList.contains('error') && !/Aucune progression/.test(s.textContent)); }, null, { timeout: 420000 });
  if (!(await page.locator('#launch').isEnabled())) { r.boot = 'refusé'; r.detail = await page.locator('#status').textContent(); return r; }
  await page.locator('#launch').click();
  await page.waitForFunction(() => { const s = document.getElementById('status'); return /Session lancée/.test(s.textContent) || s.classList.contains('error'); }, null, { timeout: 300000 });
  const status = await page.locator('#status').textContent();
  if (!/Session lancée/.test(status)) { r.boot = 'refusé'; r.detail = status; return r; }
  await page.waitForTimeout(3000);
  const boot = await measure(page, 6);
  r.boot = boot.verdict; r.fps = boot.fps;
  const idle = () => page.waitForFunction(() => !document.getElementById('choose').disabled, null, { timeout: 60000 });
  await idle();
  const pick = page.locator('#cheat-list > div button').filter({ hasText: /\(\d+ codes\)/ }).filter({ hasNotText: /NON VÉRIFIÉS/ });
  if (await pick.count()) { r.cheats = { match: 'édition choisie (première)' }; await pick.first().click(); await idle(); }
  const region = page.locator('#cheat-list > div button').filter({ hasNotText: /codes|Resynchroniser|session/i });
  if (await region.count()) { await region.first().click(); await idle(); }
  const rows = await page.$$eval('#cheat-list label.cheat-row input', (l) => l.map((i) => !i.rejected));
  r.cheats = { file: rows.length ? 'catalogue PS1 intégré (numéro de série)' : '', ...(r.cheats || {}), total: rows.length, valid: rows.filter(Boolean).length, invalid: rows.filter((x) => !x).length };
  r.detail = (await page.locator('#cheat-info').textContent()).slice(0, 200);
  if (!rows.length) { r.cheats.verdict = 'aucun fichier trouvé'; return r; }
  if (!r.cheats.valid) { r.cheats.verdict = 'aucun code valide'; return r; }
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i]) continue;
    await idle();
    const box = page.locator('#cheat-list label.cheat-row input').nth(i);
    if (!(await box.isChecked())) await box.evaluate((b) => b.click());
    if (await page.locator('#cheat-list', { hasText: 'Moteur INCERTAIN' }).count()) break;
  }
  await idle().catch(() => {});
  if (await page.locator('#cheat-list', { hasText: 'Moteur INCERTAIN' }).count()) { r.cheats.verdict = 'erreur'; r.detail = 'moteur incertain après activation des codes'; return r; }
  return null;
}

// Tous les codes valides actifs : l'image doit encore avancer, sans nouvelle erreur de page.
async function withCodes(page, g, r, errors) {
  await page.waitForTimeout(4000);
  const before = errors.length;
  const after = await measure(page, 8);
  r.cheats.verdict = after.verdict === 'image' && errors.length === before ? 'tient' : after.verdict === 'image' ? 'erreur' : after.verdict;
  r.cheats.fps = after.fps;
  await screenOf(page).screenshot({ path: join(outDir, 'captures', `${g.system}-${g.name.replace(/[^\w.() -]+/g, '_').slice(0, 120)}.png`) }).catch(() => {});
  return r;
}

async function tryGame(browser, g) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  const r = { system: g.system, name: g.name, at: new Date().toISOString() };
  const slow = g.system === 'psp' || g.system === 'nds' ? 240000 : 120000;
  try {
    if (g.system === 'n64' || g.system === 'ps1') {
      const early = await (g.system === 'n64' ? tryN64 : tryPS1)(page, g, r);
      if (early) return early;
      return await withCodes(page, g, r, errors);
    }
    await page.goto(`${base}portables/?console=${g.system}`, { timeout: 90000 });
    await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 60000 });
    try { await openRom(page, g, slow); } catch (err) { r.boot = err.refused ? 'refusé' : 'erreur'; r.detail = err.message; return r; }
    await pressStart(page);
    await page.waitForTimeout(3000);
    const boot = await measure(page, 6);
    r.boot = boot.verdict; r.fps = boot.fps;
    // Codes cherchés et importés par le site : boutons « Associer » dans l'onglet Codes.
    const assoc = page.locator('#cheatMatches button', { hasText: /^Associer/ });
    await assoc.first().waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
    const n = await assoc.count();
    if (!n) { r.cheats = { verdict: 'aucun fichier trouvé' }; r.detail = (await page.locator('#cheatMatches').textContent().catch(() => '')).slice(0, 200); return r; }
    const li = assoc.first().locator('xpath=..');
    const file = (await li.locator('span').first().textContent()).trim();
    const intro = await li.locator('xpath=../preceding-sibling::p[1]').textContent().catch(() => '');
    r.cheats = { file, match: /disque/.test(intro) ? 'même disque' : /Même nom/.test(intro) ? 'même nom' : 'même titre', offered: n };
    await assoc.first().evaluate((b) => b.click()); // onglet Codes peut être caché : clic direct
    await page.waitForFunction(() => /Association enregistrée/.test(document.getElementById('cheatMatches').textContent), null, { timeout: 15000 });
    // Relance : les codes du fichier associé arrivent au lancement.
    await openRom(page, g, slow);
    await pressStart(page);
    await page.locator('#codeList input[type=checkbox]').first().waitFor({ state: 'attached', timeout: 30000 });
    const codes = await page.evaluate(() => [...document.querySelectorAll('#codeList li')].filter((li) => li.querySelector('input[type=checkbox]'))
      .map((li) => ({ code: li.querySelector('code')?.textContent || '', bad: !!li.querySelector('small.warn') })));
    const valid = codes.filter((c) => !c.bad).map((c) => c.code);
    Object.assign(r.cheats, { total: codes.length, valid: valid.length, invalid: codes.length - valid.length });
    if (!valid.length) { r.cheats.verdict = 'aucun code valide'; return r; }
    // Même limite que le lanceur (applyLiveCodes) : Mega Drive, 150 lignes de codes au plus.
    const limited = limitActiveCodes(g.system, valid);
    if (limited.dropped) r.cheats.dropped = limited.dropped;
    await page.evaluate((list) => { const boots = Object.values(window.__portablesBoots); boots[boots.length - 1].control.setCodes(list); }, limited.codes);
    return await withCodes(page, g, r, errors);
  } catch (err) {
    if (!r.boot) r.boot = 'erreur';
    if (r.cheats && !r.cheats.verdict) r.cheats.verdict = 'erreur';
    const panel = r.cheats ? ` — onglet Codes : ${((await page.locator('#cheatMatches').textContent().catch(() => '')) + ' / ' + (await page.locator('#codeList').textContent().catch(() => ''))).slice(0, 300)}` : '';
    r.detail = `${(await page.locator('#status').textContent().catch(() => '')) || ''} ${err.message.split('\n')[0]}${panel}`.trim();
    return r;
  } finally {
    if (errors.length) r.detail = [r.detail, `erreurs de page : ${[...new Set(errors)].join(' / ')}`].filter(Boolean).join(' — ').slice(0, 600);
    await context.close().catch(() => {});
  }
}

let next = 0, done = 0;
async function worker() {
  let browser = await launch();
  try {
    while (next < todo.length) {
      const g = todo[next++];
      const r = await Promise.race([tryGame(browser, g), new Promise((ok) => setTimeout(() => ok({ system: g.system, name: g.name, boot: 'erreur', detail: 'délai de 8 minutes dépassé' }), 480000))]);
      results[keyOf(g)] = r;
      save();
      done++;
      console.log(`[${done}/${todo.length}] ${g.system.padEnd(7)} ${r.boot.padEnd(7)} codes : ${(r.cheats?.verdict || '—').padEnd(8)} ${g.name}${r.cheats?.valid != null ? ` — ${r.cheats.valid} codes valides, ${r.cheats.invalid} refusés` : ''}${r.detail ? ` — ${r.detail.slice(0, 140)}` : ''}`);
      if (r.boot === 'erreur' || r.cheats?.verdict === 'erreur') { await browser.close().catch(() => {}); browser = await launch(); } // navigateur neuf après un plantage
    }
  } finally { await browser.close().catch(() => {}); }
}
try { await Promise.all(Array.from({ length: workers }, worker)); } finally { server.close(); }
save();
console.log(`Terminé. Résumé : ${mdPath}`);
