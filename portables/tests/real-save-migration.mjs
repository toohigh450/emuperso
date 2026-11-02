// Essai RÉEL de reprise des sauvegardes GB / GBC / GBA / DS (vrais cœurs EmulatorJS 4.2.3, CDN).
// L'ANCIENNE version du lanceur (commit LEGACY_COMMIT, sauvegardes nommées d'après le fichier) et la
// nouvelle sont servies sur la même origine : elles partagent donc la même base du navigateur, comme
// sur le site publié. Les sauvegardes « anciennes » sont créées par l'ancienne version elle-même.
// ROM : ROM d'essai écrites pour le projet (tests/test-roms.mjs) et démo libre Pong-NDS. Réseau requis.
//   PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… node tests/real-save-migration.mjs
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeGbTestRom, makeGbaTestRom } from './test-roms.mjs';
import { fingerprint, ejsGameName } from '../js/hash.mjs';

// Dernière version où GB/GBC/GBA/DS nommaient la sauvegarde d'après le fichier de la ROM.
const LEGACY_COMMIT = process.env.LEGACY_COMMIT || '7d2db05';
const here = fileURLToPath(new URL('../', import.meta.url));
const work = await mkdtemp(join(tmpdir(), 'emuperso-migration-'));
execSync(`git archive --format=tar ${LEGACY_COMMIT} portables | tar -x -C "${work.replace(/\\/g, '/')}"`, { cwd: join(here, '..'), shell: 'bash' });
const legacyRoot = join(work, 'portables');

const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  let path = new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html');
  let root = here;
  if (path.startsWith('/ancien/')) { root = legacyRoot; path = path.slice('/ancien'.length); }
  const file = resolve(root, '.' + path);
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}/`;

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());

const results = [];
const record = (system, step, ok, detail = '') => {
  results.push({ ok });
  console.log(`${ok ? 'RÉUSSI' : 'ÉCHEC '} [${system}] ${step}${detail ? ` — ${detail}` : ''}`);
};

async function goto(version) {
  await page.goto(origin + (version === 'ancien' ? 'ancien/' : ''));
  await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 60000 });
}
const engineFrame = () => page.frames().find((f) => f.url().includes('player.html'));
async function waitEngineReady() {
  await page.frameLocator('iframe.player-frame').locator('.ejs_start_button').waitFor({ timeout: 120000 });
}
async function pressStart() {
  const button = page.frameLocator('iframe.player-frame').locator('.ejs_start_button');
  await button.waitFor({ timeout: 120000 });
  for (let attempt = 0; attempt < 8; attempt++) {
    await button.click({ timeout: 5000 }).catch(() => {});
    if (await page.waitForFunction(() => document.body.dataset.state === 'running', null, { timeout: 4000 }).then(() => true, () => false)) {
      await page.waitForTimeout(1500);
      return;
    }
  }
  throw new Error('Le jeu ne démarre pas.');
}
async function openRom(name, bytes) {
  await page.locator('#romInput').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
}
async function openDemo(key) {
  await page.locator(`[data-portable-demo="${key}"]`).click();
}
const savePath = () => engineFrame().evaluate(() => window.EJS_emulator.gameManager.getSaveFilePath());
async function counter() {
  return page.evaluate(() => { const s = Object.values(window.__portablesBoots)[0].control.getSave(); return s ? s[0] : null; });
}
async function waitCounter(want) {
  let n = null;
  for (let i = 0; i < 16; i++) { n = await counter(); if (n === want) return n; await page.waitForTimeout(500); }
  return n;
}
async function closeGame() {
  await page.getByRole('button', { name: 'Fermer le jeu', exact: true }).click();
  await page.locator('#slotEmpty').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
}
// Lecture directe de la base du moteur (même origine que les deux versions).
function engineFile(path) {
  return page.evaluate((path) => new Promise((resolve, reject) => {
    const r = indexedDB.open('/data/saves');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result;
      const q = db.transaction('FILE_DATA').objectStore('FILE_DATA').get(path);
      q.onsuccess = () => { db.close(); resolve(q.result && q.result.contents ? [...new Uint8Array(q.result.contents.buffer, q.result.contents.byteOffset, q.result.contents.byteLength)] : null); };
      q.onerror = () => reject(q.error);
    };
  }), path);
}
const warningsText = () => page.locator('#gameWarnings').textContent();
const newStem = async (bytes, core) => ejsGameName('', core, (await fingerprint(bytes)).hex);

// --- Game Boy ------------------------------------------------------------------------
const gb = makeGbTestRom();
const gbNew = `/data/saves/Gambatte/${await newStem(gb, 'gambatte')}.srm`;
const gbOld = '/data/saves/Gambatte/Aventure (France).srm';

await goto('ancien');
await openRom('Aventure (France).gb', gb);
await pressStart();
const c1 = await waitCounter(1);
const oldPath = await savePath();
record('gb', 'ancienne version : sauvegarde nommée d’après le fichier', oldPath === gbOld && c1 === 1, `${oldPath}, compteur ${c1}`);
await closeGame();
const legacyBytes = await engineFile(gbOld);
record('gb', 'ancienne sauvegarde écrite dans la base du moteur', !!legacyBytes && legacyBytes[0] === 1);

await goto('nouveau');
await openRom('Aventure (France).gb', gb);
await waitEngineReady();
const copied = await engineFile(gbNew);
record('gb', 'copie faite avant le démarrage du moteur, octet pour octet', !!copied && copied.length === legacyBytes.length && copied.every((b, i) => b === legacyBytes[i]), copied ? `${copied.length} octets` : 'absente');
await pressStart();
const newPath = await savePath();
const c2 = await waitCounter(2);
record('gb', 'nouvelle version : sauvegarde reprise et utilisée par le jeu', newPath === gbNew && c2 === 2, `${newPath}, compteur ${c2}`);
record('gb', 'message « sauvegarde reprise » affiché', /Sauvegarde existante reprise depuis « Aventure \(France\) »/.test(await warningsText()));
await closeGame();
const legacyAfter = await engineFile(gbOld);
record('gb', 'ancienne sauvegarde intacte', !!legacyAfter && legacyAfter.every((b, i) => b === legacyBytes[i]), `compteur ${legacyAfter && legacyAfter[0]}`);

await openRom('Aventure renommée.gb', gb);
await pressStart();
const c3 = await waitCounter(3);
record('gb', 'ROM renommée : même sauvegarde (empreinte)', c3 === 3 && (await savePath()) === gbNew, `compteur ${c3}`);
record('gb', 'aucune nouvelle reprise une fois la copie faite', !/Sauvegarde existante reprise/.test(await warningsText()));
await closeGame();

// L'ancienne version joue encore sous l'ancien nom : la nouvelle ne doit jamais écraser sa propre sauvegarde.
await goto('ancien');
await openRom('Aventure (France).gb', gb);
await pressStart();
const legacyAgain = await waitCounter(2);
await closeGame();
await goto('nouveau');
await openRom('Aventure (France).gb', gb);
await pressStart();
const c4 = await waitCounter(4);
record('gb', 'sauvegarde au nouveau nom jamais remplacée par l’ancienne', legacyAgain === 2 && c4 === 4, `ancienne ${legacyAgain}, nouvelle ${c4} (attendu 4)`);
await closeGame();

// ROM renommée AVANT la première ouverture dans la nouvelle version : reprise par le nom du lancement précédent.
const gb2 = makeGbTestRom({ variant: 1 });
await goto('ancien');
await openRom('Second.gb', gb2);
await pressStart();
const d1 = await waitCounter(1);
await closeGame();
await goto('nouveau');
await openRom('Second renommé.gbc', gb2);
await pressStart();
const d2 = await waitCounter(2);
record('gb', 'ROM renommée avant la mise à jour : reprise via le nom précédent', d1 === 1 && d2 === 2 && /depuis « Second »/.test(await warningsText()), `compteurs ${d1} puis ${d2}`);
await closeGame();

// Jeu jamais ouvert : rien n'est copié, aucun message.
await openRom('Inconnu.gb', makeGbTestRom({ variant: 2 }));
await pressStart();
const e1 = await waitCounter(1);
record('gb', 'jeu sans ancienne sauvegarde : départ normal, aucun message', e1 === 1 && !/Sauvegarde existante reprise|non reprise/.test(await warningsText()), `compteur ${e1}`);
await closeGame();

// --- Game Boy Advance ------------------------------------------------------------------
const gba = makeGbaTestRom();
await goto('ancien');
await openRom('Course (Europe).gba', gba);
await pressStart();
const g1 = await waitCounter(1);
const gbaOldPath = await savePath();
await closeGame();
await goto('nouveau');
await openRom('Course (Europe).gba', gba);
await pressStart();
const g2 = await waitCounter(2);
const gbaNewPath = await savePath();
record('gba', 'sauvegarde SRAM reprise par la nouvelle version', g1 === 1 && g2 === 2 && gbaOldPath === '/data/saves/mGBA/Course (Europe).srm'
  && gbaNewPath === `/data/saves/mGBA/${await newStem(gba, 'mgba')}.srm`, `${gbaOldPath} → ${gbaNewPath}, compteurs ${g1} puis ${g2}`);
await closeGame();

// --- DS (démo libre Pong-NDS) ------------------------------------------------------------
// La démo n'écrit pas de sauvegarde : l'ancienne version en reçoit une, écrite par son propre moteur
// au chemin qu'il indique, puis la nouvelle doit la retrouver sous le nom de l'empreinte.
const dsSeed = Array.from({ length: 64 }, (_, i) => (i * 37 + 11) & 0xff);
await goto('ancien');
await openDemo('nds');
await pressStart();
const dsOld = await savePath();
await engineFrame().evaluate((seed) => new Promise((resolve) => {
  const gm = window.EJS_emulator.gameManager;
  gm.FS.writeFile(gm.getSaveFilePath(), new Uint8Array(seed));
  gm.FS.syncfs(false, resolve);
}), dsSeed);
await page.getByRole('button', { name: 'Fermer le jeu', exact: true }).click();
await page.locator('#slotEmpty').waitFor({ state: 'visible' });
const dsLegacy = await engineFile(dsOld);
await goto('nouveau');
await openDemo('nds');
await waitEngineReady();
await pressStart();
const dsNew = await savePath();
const dsCopied = await engineFile(dsNew);
record('nds', 'DeSmuME 2015 : sauvegarde reprise sous le nom de l’empreinte', dsOld === '/data/saves/DeSmuME 2015/Pong-NDS.dsv' && /^\/data\/saves\/DeSmuME 2015\/rom-[0-9a-f]{64}-desmume2015\.dsv$/.test(dsNew)
  && !!dsLegacy && !!dsCopied && dsSeed.every((b, i) => dsCopied[i] === b), `${dsOld} → ${dsNew}`);
record('nds', 'ancienne sauvegarde DS intacte', (await engineFile(dsOld) || []).every((b, i) => b === dsSeed[i]));
await closeGame();

// Dossier du second cœur DS sans BIOS (melonDS demande un BIOS : dossier lu dans le binaire du cœur).
await page.getByRole('tab', { name: 'Moteur', exact: true }).click();
await page.getByLabel(/^DeSmuME \(sans BIOS\)/).check();
await openDemo('nds');
await pressStart();
const dsAlt = await savePath();
record('nds', 'DeSmuME : dossier de sauvegarde « DeSmuME »', dsAlt.startsWith('/data/saves/DeSmuME/'), dsAlt);
await closeGame();
await page.getByLabel(/^DeSmuME 2015/).check();

record('page', 'aucune erreur JavaScript', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
server.close();
await rm(work, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} vérifications réussies.`);
process.exit(failed ? 1 : 0);
