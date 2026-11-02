// Émulation téléphone Android dans Chrome (écran tactile, 412×915) : NE REMPLACE PAS un vrai téléphone.
// Vérifie la manette tactile NES/SNES du moteur, la mise en page portrait/paysage et la reprise après
// mise en arrière-plan.
//   node tools/build-portail.mjs && PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… node tools/test-mobile.mjs [url]
import { startPortail } from './serve-portail.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const remote = process.argv[2];
const server = remote ? { url: remote.endsWith('/') ? remote : remote + '/', close: async () => {} } : await startPortail();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [];
const record = (scope, step, ok, detail = '') => {
  results.push({ ok });
  console.log(`${ok ? 'RÉUSSI' : 'ÉCHEC '} [${scope}] ${step}${detail ? ` — ${detail}` : ''}`);
};
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

async function pressStart(page) {
  const button = page.frameLocator('iframe').locator('.ejs_start_button');
  await button.waitFor({ timeout: 120000 });
  for (let attempt = 0; attempt < 8; attempt++) {
    await button.tap({ timeout: 5000 }).catch(() => button.click({ timeout: 5000 }).catch(() => {}));
    if (await page.waitForFunction(() => document.body.dataset.state === 'running', null, { timeout: 4000 }).then(() => true, () => false)) return;
  }
  throw new Error('Le jeu ne démarre pas.');
}
const frames = (page) => page.frames()[1].evaluate(() => window.EJS_emulator.gameManager.getFrameNum());

try {
  for (const [sys, demo, expected] of [['nes', 'nes', ['A', 'B', 'START', 'SELECT']], ['snes', 'snes', ['A', 'B', 'X', 'Y', 'L', 'R', 'START', 'SELECT']]]) {
    const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, userAgent: ANDROID });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(server.url);
    await page.locator(`a.card[href="portables/?console=${sys}"]`).tap();
    await page.waitForURL(`**/portables/?console=${sys}`);
    record(sys, 'accueil → console au toucher', true);
    record(sys, 'sélecteur de ROM sans filtre « accept » sur écran tactile', (await page.locator('#romInput').getAttribute('accept')) === null);
    await page.locator(`[data-portable-demo="${demo}"]`).tap();
    await pressStart(page);
    await page.waitForTimeout(2500);
    const pad = await page.frames()[1].evaluate(() => {
      const root = document.querySelector('.ejs_virtualGamepad_parent');
      if (!root) return null;
      const visible = getComputedStyle(root).display !== 'none' && root.getBoundingClientRect().height > 0;
      const labels = [...root.querySelectorAll('.ejs_virtualGamepad_button')].filter((b) => b.getBoundingClientRect().width > 0)
        .map((b) => b.textContent.trim().toUpperCase()).filter(Boolean);
      return { visible, labels, dpad: !!root.querySelector('.ejs_dpad_main') };
    });
    const missing = pad ? expected.filter((l) => !pad.labels.includes(l)) : expected;
    record(sys, 'manette tactile visible avec les bons boutons', !!pad && pad.visible && pad.dpad && missing.length === 0, pad ? `boutons : ${pad.labels.join(' ')}${missing.length ? ` ; manquants : ${missing.join(' ')}` : ''}` : 'absente');
    // Appui tactile réel sur le bouton A virtuel : le moteur doit continuer à tourner sans erreur.
    const box = await page.frameLocator('iframe').locator('.ejs_virtualGamepad_button', { hasText: /^A$/ }).first().boundingBox();
    if (box) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    record(sys, 'appui tactile sur A sans erreur', !!box && errors.length === 0);
    const layout = await page.evaluate(() => {
      const screen = document.getElementById('screen').getBoundingClientRect();
      const stage = document.querySelector('.stage').getBoundingClientRect();
      const rail = document.querySelector('.rail').getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth, gameFirst: stage.top < rail.top, w: Math.round(screen.width), h: Math.round(screen.height), touch: getComputedStyle(document.getElementById('screen')).touchAction };
    });
    record(sys, 'portrait : jeu en haut, pas de défilement horizontal, gestes du navigateur bloqués sur l’écran', !layout.overflow && layout.gameFirst && layout.touch === 'none', `écran ${layout.w}×${layout.h}, touch-action ${layout.touch}`);
    await page.setViewportSize({ width: 915, height: 412 });
    await page.waitForTimeout(800);
    const land = await page.evaluate(() => { const r = document.getElementById('screen').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), overflow: document.documentElement.scrollWidth > innerWidth }; });
    record(sys, 'paysage : écran sur toute la hauteur', land.h >= 412 * 0.85 && !land.overflow, `écran ${land.w}×${land.h}`);
    // Arrière-plan : une autre page passe devant, puis retour. Le jeu doit reprendre.
    const before = await frames(page);
    const other = await context.newPage();
    await other.goto('about:blank');
    await other.bringToFront();
    await page.waitForTimeout(1500);
    await page.bringToFront();
    await page.waitForTimeout(1500);
    const after = await frames(page);
    record(sys, 'reprise après mise en arrière-plan', after > before && (await page.evaluate(() => document.body.dataset.state)) === 'running', `images ${before} → ${after}`);
    record(sys, 'aucune erreur JavaScript', errors.length === 0, errors.slice(0, 2).join(' | '));
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} vérifications réussies (émulation, pas un vrai téléphone).`);
if (failed) process.exit(1);
