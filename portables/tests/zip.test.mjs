import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { extractFirst, listCandidates, isZip, crc32, ZipError } from '../js/zip.mjs';
import { ROM_EXTENSIONS } from '../js/systems.mjs';
import { makeGba } from './helpers.mjs';

const fixture = (n) => new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));
const expected = makeGba({ title: 'ZIPTEST', code: 'AZPE', size: 4096 });

test('CRC32 : vecteur de référence', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('ZIP deflate fabriqué par Python : prend le jeu, ignore le reste, retire le dossier', async () => {
  const z = fixture('py-deflate.zip');
  assert.equal(isZip(z), true);
  const r = await extractFirst(z, ROM_EXTENSIONS);
  assert.equal(r.name, 'Test Game (USA).gba');
  assert.deepEqual(r.bytes, expected);
});

test('ZIP stocké (sans compression)', async () => {
  const r = await extractFirst(fixture('py-stored.zip'), ROM_EXTENSIONS);
  assert.deepEqual(r.bytes, expected);
});

test('ZIP sans jeu : erreur claire', async () => {
  await assert.rejects(() => extractFirst(fixture('py-norom.zip'), ROM_EXTENSIONS), (e) => e instanceof ZipError && /Aucun jeu/.test(e.message));
});

test('fichier qui n\'est pas un ZIP', async () => {
  const junk = new Uint8Array(100).fill(7);
  assert.equal(isZip(junk), false);
  await assert.rejects(() => extractFirst(junk, ROM_EXTENSIONS), ZipError);
});

test('CRC corrompu : refusé', async () => {
  const z = fixture('py-stored.zip').slice();
  // Modifie un octet de données (juste après l'en-tête local de 30 octets + nom).
  const nameLen = z[26] | (z[27] << 8);
  z[30 + nameLen + 50] ^= 0xff;
  await assert.rejects(() => extractFirst(z, ROM_EXTENSIONS), (e) => e instanceof ZipError && /CRC32/.test(e.message));
});

test('ZIP chiffré : refusé', async () => {
  const z = fixture('py-stored.zip').slice();
  // Bit 0 des drapeaux dans le répertoire central.
  const view = new DataView(z.buffer);
  let eocd = z.length - 22;
  const cd = view.getUint32(eocd + 16, true);
  view.setUint16(cd + 8, view.getUint16(cd + 8, true) | 1, true);
  await assert.rejects(() => extractFirst(z, ROM_EXTENSIONS), (e) => e instanceof ZipError && /chiffré/.test(e.message));
});

test('ZIP minimal fabriqué à la main (deflate Node)', async () => {
  const data = expected;
  const comp = deflateRawSync(data);
  const name = new TextEncoder().encode('a.gba');
  const crc = crc32(data);
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26); name.forEach((b, i) => (local[30 + i] = b));
  const cdir = Buffer.alloc(46 + name.length);
  cdir.writeUInt32LE(0x02014b50, 0); cdir.writeUInt16LE(20, 4); cdir.writeUInt16LE(20, 6); cdir.writeUInt16LE(8, 10);
  cdir.writeUInt32LE(crc, 16); cdir.writeUInt32LE(comp.length, 20); cdir.writeUInt32LE(data.length, 24);
  cdir.writeUInt16LE(name.length, 28); cdir.writeUInt32LE(0, 42); name.forEach((b, i) => (cdir[46 + i] = b));
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdir.length, 12); eocd.writeUInt32LE(local.length + comp.length, 16);
  const zip = new Uint8Array(Buffer.concat([local, comp, cdir, eocd]));
  const r = await extractFirst(zip, ROM_EXTENSIONS);
  assert.deepEqual(r.bytes, data);
});

test('ZIP : taille excessive refusée avant décompression', async () => {
  await assert.rejects(extractFirst(fixture('py-deflate.zip'), ROM_EXTENSIONS, { maxBytes: 100 }), /trop gros/);
});

test('ZIP : offsets locaux hors fichier refusés avec une erreur explicite', async () => {
  const z = fixture('py-stored.zip').slice();
  const view = new DataView(z.buffer);
  const cd = view.getUint32(z.length - 22 + 16, true);
  view.setUint32(cd + 42, z.length + 100, true);
  await assert.rejects(extractFirst(z, ROM_EXTENSIONS), (e) => e instanceof ZipError && /hors du fichier/.test(e.message));
});

test('ZIP : choix explicite et entrée absente', async () => {
  const z = fixture('py-deflate.zip');
  const selected = await extractFirst(z, ROM_EXTENSIONS, { name: listCandidates(z, ROM_EXTENSIONS)[0].name });
  assert.deepEqual(selected.bytes, expected);
  await assert.rejects(extractFirst(z, ROM_EXTENSIONS, { name: 'absent.gba' }), /introuvable/);
});

test('ZIP : un flux qui dépasse la taille déclarée est arrêté', async () => {
  const z = fixture('py-deflate.zip').slice();
  const view = new DataView(z.buffer);
  const cd = view.getUint32(z.length - 22 + 16, true);
  // Première entrée : README ; trouve le fichier ROM dans le répertoire central.
  let p = cd;
  while (view.getUint32(p, true) === 0x02014b50) {
    const len = view.getUint16(p + 28, true);
    const name = new TextDecoder().decode(z.subarray(p + 46, p + 46 + len));
    if (name.endsWith('.gba')) { view.setUint32(p + 24, 10, true); break; }
    p += 46 + len + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  await assert.rejects(extractFirst(z, ROM_EXTENSIONS), /excessive/);
});
