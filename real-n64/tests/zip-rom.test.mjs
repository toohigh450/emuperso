// SPDX-License-Identifier: MIT
// Fixtures contain only this repository's MIT diagnostic ROM and synthetic data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { inspectZipBytes, extractZipEntry, prepareZipRom, readZipFile } from '../zip-rom.mjs';

const ROM = new Uint8Array(readFileSync(new URL('../homebrew/fallback-open/demo-emuperso-open.z64', import.meta.url)));
const SHA = bytes => createHash('sha256').update(bytes).digest('hex');
function crc32(bytes) {
  let result = 0xffffffff;
  for (const byte of bytes) {
    result ^= byte;
    for (let i = 0; i < 8; i++) result = (result >>> 1) ^ (result & 1 ? 0xedb88320 : 0);
  }
  return (result ^ 0xffffffff) >>> 0;
}
function permute(bytes, width) {
  const out = bytes.slice();
  for (let i = 0; i < out.length; i += width) out.set(bytes.subarray(i, i + width).slice().reverse(), i);
  return out;
}

// Independent small ZIP32 fixture writer; no production compression/parser used.
function fixture(entries, options = {}) {
  const locals = [], central = [];
  let offset = 0;
  for (const source of entries) {
    const data = Buffer.from(source.data ?? ROM);
    const name = Buffer.from(source.nameBytes ?? source.name ?? 'demo.z64');
    const localName = Buffer.from(source.localName ?? name);
    const method = source.method ?? 8;
    const packed = Buffer.from(source.packed ?? (method === 8 ? deflateRawSync(data) : data));
    const checksum = source.crc ?? crc32(data);
    const flags = source.flags ?? (0x0800 | (source.descriptor ? 8 : 0));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(source.localFlags ?? flags, 6);
    local.writeUInt16LE(source.localMethod ?? method, 8);
    local.writeUInt32LE(source.descriptor ? 0 : source.localCrc ?? checksum, 14);
    local.writeUInt32LE(source.descriptor ? 0 : source.localCompressedSize ?? packed.length, 18);
    local.writeUInt32LE(source.descriptor ? 0 : source.localSize ?? source.size ?? data.length, 22);
    local.writeUInt16LE(localName.length, 26);
    const descriptor = source.descriptor ? Buffer.alloc(source.descriptorSignature === false ? 12 : 16) : Buffer.alloc(0);
    if (descriptor.length) {
      const start = descriptor.length === 16 ? 4 : 0;
      if (start) descriptor.writeUInt32LE(0x08074b50);
      descriptor.writeUInt32LE(source.descriptorCrc ?? checksum, start);
      descriptor.writeUInt32LE(packed.length, start + 4);
      descriptor.writeUInt32LE(source.size ?? data.length, start + 8);
    }
    const extra = Buffer.from(source.extra ?? []);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(source.madeBy ?? 20, 4);
    c.writeUInt16LE(source.versionNeeded ?? 20, 6);
    c.writeUInt16LE(flags, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt32LE(checksum, 16);
    c.writeUInt32LE(source.compressedSize ?? packed.length, 20);
    c.writeUInt32LE(source.size ?? data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt16LE(extra.length, 30);
    c.writeUInt16LE(source.disk ?? 0, 34);
    c.writeUInt32LE(source.externalAttributes ?? 0, 38);
    c.writeUInt32LE(source.localOffset ?? offset, 42);
    locals.push(local, localName, packed, descriptor);
    central.push(c, name, extra);
    offset += local.length + localName.length + packed.length + descriptor.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  const comment = Buffer.from(options.comment ?? []);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(options.disk ?? 0, 4);
  end.writeUInt16LE(options.directoryDisk ?? 0, 6);
  end.writeUInt16LE(options.diskCount ?? entries.length, 8);
  end.writeUInt16LE(options.count ?? entries.length, 10);
  end.writeUInt32LE(options.directorySize ?? directory.length, 12);
  end.writeUInt32LE(options.directoryOffset ?? offset, 16);
  end.writeUInt16LE(comment.length, 20);
  return new Uint8Array(Buffer.concat([...locals, directory, end, comment]));
}
function first(archive) { assert(archive.entries.length); return archive.entries[0].id; }
async function rejectsArchive(bytes) {
  await assert.rejects(async () => {
    const archive = inspectZipBytes(bytes);
    for (const entry of archive.entries) await extractZipEntry(archive, entry.id);
  });
}

test('ZIP stocké : octets exacts, entrée imbriquée et source intacte', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const bytes = fixture([{ name: 'dossier/DEMO.Z64', method: 0 }]), before = bytes.slice();
  const archive = inspectZipBytes(bytes);
  assert.equal(archive.entries.length, 1);
  assert.equal(archive.entries[0].name, 'dossier/DEMO.Z64');
  assert.deepEqual(await extractZipEntry(archive, first(archive)), ROM);
  assert.deepEqual(bytes, before);
});

for (const [format, data] of Object.entries({ z64: ROM, v64: permute(ROM, 2), n64: permute(ROM, 4) })) {
  test(`ZIP DEFLATE ${format} : extraction puis normalisation avec hashes indépendants`, async () => {
    const archive = await readZipFile(new File([fixture([{ name: `demo.${format}`, data }])], 'local.zip'));
    const prepared = await prepareZipRom(archive, first(archive));
    assert.deepEqual(prepared.bytes, ROM);
    assert.equal(prepared.metadata.source, 'local-zip');
    assert.equal(prepared.metadata.detected_format, format);
    assert.equal(prepared.metadata.source_sha256, SHA(data));
    assert.equal(prepared.metadata.canonical_sha256, SHA(ROM));
  });
}

test('Descripteurs de données ZIP32 avec et sans signature', async () => {
  for (const descriptorSignature of [true, false]) {
    const archive = inspectZipBytes(fixture([{ name: 'stream.z64', descriptor: true, descriptorSignature }]));
    assert.deepEqual(await extractZipEntry(archive, first(archive)), ROM);
  }
});

test('Plusieurs ROM sont listées sans extraction automatique ; fichier annexe ignoré', async () => {
  const archive = inspectZipBytes(fixture([
    { name: 'readme.txt', data: new TextEncoder().encode('MIT diagnostic fixture') },
    { name: 'A.z64' }, { name: 'B.n64', data: permute(ROM, 4) },
  ]));
  assert.deepEqual(archive.entries.map(e => e.name), ['A.z64', 'B.n64']);
  const chosen = archive.entries.find(e => e.name === 'B.n64');
  assert.deepEqual((await prepareZipRom(archive, chosen.id)).bytes, ROM);
  await assert.rejects(async () => extractZipEntry(archive, 999999));
});

test('Absence de ROM, archive vide, fausse signature et troncatures refusées', async () => {
  for (const bytes of [fixture([]), fixture([{ name: 'readme.md', data: new TextEncoder().encode('fixture') }]),
    new Uint8Array(4096), fixture([{ name: 'x.z64' }]).subarray(0, -1), fixture([{ name: 'x.z64' }]).subarray(0, 15)]) {
    await rejectsArchive(bytes);
  }
});

test('Le format ROM reste validé après extraction et une extension trompeuse est signalée', async () => {
  const archive = inspectZipBytes(fixture([{ name: 'wrong.n64', data: ROM }]));
  const prepared = await prepareZipRom(archive, first(archive));
  assert.equal(prepared.metadata.extension_mismatch, true);
  assert.equal(prepared.metadata.detected_format, 'z64');
  const invalid = inspectZipBytes(fixture([{ name: 'not-a-rom.z64', data: new Uint8Array(4096) }]));
  await assert.rejects(prepareZipRom(invalid, first(invalid)), { code: 'E_FORMAT' });
});

test('CRC incorrect et différence local/central refusés avant tout lancement', async () => {
  for (const options of [{ crc: 1234 }, { localCrc: 1234 }, { localName: 'other.z64' },
    { localMethod: 0 }, { localFlags: 0x0801 }, { localSize: ROM.length + 4 }, { localCompressedSize: 1 }]) {
    await rejectsArchive(fixture([{ name: 'demo.z64', ...options }]));
  }
});

test('Chiffrement, multi-disques, ZIP64 et méthodes non prises en charge refusés', async () => {
  for (const bytes of [fixture([{ flags: 0x0801 }]), fixture([{ disk: 1 }]),
    fixture([{}], { disk: 1 }), fixture([{}], { directoryDisk: 1 }), fixture([{}], { diskCount: 0 }),
    fixture([{ method: 12 }]), fixture([{ size: 0xffffffff }]), fixture([{ localOffset: 0xffffffff }]),
    fixture([{}], { count: 0xffff }), fixture([{}], { directoryOffset: 0xffffffff }),
    fixture([{ extra: [1, 0, 0, 0] }])]) await rejectsArchive(bytes);
});

test('Chemins de traversée, absolus, Windows et contrôles sont refusés', async () => {
  for (const name of ['../demo.z64', 'a/../demo.z64', '/demo.z64', 'C:/demo.z64',
    'a\\demo.z64', 'a//demo.z64', './demo.z64', 'a/./demo.z64', '\\server\\share.z64', 'a\0.z64']) {
    await rejectsArchive(fixture([{ name }]));
  }
});

test('Liens Unix et noms d’entrée dupliqués ambigus sont refusés', async () => {
  for (const host of [3, 19]) {
    await rejectsArchive(fixture([{ madeBy: (host << 8) | 20, externalAttributes: (0xa1ff << 16) >>> 0 }]));
  }
  await rejectsArchive(fixture([{ name: 'same.z64' }, { name: 'same.z64' }]));
});

test('Une archive inspectée reste immuable et une copie forgée ne devient pas une archive validée', async () => {
  const archive = inspectZipBytes(fixture([{ name: 'immutable.z64' }]));
  assert(Object.isFrozen(archive)); assert(Object.isFrozen(archive.entries));
  assert(Object.isFrozen(archive.entries[0])); assert(Object.isFrozen(archive.archive));
  assert.throws(() => { archive.entries = []; }, TypeError);
  assert.throws(() => { archive.entries[0].size = 1024 * 1024 * 1024; }, TypeError);
  assert.throws(() => { archive.bytes = new Uint8Array(); }, TypeError);
  const forged = { ...archive, entries: [{ ...archive.entries[0], size: 1024 * 1024 * 1024 }] };
  await assert.rejects(extractZipEntry(forged, first(archive)));
  assert.deepEqual(await extractZipEntry(archive, first(archive)), ROM);
});

test('Les bornes de taille et du nombre d’entrées précèdent toute décompression', async () => {
  await rejectsArchive(fixture([{ size: 64 * 1024 * 1024 + 4, localSize: 64 * 1024 * 1024 + 4 }]));
  await rejectsArchive(fixture(Array.from({ length: 513 }, (_, n) => ({ name: `demo-${n}.z64`, data: new Uint8Array() }))));
  await rejectsArchive(fixture(Array.from({ length: 5 }, (_, n) => ({ name: `large-${n}.z64`, size: 64 * 1024 * 1024, localSize: 64 * 1024 * 1024 }))));
});

test('DEFLATE à sortie mensongère est interrompu sans accepter le contenu', async () => {
  const data = new Uint8Array(1024 * 1024); data.set(ROM);
  await rejectsArchive(fixture([{ name: 'bomb.z64', data, size: 4096, localSize: 4096 }]));
});

test('Limite positive réelle : ROM synthétique de 64 Mio fortement compressée acceptée', async () => {
  const data = new Uint8Array(64 * 1024 * 1024); data.set(ROM);
  const archive = inspectZipBytes(fixture([{ name: 'synthetic-max.z64', data }]));
  const output = await extractZipEntry(archive, first(archive));
  assert.equal(output.length, data.length);
  assert.equal(SHA(output), SHA(data));
});

test('Répertoire central incohérent, offsets hors limites et chevauchements refusés', async () => {
  for (const bytes of [fixture([{}], { directorySize: 1 }), fixture([{}], { directoryOffset: 1 }),
    fixture([{ localOffset: 0x7fffffff }]), fixture([{ name: 'A.z64' }, { name: 'B.z64', localOffset: 0 }])]) {
    await rejectsArchive(bytes);
  }
});

test('Commentaire ZIP arbitraire ne cache pas une archive valide derrière un faux EOCD', async () => {
  const comment = Buffer.alloc(30); comment.writeUInt32LE(0x06054b50, 2);
  const archive = inspectZipBytes(fixture([{ name: 'with-comment.z64' }], { comment }));
  assert.deepEqual(await extractZipEntry(archive, first(archive)), ROM);
});

test('ZIP trop grand ou extension invalide refusés avant lecture ; lectures partielles refusées', async () => {
  for (const descriptor of [{ name: 'x.zip', size: 96 * 1024 * 1024 + 1 }, { name: 'x.exe', size: 4096 }, { name: 'x.zip', size: 0 }]) {
    let read = false;
    await assert.rejects(readZipFile({ ...descriptor, arrayBuffer: async () => { read = true; return new ArrayBuffer(1); } }));
    assert.equal(read, false);
  }
  await assert.rejects(readZipFile({ name: 'partial.zip', size: 4096, arrayBuffer: async () => new ArrayBuffer(30) }));
});

test('Annulation explicite n’accepte aucune entrée', async () => {
  const archive = inspectZipBytes(fixture([{ name: 'cancel.z64' }]));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(extractZipEntry(archive, first(archive), { signal: controller.signal }));
  const running = new AbortController();
  const extraction = extractZipEntry(archive, first(archive), { signal: running.signal });
  running.abort();
  await assert.rejects(extraction);
  assert.deepEqual(await extractZipEntry(archive, first(archive)), ROM);
});
