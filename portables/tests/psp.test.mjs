import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { analyzePsp, detectPspFormat, parseSfo, normalizeDiscId, regionFromDiscId, blobReader, saveDataPrefix, PSP_MAX_BYTES } from '../js/psp.mjs';
import { Sha256, fingerprintBlob, toHex } from '../js/hash.mjs';
import { parseCheatCode, isPlaceholderCode } from '../js/codes.mjs';
import { discIdOfCheatName, classifyCheatFiles, inferSystemFromPath, parseCht } from '../js/cheats.mjs';
import { pspMemoryPlan } from '../js/resources.mjs';
import { systemFromPath } from '../js/catalog.mjs';
import { engineExtension, analyzeRom, SYSTEMS } from '../js/systems.mjs';

const SECTOR = 2048;
const MiB = 1024 * 1024;

// --- Fabrication d'images PSP minimales (aucun contenu de jeu réel) ---------------------
function sfo(fields) {
  const keys = Object.keys(fields);
  const enc = new TextEncoder();
  const keyBytes = [];
  const dataBytes = [];
  const entries = [];
  let kOff = 0, dOff = 0;
  for (const k of keys) {
    const kb = enc.encode(`${k}\0`);
    const db = enc.encode(`${fields[k]}\0`);
    const max = Math.ceil(db.length / 4) * 4;
    entries.push({ kOff, len: db.length, max, dOff });
    keyBytes.push(kb);
    const padded = new Uint8Array(max); padded.set(db);
    dataBytes.push(padded);
    kOff += kb.length; dOff += max;
  }
  const keyTable = 20 + keys.length * 16;
  const dataTable = Math.ceil((keyTable + kOff) / 4) * 4;
  const out = new Uint8Array(dataTable + dOff);
  const v = new DataView(out.buffer);
  out.set([0, 0x50, 0x53, 0x46]);
  v.setUint32(4, 0x0101, true); v.setUint32(8, keyTable, true); v.setUint32(12, dataTable, true); v.setUint32(16, keys.length, true);
  entries.forEach((e, i) => {
    const p = 20 + i * 16;
    v.setUint16(p, e.kOff, true); v.setUint16(p + 2, 0x0204, true); v.setUint32(p + 4, e.len, true); v.setUint32(p + 8, e.max, true); v.setUint32(p + 12, e.dOff, true);
  });
  let p = keyTable; for (const kb of keyBytes) { out.set(kb, p); p += kb.length; }
  p = dataTable; for (const db of dataBytes) { out.set(db, p); p += db.length; }
  return out;
}

function record(name, lba, size, dir) {
  const nameBytes = typeof name === 'number' ? Uint8Array.of(name) : new TextEncoder().encode(name);
  const len = 33 + nameBytes.length + (nameBytes.length % 2 === 0 ? 1 : 0);
  const r = new Uint8Array(len);
  const v = new DataView(r.buffer);
  r[0] = len;
  v.setUint32(2, lba, true); v.setUint32(6, lba, false); v.setUint32(10, size, true); v.setUint32(14, size, false);
  r[25] = dir ? 2 : 0; r[32] = nameBytes.length; r.set(nameBytes, 33);
  return r;
}

function iso({ systemId = 'PSP GAME', discId = 'ULUS-10041', title = 'Jeu d’essai', version = '1.01' } = {}) {
  const img = new Uint8Array(24 * SECTOR);
  const umd = new TextEncoder().encode(`${discId}|0000000000000001|0001|G`);
  const param = sfo({ CATEGORY: 'UG', DISC_ID: discId.replace('-', ''), DISC_VERSION: version, TITLE: title });
  const put = (lba, bytes) => img.set(bytes, lba * SECTOR);
  const dir = (lba, parent, items) => {
    let p = lba * SECTOR;
    for (const r of [record(0, lba, SECTOR, true), record(1, parent, SECTOR, true), ...items]) { img.set(r, p); p += r.length; }
  };
  const pvd = new Uint8Array(SECTOR);
  pvd[0] = 1; pvd.set(new TextEncoder().encode('CD001'), 1); pvd[6] = 1;
  pvd.set(new TextEncoder().encode(systemId.padEnd(32, ' ')), 8);
  pvd.set(new TextEncoder().encode('UMD VOLUME'.padEnd(32, ' ')), 40);
  pvd.set(record(0, 18, SECTOR, true), 156);
  put(16, pvd);
  put(17, Uint8Array.of(255, 0x43, 0x44, 0x30, 0x30, 0x31, 1));
  dir(18, 18, [record('PSP_GAME', 19, SECTOR, true), record('UMD_DATA.BIN;1', 20, umd.length, false)]);
  dir(19, 18, [record('PARAM.SFO;1', 21, param.length, false)]);
  put(20, umd);
  put(21, param);
  return img;
}

function cso(image, { version = 1, plainBlock = 16 } = {}) {
  const blocks = Math.ceil(image.length / SECTOR);
  const parts = [];
  const index = new Uint32Array(blocks + 1);
  let pos = 0x18 + (blocks + 1) * 4;
  for (let b = 0; b < blocks; b++) {
    const raw = image.subarray(b * SECTOR, (b + 1) * SECTOR);
    const plain = b === plainBlock;
    const data = plain ? raw : deflateRawSync(raw);
    index[b] = pos | (plain ? 0x80000000 : 0);
    parts.push(data); pos += data.length;
  }
  index[blocks] = pos;
  const out = new Uint8Array(pos);
  const v = new DataView(out.buffer);
  out.set(new TextEncoder().encode('CISO'));
  v.setUint32(4, 0x18, true); v.setUint32(8, image.length, true); v.setUint32(16, SECTOR, true);
  out[0x14] = version;
  out.set(new Uint8Array(index.buffer), 0x18);
  let p = 0x18 + (blocks + 1) * 4;
  for (const d of parts) { out.set(d, p); p += d.length; }
  return out;
}

function pbp(param) {
  const out = new Uint8Array(0x28 + param.length + 16);
  const v = new DataView(out.buffer);
  out.set([0, 0x50, 0x42, 0x50]);
  v.setUint32(4, 0x10000, true); v.setUint32(8, 0x28, true);
  for (let i = 1; i < 8; i++) v.setUint32(8 + i * 4, 0x28 + param.length, true);
  out.set(param, 0x28);
  return out;
}

const reader = (bytes) => async (p, n) => bytes.slice(p, p + n);

// --- Analyse ---------------------------------------------------------------------------
test('PSP : image ISO, identifiant du disque, titre, région et version lus sans tout charger', async () => {
  const img = iso();
  let read = 0;
  const info = await analyzePsp(async (p, n) => { read += n; return img.slice(p, p + n); }, img.length);
  assert.deepEqual(info.errors, []);
  assert.equal(info.format, 'iso');
  assert.equal(info.discId, 'ULUS-10041');
  assert.equal(info.title, 'Jeu d’essai');
  assert.equal(info.region, 'USA');
  assert.equal(info.version, '1.01');
  assert.equal(info.headerOk, true);
  assert.ok(read < 64 * 1024, `lecture limitée (${read} octets)`);
});

test('PSP : image CSO (blocs compressés et bloc stocké) donne le même résultat que l’ISO', async () => {
  const img = iso({ discId: 'ULES-00290', title: 'Essai CSO' });
  const c = cso(img);
  assert.equal(detectPspFormat(c.subarray(0, 0x40)), 'cso');
  const info = await analyzePsp(reader(c), c.length);
  assert.deepEqual(info.errors, []);
  assert.equal(info.format, 'cso');
  assert.equal(info.discId, 'ULES-00290');
  assert.equal(info.region, 'Europe');
  assert.equal(info.title, 'Essai CSO');
});

test('PSP : EBOOT.PBP lu par son PARAM.SFO', async () => {
  const b = pbp(sfo({ DISC_ID: 'NPJH50001', TITLE: 'Démo PSN', CATEGORY: 'EG' }));
  const info = await analyzePsp(reader(b), b.length);
  assert.equal(info.format, 'pbp');
  assert.equal(info.discId, 'NPJH-50001');
  assert.equal(info.region, 'Japon');
  assert.equal(info.title, 'Démo PSN');
});

test('PSP : formats refusés avec une explication (CHD, ZSO, CSO v2, inconnu, trop gros) ; image refaite acceptée', async () => {
  const chd = new TextEncoder().encode('MComprHD' + '\0'.repeat(120));
  assert.match((await analyzePsp(reader(chd), chd.length)).errors[0], /chdman/);
  const zso = new TextEncoder().encode('ZISO' + '\0'.repeat(60));
  assert.match((await analyzePsp(reader(zso), zso.length)).errors[0], /ZSO/);
  const v2 = cso(iso(), { version: 2 });
  assert.match((await analyzePsp(reader(v2), v2.length)).errors[0], /version 2/);
  const rebuilt = iso({ systemId: 'HJH VCDROM Extension' });
  const r = await analyzePsp(reader(rebuilt), rebuilt.length);
  assert.deepEqual(r.errors, []);
  assert.equal(r.discId, 'ULUS-10041');
  assert.match(r.warnings[0], /Image refaite/);
  const junk = randomBytes(40000);
  assert.match((await analyzePsp(reader(junk), junk.length)).errors[0], /pas un jeu PSP/);
  assert.match((await analyzePsp(reader(junk), PSP_MAX_BYTES + 1)).errors[0], /trop gros/);
  assert.match((await analyzePsp(reader(new Uint8Array(0)), 0)).errors[0], /vide/);
});

test('PSP : identifiants de disque, régions et dossier de sauvegarde', () => {
  assert.equal(normalizeDiscId('ulus10041'), 'ULUS-10041');
  assert.equal(normalizeDiscId('ULUS-10041'), 'ULUS-10041');
  assert.equal(normalizeDiscId('ULUS-1004'), null);
  assert.equal(regionFromDiscId('UCJS-10001'), 'Japon');
  assert.equal(regionFromDiscId('ULKS-46001'), 'Corée');
  assert.equal(regionFromDiscId(null), 'inconnue');
  assert.equal(saveDataPrefix('ULUS-10041'), 'ULUS10041');
  assert.equal(parseSfo(new Uint8Array(10)), null);
});

test('PSP : intégration au lanceur (extension moteur, catalogue, refus .chd par analyzeRom)', () => {
  assert.equal(SYSTEMS.psp.coreId, 'ppsspp');
  assert.equal(engineExtension({ system: 'psp', format: 'cso' }), 'cso');
  assert.equal(systemFromPath('PSP/Jeu (USA).cso'), 'psp');
  assert.equal(systemFromPath('Sony - PlayStation Portable/Jeu.zip'), 'psp');
  assert.match(analyzeRom('jeu.chd', new Uint8Array(16)).errors[0], /chdman/);
});

// --- Empreinte par morceaux ------------------------------------------------------------
test('SHA-256 par morceaux identique à crypto, quelles que soient les coupures', async () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 127, 128, 4097]) {
    const b = randomBytes(n);
    const s = new Sha256();
    for (let p = 0; p < n; p += 7) s.update(b.subarray(p, p + 7));
    assert.equal(toHex(s.digest()), createHash('sha256').update(b).digest('hex'), `taille ${n}`);
  }
  const big = randomBytes(9 * MiB + 3);
  const steps = [];
  const fp = await fingerprintBlob(new Blob([big]), (done, total) => steps.push([done, total]));
  assert.equal(fp.hex, createHash('sha256').update(big).digest('hex'));
  assert.deepEqual(steps.at(-1), [big.length, big.length]);
});

// --- Codes CWCheat ---------------------------------------------------------------------
test('Codes PSP : CWCheat normalisé, paires obligatoires, titres de section non activables', () => {
  const one = parseCheatCode('psp', '0x2024da44 0x3f800000');
  assert.equal(one.ok, true);
  assert.equal(one.code, '_L 0x2024DA44 0x3F800000');
  const multi = parseCheatCode('psp', '_L 0x2024DA44 0x3F800000\n_L 0x20000010 0x00000001');
  assert.equal(multi.code, '_L 0x2024DA44 0x3F800000+_L 0x20000010 0x00000001');
  assert.equal(multi.parts.length, 2);
  assert.equal(parseCheatCode('psp', '_L 0x2024DA44').ok, false);
  assert.equal(parseCheatCode('psp', '_L 0x2024DA4 0x00000001').ok, false);
  assert.match(parseCheatCode('psp', '_S ULUS-10080').error, /_L/);
  assert.equal(isPlaceholderCode('psp', '_L 0x00000000 0x00000000'), true);
  assert.equal(isPlaceholderCode('psp', '_L 0x2024DA44 0x3F800000'), false);
  assert.equal(isPlaceholderCode('gba', '00000000'), false);
});

test('Fichiers .cht PSP : dossier libretro reconnu, correspondance par identifiant de disque à confirmer', () => {
  assert.equal(inferSystemFromPath('Sony - PlayStation Portable/Jeu [US] [ULUS-10080].cht'), 'psp');
  assert.equal(discIdOfCheatName('Sony - PlayStation Portable/007 - From Russia With Love [US] [ULUS-10080].cht'), 'ULUS-10080');
  assert.equal(discIdOfCheatName('Zelda (USA).cht'), null);
  const files = [
    { name: '007 - From Russia With Love [US] [ULUS-10080].cht' },
    { name: '007 - From Russia With Love [EU] [ULES-00290].cht' },
  ];
  const r = classifyCheatFiles('007 (USA).cso', 'f'.repeat(64), files, { discId: 'ULUS-10080' });
  assert.deepEqual(r.identified, []);
  assert.deepEqual(r.sameDisc.map((f) => f.name), [files[0].name]);
  const codes = parseCht('cheat0_desc = "Titre"\ncheat0_code =  "_L 0x00000000 0x00000000"\ncheat1_desc = "16:9"\ncheat1_code =  "_L 0x2024DA44 0x3F800000"');
  assert.equal(codes.length, 2);
  assert.equal(isPlaceholderCode('psp', codes[0].code), true);
  assert.equal(parseCheatCode('psp', codes[1].code).ok, true);
});

test('Mémoire PSP : estimation prudente, avertissement et refus', () => {
  assert.equal(pspMemoryPlan(300 * MiB, { deviceMemory: 8 }).warn, false);
  assert.equal(pspMemoryPlan(900 * MiB, { deviceMemory: 8 }).warn, true);
  assert.throws(() => pspMemoryPlan(1700 * MiB, { deviceMemory: 8 }), /trop lourd/);
  assert.throws(() => pspMemoryPlan(900 * MiB, { deviceMemory: 2 }), /trop lourd/);
});

test('blobReader lit une tranche d’un Blob', async () => {
  const read = blobReader(new Blob([Uint8Array.of(1, 2, 3, 4, 5)]));
  assert.deepEqual([...await read(1, 3)], [2, 3, 4]);
});

// --- Sauvegardes PSP (dossiers de la carte mémoire, échangés en ZIP) -----------------------
import { buildZip, extractAll } from '../js/zip.mjs';
import { checkSaveArchive } from '../js/psp.mjs';

test('Sauvegardes PSP : ZIP exporté relu à l’identique, contenu déterministe', async () => {
  const files = [
    { name: 'ULES00233DATA00/PARAM.SFO', bytes: Uint8Array.of(0, 0x50, 0x53, 0x46, 1, 2) },
    { name: 'ULES00233DATA00/DATA.BIN', bytes: new Uint8Array(randomBytes(5000)) },
  ];
  const date = new Date(2000, 0, 1);
  const zip = buildZip(files, date);
  assert.deepEqual(buildZip(files, date), zip);
  const back = await extractAll(zip);
  assert.deepEqual(back.map((f) => f.name), files.map((f) => f.name));
  assert.deepEqual([...back[1].bytes], [...files[1].bytes]);
});

test('Sauvegardes PSP : seuls les dossiers de ce jeu, sans chemin dangereux', () => {
  const f = (name) => ({ name, bytes: new Uint8Array(1) });
  assert.deepEqual(checkSaveArchive([f('ULES00233DATA00/DATA.BIN'), f('ULES00233SYS/PARAM.SFO')], 'ULES00233'), { ok: true, folders: ['ULES00233DATA00', 'ULES00233SYS'] });
  assert.match(checkSaveArchive([f('ULUS10041DATA00/DATA.BIN')], 'ULES00233').error, /pas une sauvegarde de ce jeu/);
  assert.match(checkSaveArchive([f('../ULES00233/DATA.BIN')], 'ULES00233').error, /Chemin refusé/);
  assert.match(checkSaveArchive([f('ULES00233DATA00\\..\\x')], 'ULES00233').error, /Chemin refusé/);
  assert.match(checkSaveArchive([f('DATA.BIN')], 'ULES00233').error, /Chemin refusé/);
  assert.match(checkSaveArchive([], 'ULES00233').error, /vide/);
  assert.match(checkSaveArchive([f('ULES00233DATA00/DATA.BIN')], null).error, /inconnu/);
});

test('Fichier CWCheat écrit avant le démarrage : une paire par ligne, vide sans code actif', async () => {
  const { pspCheatFile } = await import('../js/psp.mjs');
  const f = pspCheatFile('NPUZ-00109', [{ name: 'Vies\ninfinies', code: '_L 0x20023964 0x8E37D6F0 _L 0x20023970 0x24040009' }, { name: 'B', code: '_L 0x2024da44 0x3f800000+_L 0x20000010 0x00000001' }]);
  assert.equal(f.path, '/data/saves/PPSSPP/PSP/Cheats/NPUZ00109.ini');
  assert.equal(f.text, '_S NPUZ00109\n_C1 Vies infinies\n_L 0x20023964 0x8E37D6F0\n_L 0x20023970 0x24040009\n_C1 B\n_L 0x2024DA44 0x3F800000\n_L 0x20000010 0x00000001\n');
  assert.equal(pspCheatFile('ULES-00233', []).text, '_S ULES00233\n');
  assert.equal(pspCheatFile(null, []), null);
});

test('Codes PSP en conflit : même adresse, valeurs différentes ; conditionnels ignorés', async () => {
  const { pspCodeConflicts } = await import('../js/codes.mjs');
  const conflicts = pspCodeConflicts([
    { name: 'Niveau 1', code: '_L 0x20002020 0x24080000 _L 0x20002024 0x00000001' },
    { name: 'Niveau 2', code: '_L 0x20002020 0x24080001' },
    { name: 'Vies', code: '_L 0x20023964 0x8E37D6F0' },
    { name: 'Même valeur', code: '_L 0x20023964 0x8E37D6F0' },
    { name: 'Conditionnel', code: '_L 0xD0001234 0x20002020 _L 0x20002020 0x00000005' },
  ]);
  assert.deepEqual(conflicts, [['Niveau 1', 'Niveau 2', '0x08802020']]);
});
