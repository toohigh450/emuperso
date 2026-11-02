import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { packStateBundle, unpackStateBundle, STATE_BUNDLE_HEADER_BYTES, MAX_STATE_BUNDLE_BYTES, MAX_STATE_BATTERY_BYTES } from '../state-bundle.mjs';

const state = new Uint8Array([82, 65, 83, 84, 65, 84, 69, 1, 17, 34]);
const native = new Uint8Array([90, 23, 0, 18]);
const modify = (packed, callback) => { const changed = packed.slice(); callback(new DataView(changed.buffer), changed); return changed; };

test('État et sauvegarde native sont regroupés et récupérés exactement', () => {
  const packed = packStateBundle(state, native), restored = unpackStateBundle(packed);
  assert.equal(packed.length, STATE_BUNDLE_HEADER_BYTES + state.length + native.length);
  assert.deepEqual(restored.state, state); assert.deepEqual(restored.battery, native);
});

test('Absence de sauvegarde native explicite et état minimal non vide', () => {
  const restored = unpackStateBundle(packStateBundle(new Uint8Array([1]), null));
  assert.deepEqual(restored.state, new Uint8Array([1])); assert.equal(restored.battery, null);
  assert.throws(() => packStateBundle(new Uint8Array(), null), { code: 'E_BUNDLE_LENGTH' });
  assert.throws(() => packStateBundle(state, new Uint8Array()), { code: 'E_BUNDLE_LENGTH' });
});

test('Copies indépendantes : aucune mutation des entrées ou de la sortie ne traverse le paquet', () => {
  const a = state.slice(), b = native.slice(), packed = packStateBundle(a, b);
  a[0] = 0; b[0] = 0;
  const restored = unpackStateBundle(packed); assert.deepEqual(restored.state, state); assert.deepEqual(restored.battery, native);
  restored.state[0] = 0; restored.battery[0] = 0;
  assert.deepEqual(unpackStateBundle(packed).state, state); assert.deepEqual(unpackStateBundle(packed).battery, native);
});

test('Vues avec offset et octets venant d’un autre realm acceptés sans octets adjacents', () => {
  const remote = vm.runInNewContext('new Uint8Array([99,82,65,83,84,65,84,69,1,17,34,88]).subarray(1,11)');
  const bytes = unpackStateBundle(packStateBundle(remote, native.buffer));
  assert.deepEqual(bytes.state, state); assert.deepEqual(bytes.battery, native);
  const wrapped = new Uint8Array(packStateBundle(state, native).length + 8); wrapped.set(packStateBundle(state, native), 4);
  assert.deepEqual(unpackStateBundle(wrapped.subarray(4, wrapped.length - 4)).state, state);
  for (const bad of [null, [], 'bytes', new Uint16Array([1])]) assert.throws(() => packStateBundle(bad, null), { code: 'E_BUNDLE_TYPE' });
});

test('Magic, champs réservés et flags inconnus sont refusés', () => {
  const packed = packStateBundle(state, native);
  assert.throws(() => unpackStateBundle(modify(packed, (_h, b) => { b[0] ^= 1; })), { code: 'E_BUNDLE_MAGIC' });
  assert.throws(() => unpackStateBundle(modify(packed, h => h.setUint32(16, 2, true))), { code: 'E_BUNDLE_FLAGS' });
  assert.throws(() => unpackStateBundle(modify(packed, h => h.setUint32(20, 1, true))), { code: 'E_BUNDLE_FLAGS' });
});

test('Troncatures, octets supplémentaires, longueurs mensongères et absence incohérente refusées', () => {
  const packed = packStateBundle(state, native);
  for (const length of [0, 7, 23, packed.length - 1]) assert.throws(() => unpackStateBundle(packed.slice(0, length)));
  assert.throws(() => unpackStateBundle(new Uint8Array([...packed, 0])), { code: 'E_BUNDLE_LENGTH' });
  for (const [offset, value] of [[8, 0], [8, 0xffffffff], [12, 0], [12, 0xffffffff], [16, 0]]) {
    assert.throws(() => unpackStateBundle(modify(packed, h => h.setUint32(offset, value, true))), { code: 'E_BUNDLE_LENGTH' });
  }
});

test('Limite native réelle 1 Mio et limite totale réelle 64 Mio, en-tête compris', () => {
  const battery = new Uint8Array(MAX_STATE_BATTERY_BYTES);
  assert.equal(unpackStateBundle(packStateBundle(state, battery)).battery.length, MAX_STATE_BATTERY_BYTES);
  assert.throws(() => packStateBundle(state, new Uint8Array(MAX_STATE_BATTERY_BYTES + 1)), { code: 'E_BUNDLE_LIMIT' });
  const maximum = new Uint8Array(MAX_STATE_BUNDLE_BYTES - STATE_BUNDLE_HEADER_BYTES);
  maximum[0] = 82;
  const packed = packStateBundle(maximum, null); assert.equal(packed.length, MAX_STATE_BUNDLE_BYTES);
  assert.equal(unpackStateBundle(packed).state.length, maximum.length);
  assert.throws(() => packStateBundle(maximum, new Uint8Array([1])), { code: 'E_BUNDLE_LIMIT' });
});

test('ROM accidentelle refusée dans les trois ordres d’octets, avant ou après regroupement', () => {
  for (const signature of [[0x80, 0x37, 0x12, 0x40], [0x37, 0x80, 0x40, 0x12], [0x40, 0x12, 0x37, 0x80]]) {
    assert.throws(() => packStateBundle(new Uint8Array(signature), null), { code: 'E_BUNDLE_ROM' });
    const packed = packStateBundle(state, null); packed.set(signature, STATE_BUNDLE_HEADER_BYTES);
    assert.throws(() => unpackStateBundle(packed), { code: 'E_BUNDLE_ROM' });
  }
});
