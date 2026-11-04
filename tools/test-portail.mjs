// Non-régression du site assemblé (dist/) : accueil 12 consoles, liens, démos réelles de chaque console.
// Moteurs réels : CDN EmulatorJS pour les consoles Nintendo portables/NES/SNES, moteurs vendored pour N64/PS1.
//   node tools/build-portail.mjs && PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… node tools/test-portail.mjs [url]
import { startPortail } from './serve-portail.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const remote = process.argv[2];
const server = remote ? { url: remote.endsWith('/') ? remote : remote + '/', close: async () => {} } : await startPortail();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [];
const record = (scope, step, ok, detail = '') => {
  results.push({ scope, step, ok, detail });
  console.log(`${ok ? 'RÉUSSI' : 'ÉCHEC '} [${scope}] ${step}${detail ? ` — ${detail}` : ''}`);
};

// Couleurs distinctes d'une capture d'élément (l'image est décodée dans la page).
async function colorsOf(page, locator) {
  const png = (await locator.screenshot()).toString('base64');
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const g = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d');
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    const set = new Set();
    for (let i = 0; i < d.length; i += 4 * 53) set.add((d[i] >> 3 << 10) | (d[i + 1] >> 3 << 5) | (d[i + 2] >> 3));
    return set.size;
  }, png);
}
// Proportion de pixels franchement rouges (la démo PS1 dessine un écran rouge par commande GPU native).
async function redShare(page, locator) {
  const png = (await locator.screenshot()).toString('base64');
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const g = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d');
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    let red = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] < 70 && d[i + 2] < 70) red++;
    return red / (d.length / 4);
  }, png);
}

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

async function page(path, scope) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await context.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => d.accept());
  const response = await p.goto(server.url + path);
  record(scope, `ouverture de /${path}`, !!response && response.ok(), `HTTP ${response && response.status()}`);
  return { p, context, errors };
}

try {
  // Accueil
  {
    const { p, context, errors } = await page('', 'accueil');
    const links = await p.locator('nav.grid a.card').evaluateAll((as) => as.map((a) => [a.querySelector('h3').textContent, a.getAttribute('href')]));
    record('accueil', '12 consoles sur la même page', links.length === 12, links.map((l) => l[0]).join(', '));
    for (const [name, href] of links) {
      const status = await p.evaluate(async (u) => (await fetch(u, { cache: 'no-store' })).status, href);
      record('accueil', `lien ${name}`, status === 200, `${href} → HTTP ${status}`);
    }
    for (const href of ['N64-Web-Lab-Phase1A.html', 'portables/DEMOS-LIBRES.md', 'docs/PORTAIL-8-CONSOLES.md', 'docs/CONTROLLER-V2.html']) {
      const status = await p.evaluate(async (u) => (await fetch(u, { cache: 'no-store' })).status, href);
      record('accueil', `lien de pied de page ${href}`, status === 200, `HTTP ${status}`);
    }
    await p.setViewportSize({ width: 375, height: 812 });
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    record('accueil', 'largeur téléphone sans défilement horizontal', !overflow);
    record('accueil', 'aucune erreur JavaScript', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // Consoles du lanceur Nintendo : démo libre réelle de chaque console.
  for (const [sys, demo] of [['gb', 'gb'], ['gbc', 'gbc'], ['gba', 'gba'], ['nds', 'nds'], ['nes', 'nes'], ['snes', 'snes']]) {
    const { p, context, errors } = await page(`portables/?console=${sys}`, sys);
    await p.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 60000 });
    record(sys, 'console présélectionnée depuis l’accueil', (await p.locator('#catSystem').inputValue()) === sys);
    await p.locator(`[data-portable-demo="${demo}"]`).click();
    await pressStart(p);
    await p.waitForTimeout(5000);
    // Une bordure colorée autour d'un canvas blanc ne valide pas une image de jeu.
    const colors = await p.evaluate(async () => {
      const c = Object.values(window.__portablesBoots)[0].control;
      const bmp = await createImageBitmap(new Blob([await c.screenshot()], {type:'image/png'}));
      const g = new OffscreenCanvas(bmp.width,bmp.height).getContext('2d');
      g.drawImage(bmp,0,0);
      const d=g.getImageData(0,0,bmp.width,bmp.height).data, colors=new Set();
      for(let i=0;i<d.length;i+=4)colors.add((d[i]<<16)|(d[i+1]<<8)|d[i+2]);
      return colors.size;
    });
    record(sys, 'démo libre lancée avec le vrai cœur, image non uniforme', colors >= 2, `${colors} couleurs, ${await p.locator('#gameCore').textContent()}`);
    await p.getByRole('button', { name: 'Fermer le jeu', exact: true }).click();
    await p.locator('#slotEmpty').waitFor({ state: 'visible' });
    record(sys, 'fermeture propre (iframe moteur libérée)', (await p.locator('iframe').count()) === 0);
    record(sys, 'aucune erreur JavaScript', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // Sans démo fournie : présélection et isolation, sans prétendre valider un jeu.
  for (const sys of ['psp', 'genesis', 'arcade', 'doom']) {
    const { p, context, errors } = await page(`portables/?console=${sys}`, sys);
    await p.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 60000 });
    record(sys, 'console présélectionnée depuis l’accueil', (await p.locator('#catSystem').inputValue()) === sys);
    record(sys, 'isolation inter-origines active (SharedArrayBuffer)', await p.evaluate(() => window.crossOriginIsolated === true && typeof SharedArrayBuffer === 'function'));
    record(sys, 'aucune erreur JavaScript', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // N64 et PS1 sur la même origine, avec isolation (COOP/COEP) comme sur leurs déploiements dédiés.
  for (const [scope, path, button] of [['n64', 'real-n64/', '#start'], ['ps1', 'ps1-web/', '#demo-homebrew']]) {
    const { p, context, errors } = await page(path, scope);
    record(scope, 'isolation inter-origines active', await p.evaluate(() => window.crossOriginIsolated === true));
    await p.locator(button).click();
    await p.waitForTimeout(25000);
    const status = (await p.locator('#status').textContent()).trim();
    // N64 et PS1 dessinent dans leur propre iframe moteur : on capture cette iframe.
    const view = (await p.locator('canvas').count()) > 0 ? p.locator('canvas').first() : p.locator('iframe').first();
    if (scope === 'ps1') {
      const share = await redShare(p, view);
      record(scope, 'démo homebrew lancée, écran rouge attendu affiché', share > 0.2, `${Math.round(share * 100)} % de pixels rouges ; statut : ${status.slice(0, 140)}`);
    } else {
      const colors = await colorsOf(p, view);
      record(scope, 'démo homebrew lancée, image affichée', colors >= 2, `${colors} couleurs ; statut : ${status.slice(0, 140)}`);
    }
    record(scope, 'aucune erreur JavaScript', errors.length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
  }

  {
    const { p, context, errors } = await page('N64-Web-Lab-Phase1A.html', 'labo-n64');
    record('labo-n64', 'page du laboratoire N64 intacte', (await p.title()).includes('N64 Web Lab'));
    record('labo-n64', 'aucune erreur JavaScript', errors.length === 0, errors.join(' | '));
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies.`);
if (failed.length) process.exit(1);
