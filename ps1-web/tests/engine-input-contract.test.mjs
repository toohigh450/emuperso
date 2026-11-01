import test from 'node:test';
import assert from 'node:assert/strict';

// Contrat EmulatorJS : defaultControllers doit définir les joueurs 0-3,
// sinon setupKeys() plante sur this.controls[1] (undefined).
// Reproduit la logique de engine-session.mjs + le merge d'EmulatorJS.

function buildDefaultControllers(native) {
  const unbound = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [i, { value2: '' }]));
  const defaultControllers = { 0: unbound, 1: {}, 2: {}, 3: {} };
  return native ? {} : { defaultControllers };
}

function emulateEmulatorJSMerge(configDefaultControllers) {
  // Simule le merge du constructeur EmulatorJS + setupKeys()
  const defaultControllers = { 0: {}, 1: {}, 2: {}, 3: {} }; // initControlVars
  if (configDefaultControllers) {
    for (const [player, buttons] of Object.entries(configDefaultControllers)) {
      defaultControllers[player] = defaultControllers[player] || {};
      for (const [button, cfg] of Object.entries(buttons)) {
        defaultControllers[player][button] = { ...(defaultControllers[player][button] || {}), ...cfg };
      }
    }
  }
  // Simule this.controls construit depuis defaultControllers
  const controls = defaultControllers;
  // Simule setupKeys() : boucle 4 joueurs x 30 boutons
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 30; j++) {
      if (controls[i][j]) { /* accès sans crash */ }
    }
  }
  return controls;
}

test('defaultControllers a les 4 joueurs en mode custom', () => {
  const { defaultControllers } = buildDefaultControllers(false);
  assert.deepEqual(Object.keys(defaultControllers).sort(), ['0', '1', '2', '3']);
});

test('pas de crash setupKeys avec notre structure (mode custom)', () => {
  const { defaultControllers } = buildDefaultControllers(false);
  const controls = emulateEmulatorJSMerge(defaultControllers);
  assert.ok(controls[0] && controls[1] && controls[2] && controls[3]);
});

test('joueur 0 neutralisé, joueurs 1-3 préservés', () => {
  const { defaultControllers } = buildDefaultControllers(false);
  assert.equal(defaultControllers[0][0].value2, '');
  assert.deepEqual(defaultControllers[1], {});
  assert.deepEqual(defaultControllers[2], {});
  assert.deepEqual(defaultControllers[3], {});
});

test('mode natif : pas de surcharge defaultControllers', () => {
  const result = buildDefaultControllers(true);
  assert.deepEqual(result, {});
});
