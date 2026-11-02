// Essai de démarrage réel de ROM personnelles, en LECTURE SEULE (le navigateur lit le fichier, rien n'est
// copié, modifié ni publié). Les chemins sont donnés en argument ; aucun nom de fichier n'est enregistré
// dans le dépôt par cet outil.
//   PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… node tools/test-collection.mjs "E:\roms\...\jeu.smc" "…\jeu.zip"
import { startTestServer } from '../tests/server.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const paths = process.argv.slice(2);
if (!paths.length) throw new Error('Indique au moins un fichier de jeu.');
const server = await startTestServer();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
let failures = 0;
try {
  for (const path of paths) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(server.url);
    const name = path.split(/[\\/]/).pop();
    let line;
    try {
      await page.locator('#romInput').setInputFiles(path);
      const button = page.frameLocator('iframe.player-frame').locator('.ejs_start_button');
      await button.waitFor({ timeout: 120000 });
      for (let i = 0; i < 8 && (await page.evaluate(() => document.body.dataset.state)) !== 'running'; i++) {
        await button.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(3000);
      }
      const facts = await page.evaluate(() => ['gameSystem', 'gameRegion', 'gameDetails', 'gameCore'].map((id) => document.getElementById(id).textContent).join(' | '));
      const f0 = await page.frames().find((f) => f.url().includes('player.html')).evaluate(() => window.EJS_emulator.gameManager.getFrameNum());
      await page.waitForTimeout(8000);
      const f1 = await page.frames().find((f) => f.url().includes('player.html')).evaluate(() => window.EJS_emulator.gameManager.getFrameNum());
      const colors = await page.evaluate(async () => {
        const c = Object.values(window.__portablesBoots)[0].control;
        const bmp = await createImageBitmap(new Blob([await c.screenshot()], { type: 'image/png' }));
        const g = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d');
        g.drawImage(bmp, 0, 0);
        const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
        const set = new Set();
        for (let i = 0; i < d.length; i += 4) set.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
        return `${set.size} couleurs ${bmp.width}×${bmp.height}`;
      });
      const fps = Math.round((f1 - f0) / 8);
      const ok = f1 > f0 && errors.length === 0;
      line = `${ok ? 'RÉUSSI' : 'ÉCHEC '} ${name} — ${facts} — ${fps} images/s (headless) — ${colors}${errors.length ? ` — erreurs : ${errors.join(' | ')}` : ''}`;
      if (!ok) failures++;
    } catch (err) {
      failures++;
      line = `ÉCHEC  ${name} — ${(await page.locator('#status').textContent().catch(() => '')) || err.message}`;
    }
    console.log(line);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failures ? 1 : 0);
