// Validation réelle GameCube : sert portables/, lance la démo Swiss (DOL) dans Chrome/Edge
// avec WebGPU, puis lit les métriques exportées par gcplayer.html. Aucun ROM commerciale.
// Prérequis : npm i --no-save playwright-core ; Chrome/Edge récent (CHROME_PATH ou chemins par défaut).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');

const root = fileURLToPath(new URL('../', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.dol': 'application/octet-stream', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', TYPES[extname(path)] || 'application/octet-stream');
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404).end('404'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) throw new Error('Chrome/Edge introuvable : définir CHROME_PATH.');

const timeoutMs = Number(process.env.GC_TIMEOUT_MS || 120000);
const browser = await chromium.launch({
  headless: process.env.GC_HEADED !== '1',
  executablePath,
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=default'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('dialog', (d) => { void d.accept(); });
const consoleErrors = [];
const failedRequests = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`); });
page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });
page.on('requestfailed', (r) => failedRequests.push(`failed ${r.url()} ${r.failure()?.errorText || ''}`));

const report = { browser: executablePath, url: `http://127.0.0.1:${server.address().port}/?console=gamecube`, file: process.env.GC_FILE || 'demo:gamecube', checks: {} };
try {
  await page.goto(report.url, { waitUntil: 'domcontentloaded' });
  await page.locator('#demoStatus').waitFor();
  if (process.env.GC_FILE) await page.locator('#romInput').setInputFiles(process.env.GC_FILE);
  else await page.click('[data-portable-demo="gamecube"]');
  await page.waitForTimeout(3000);
  report.checks.earlyDemoStatus = await page.locator('#demoStatus').textContent();
  report.checks.earlyState = await page.evaluate(() => document.body.dataset.state);
  report.checks.earlyStatus = await page.locator('#status').textContent();
  await page.waitForFunction(() => document.body.dataset.state !== 'idle' || document.getElementById('status').dataset.kind === 'error', null, { timeout: 30000 });

  const frame = await page.waitForEvent('framenavigated', { predicate: (f) => f.url().includes('gcplayer.html'), timeout: 30000 }).catch(() => null);
  const gcFrame = frame || page.frames().find((f) => f.url().includes('gcplayer.html'));
  assert.ok(gcFrame, 'iframe gcplayer.html absente');
  report.checks.gcFrame = true;

  try {
    await gcFrame.waitForSelector('body > canvas', { timeout: timeoutMs });
    report.checks.canvas = true;
  } catch (err) {
    report.checks.canvas = false;
    report.checks.canvasError = String(err);
  }

  const perf = await page.waitForFunction(() => {
    const e = Object.values(window.__portablesBoots || {})[0];
    const p = e && e.control && typeof e.control.getPerf === 'function' ? e.control.getPerf() : null;
    return p ? Array.from(p) : null;
  }, null, { timeout: 30000 }).then((h) => h.jsonValue()).catch(() => null);
  report.checks.perf = perf;

  await page.waitForTimeout(10000);
  const perf2 = await page.evaluate(() => {
    const e = Object.values(window.__portablesBoots || {})[0];
    const p = e && e.control && typeof e.control.getPerf === 'function' ? e.control.getPerf() : null;
    return p ? Array.from(p) : null;
  });
  report.checks.perfAfter10s = perf2;
  report.checks.save = await page.evaluate(() => {
    const e = Object.values(window.__portablesBoots || {})[0];
    const s = e && e.control && typeof e.control.getSave === 'function' ? e.control.getSave() : null;
    return s ? { bytes: s.length || s.byteLength } : null;
  }).catch(() => null);
  report.checks.status = await page.locator('#status').textContent();
  report.checks.state = await page.evaluate(() => document.body.dataset.state);
  const shot = join(mkdtempSync(join(tmpdir(), 'emuperso-gc-')), 'gamecube.png');
  await page.screenshot({ path: shot });
  report.screenshot = shot;
  report.consoleErrors = consoleErrors.slice(0, 20);
  report.failedRequests = failedRequests.slice(0, 20);
  const speed = Array.isArray(perf2) ? perf2[1] : 0;
  report.verdict = report.checks.canvas && speed > 0 ? 'BOOTED' : report.checks.canvas ? 'CANVAS_NO_PERF' : 'NO_CANVAS';
  console.log(JSON.stringify(report, null, 2));
  if (report.verdict !== 'BOOTED') process.exitCode = 2;
} catch (err) {
  report.error = String(err && err.stack || err);
  report.checks.status = await page.locator('#status').textContent().catch(() => null);
  report.checks.demoStatus = await page.locator('#demoStatus').textContent().catch(() => null);
  report.checks.state = await page.evaluate(() => document.body.dataset.state).catch(() => null);
  report.consoleErrors = consoleErrors.slice(0, 20);
  report.failedRequests = failedRequests.slice(0, 20);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
