import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDisc, inspectDisc, validateDescriptor, DiscFileError } from '../disc-file.mjs';
test('900 Mio boundary is unchanged; oversize rejected before reading any bytes', async () => {
  const size = 900 * 1024 * 1024;
  assert.equal(validateDescriptor({ name: 'synthetic.iso', size }), 'iso');
  let reads = 0;
  await assert.rejects(prepareDisc({ name: 'synthetic.iso', size: size + 1,
    arrayBuffer() { reads++; throw new Error('must never read oversized disc'); } }), { code: 'E_SIZE' });
  assert.equal(reads, 0);
});
const disc = (size = 128 * 1024, boot = 'BOOT = cdrom:\\SLUS_006.94;1') => {
  const bytes = new Uint8Array(size), put = (at, s) => bytes.set(new TextEncoder().encode(s), at);
  put(9408, 'Licensed  by  Sony Computer Entertainment Inc.'); put(40000, boot); return bytes;
};
test('numéro de série et signature détectés, clé = SHA-256', async () => {
  const bytes = disc(2352 * 60), prepared = await prepareDisc(new File([bytes], 'jeu.bin'));
  assert.equal(prepared.metadata.serial, 'SLUS-00694'); assert.equal(prepared.metadata.sector_size, 2352);
  assert.deepEqual(prepared.metadata.notes, []); assert.match(prepared.metadata.canonical_sha256, /^[a-f0-9]{64}$/);
});
test('deux disques différents : deux empreintes', async () => {
  const a = await prepareDisc(new File([disc()], 'a.iso')), other = disc(); other[100] = 7;
  assert.notEqual(a.metadata.canonical_sha256, (await prepareDisc(new File([other], 'b.iso'))).metadata.canonical_sha256);
});
test('refus : .cue, extension, taille, signature CHD/PBP', async () => {
  assert.throws(() => validateDescriptor({ name: 'x.cue', size: 1e6 }), { code: 'E_CUE' });
  assert.throws(() => validateDescriptor({ name: 'x.z64', size: 1e6 }), { code: 'E_EXTENSION' });
  assert.throws(() => validateDescriptor({ name: 'x.iso', size: 10 }), { code: 'E_SIZE' });
  assert.throws(() => validateDescriptor({ name: 'x.iso', size: 901 * 1024 * 1024 }), { code: 'E_SIZE' });
  await assert.rejects(prepareDisc(new File([new Uint8Array(70000)], 'x.chd')), DiscFileError);
  assert.throws(() => inspectDisc(new Uint8Array(70000), 70000, 'pbp'), { code: 'E_FORMAT' });
});
test('disque sans série ni marque PlayStation : remarques honnêtes, pas de refus', () => {
  const info = inspectDisc(new Uint8Array(2048 * 40), 2048 * 40 + 1, 'iso');
  assert.equal(info.serial, null); assert.equal(info.notes.length, 3);
});
