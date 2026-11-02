// Build the public distribution first. Optional ROM paths stay local to the test.
// TEST_URL=https://.../ node tests/state-frame-browser.mjs [ROM.zip ...]
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '../../portables/node_modules/playwright/index.mjs');
const server = process.env.TEST_URL ? { url: process.env.TEST_URL, close: async () => {} }
  : await (await import('../../tools/serve-portail.mjs')).startPortail();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
const evidence = process.env.EVIDENCE_DIR;
if (evidence) await mkdir(evidence, { recursive: true });
const results = [];
try {
  for (const [i, rom] of (process.argv.slice(2).length ? process.argv.slice(2) : [null]).entries()) {
    const context = await browser.newContext({ viewport: { width: 1365, height: 1000 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push({message:error.stack||error.message,url:page.url(),time:Date.now()})); page.on('dialog', dialog => dialog.accept());
    const open = async () => {
      await page.goto(new URL('real-n64/', server.url).href);
      if (rom) {
        await page.locator('#rom-file').setInputFiles(rom);
        await page.waitForFunction(() => !document.querySelector('#launch-local').disabled);
        await page.locator('#launch-local').click();
      } else await page.locator('#start').click();
      await page.waitForFunction(() => window.EJS_emulator?.gameManager?.getFrameNum() > 20, null, { timeout: 90000 });
    };
    const action = async index => {
      await page.evaluate(index => EJS_emulator.gameManager.simulateInput(0, index, 1), index);
      await page.waitForTimeout(100);
      await page.evaluate(index => EJS_emulator.gameManager.simulateInput(0, index, 0), index);
    };
    const restore = async label => {
      const initial = await page.evaluate(() => RealN64.diagnostic()); const generation=initial.session.active_generation, failures=initial.records.filter(r=>r.type==='operation.failed').length;
      await page.locator('#state-load').click();
      await page.waitForFunction(({generation,failures}) => {
        const d = RealN64.diagnostic(), message = document.querySelector('#save-status').textContent;
        return d.session.candidate_generation === null && !document.querySelector('#state-load').disabled &&
          (d.session.active_generation > generation || d.records.filter(r=>r.type==='operation.failed').length > failures);
      }, {generation,failures}, { timeout: 45000 });
      const message = await page.locator('#save-status').textContent();
      if(!/État chargé|mémoire est déjà conforme/.test(message) && evidence)await writeFile(evidence+'/failed-diagnostic.json',JSON.stringify(await page.evaluate(()=>RealN64.diagnostic()),null,2));
      assert.match(message, /État chargé|mémoire est déjà conforme/);
      const diagnostic = await page.evaluate(() => RealN64.diagnostic());
      const proof = diagnostic.records.findLast(row => /state.memory.verified|state.memory.equivalent/.test(row.type))?.data;
      assert.ok(proof, 'RAM proof absent');
      assert.equal(proof.native_payload_read_bytes, proof.native_payload_expected_bytes);
      assert.ok(proof.memory.verified || proof.memory.equivalent);
      const before = await page.evaluate(() => EJS_emulator.gameManager.getFrameNum());
      await page.waitForTimeout(1800);
      const after = await page.evaluate(() => EJS_emulator.gameManager.getFrameNum());
      assert.ok(after > before + 10, JSON.stringify({reason:'Native frames stalled',label,before,after,errors,snapshot:await page.evaluate(()=>RealN64.diagnostic().session),records:await page.evaluate(()=>RealN64.diagnostic().records.slice(-8))}));
      if (evidence) await page.frames().find(frame => frame !== page.mainFrame()).locator('canvas').first().screenshot({ path: `${evidence}/rom-${i}-${label}.png` });
      return { label, message, proof, before, after };
    };
    await open(); await page.waitForTimeout(7000);
    if (rom) { await action(3); await page.waitForTimeout(1200); await action(8); await page.waitForTimeout(1200); await action(8); await page.waitForTimeout(7000); }
    await page.locator('#state-save').click();
    await page.waitForFunction(() => document.querySelector('#save-status').textContent.includes('État enregistré'), null, { timeout: 20000 });
    await page.waitForTimeout(1800);
    const checks = [await restore('first'), await restore('repeat')]; assert.deepEqual(errors,[], 'Before navigation');
    // Reload the document while retaining the isolated browser storage.
    await open(); checks.push(await restore('after-reload'));
    results.push({ test: rom ? `local-rom-${i}` : 'MIT-homebrew', checks, errors });
    assert.deepEqual(errors, []);
    console.log(`PASS ${rom ? `local ROM ${i}` : 'MIT homebrew'}: 3 restores, complete native reads, RAM proof, frame progression, browser reload.`);
    await context.close();
  }
} finally {
  if (evidence) await writeFile(`${evidence}/results.json`, JSON.stringify(results, null, 2));
  await browser.close(); await server.close();
}
