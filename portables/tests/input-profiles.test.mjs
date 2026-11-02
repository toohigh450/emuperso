import test from 'node:test';
import assert from 'node:assert/strict';
import { PAD, RP, buttonMap, computePadInputs, normalizePad, pickPad, touchLayout, PAD_PROFILES } from '../js/input-profiles.mjs';
import { SYSTEMS } from '../js/systems.mjs';

const pad = (pressed = [], axes = [0, 0, 0, 0]) => ({
  connected: true, mapping: 'standard', id: 'Xbox 360 Controller (STANDARD GAMEPAD)', axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
});
const on = (out) => Object.entries(out).filter(([, v]) => v).map(([k, v]) => [Number(k), v]);

test('Chaque console du lanceur a ses deux profils ; Natif laisse la main au moteur', () => {
  for (const sys of Object.keys(SYSTEMS)) {
    assert.ok(buttonMap(sys, 'authentique'), sys);
    assert.ok(buttonMap(sys, 'confort').length > buttonMap(sys, 'authentique').length, sys);
    assert.equal(buttonMap(sys, 'natif'), null);
  }
  assert.deepEqual(Object.keys(PAD_PROFILES), ['authentique', 'confort', 'natif']);
});

test('Start et Select toujours accessibles, quelle que soit la console', () => {
  for (const sys of Object.keys(SYSTEMS)) for (const profile of ['authentique', 'confort']) {
    const out = computePadInputs(sys, pad([PAD.start, PAD.back]), { profile });
    assert.equal(out[RP.START], 1, `${sys} ${profile}`);
    assert.equal(out[RP.SELECT], 1, `${sys} ${profile}`);
  }
});

test('Positions d’origine : NES B/A, SNES losange, Genesis A-B-C, PSP ✕ ○ □ △', () => {
  assert.deepEqual(on(computePadInputs('nes', pad([PAD.bottom]), { profile: 'authentique' })), [[RP.B, 1]]);
  assert.deepEqual(on(computePadInputs('nes', pad([PAD.right]), { profile: 'authentique' })), [[RP.A, 1]]);
  assert.deepEqual(on(computePadInputs('snes', pad([PAD.left]), { profile: 'authentique' })), [[RP.Y, 1]]);
  assert.deepEqual(on(computePadInputs('snes', pad([PAD.top]), { profile: 'authentique' })), [[RP.X, 1]]);
  // Genesis Plus GX : A = Y, B = B, C = A (EmulatorJS).
  assert.deepEqual(on(computePadInputs('genesis', pad([PAD.left, PAD.bottom, PAD.right]), { profile: 'authentique' })), [[RP.B, 1], [RP.Y, 1], [RP.A, 1]]);
  // PSP : ✕ = B, ○ = A, □ = Y, △ = X.
  assert.deepEqual(on(computePadInputs('psp', pad([PAD.bottom, PAD.right, PAD.left, PAD.top]), { profile: 'authentique' })), [[RP.B, 1], [RP.Y, 1], [RP.A, 1], [RP.X, 1]]);
});

test('Confort : stick gauche → croix (seuil), doublons ; Authentique : le stick ne pilote pas la croix', () => {
  assert.deepEqual(on(computePadInputs('nes', pad([], [-0.9, 0]), { profile: 'confort' })), [[RP.LEFT, 1]]);
  assert.deepEqual(on(computePadInputs('nes', pad([], [0.3, 0]), { profile: 'confort' })), []);
  assert.deepEqual(on(computePadInputs('nes', pad([], [-0.9, 0]), { profile: 'authentique' })), []);
  assert.deepEqual(on(computePadInputs('nes', pad([PAD.left]), { profile: 'confort' })), [[RP.B, 1]]);
  assert.deepEqual(on(computePadInputs('gba', pad([PAD.LT]), { profile: 'confort' })), [[RP.L, 1]]);
  assert.deepEqual(on(computePadInputs('gba', pad([PAD.LT]), { profile: 'authentique' })), []);
});

test('PSP : stick gauche analogique avec zone morte, jamais converti en croix', () => {
  const out = computePadInputs('psp', pad([], [1, 0]), { profile: 'confort', deadzone: 0.2 });
  assert.equal(out[16], 0x7fff);
  assert.equal(out[RP.RIGHT], 0);
  assert.deepEqual(on(computePadInputs('psp', pad([], [0.1, 0.1]), { profile: 'confort', deadzone: 0.2 })), []);
  const half = computePadInputs('psp', pad([], [0, -0.6]), { profile: 'authentique', deadzone: 0.2 });
  assert.ok(Math.abs(half[19] - 0.5 * 0x7fff) <= 1, `moitié de course : ${half[19]}`);
});

test('Aucune manette : tout relâché ; préférence pour la disposition « standard »', () => {
  assert.equal(on(computePadInputs('snes', null, {})).length, 0);
  const odd = { connected: true, mapping: '', id: 'autre' };
  const std = pad();
  assert.equal(pickPad([null, odd, std]), std);
  assert.equal(pickPad([odd]), odd);
  assert.equal(pickPad([{ connected: false, mapping: 'standard' }]), null);
});

test('Réglages bornés et valeurs par défaut', () => {
  assert.deepEqual(normalizePad({}), { profile: 'confort', deadzone: 0.25, hideTouch: true, touchSize: 1, touchOpacity: 0.85 });
  assert.deepEqual(normalizePad({ profile: 'x', deadzone: 5, touchSize: 0.1, touchOpacity: 2, hideTouch: false }), { profile: 'confort', deadzone: 0.6, hideTouch: false, touchSize: 0.6, touchOpacity: 1 });
});

test('Commandes tactiles PSP : ✕ ○ □ △, stick analogique, croix, L/R, Start/Select', () => {
  const layout = touchLayout('psp');
  assert.deepEqual(layout.filter((b) => b.type === 'button').map((b) => [b.text, b.input_value]).sort(), [['L', 10], ['R', 11], ['Select', 2], ['Start', 3], ['□', 1], ['○', 8], ['△', 9], ['✕', 0]].sort());
  assert.ok(layout.some((b) => b.type === 'zone' && b.joystickInput && b.inputValues.join() === '16,17,18,19'));
  assert.ok(layout.some((b) => b.type === 'zone' && !b.joystickInput && b.inputValues.join() === '4,5,6,7'));
  assert.equal(touchLayout('snes'), null);
});
