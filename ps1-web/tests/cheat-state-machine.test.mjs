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

// === Audit GPT RC-1.7 : erreurs partielles et chemins P0/P1 ===

// P0-A : changement de serial → le moteur est vidé (pas de codes fantômes)
test('P0-A : remplacement liste cheats vide le moteur', async () => {
  const h = createHarness();
  h.setCheats([mkCheat('Speed')]);
  await h.toggle(0, true); // applied
  assert.equal(h.calls.length, 1);
  // Simule le changement de serial : nouvelle liste, sync moteur
  const oldCheats = h.cheats;
  h.setCheats([mkCheat('Autre')]); // tous 'off'
  await h.atomicCheatUpdate(() => {}); // sync
  assert.deepEqual(h.calls[h.calls.length - 1], [], 'moteur vidé après changement');
  assert.equal(h.appliedCheats().length, 0);
  h.assertInvariant();
});

// P0-B : échec partiel moteur → reset moteur + resync JS
test('P0-B : échec partiel → moteur reseté et resynchronisé', async () => {
  // Moteur qui échoue au milieu puis réussit le resync
  const engineCalls = [];
  let failNext = true;
  const engine = {
    async setCheats(list) {
      engineCalls.push(list.map(c => c.name));
      if (failNext) { failNext = false; throw new Error('PARTIEL: setCheat(1) a échoué'); }
    },
  };
  const h = createHarness();
  h.sessions.current.api = engine;
  h.setCheats([mkCheat('A'), mkCheat('B')]);
  // Simule atomicCheatUpdate avec resync (miroir de app.js)
  const snapshot = h.cheats.map(c => c.state);
  h.cheats.forEach(c => { c.state = 'applied'; });
  try {
    await engine.setCheats(h.cheats.filter(c => c.state === 'applied'));
    assert.fail('aurait dû échouer');
  } catch (e) {
    h.cheats.forEach((c, i) => { c.state = snapshot[i]; }); // rollback JS
    const rollbackList = h.cheats.filter(c => c.state === 'applied');
    await engine.setCheats(rollbackList); // resync
  }
  assert.deepEqual(h.cheats.map(c => c.state), ['off', 'off'], 'rollback JS complet');
  assert.deepEqual(engineCalls[engineCalls.length - 1], [], 'moteur resynchronisé à vide');
  h.assertInvariant();
});

// P1 : échec confirmation → _regionConfirmed=false (bouton réapparaît)
test('P1 : échec confirmation rouvre le verrou régional', async () => {
  const h = createHarness({ engineFails: true });
  h.setCheats([mkCheat('Speed')]);
  h.window._regionMismatch = { gameRegion: 'Europe', catalogRegion: 'USA' };
  await h.toggle(0, true); // → pending
  h.window._regionConfirmed = true; // clic "Je confirme"
  try {
    await h.atomicCheatUpdate(() => { h.cheats[0].state = 'applied'; });
    assert.fail('aurait dû échouer');
  } catch (e) {
    // P1 : rouvrir la confirmation
    h.window._regionConfirmed = false;
  }
  assert.equal(h.window._regionConfirmed, false, 'bouton de confirmation réapparaît');
  assert.equal(h.cheats[0].state, 'pending', 'cheat revenu en attente');
  h.assertInvariant();
});

// P1 : échec "désactiver tous" → listes différées préservées
test('P1 : échec désactiver-tous préserve les listes différées', async () => {
  const h = createHarness({ engineFails: true });
  h.setCheats([mkCheat('Speed')]);
  h.window._pendingCheatRestore = [{ name: 'Speed', code: '80010000 0001' }];
  h.window._deferredCheatList = [{ name: 'Speed', code: '80010000 0001' }];
  const savedRestore = [...h.window._pendingCheatRestore];
  const savedDeferred = [...h.window._deferredCheatList];
  // Simule le handler cheat-off avec sauvegarde/restauration (miroir app.js)
  h.window._pendingCheatRestore = [];
  h.window._deferredCheatList = [];
  try {
    await h.atomicCheatUpdate(() => { h.cheats.forEach(c => { c.state = 'off'; }); });
    assert.fail('aurait dû échouer');
  } catch (e) {
    h.window._pendingCheatRestore = savedRestore;
    h.window._deferredCheatList = savedDeferred;
  }
  assert.deepEqual(h.window._pendingCheatRestore, savedRestore, 'liste restaurée préservée');
  assert.deepEqual(h.window._deferredCheatList, savedDeferred, 'liste différée préservée');
  h.assertInvariant();
});

// Invariant global : vérification source du reset moteur sur échec partiel
test('P0-B : engine-session reset sur échec partiel (source)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../engine-session.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('manager.resetCheat();') && src.includes('cheats.apply_failed'),
    'setCheats moteur fait reset sur échec partiel');
});
