import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyBatteryPath, readLegacyBattery, LEGACY_REFERENCE_SHA256 } from '../legacy-battery.mjs';

test('Chemins 0.3 exacts, hash normalisé et aucune recherche par nom de jeu', () => {
  assert.equal(legacyBatteryPath('A'.repeat(64)), '/data/saves/Mupen64Plus-Next/EMUPERSO_LOCAL_' + 'a'.repeat(64) + '.srm');
  assert.equal(legacyBatteryPath(LEGACY_REFERENCE_SHA256, { reference: true }), '/data/saves/Mupen64Plus-Next/DEMO N64 EMUPERSO.srm');
  for (const bad of ['Conker', '../original', '', 'a'.repeat(63), 'g'.repeat(64)]) assert.throws(() => legacyBatteryPath(bad), { code: 'E_LEGACY_IDENTITY' });
  assert.throws(() => legacyBatteryPath('a'.repeat(64), { reference: true }), { code: 'E_LEGACY_IDENTITY' });
});
test('Sans énumération des bases, aucun open de base n’est tenté', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  let opens = 0;
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open() { opens++; throw new Error('Must not open'); } } });
  try { assert.equal(await readLegacyBattery('a'.repeat(64)), null); assert.equal(opens, 0); }
  finally { if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor); else delete globalThis.indexedDB; }
});
test('Base historique absente : aucune création ni ouverture d’une autre base', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  let opens = 0;
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { async databases() { return [{ name: 'another-project' }]; }, open() { opens++; } } });
  try { assert.equal(await readLegacyBattery('a'.repeat(64)), null); assert.equal(opens, 0); }
  finally { if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor); else delete globalThis.indexedDB; }
});
