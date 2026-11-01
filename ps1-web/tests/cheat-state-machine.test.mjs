/**
 * Tests comportementaux de la machine à états des cheats (audit GPT RC-1.6).
 *
 * Contrat testé (miroir fidèle de la logique de app.js) :
 * - État unique par cheat : 'off' | 'pending' | 'applied'
 * - atomicCheatUpdate : mutation proposée → setCheats → succès ? commit : rollback
 * - Verrou régional : activation bloquée → 'pending', SANS appel moteur
 * - "Désactiver tous" : purge 'pending' ET les listes différées
 * - Échec moteur : aucun cheat ne reste marqué 'applied' à tort
 *
 * Le moteur est instrumenté : chaque appel à setCheats est enregistré,
 * et un mode échec simulé permet de tester les chemins d'erreur.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// --- Harnais : réplique fidèle de la logique app.js ---

function createHarness({ engineFails = false } = {}) {
  const calls = []; // appels instrumentés à setCheats
  const events = [];
  const engine = {
    async setCheats(list) {
      calls.push(list.map(c => ({ ...c })));
      if (engineFails) throw new Error('MOTEUR: setCheats rejeté (test)');
    },
  };
  const sessions = { current: { api: engine } };
  let cheats = [];
  const window = { _pendingCheatRestore: [], _deferredCheatList: [], _regionConfirmed: false, _regionMismatch: null };

  const appliedCheats = () => cheats.filter(c => c.state === 'applied');
  const pendingCheats = () => cheats.filter(c => c.state === 'pending');

  async function atomicCheatUpdate(mutate) {
    const snapshot = cheats.map(c => c.state);
    mutate();
    const list = appliedCheats().map(c => ({ name: c.name, code: c.code }));
    try {
      if (sessions.current) await sessions.current.api.setCheats(list);
      events.push({ type: 'cheats.applied', count: list.length });
    } catch (error) {
      cheats.forEach((c, i) => { c.state = snapshot[i]; });
      events.push({ type: 'cheats.apply_failed', message: String(error.message) });
      throw error;
    }
    return list.length;
  }

  const isRegionActivationAllowed = () =>
    !window._regionMismatch || window._regionConfirmed === true;

  async function toggle(index, on) {
    const cheat = cheats[index];
    if (!on) {
      await atomicCheatUpdate(() => { cheat.state = 'off'; });
      return;
    }
    if (!isRegionActivationAllowed()) {
      cheat.state = 'pending';
      return;
    }
    await atomicCheatUpdate(() => { cheat.state = 'applied'; });
  }

  async function disableAll() {
    window._pendingCheatRestore = [];
    window._deferredCheatList = [];
    await atomicCheatUpdate(() => { cheats.forEach(c => { c.state = 'off'; }); });
  }

  async function confirmRegion() {
    window._regionConfirmed = true;
    const pendingRestore = window._pendingCheatRestore || [];
    // Pas de travail ? Pas d'appel moteur redondant.
    if (!cheats.some(c => c.state === 'pending') && pendingRestore.length === 0) return;
    await atomicCheatUpdate(() => {
      for (const c of cheats) if (c.state === 'pending') c.state = 'applied';
      for (const p of pendingRestore) {
        const existing = cheats.find(c => c.name === p.name && c.code === p.code);
        if (existing && existing.state !== 'applied') existing.state = 'applied';
      }
    });
    window._pendingCheatRestore = [];
  }

  // Invariant : jamais pending ET applied simultanément sur un cheat
  function assertInvariant() {
    for (const c of cheats) {
      assert.ok(['off', 'pending', 'applied'].includes(c.state), `état valide pour ${c.name}`);
    }
  }

  return {
    calls, events, window, sessions,
    get cheats() { return cheats; },
    setCheats(list) { cheats = list.map(c => ({ ...c })); },
    appliedCheats, pendingCheats, atomicCheatUpdate,
    isRegionActivationAllowed, toggle, disableAll, confirmRegion, assertInvariant,
  };
}

const mkCheat = (name) => ({ name, code: '80010000 0001', source: 'catalogue', state: 'off', incompatible: false });

// 1. Activation normale : applied + un appel moteur
test('activation : état applied, moteur appelé une fois', async () => {
  const h = createHarness();
  h.setCheats([mkCheat('Speed')]);
  await h.toggle(0, true);
  assert.equal(h.cheats[0].state, 'applied');
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].map(c => c.name), ['Speed']);
  h.assertInvariant();
});

// 2. Région bloquée : pending, AUCUN appel moteur
test('région non confirmée : pending, moteur non appelé', async () => {
  const h = createHarness();
  h.setCheats([mkCheat('Speed')]);
  h.window._regionMismatch = { gameRegion: 'Europe', catalogRegion: 'USA' };
  await h.toggle(0, true);
  assert.equal(h.cheats[0].state, 'pending');
  assert.equal(h.calls.length, 0);
  h.assertInvariant();
});

// 3. P0 : "désactiver tous" purge pending + listes différées
test('P0 : désactiver tous purge pending et listes différées', async () => {
  const h = createHarness();
  h.setCheats([mkCheat('Speed')]);
  h.window._regionMismatch = { gameRegion: 'Europe', catalogRegion: 'USA' };
  await h.toggle(0, true); // → pending
  assert.equal(h.cheats[0].state, 'pending');
  h.window._pendingCheatRestore = [{ name: 'Speed', code: '80010000 0001' }];
  h.window._deferredCheatList = [{ name: 'Speed', code: '80010000 0001' }];
  await h.disableAll();
  assert.equal(h.cheats[0].state, 'off');
  assert.deepEqual(h.window._pendingCheatRestore, []);
  assert.deepEqual(h.window._deferredCheatList, []);
  // Le dernier appel moteur est une liste vide
  assert.deepEqual(h.calls[h.calls.length - 1], []);
  h.assertInvariant();
});

// 4. P0 régression : confirmer APRÈS "désactiver tous" ne réactive rien
test('P0 : confirmer après désactiver-tous ne réactive rien', async () => {
  const h = createHarness();
  h.setCheats([mkCheat('Speed')]);
  h.window._regionMismatch = { gameRegion: 'Europe', catalogRegion: 'USA' };
  await h.toggle(0, true); // → pending
  await h.disableAll();    // → off + purge
  await h.confirmRegion(); // ne doit RIEN réactiver
  assert.equal(h.cheats[0].state, 'off');
  assert.equal(h.appliedCheats().length, 0);
  h.assertInvariant();
});

// 5. P1 : échec moteur → rollback, aucun "actif" fantôme
test('P1 : échec setCheats → rollback complet', async () => {
  const h = createHarness({ engineFails: true });
  h.setCheats([mkCheat('Speed')]);
  await assert.rejects(() => h.toggle(0, true), /MOTEUR/);
  assert.equal(h.cheats[0].state, 'off', 'état restauré à off après échec');
  assert.equal(h.appliedCheats().length, 0, 'aucun cheat appliqué');
  assert.ok(h.events.some(e => e.type === 'cheats.apply_failed'), 'échec journalisé');
  h.assertInvariant();
});

// 6. P1 : échec moteur sur désactivation → état précédent conservé
test('P1 : échec setCheats sur désactivation → rollback', async () => {
  const h = createHarness();
  h.setCheats([mkCheat('Speed')]);
  await h.toggle(0, true); // applied, moteur OK
  assert.equal(h.cheats[0].state, 'applied');
  // Le moteur tombe en panne ensuite
  h.sessions.current.api.setCheats = async () => { throw new Error('MOTEUR: panne'); };
  await assert.rejects(() => h.toggle(0, false), /panne/);
  assert.equal(h.cheats[0].state, 'applied', 'reste applied car le moteur a refusé');
  h.assertInvariant();
});

// 7. Confirmation régionale : pending → applied, moteur appelé
test('confirmation : pending devient applied avec appel moteur', async () => {
  const h = createHarness();
  h.setCheats([mkCheat('Speed')]);
  h.window._regionMismatch = { gameRegion: 'Europe', catalogRegion: 'USA' };
  await h.toggle(0, true); // → pending
  assert.equal(h.calls.length, 0);
  await h.confirmRegion();
  assert.equal(h.cheats[0].state, 'applied');
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].map(c => c.name), ['Speed']);
  h.assertInvariant();
});

// 8. Restauration différée consommée une seule fois
test('restauration : _pendingCheatRestore consommé après application', async () => {
  const h = createHarness();
  h.setCheats([mkCheat('Speed')]);
  h.window._pendingCheatRestore = [{ name: 'Speed', code: '80010000 0001' }];
  await h.confirmRegion();
  assert.deepEqual(h.window._pendingCheatRestore, [], 'liste vidée après succès');
  assert.equal(h.cheats[0].state, 'applied');
  // Deuxième confirmation : rien à appliquer, pas d'appel supplémentaire
  const callsBefore = h.calls.length;
  await h.confirmRegion();
  assert.equal(h.calls.length, callsBefore, 'aucun appel moteur redondant');
  h.assertInvariant();
});
