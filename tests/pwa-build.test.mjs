import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('assemblage isolé : ressources PWA copiées, secrets et jeux privés exclus', () => {
  const root = mkdtempSync(join(tmpdir(), 'emuperso-build-'));
  const put = (path, value = 'fixture synthétique') => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), value);
  };
  try {
    mkdirSync(join(root, 'tools'));
    copyFileSync(new URL('../tools/build-portail.mjs', import.meta.url), join(root, 'tools/build-portail.mjs'));
    const wallpapers = ['nes', 'snes', 'gb', 'gbc', 'gba', 'nds', 'genesis', 'n64', 'ps1', 'psp', 'portal', 'debugger'].map((id) => `bg/bg-${id}.jpg`);
    const resources = ['index.html', 'manifest.webmanifest', 'sw.js', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
      'i18n.js', 'i18n/fr.json', 'i18n/en.json', 'logo.png', 'portail.js', 'changelog.json', ...wallpapers];
    // Fixtures de copie uniquement : ne représentent pas des icônes installables.
    for (const name of resources) put('portail/' + name, 'fixture ' + name);
    for (const app of ['ps1-web', 'real-n64']) {
      put(app + '/dist/index.html');
      put(app + '/dist/runtime.wasm');
      put(app + '/dist/.env.local', 'SECRET');
      put(app + '/dist/test.keystore', 'SECRET');
      put(app + '/dist/private/jeu.nes', 'PRIVATE');
      put(app + '/dist/private/jeu.wad', 'PRIVATE');
      put(app + '/dist/private/jeu.md', Buffer.alloc(512));
    }
    const excluded = ['.git', '.env', '.env.local', 'nested/.env.production', '.aws/credentials', '.ssh/id_rsa', '.codex/config.toml', 'nested/test.jks', 'test.keystore', 'test.p12', 'private.pem', 'EMUPERSO.apk', 'jeu.iso', 'jeu.gba', 'save.sav',
      'private/jeu.nes', 'private/jeu.sfc', 'private/jeu.swc', 'private/jeu.fig', 'private/jeu.unf', 'private/jeu.unif', 'private/doom2.wad', 'private/save.state1', 'private/save.st0'];
    for (const name of excluded) put(name, 'SECRET');
    put('portables/js/app.mjs', 'export const preserved = true;');
    const demos = ['portables/demos/opennes-snake.nes', 'portables/demos/opensnes-input.sfc'];
    for (const name of demos) put(name, 'public homebrew fixture');
    put('docs/preserved.md', '# Documentation');
    put('private/jeu.md', Buffer.alloc(512));
    put('ps1-web/dist/homebrew/demo-emuperso-ps1.iso', 'public PS1 homebrew fixture');
    put('real-n64/dist/homebrew/fallback-open/demo-emuperso-open.z64', 'public N64 homebrew fixture');
    // APK de test placé exprès dans portail/android/ : seul .apk publié (lien de la page d'accueil).
    put('portail/android/EMUPERSO.apk', 'fixture apk');
    const result = spawnSync(process.execPath, ['tools/build-portail.mjs'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    for (const name of resources) assert.equal(readFileSync(join(root, 'dist', name), 'utf8'), 'fixture ' + name);
    for (const name of excluded) assert.equal(existsSync(join(root, 'dist', name)), false, name);
    assert.equal(existsSync(join(root, 'dist/private/jeu.md')), false);
    for (const name of demos) assert.equal(readFileSync(join(root, 'dist', name), 'utf8'), 'public homebrew fixture');
    assert.equal(readFileSync(join(root, 'dist/docs/preserved.md'), 'utf8'), '# Documentation');
    for (const app of ['ps1-web', 'real-n64']) {
      assert.ok(existsSync(join(root, 'dist', app, 'runtime.wasm')));
      for (const name of ['.env.local', 'test.keystore', 'private/jeu.nes', 'private/jeu.wad', 'private/jeu.md']) assert.equal(existsSync(join(root, 'dist', app, name)), false, app + '/' + name);
    }
    assert.ok(existsSync(join(root, 'dist/ps1-web/homebrew/demo-emuperso-ps1.iso')));
    assert.ok(existsSync(join(root, 'dist/real-n64/homebrew/fallback-open/demo-emuperso-open.z64')));
    assert.equal(readFileSync(join(root, 'dist/portables/js/app.mjs'), 'utf8'), 'export const preserved = true;');
    assert.equal(readFileSync(join(root, 'dist/android/EMUPERSO.apk'), 'utf8'), 'fixture apk');
    const manifest = JSON.parse(readFileSync(join(root, 'dist/PORTAIL-MANIFEST.json')));
    assert.equal(manifest.fichiers, Object.keys(manifest.sha256).length);
    assert.ok(manifest.sha256['sw.js']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
