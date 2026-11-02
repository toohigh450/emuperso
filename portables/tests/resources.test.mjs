import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryPlan, MiB, MAX_INPUT_BYTES } from '../js/resources.mjs';
import { validateDsBios, MAX_BIOS_ZIP } from '../js/bios.mjs';
import { crc32 } from '../js/zip.mjs';

test('budgets DS à 256/512/1024 Mio, sans allouer les ROMs', () => {
  assert.equal(memoryPlan(256*MiB, {deviceMemory: 8}).warn, true);
  assert.equal(memoryPlan(512*MiB, {deviceMemory: 8}).estimated, 2816*MiB);
  assert.throws(() => memoryPlan(512*MiB), /Mémoire estimée excessive/);
  assert.throws(() => memoryPlan(1024*MiB, {deviceMemory: 16}), /maximum 512/);
  assert.throws(() => memoryPlan(256*MiB, {deviceMemory: 2}), /Mémoire estimée excessive/);
  assert.throws(() => memoryPlan(512*MiB, {deviceMemory: 8, archiveBytes: 512*MiB}), /Mémoire estimée excessive/);
  assert.throws(() => memoryPlan(512*MiB, {deviceMemory: 8, activeBytes: 128*MiB}), /Mémoire estimée excessive/);
  assert.equal(MAX_INPUT_BYTES, 528*MiB);
});

// Contenu artificiel : vérifie la structure, aucun BIOS matériel n'est fourni.
function biosZip(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, size] of entries) {
    const data = Buffer.alloc(size), filename = Buffer.from(name), crc = crc32(data);
    const local = Buffer.alloc(30+filename.length);
    local.writeUInt32LE(0x04034b50,0);local.writeUInt32LE(crc,14);local.writeUInt32LE(size,18);local.writeUInt32LE(size,22);local.writeUInt16LE(filename.length,26);filename.copy(local,30);
    const cd = Buffer.alloc(46+filename.length);
    cd.writeUInt32LE(0x02014b50,0);cd.writeUInt32LE(crc,16);cd.writeUInt32LE(size,20);cd.writeUInt32LE(size,24);cd.writeUInt16LE(filename.length,28);cd.writeUInt32LE(offset,42);filename.copy(cd,46);
    locals.push(local,data);central.push(cd);offset+=local.length+data.length;
  }
  const directory=Buffer.concat(central), end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return new Uint8Array(Buffer.concat([...locals,directory,end]));
}
const valid = [['bios7.bin',16384],['bios9.bin',4096],['firmware.bin',262144]];

test('BIOS DS : structure et CRC des trois fichiers attendus', async () => {
  assert.equal((await validateDsBios(biosZip(valid))).files.length,3);
});
test('BIOS DS : manque, doublon, sous-dossier et taille refusés', async () => {
  for (const entries of [valid.slice(1), [...valid,valid[0]], [['nested/bios7.bin',16384],...valid.slice(1)], [['bios7.bin',4],...valid.slice(1)]]) await assert.rejects(validateDsBios(biosZip(entries)), /BIOS DS/);
});
test('BIOS DS : ZIP corrompu, CRC et fichier trop gros refusés', async () => {
  const zip = biosZip(valid);zip[50]^=1;
  await assert.rejects(validateDsBios(zip), /CRC32/);
  await assert.rejects(validateDsBios(new Uint8Array(40)), /ZIP/);
  await assert.rejects(validateDsBios(new Uint8Array(MAX_BIOS_ZIP+1)), /trop gros/);
});
