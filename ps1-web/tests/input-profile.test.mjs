import test from 'node:test';
import assert from 'node:assert/strict';
import { computeInputs, normalizeInput, padType, SCALE } from '../input-profile.mjs';
const pad = (buttons = {}, axes = [0, 0, 0, 0]) => ({ buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: !!buttons[i], value: buttons[i] ? 1 : 0 })), axes });
const digital = normalizeInput({}), analog = normalizeInput({ analog: 'dualshock', deadzone: 0.2 });
test('positionnel OEM : bas=Croix(B), droite=Rond(A), gauche=Carré(Y), haut=Triangle(X)', () => {
  for (const [button, id] of [[0, 0], [1, 8], [2, 1], [3, 9]]) { const out = computeInputs(pad({ [button]: 1 }), digital); assert.equal(out[id], 1); assert.equal(Object.values(out).filter(Boolean).length, 1); }
});
test('croix physique toujours utilisable, seule ou avec le stick', () => {
  assert.equal(computeInputs(pad({ 14: 1 }), digital)[6], 1);
  const both = computeInputs(pad({ 12: 1 }, [0.9, 0, 0, 0]), digital); assert.equal(both[4], 1); assert.equal(both[7], 1);
});
test('numérique : stick gauche -> croix, zone morte respectée', () => {
  assert.equal(computeInputs(pad({}, [-1, 0, 0, 0]), digital)[6], 1);
  assert.equal(computeInputs(pad({}, [0, 1, 0, 0]), digital)[5], 1);
  assert.deepEqual(Object.values(computeInputs(pad({}, [0.3, 0.3, 0, 0]), normalizeInput({ deadzone: 0.5 }))).filter(Boolean), []);
  assert.deepEqual(Object.values(computeInputs(pad({}, [-1, 0, 0, 0]), normalizeInput({ stickToDpad: false }))).filter(Boolean), []);
});
test('analogique : axes -> identifiants 16..19 / 20..23, zone morte radiale, croix intacte', () => {
  const out = computeInputs(pad({ 15: 1 }, [1, 0, -0.5, 0.1]), analog);
  assert.equal(out[16], SCALE); assert.equal(out[17], 0); assert.equal(out[18], 0); assert.equal(out[19], 0);
  assert.equal(computeInputs(pad({}, [0, -1, 0, 0]), analog)[19], SCALE);
  const diagonal = computeInputs(pad({}, [1, -1, 0, 0]), analog); assert.ok(diagonal[16] < SCALE && diagonal[19] < SCALE && Math.hypot(diagonal[16], diagonal[19]) <= SCALE + 1);
  assert.ok(out[21] > 0 && out[20] === 0 && out[23] === 0 && out[22] < out[21]); assert.equal(out[7], 1);
  assert.ok(Object.values(computeInputs(pad({}, [0.15, 0.1, 0, 0]), analog)).every(v => v === 0));
  assert.equal(computeInputs(pad({}, [1, 0, 0, 0]), analog)[6], 0);
});
test('configuration : valeurs bornées, type de manette = valeurs réelles du cœur, sans manette tout à zéro', () => {
  assert.equal(normalizeInput({ deadzone: 5 }).deadzone, 0.6); assert.equal(normalizeInput({ deadzone: 0 }).deadzone, 0.05);
  assert.equal(normalizeInput({ analog: 'x' }).analog, 'off'); assert.equal(normalizeInput(null).native, false);
  assert.deepEqual([padType(digital), padType(analog), padType(normalizeInput({ analog: 'analog' }))], ['standard', 'dualshock', 'analog']);
  assert.ok(Object.values(computeInputs(null, digital)).every(v => v === 0));
});

test('normalizeInput préserve _profile quand présent', () => {
  const cfg = normalizeInput({ analog: 'off', _profile: 'authentique' });
  assert.equal(cfg._profile, 'authentique');
  const cfg2 = normalizeInput({ analog: 'off' });
  assert.equal(cfg2._profile, undefined);
});
