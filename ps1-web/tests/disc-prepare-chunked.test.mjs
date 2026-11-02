// P0 chargement (mandat RC-1.13) : préparation par blocs, empreinte inchangée, erreurs explicites.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { prepareDisc, sha256, Sha256 } from '../disc-file.mjs';

const ref = bytes => createHash('sha256').update(bytes).digest('hex');
const disc = (size, boot = 'BOOT = cdrom:\\SLUS_006.94;1') => {
  const bytes = new Uint8Array(size), put = (at, s) => bytes.set(new TextEncoder().encode(s), at);
  put(9408, 'Licensed  by  Sony Computer Entertainment Inc.'); put(40000, boot); return bytes;
};
// Faux fichier qui compte les lectures et peut échouer, rendre trop peu d'octets ou se bloquer.
function fakeFile(bytes, name, { failAt = -1, shortAt = -1 } = {}) {
  const f = { name, size: bytes.length, slices: 0,
    slice(a, b) { const n = f.slices++; return { arrayBuffer: async () => {
      if (n === failAt) { const e = new Error('lecture refusée'); e.name = 'NotReadableError'; throw e; }
      const part = bytes.slice(a, n === shortAt ? b - 1 : b); return part.buffer;
    } }; },
    arrayBuffer() { throw new Error('le fichier entier ne doit plus être lu d’un bloc'); } };
  return f;
}

test('Sha256 incrémental = SHA-256 de référence (tailles limites, découpages arbitraires)', () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 1000, 65536 + 13]) {
    const data = randomBytes(n), h = new Sha256();
    for (let i = 0; i < n;) { const step = 1 + ((i * 7) % 97); h.update(data.subarray(i, i + step)); i += step; }
    assert.equal(h.hex(), ref(data), `taille ${n}`);
  }
});

test('prepareDisc par blocs : même empreinte que WebCrypto, progression monotone, aucune lecture d’un bloc', async () => {
  const bytes = disc(2352 * 300), file = fakeFile(bytes, 'jeu.bin'), stages = [];
  const r = await prepareDisc(file, { chunkBytes: 65536, onStage: (s, d) => stages.push([s, d]) });
  assert.equal(r.metadata.canonical_sha256, await sha256(bytes));
  assert.equal(r.metadata.serial, 'SLUS-00694');
  const progress = stages.filter(([s]) => s === 'read.progress').map(([, d]) => d.bytes);
  assert.deepEqual(progress, [...progress].sort((a, b) => a - b));
  assert.equal(progress.at(-1), bytes.length);
  assert.equal(stages.filter(([s]) => s === 'inspect.done').length, 1, 'une seule inspection');
  assert.equal(file.slices, Math.ceil(bytes.length / 65536));
  assert.equal(r.timings.bytes, bytes.length);
});

test('faux CHD refusé dès le premier bloc, sans lire le reste', async () => {
  const file = fakeFile(new Uint8Array(20 * 1024 * 1024), 'faux.chd');
  await assert.rejects(prepareDisc(file), { code: 'E_FORMAT' });
  assert.equal(file.slices, 1);
});

test('lecture refusée en cours de route => E_READ explicite avec la position', async () => {
  await assert.rejects(prepareDisc(fakeFile(disc(2352 * 300), 'jeu.bin', { failAt: 3 }), { chunkBytes: 65536 }),
    e => e.code === 'E_READ' && /Mio/.test(e.message) && /NotReadableError/.test(e.message));
});

test('bloc incomplet (fichier modifié pendant la lecture) => E_READ', async () => {
  await assert.rejects(prepareDisc(fakeFile(disc(2352 * 300), 'jeu.bin', { shortAt: 2 }), { chunkBytes: 65536 }), { code: 'E_READ' });
});

test('annulation entre deux blocs => E_ABORTED, plus aucune lecture ensuite', async () => {
  const abort = new AbortController(), file = fakeFile(disc(2352 * 300), 'jeu.bin');
  const run = prepareDisc(file, { chunkBytes: 65536, signal: abort.signal,
    onStage: (s, d) => { if (s === 'read.progress' && d.bytes >= 65536 * 2) abort.abort(); } });
  await assert.rejects(run, { code: 'E_ABORTED' });
  assert.equal(file.slices, 2);
});
