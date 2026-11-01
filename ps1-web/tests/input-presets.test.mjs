import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILES, DEFAULT_PROFILE_ID, profileIds, getProfile, resolveProfile, usesStickToDpad,
} from '../input-presets.mjs';
import { normalizeInput } from '../input-profile.mjs';

test('deux profils nommés, confort par défaut (choix de Karl)', () => {
  assert.deepEqual(profileIds(), ['authentique', 'confort']);
  assert.equal(DEFAULT_PROFILE_ID, 'confort');
  assert.equal(PROFILES.authentique.label, 'PS1 authentique');
  assert.equal(PROFILES.confort.label, 'Confort moderne');
});

test('profil inconnu -> repli sur le défaut, sans crash', () => {
  assert.equal(getProfile('nimporte-quoi').id, 'confort');
  assert.equal(getProfile(null).id, 'confort');
  assert.equal(getProfile(undefined).id, 'confort');
});

test('authentique : aucune simulation stick->croix', () => {
  const cfg = resolveProfile('authentique');
  assert.equal(cfg.stickToDpad, false);
  assert.equal(cfg.analog, 'off');
  assert.equal(usesStickToDpad('authentique'), false);
});

test('confort : stick gauche -> croix, mapping positionnel conservé', () => {
  const cfg = resolveProfile('confort');
  assert.equal(cfg.stickToDpad, true);
  assert.equal(usesStickToDpad('confort'), true);
});

test('surcharges par jeu : normalisées via le schéma de Claude', () => {
  const cfg = resolveProfile('confort', { deadzone: 0.35, analog: 'dualshock' });
  assert.equal(cfg.deadzone, 0.35);
  assert.equal(cfg.analog, 'dualshock');
  // Bornes respectées même en surcharge
  assert.equal(resolveProfile('confort', { deadzone: 99 }).deadzone, 0.6);
  assert.deepEqual(resolveProfile('confort'), normalizeInput({ stickToDpad: true, deadzone: 0.2 }));
});

test('les objets profils sont gelés (pas de mutation accidentelle)', () => {
  assert.ok(Object.isFrozen(PROFILES));
  assert.ok(Object.isFrozen(PROFILES.confort));
  assert.ok(Object.isFrozen(resolveProfile('confort')));
});
