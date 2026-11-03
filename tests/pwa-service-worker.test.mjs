import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../portail/sw.js', import.meta.url), 'utf8');
function worker({ offline = false, status = 200, redirected = false, quota = false } = {}) {
  const handlers = {};
  const entries = new Map();
  const deleted = [];
  const writes = [];
  const response = { ok: status === 200, status, redirected, type: 'basic', clone() { return this; } };
  const cache = {
    async addAll(paths) { for (const path of paths) entries.set(path, response); },
    async match(request) { return entries.get(new URL(request.url).pathname); },
    async put(request, value) { if (quota) throw Error('quota'); writes.push(request.url); entries.set(new URL(request.url).pathname, value); },
  };
  vm.runInNewContext(source, {
    URL, Response,
    self: { location: { origin: 'https://emuperso.example' }, addEventListener: (name, fn) => { handlers[name] = fn; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: { open: async () => cache, keys: async () => ['emuperso-sw-v1', 'emuperso-sw-v2', 'other-app'], delete: async (name) => { deleted.push(name); } },
    fetch: async () => { if (offline) throw Error('offline'); return response; },
  });
  async function lifecycle(name) { let pending; handlers[name]({ waitUntil: (p) => { pending = p; } }); await pending; }
  function request(path, options = {}) {
    let result;
    handlers.fetch({ request: new Request(new URL(path, 'https://emuperso.example'), options), respondWith: (p) => { result = p; } });
    return result;
  }
  return { request, lifecycle, entries, deleted, writes, response };
}

test('installation : uniquement les cinq ressources du portail', async () => {
  const w = worker(); await w.lifecycle('install');
  assert.deepEqual([...w.entries.keys()], ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png']);
});
test('activation : retire le cache v1 trop large et préserve les autres applications', async () => {
  const w = worker(); await w.lifecycle('activate');
  assert.deepEqual(w.deleted, ['emuperso-sw-v1']);
});
test('ROMs, BIOS, saves, moteurs, sous-pages, assetlinks et requêtes spéciales passent sans interception', () => {
  const w = worker();
  for (const path of ['/jeu.nes', '/jeu.sfc', '/jeu.bin', '/jeu.iso', '/jeu.7z', '/bios.bin', '/save.state', '/runtime.wasm', '/portables/', '/ps1-web/', '/real-n64/', '/.well-known/assetlinks.json', '/?jeu=test', 'https://cdn.example/icon-192.png']) {
    assert.equal(w.request(path), undefined, path);
  }
  assert.equal(w.request('/', { method: 'POST' }), undefined);
  assert.equal(w.request('/icon-192.png', { headers: { Range: 'bytes=0-10' } }), undefined);
});
test('portail : réseau prioritaire et copie mise à jour', async () => {
  const w = worker(); w.entries.set('/', 'ancienne version');
  assert.equal(await w.request('/'), w.response);
  assert.deepEqual(w.writes, ['https://emuperso.example/']);
});
test('hors ligne : copie du portail disponible, aucune fausse page pour une route inconnue', async () => {
  const w = worker({ offline: true }); w.entries.set('/', 'portail enregistré');
  assert.equal(await w.request('/'), 'portail enregistré');
  assert.equal((await w.request('/icon-192.png')).type, 'error');
  assert.equal(w.request('/inconnu'), undefined);
});
test('erreurs HTTP et redirections ne remplacent pas une bonne copie', async () => {
  for (const options of [{ status: 404 }, { status: 503 }, { redirected: true }]) {
    const w = worker(options); w.entries.set('/', 'bonne copie');
    assert.equal(await w.request('/'), w.response);
    assert.equal(w.entries.get('/'), 'bonne copie');
    assert.deepEqual(w.writes, []);
  }
});
test('un quota de cache dépassé conserve la réponse réseau', async () => {
  const w = worker({ quota: true });
  assert.equal(await w.request('/'), w.response);
});
