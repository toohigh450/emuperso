import test from 'node:test';
import assert from 'node:assert/strict';
import { computeN64Inputs, normalizeN64Pad, pickPad, SCALE } from '../n64-input.mjs';

const pad = (pressed = [], axes = [0, 0, 0, 0]) => ({ connected: true, mapping: 'standard', id: 'Xbox', axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });
const on = (out) => Object.entries(out).filter(([, v]) => v).map(([k, v]) => [Number(k), v]);

test('N64 Authentique : correspondance du mandat (A, B = X, Z = LT, L/R, Start, croix)', () => {
  assert.deepEqual(on(computeN64Inputs(pad([0]), { profile: 'authentique' })), [[0, 1]]);
  assert.deepEqual(on(computeN64Inputs(pad([2]), { profile: 'authentique' })), [[1, 1]]);
  assert.deepEqual(on(computeN64Inputs(pad([6]), { profile: 'authentique' })), [[12, 1]]);
  assert.deepEqual(on(computeN64Inputs(pad([4, 5]), { profile: 'authentique' })), [[10, 1], [11, 1]]);
  assert.deepEqual(on(computeN64Inputs(pad([9]), { profile: 'authentique' })), [[3, 1]]);
  assert.deepEqual(on(computeN64Inputs(pad([12, 15]), { profile: 'authentique' })), [[4, 1], [7, 1]]);
  assert.deepEqual(on(computeN64Inputs(pad([7, 1, 3]), { profile: 'authentique' })), []); // doublons réservés au confort
});

test('N64 : les quatre boutons C sur le stick droit, utilisables avec le stick et un bouton', () => {
  assert.deepEqual(on(computeN64Inputs(pad([], [0, 0, 1, 0]), {})), [[20, SCALE]]);
  assert.deepEqual(on(computeN64Inputs(pad([], [0, 0, -1, 0]), {})), [[21, SCALE]]);
  assert.deepEqual(on(computeN64Inputs(pad([], [0, 0, 0, 1]), {})), [[22, SCALE]]);
  assert.deepEqual(on(computeN64Inputs(pad([], [0, 0, 0, -1]), {})), [[23, SCALE]]);
  assert.deepEqual(on(computeN64Inputs(pad([], [0, 0, 0.3, 0]), {})), []);
  const combo = computeN64Inputs(pad([0], [1, 0, 0, -1]), { deadzone: 0.2 });
  assert.equal(combo[0], 1); assert.equal(combo[16], SCALE); assert.equal(combo[23], SCALE);
});

test('N64 Confort : Z sur RT, C bas sur B, C gauche sur Y', () => {
  assert.deepEqual(on(computeN64Inputs(pad([7]), { profile: 'confort' })), [[12, 1]]);
  assert.deepEqual(on(computeN64Inputs(pad([1]), { profile: 'confort' })), [[22, SCALE]]);
  assert.deepEqual(on(computeN64Inputs(pad([3]), { profile: 'confort' })), [[21, SCALE]]);
});

test('N64 : zone morte radiale, sensibilité, profil natif et réglages bornés', () => {
  assert.deepEqual(on(computeN64Inputs(pad([], [0.1, 0.1]), { deadzone: 0.2 })), []);
  const half = computeN64Inputs(pad([], [0.6, 0]), { deadzone: 0.2, sensitivity: 1 });
  assert.ok(Math.abs(half[16] - SCALE / 2) <= 1);
  const boosted = computeN64Inputs(pad([], [0.6, 0]), { deadzone: 0.2, sensitivity: 1.5 });
  assert.ok(boosted[16] > half[16]);
  assert.equal(computeN64Inputs(pad([0]), { profile: 'natif' }), null);
  assert.deepEqual(normalizeN64Pad({ profile: '?', deadzone: 9, sensitivity: 0 }), { profile: 'confort', deadzone: 0.5, sensitivity: 0.5, hideTouch: true });
  assert.equal(pickPad([null, { connected: true, mapping: '' }, pad()]).mapping, 'standard');
});
