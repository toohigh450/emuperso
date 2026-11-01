import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../js/session.mjs';

function fakeHost() {
  const log = [];
  let alive = 0;
  let maxAlive = 0;
  const host = {
    log,
    events: {},
    get alive() { return alive; },
    get maxAlive() { return maxAlive; },
    delay: null,
    fail: null,
    async create(boot, events) {
      if (host.fail) throw new Error(host.fail);
      log.push(`create:${boot.id}`);
      host.events[boot.id] = events;
      if (host.delay) await host.delay(boot.id);
      alive++;
      maxAlive = Math.max(maxAlive, alive);
      return { destroy: async () => { alive--; log.push(`destroy:${boot.id}`); } };
    },
  };
  return host;
}
const game = (id) => ({ title: id });

test('un seul jeu actif : démarrer B détruit A avant de créer B', async () => {
  const host = fakeHost();
  const s = new Session(host);
  await s.start(game('A'), { id: 'A' });
  await s.start(game('B'), { id: 'B' });
  assert.deepEqual(host.log, ['create:A', 'destroy:A', 'create:B']);
  assert.equal(host.alive, 1);
  assert.equal(host.maxAlive, 1);
  assert.equal(s.current.title, 'B');
});

test('démarrages concurrents : seul le dernier survit', async () => {
  const host = fakeHost();
  const gates = {};
  host.delay = (id) => new Promise((r) => { gates[id] = r; });
  const s = new Session(host);
  const pa = s.start(game('A'), { id: 'A' });
  await Promise.resolve();
  const pb = s.start(game('B'), { id: 'B' });
  await new Promise((r) => setTimeout(r, 5));
  gates.A();
  gates.B();
  const [ra, rb] = await Promise.all([pa, pb]);
  assert.equal(ra, false);
  assert.equal(rb, true);
  assert.equal(host.alive, 1);
  assert.equal(s.current.title, 'B');
  assert.ok(host.log.includes('destroy:A'));
  assert.ok(!host.log.includes('destroy:B'));
});

test('arrêt idempotent', async () => {
  const host = fakeHost();
  const s = new Session(host);
  await s.start(game('A'), { id: 'A' });
  await s.stop();
  await s.stop();
  assert.equal(host.alive, 0);
  assert.equal(s.state, 'idle');
  assert.equal(s.current, null);
  assert.equal(s.hasActiveGame, false);
});

test('échec de création : retour à idle avec message', async () => {
  const host = fakeHost();
  host.fail = 'moteur introuvable';
  const s = new Session(host);
  const ok = await s.start(game('A'), { id: 'A' });
  assert.equal(ok, false);
  assert.equal(s.state, 'idle');
  assert.equal(s.lastError, 'moteur introuvable');
  assert.equal(s.current, null);
});

test('événements du moteur : prêt, démarré, erreur, sortie', async () => {
  const host = fakeHost();
  const seen = [];
  const s = new Session(host, (snap) => seen.push(snap.state));
  await s.start(game('A'), { id: 'A' });
  host.events.A.onReady();
  assert.equal(s.state, 'starting');
  host.events.A.onStart();
  assert.equal(s.state, 'running');
  host.events.A.onExit();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(s.state, 'idle');
  assert.equal(host.alive, 0);

  await s.start(game('B'), { id: 'B' });
  host.events.B.onError('cœur introuvable');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(s.state, 'idle');
  assert.equal(s.lastError, 'cœur introuvable');
  assert.equal(host.alive, 0);
});

test('un événement tardif d\'un ancien jeu est ignoré', async () => {
  const host = fakeHost();
  const s = new Session(host);
  await s.start(game('A'), { id: 'A' });
  await s.start(game('B'), { id: 'B' });
  host.events.A.onStart();
  host.events.A.onExit();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(s.current.title, 'B');
  assert.equal(host.alive, 1);
});
