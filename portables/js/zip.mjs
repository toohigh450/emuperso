// Lecture minimale d'un ZIP contenant un jeu (stockage ou deflate). Sans dépendance.
// Refuse les ZIP chiffrés, ZIP64 et toute entrée dont le CRC32 ne correspond pas.

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
  }
  return CRC_TABLE;
}

export function crc32(bytes) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export class ZipError extends Error {}

function readEntries(view, bytes) {
  const minEocd = 22;
  if (bytes.length < minEocd) throw new ZipError("Ce fichier n'est pas un ZIP valide.");
  let eocd = -1;
  const stop = Math.max(0, bytes.length - minEocd - 0xffff);
  for (let i = bytes.length - minEocd; i >= stop; i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("Ce fichier n'est pas un ZIP valide (fin d'archive introuvable).");
  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const cdSize = view.getUint32(eocd + 12, true);
  if (view.getUint16(eocd + 4, true) || view.getUint16(eocd + 6, true) || view.getUint16(eocd + 8, true) !== count) throw new ZipError('ZIP multi-volumes non pris en charge.');
  if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipError('ZIP64 non pris en charge.');
  if (cdOffset + cdSize > eocd) throw new ZipError('Répertoire central hors du ZIP.');

  const entries = [];
  let p = cdOffset;
  const decoder = new TextDecoder('utf-8');
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) {
      throw new ZipError("Répertoire central du ZIP illisible.");
    }
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const compressedSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    if (p + 46 + nameLen + extraLen + commentLen > cdOffset + cdSize) throw new ZipError('Répertoire central tronqué.');
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, flags, method, crc, compressedSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(compressed, expectedSize) {
  if (typeof DecompressionStream === 'undefined') {
    throw new ZipError('Ce navigateur ne sait pas décompresser les ZIP (DecompressionStream absent).');
  }
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > expectedSize) throw new ZipError('Taille décompressée excessive : ZIP corrompu.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

async function readEntryData(view, zipBytes, entry, maxBytes) {
  if (entry.flags & 0x1) throw new ZipError('ZIP chiffré : non pris en charge.');
  if (entry.compressedSize === 0xffffffff || entry.size === 0xffffffff) throw new ZipError('ZIP64 non pris en charge.');
  if (entry.size > maxBytes) throw new ZipError('Fichier trop gros dans le ZIP (limite mémoire dépassée).');
  if (entry.localOffset + 30 > zipBytes.length) throw new ZipError('Entrée de ZIP hors du fichier.');
  if (view.getUint32(entry.localOffset, true) !== 0x04034b50) throw new ZipError('Entrée de ZIP illisible.');
  const nameLen = view.getUint16(entry.localOffset + 26, true);
  const extraLen = view.getUint16(entry.localOffset + 28, true);
  const dataStart = entry.localOffset + 30 + nameLen + extraLen;
  if (dataStart + entry.compressedSize > zipBytes.length) throw new ZipError('Données ZIP tronquées.');
  const raw = zipBytes.subarray(dataStart, dataStart + entry.compressedSize);

  let data;
  if (entry.method === 0) data = raw.slice();
  else if (entry.method === 8) data = await inflateRaw(raw, entry.size);
  else throw new ZipError(`Méthode de compression ZIP ${entry.method} non prise en charge.`);

  if (data.length !== entry.size) throw new ZipError('Taille décompressée inattendue : ZIP corrompu.');
  if (crc32(data) !== entry.crc) throw new ZipError('CRC32 incorrect : ZIP corrompu.');
  return data;
}

export function isZip(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05);
}

/**
 * Extrait la première entrée dont l'extension est dans `accept` (ensemble de chaînes minuscules).
 * @returns {Promise<{name: string, bytes: Uint8Array}>}
 */
export function listCandidates(zipBytes, accept) {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const entries = readEntries(view, zipBytes);
  return entries.filter((e) => {
    if (e.name.endsWith('/')) return false;
    if (e.name.startsWith('__MACOSX/') || /(^|\/)\._/.test(e.name)) return false;
    const m = /\.([^.\\/]+)$/.exec(e.name);
    return m && accept.has(m[1].toLowerCase());
  });
}

export async function extractFirst(zipBytes, accept, { name, maxBytes = 1024 * 1024 * 1024 } = {}) {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const candidates = listCandidates(zipBytes, accept);
  if (candidates.length === 0) {
    throw new ZipError('Aucun jeu (.gb, .gbc, .gba, .nds) trouvé dans ce ZIP.');
  }
  const entry = name === undefined ? candidates[0] : candidates.find((e) => e.name === name);
  if (!entry) throw new ZipError('Jeu sélectionné introuvable dans le ZIP.');
  const data = await readEntryData(view, zipBytes, entry, maxBytes);
  const baseName = entry.name.replace(/^.*[\\/]/, '');
  return { name: baseName, bytes: data, otherCandidates: candidates.length - 1 };
}

/**
 * Toutes les entrées d'un ZIP (sauvegardes PSP : un dossier par sauvegarde). Mêmes contrôles
 * qu'extractFirst : pas de chiffrement ni de ZIP64, CRC32 vérifié, tailles plafonnées.
 * @returns {Promise<Array<{name: string, bytes: Uint8Array}>>} chemins complets, sans dossiers vides
 */
export async function extractAll(zipBytes, { maxBytes = 64 * 1024 * 1024, maxFiles = 2000 } = {}) {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const entries = readEntries(view, zipBytes).filter((e) => !e.name.endsWith('/') && !e.name.startsWith('__MACOSX/'));
  if (entries.length > maxFiles) throw new ZipError(`ZIP trop fourni (${entries.length} fichiers, maximum ${maxFiles}).`);
  const out = [];
  let total = 0;
  for (const entry of entries) {
    total += entry.size;
    if (total > maxBytes) throw new ZipError('ZIP trop gros une fois décompressé.');
    out.push({ name: entry.name, bytes: await readEntryData(view, zipBytes, entry, maxBytes) });
  }
  return out;
}

/** ZIP sans compression (méthode 0) : export de sauvegardes PSP lisible par tout outil d'archive. */
export function buildZip(files, date = new Date()) {
  const enc = new TextEncoder();
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.bytes);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
    lv.setUint16(10, time, true); lv.setUint16(12, day, true); lv.setUint32(14, crc, true);
    lv.setUint32(18, f.bytes.length, true); lv.setUint32(22, f.bytes.length, true); lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint16(12, time, true); cv.setUint16(14, day, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, f.bytes.length, true); cv.setUint32(24, f.bytes.length, true); cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, f.bytes);
    centrals.push(central);
    offset += local.length + f.bytes.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  return concat([...locals, ...centrals, end]);
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}
