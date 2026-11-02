// Essai RÉEL NES / SNES : vrais cœurs FCEUmm et Snes9x (EmulatorJS 4.2.3, CDN), vraie interface du lanceur.
// ROM utilisées : ROM d'essai écrites pour le projet (tests/test-roms.mjs) et homebrews libres de demos/.
// Aucune ROM commerciale. Réseau requis (CDN EmulatorJS). Chrome installé requis.
//   PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… node tests/real-nes-snes.mjs
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer } from './server.mjs';
import { makeNesTestRom, makeSnesTestRom, NES_TEST, SNES_TEST } from './test-roms.mjs';
import { encodeNesGameGenie, encodeSnesGameGenie } from '../js/codes.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = await startTestServer();
const profile = await mkdtemp(join(tmpdir(), 'emuperso-nes-snes-'));
const results = [];
const record = (system, step, ok, detail = '') => {
  results.push({ system, step, ok, detail });
  console.log(`${ok ? 'RÉUSSI' : 'ÉCHEC '} [${system}] ${step}${detail ? ` — ${detail}` : ''}`);
};
const launch = () => chromium.launchPersistentContext(profile, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--autoplay-policy=no-user-gesture-required'],
  acceptDownloads: true,
  viewport: { width: 1280, height: 900 },
});

const SYSTEMS = {
  nes: { T: NES_TEST, rom: makeNesTestRom(), file: 'Essai couleur (USA).nes', gg: encodeNesGameGenie(NES_TEST.colorRom, NES_TEST.gg), ram: '0300:16',
    hue: { base: 'b', gg: 'g', ram: 'r' } },
  snes: { T: SNES_TEST, rom: makeSnesTestRom(), file: 'Essai couleur (U).sfc', gg: encodeSnesGameGenie(SNES_TEST.colorRom, SNES_TEST.gg), ram: '7E0100:03',
    hue: { base: 'r', gg: 'b', ram: 'g' } },
};
const dominant = ([r, g, b]) => (r >= g && r >= b ? 'r' : g >= b ? 'g' : 'b');

async function control(page, fn, arg) {
  return page.evaluate(async ({ src, arg }) => {
    const entry = Object.values(window.__portablesBoots)[0];
    // eslint-disable-next-line no-new-func
    return new Function('c', 'arg', `return (${src})(c, arg);`)(entry.control, arg);
  }, { src: fn.toString(), arg });
}
async function pixel(page) {
  return control(page, async (c) => {
    const png = await c.screenshot();
    const bmp = await createImageBitmap(new Blob([png], { type: 'image/png' }));
    const g = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d');
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(bmp.width >> 1, bmp.height >> 1, 1, 1).data;
    return [d[0], d[1], d[2]];
  });
}
async function variety(page) {
  return control(page, async (c) => {
    const png = await c.screenshot();
    const bmp = await createImageBitmap(new Blob([png], { type: 'image/png' }));
    const g = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d');
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    const colors = new Set();
    for (let i = 0; i < d.length; i += 4) colors.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    return { colors: colors.size, width: bmp.width, height: bmp.height };
  });
}
const settle = (page, ms = 700) => page.waitForTimeout(ms);
// Le bouton Démarrer du moteur peut apparaître avant d'être actif : on réessaie jusqu'au démarrage.
async function pressStart(page) {
  const button = page.frameLocator('iframe.player-frame').locator('.ejs_start_button');
  await button.waitFor({ timeout: 120000 });
  for (let attempt = 0; attempt < 8; attempt++) {
    await button.click({ timeout: 5000 }).catch(() => {});
    const running = await page.waitForFunction(() => document.body.dataset.state === 'running', null, { timeout: 4000 }).then(() => true, () => false);
    if (running) return;
  }
  throw new Error('Le jeu ne démarre pas après 8 appuis sur Démarrer.');
}
async function startGame(page) {
  await pressStart(page);
  await settle(page, 1200);
}
async function openRom(page, name, bytes) {
  await page.locator('#romInput').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
  await startGame(page);
}
async function saveCounter(page) {
  const save = await control(page, (c) => { const s = c.getSave(); return s ? [...s.slice(0, 4)] : null; });
  return save ? save[0] : null;
}
// Le compteur change quelques images après un redémarrage ou un chargement : on l'attend (8 s au plus).
async function waitCounter(page, ok) {
  let n = null;
  for (let i = 0; i < 16; i++) {
    n = await saveCounter(page);
    if (ok(n)) return n;
    await page.waitForTimeout(500);
  }
  return n;
}
async function audioState(page) {
  return page.frames().find((f) => f.url().includes('player.html')).evaluate(() => {
    const m = window.EJS_emulator && window.EJS_emulator.Module;
    const ctx = m && m.AL && m.AL.currentCtx && m.AL.currentCtx.audioCtx;
    return ctx ? ctx.state : 'inconnu';
  });
}

let context = await launch();
let page = context.pages()[0] || await context.newPage();
const errors = [];
const watch = (p) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (d) => d.accept()); };
watch(page);
await page.goto(server.url);
await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 60000 });

const counters = {};
for (const [sys, S] of Object.entries(SYSTEMS)) {
  await openRom(page, S.file, S.rom);
  const label = await page.locator('#gameSystem').textContent();
  record(sys, 'ouverture d’une ROM locale et démarrage du vrai cœur', true, `${label}, ${await page.locator('#gameCore').textContent()}`);
  const v = await variety(page);
  record(sys, 'affichage', v.width >= 256 && v.height >= 224, `${v.width}×${v.height}`);
  record(sys, 'contexte audio', (await audioState(page)) === 'running', `état ${await audioState(page)} (écoute réelle non vérifiée)`);
  const base = await pixel(page);
  record(sys, 'couleur de base', dominant(base) === S.hue.base, base.join(','));

  // Codes : ajout (désactivé), activation, désactivation, code RAM, suppression.
  await page.getByRole('tab', { name: 'Codes', exact: true }).click();
  await page.locator('#codeName').fill('Couleur Game Genie');
  await page.locator('#codeValue').fill(S.gg.toLowerCase());
  await page.getByRole('button', { name: 'Ajouter (désactivé)' }).click();
  await page.getByText('Code ajouté, désactivé.').waitFor();
  await settle(page);
  record(sys, 'code ajouté mais inactif', dominant(await pixel(page)) === S.hue.base);
  await page.getByLabel(/Couleur Game Genie/).check();
  await settle(page);
  const gg = await pixel(page);
  record(sys, `Game Genie ${S.gg} activé`, dominant(gg) === S.hue.gg, gg.join(','));
  await page.getByLabel(/Couleur Game Genie/).uncheck();
  await settle(page);
  const ggOff = await pixel(page);
  record(sys, 'Game Genie désactivé', dominant(ggOff) === S.hue.base, ggOff.join(','));
  await page.locator('#codeName').fill('Couleur RAM');
  await page.locator('#codeValue').fill(S.ram);
  await page.getByRole('button', { name: 'Ajouter (désactivé)' }).click();
  await page.getByText('Code ajouté, désactivé.').waitFor();
  await page.getByLabel(/Couleur RAM/).check();
  await settle(page);
  const ram = await pixel(page);
  record(sys, `code RAM ${S.ram} activé`, dominant(ram) === S.hue.ram, ram.join(','));
  await page.getByLabel(/Couleur RAM/).uncheck();
  await settle(page);
  record(sys, 'code RAM désactivé', dominant(await pixel(page)) === S.hue.base);
  await page.locator('#codeValue').fill(sys === 'nes' ? 'C2AF-3D07' : 'SXIOPO');
  await page.getByRole('button', { name: 'Ajouter (désactivé)' }).click();
  await page.getByText(/n’est pas un code (NES|SNES) reconnu/).waitFor();
  record(sys, 'code d’une autre console refusé avec message', true);

  // Sauvegarde normale : compteur de démarrages en mémoire sauvegardée.
  counters[sys] = await saveCounter(page);
  record(sys, 'sauvegarde normale lue (compteur de démarrages)', counters[sys] >= 1, `compteur ${counters[sys]}`);
  await page.getByRole('tab', { name: 'Sauvegardes', exact: true }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exporter maintenant' }).click();
  const exported = await dl;
  record(sys, 'export de la sauvegarde', /\.sav$/.test(exported.suggestedFilename()), exported.suggestedFilename());

  // État : enregistrer, redémarrer (compteur + 1), recharger l'état (compteur revenu).
  await page.locator('#stateSlots').getByRole('button', { name: 'Enregistrer' }).first().click();
  await page.getByText(/État enregistré dans l’emplacement 1/).waitFor();
  await control(page, (c) => c.restart());
  const afterRestart = await waitCounter(page, (n) => n === counters[sys] + 1);
  await page.locator('#stateSlots').getByRole('button', { name: 'Charger', exact: true }).first().click();
  const afterLoad = await waitCounter(page, (n) => n === counters[sys]);
  record(sys, 'save state : enregistrer puis charger', afterRestart === counters[sys] + 1 && afterLoad === counters[sys], `avant ${counters[sys]}, après redémarrage ${afterRestart}, après chargement ${afterLoad}`);

  // Import d'une sauvegarde (compteur forcé à 0x40) : le jeu redémarre et l'incrémente.
  const sav = new Uint8Array(sys === 'nes' ? 8192 : 2048); sav[0] = 0x40;
  await page.locator('#saveImport').setInputFiles({ name: 'import.sav', mimeType: 'application/octet-stream', buffer: Buffer.from(sav) });
  await page.getByText(/Sauvegarde importée/).waitFor();
  await settle(page, 1200);
  const imported = await saveCounter(page);
  record(sys, 'import d’une sauvegarde', imported === 0x41, `compteur ${imported}`);
  counters[sys] = imported;
}
record('nes→snes', 'changement de ROM et de console sans recharger', (await page.locator('#gameSystem').textContent()).includes('Super Nintendo'));

// Fermeture du navigateur : la sauvegarde du moteur et les codes doivent survivre.
await page.getByRole('button', { name: 'Fermer le jeu', exact: true }).click();
await page.locator('#slotEmpty').waitFor({ state: 'visible' });
await settle(page, 1500);
await context.close();
context = await launch();
page = context.pages()[0] || await context.newPage();
watch(page);
await page.goto(server.url);
for (const [sys, S] of Object.entries(SYSTEMS)) {
  await openRom(page, `renommé-${S.file}`, S.rom);
  const counter = await saveCounter(page);
  // NES quitté par changement de ROM, SNES par « Fermer le jeu » : les deux doivent avoir écrit leur sauvegarde.
  const expected = counters[sys] + 1;
  record(sys, 'sauvegarde retrouvée après fermeture du navigateur', counter === expected, `compteur ${counter}, attendu ${expected}`);
  await page.getByRole('tab', { name: 'Codes', exact: true }).click();
  await page.getByLabel(/Couleur Game Genie/).waitFor();
  const checked = await page.getByLabel(/Couleur Game Genie/).isChecked();
  record(sys, 'codes enregistrés retrouvés, toujours désactivés', !checked && dominant(await pixel(page)) === S.hue.base);
  await page.getByLabel(/Couleur Game Genie/).check();
  await settle(page);
  record(sys, 'code réactivé après relance', dominant(await pixel(page)) === S.hue.gg);
  await page.getByLabel(/Couleur Game Genie/).uncheck();
  await page.getByRole('tab', { name: 'Sauvegardes', exact: true }).click();
  await page.locator('#stateSlots').getByText(/Emplacement 1 : (?!vide)/).waitFor();
  record(sys, 'état de jeu conservé après fermeture du navigateur', true);
}

// Démos libres et puces spéciales : démarrage et image non uniforme après quelques secondes.
for (const [key, label] of [['nes', 'NES · Snake'], ['snes', 'SNES · Neon Breaker'], ['snes-shmup', 'SNES · Shmup'], ['snes-sa1', 'SA-1 · Étoiles'], ['snes-dsp1', 'DSP-1 · Sol']]) {
  await page.evaluate(() => { document.querySelector('.demo-panel details').open = true; });
  await page.locator(`[data-portable-demo="${key}"]`).click();
  await startGame(page);
  await settle(page, 4000);
  const v = await variety(page);
  record(key, `démo « ${label} » démarrée et affichée`, v.colors >= 2, `${v.colors} couleurs échantillonnées, ${v.width}×${v.height}`);
}
await page.getByRole('button', { name: 'Fermer le jeu', exact: true }).click();
record('page', 'aucune erreur JavaScript de la page', errors.length === 0, errors.slice(0, 3).join(' | '));
await context.close();
await server.close();
await rm(profile, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies.`);
if (failed.length) process.exit(1);
