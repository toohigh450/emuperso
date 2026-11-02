// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { inspectNativeState, makeRestoreWitness, compareRestoreWitness,
  MUPEN_STATE_BYTES, MUPEN_STATE_VERSION, RDRAM_BYTES, RDRAM_CORE_OFFSET,
  MAX_RESTORE_ANCHORS } from '../native-state.mjs';
const MD5 = '0123456789ABCDEFFEDCBA9876543210';
const ascii = value => Uint8Array.from(value, char => char.charCodeAt(0));
function fixture({ prefix = [], suffix = [], md5 = MD5 } = {}) {
  const memory = new Uint8Array(MUPEN_STATE_BYTES);
  memory.set(ascii('M64+SAVE'));
  new DataView(memory.buffer).setUint32(8, MUPEN_STATE_VERSION, false);
  memory.set(ascii(md5), 12);
  const blocks = [...prefix, ['MEM ', memory], ...suffix, ['END ', new Uint8Array()]];
  const bytes = new Uint8Array(8 + blocks.reduce((sum, [, data]) => sum + 8 + Math.ceil(data.length / 8) * 8, 0));
  bytes.set(ascii('RASTATE')); bytes[7] = 1;
  let cursor = 8;
  for (const [tag, data] of blocks) {
    bytes.set(ascii(tag), cursor);
    new DataView(bytes.buffer).setUint32(cursor + 4, data.length, true);
    bytes.set(data, cursor + 8);
    // Native padding is intentionally nonzero, as uninitialized padding is legal.
    bytes.fill(0xa5, cursor + 8 + data.length, cursor + 8 + Math.ceil(data.length / 8) * 8);
    cursor += 8 + Math.ceil(data.length / 8) * 8;
  }
  return bytes;
}
function ram(bytes) { return inspectNativeState(bytes).rdram; }
const fails = (operation, code) => assert.throws(operation, error => error.code === code);

test('Pinned RASTATE/Mupen format exposes the exact RAM view and normalized ROM identity', () => {
  const bytes = fixture();
  const parsed = inspectNativeState(bytes);
  assert.equal(bytes.length, 16793440);
  assert.equal(parsed.rom_md5, MD5.toLowerCase());
  assert.equal(parsed.core_payload_size, 16793412);
  assert.equal(parsed.rdram.length, RDRAM_BYTES);
  assert.equal(parsed.rdram_offset, 16 + RDRAM_CORE_OFFSET);
  assert.equal(parsed.rdram.buffer, bytes.buffer);
  assert.equal(parsed.rdram.byteOffset, bytes.byteOffset + 460);
  assert.deepEqual(parsed.chunks.map(chunk => chunk.tag), ['MEM ', 'END ']);
});

test('Bounded extension chunks, alignment padding and shifted MEM placement are parsed structurally', () => {
  const bytes = fixture({ prefix: [['NOTE', new Uint8Array([1, 2, 3])]], suffix: [['ACHV', new Uint8Array(9)]] });
  const parsed = inspectNativeState(bytes);
  assert.equal(parsed.rdram_offset, 476);
  assert.equal(parsed.chunks.length, 4);
  assert.equal(parsed.rdram.length, RDRAM_BYTES);
  const trailing = new Uint8Array(bytes.length + 8); trailing.set(bytes);
  fails(() => inspectNativeState(trailing), 'E_NATIVE_END');
  const noEnd = bytes.slice(0, -8);
  fails(() => inspectNativeState(noEnd), 'E_NATIVE_END');
});

test('Malformed lengths, duplicate memory, absent memory and unsupported native identities are refused', () => {
  const base = fixture();
  const wrongLength = base.slice(); new DataView(wrongLength.buffer).setUint32(12, 0xffffffff, true);
  fails(() => inspectNativeState(wrongLength), 'E_NATIVE_CHUNK');
  const wrongSize = base.slice(); new DataView(wrongSize.buffer).setUint32(12, MUPEN_STATE_BYTES - 4, true);
  fails(() => inspectNativeState(wrongSize), 'E_NATIVE_CORE_SIZE');
  const wrongVersion = base.slice(); new DataView(wrongVersion.buffer).setUint32(24, 0x00010a00, false);
  fails(() => inspectNativeState(wrongVersion), 'E_NATIVE_CORE_VERSION');
  const wrongMd5 = base.slice(); wrongMd5[28] = 0;
  fails(() => inspectNativeState(wrongMd5), 'E_NATIVE_ROM');
  const wrongCore = base.slice(); wrongCore[16] = 0;
  fails(() => inspectNativeState(wrongCore), 'E_NATIVE_CORE');
  const wrongContainer = base.slice(); wrongContainer[7] = 2;
  fails(() => inspectNativeState(wrongContainer), 'E_NATIVE_FORMAT');
  const duplicate = fixture({ suffix: [['MEM ', new Uint8Array(MUPEN_STATE_BYTES)]] });
  fails(() => inspectNativeState(duplicate), 'E_NATIVE_CHUNK');
  const empty = new Uint8Array(24); empty.set(ascii('RASTATE')); empty[7] = 1; empty.set(ascii('END '), 8);
  fails(() => inspectNativeState(empty), 'E_NATIVE_END');
});

test('Input types, actual 64 MiB size ceiling, byte offsets and foreign realms are handled correctly', () => {
  fails(() => inspectNativeState(new Uint8Array(64 * 1024 * 1024 + 1)), 'E_NATIVE_SIZE');
  fails(() => inspectNativeState(new Uint32Array(8)), 'E_NATIVE_TYPE');
  fails(() => inspectNativeState('RASTATE'), 'E_NATIVE_TYPE');
  const bytes = fixture(), padded = new Uint8Array(bytes.length + 14); padded.set(bytes, 7);
  assert.equal(inspectNativeState(padded.subarray(7, -7)).rdram.byteOffset, 467);
  const foreign = vm.runInNewContext('new Uint8Array(' + bytes.length + ')'); foreign.set(bytes);
  assert.equal(inspectNativeState(foreign).rom_md5, MD5.toLowerCase());
  assert.equal(inspectNativeState(foreign.buffer).rdram.length, RDRAM_BYTES);
});

test('A two-byte progress marker is differential proof only after its entire stable 32-byte anchor returns', () => {
  const expected = fixture(), a = fixture(), b = fixture();
  ram(expected).set([0x13, 0x57], 0x10000);
  const witness = makeRestoreWitness(expected, a, b);
  assert.equal(witness.total, 1); assert.equal(witness.strong, 1);
  assert.equal(witness.different_bytes, 2);
  assert.equal(compareRestoreWitness(witness, a).verified, false);
  const observed = fixture(); ram(observed).set([0x13, 0x57], 0x10000);
  assert.equal(compareRestoreWitness(witness, observed).verified, true);
  ram(observed)[0x10000 + 31] = 1;
  assert.equal(compareRestoreWitness(witness, observed).verified, false);
  // Changing source bytes after witness creation must not change expectations.
  ram(expected).fill(0, 0x10000, 0x10020);
  ram(observed)[0x10000 + 31] = 0;
  assert.equal(compareRestoreWitness(witness, observed).verified, true);
  assert.equal(JSON.stringify(witness).includes('expected'), false);
});

test('Unstable baselines, weak single-byte anchors and incompatible ROMs cannot attest a restore', () => {
  const expected = fixture(), a = fixture(), b = fixture();
  ram(expected).set([0x13, 0x57], 0x10000); ram(b)[0x10000 + 31] = 1;
  fails(() => makeRestoreWitness(expected, a, b), 'E_RESTORE_UNPROVEN');
  ram(b).fill(0); ram(expected)[0x10001] = 0;
  fails(() => makeRestoreWitness(expected, a, b), 'E_RESTORE_UNPROVEN');
  ram(expected)[0x10001] = 0x57;
  const anotherRom = fixture({ md5: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  fails(() => makeRestoreWitness(expected, a, anotherRom), 'E_NATIVE_IDENTITY');
  const witness = makeRestoreWitness(expected, a, b);
  fails(() => compareRestoreWitness(witness, anotherRom), 'E_NATIVE_IDENTITY');
  fails(() => compareRestoreWitness({ ...witness }, a), 'E_RESTORE_WITNESS');
});

test('Witnesses spread over at most 128 distinct RAM pages and enforce the 90 percent threshold', () => {
  const expected = fixture(), a = fixture(), b = fixture();
  for (let page = 0; page < 512; page++) ram(expected).fill(0x37, page * 4096, page * 4096 + 32);
  const witness = makeRestoreWitness(expected, a, b);
  assert.equal(witness.total, MAX_RESTORE_ANCHORS);
  assert.equal(new Set(witness.anchors.map(anchor => Math.floor(anchor.offset / 4096))).size, 128);
  assert.equal(witness.anchors[0].offset, 0);
  assert.equal(witness.anchors.at(-1).offset, 511 * 4096);
  const observed = expected.slice(), observedRam = ram(observed);
  for (const anchor of witness.anchors.slice(0, 12)) observedRam[anchor.offset] = 0;
  let result = compareRestoreWitness(witness, observed);
  assert.equal(result.matched, 116); assert.equal(result.verified, true);
  observedRam[witness.anchors[12].offset] = 0;
  result = compareRestoreWitness(witness, observed);
  assert.equal(result.matched, 115); assert.equal(result.verified, false);
});

test('Already equivalent RAM is checked in full and is never labeled a proven load transition', () => {
  const expected = fixture(), before = fixture(), witness = makeRestoreWitness(expected, before, before);
  assert.equal(witness.already_equivalent, true); assert.equal(witness.total, 0);
  let result = compareRestoreWitness(witness, before);
  assert.equal(result.equivalent, true); assert.equal(result.verified, false); assert.equal(result.restored, false);
  ram(before)[RDRAM_BYTES - 1] = 1;
  result = compareRestoreWitness(witness, before);
  assert.equal(result.equivalent, false); assert.equal(result.verified, false);
});
