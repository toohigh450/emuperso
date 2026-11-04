import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWad } from '../js/systems.mjs';

function wad() {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode('IWAD'));
  const view = new DataView(bytes.buffer);
  view.setInt32(4, 1, true);
  view.setInt32(8, 16, true);
  view.setInt32(16, 12, true);
  view.setInt32(20, 4, true);
  bytes.set(new TextEncoder().encode('TEST'), 24);
  return bytes;
}
test('DOOM : refuse une signature IWAD seule, sans répertoire', () => {
  assert.equal(analyzeWad('doom2.wad', new TextEncoder().encode('IWAD')).ok, false);
});
test('DOOM : accepte une structure minimale et une vue décalée', () => {
  const bytes = wad();
  assert.equal(analyzeWad('doom2.wad', bytes).ok, true);
  const padded = new Uint8Array(40); padded.set(bytes, 4);
  assert.equal(analyzeWad('doom2.wad', padded.subarray(4, 36)).ok, true);
});
test('DOOM : refuse les répertoires et données hors du fichier', () => {
  for (const [offset, value] of [[4, -1], [4, 0], [4, 2147483647], [8, -1], [8, 30], [16, -1], [16, 33], [20, -1], [20, 2147483647]]) {
    const bytes = wad(); new DataView(bytes.buffer).setInt32(offset, value, true);
    assert.equal(analyzeWad('doom2.wad', bytes).ok, false, `${offset}:${value}`);
  }
});
test('DOOM : un PWAD reste refusé comme jeu autonome', () => {
  const bytes = wad(); bytes[0] = 80;
  const result = analyzeWad('doom2.wad', bytes);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /additionnel/);
});
