import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDefaultControls, CONTROL_PROFILES } from '../js/controls.mjs';

test('profil par défaut : rien n\'est imposé au moteur', () => {
  assert.equal(buildDefaultControls('defaut'), null);
  assert.equal(buildDefaultControls('inconnu'), null);
});

test('profil positionnel : les quatre boutons changent, le reste est identique', () => {
  const c = buildDefaultControls('positionnel');
  assert.equal(c[0][0].value2, 'BUTTON_1');
  assert.equal(c[0][8].value2, 'BUTTON_2');
  assert.equal(c[0][1].value2, 'BUTTON_3');
  assert.equal(c[0][9].value2, 'BUTTON_4');
  assert.equal(c[0][2].value2, 'SELECT');
  assert.equal(c[0][3].value2, 'START');
  assert.equal(c[0][4].value2, 'DPAD_UP');
  assert.equal(c[0][0].value, 'x'); // clavier inchangé
  assert.deepEqual(c[1], {});
});

test('deux appels ne partagent pas d\'état', () => {
  const a = buildDefaultControls('positionnel');
  a[0][0].value2 = 'MODIFIE';
  assert.equal(buildDefaultControls('positionnel')[0][0].value2, 'BUTTON_1');
});

test('profils déclarés', () => {
  assert.deepEqual(Object.keys(CONTROL_PROFILES), ['defaut', 'positionnel']);
});
