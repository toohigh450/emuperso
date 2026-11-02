// SPDX-License-Identifier: MIT
// ZIP32 only. Nothing is extracted to disk or sent to a server.
import { MAX_ROM_BYTES, MIN_ROM_BYTES, RomFileError, prepareRomBytes, sha256 } from './rom-file.mjs';

export const MAX_ZIP_BYTES = 96 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 512;
const MAX_CENTRAL_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const ROM_SUFFIX = /\.(z64|n64|v64)$/i;
const archives = new WeakMap();
const ensure = (ok, code, message) => { if (!ok) throw new RomFileError(code, message); };
function checkAbort(signal) { if (signal?.aborted) throw new RomFileError('E_ZIP_ABORT', 'Import ZIP annulé.'); }

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
function crcUpdate(crc, bytes) {
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return crc;
}
export function crc32(bytes) { return (crcUpdate(0xffffffff, bytes) ^ 0xffffffff) >>> 0; }

function validateExtra(bytes, start, length) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = start + length;
  while (start < end) {
    ensure(start + 4 <= end, 'E_ZIP_HEADER', 'Champ supplémentaire ZIP tronqué.');
    const kind = view.getUint16(start, true), size = view.getUint16(start + 2, true);
    ensure(kind !== 0x0001, 'E_ZIP_ZIP64', 'Les archives ZIP64 ne sont pas prises en charge.');
    ensure(kind !== 0x9901, 'E_ZIP_ENCRYPTED', 'Les ZIP chiffrés ne sont pas pris en charge.');
    start += 4 + size;
    ensure(start <= end, 'E_ZIP_HEADER', 'Longueur de champ ZIP incohérente.');
  }
}

function decodeName(raw, flags) {
  let name;
  try { name = new TextDecoder('utf-8', { fatal: true }).decode(raw); }
  catch {
    ensure(!(flags & 0x0800), 'E_ZIP_NAME', 'Nom UTF-8 invalide dans le ZIP.');
    // Legacy ZIP code pages vary. This is a display label, never a filesystem path.
    name = Array.from(raw, value => String.fromCharCode(value)).join('');
  }
  const pieces = name.split('/');
  ensure(name && !/[\\:\x00-\x1f\x7f]/.test(name) && !name.startsWith('/') &&
    !pieces.some((part, i) => part === '.' || part === '..' || (part === '' && i !== pieces.length - 1)),
  'E_ZIP_PATH', 'Chemin dangereux ou ambigu dans le ZIP. Aucun fichier n’a été extrait.');
  return name;
}

export function inspectZipBytes(bytes, name = 'archive.zip') {
  ensure(bytes instanceof Uint8Array && bytes.length >= 22 && bytes.length <= MAX_ZIP_BYTES,
    'E_ZIP_LIMIT', 'ZIP invalide ou trop volumineux : maximum 96 Mio.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = offset => view.getUint16(offset, true), u32 = offset => view.getUint32(offset, true);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 65535); offset--) {
    if (u32(offset) === 0x06054b50 && offset + 22 + u16(offset + 20) === bytes.length &&
      u32(offset + 16) + u32(offset + 12) === offset) { eocd = offset; break; }
  }
  ensure(eocd >= 0, 'E_ZIP_HEADER', 'Fin de ZIP absente, tronquée ou incohérente.');
  const count = u16(eocd + 10), centralSize = u32(eocd + 12), central = u32(eocd + 16);
  ensure(u16(eocd + 4) === 0 && u16(eocd + 6) === 0 && u16(eocd + 8) === count,
    'E_ZIP_DISKS', 'Les ZIP répartis sur plusieurs volumes ne sont pas pris en charge.');
  ensure(count !== 65535 && central !== 0xffffffff && centralSize !== 0xffffffff,
    'E_ZIP_ZIP64', 'Les archives ZIP64 ne sont pas prises en charge.');
  ensure(count <= MAX_ZIP_ENTRIES && centralSize <= MAX_CENTRAL_BYTES,
    'E_ZIP_LIMIT', 'ZIP trop complexe : maximum 512 entrées et 2 Mio de répertoire.');
  ensure(!count || (bytes.length >= 30 && u32(0) === 0x04034b50),
    'E_ZIP_HEADER', 'Le fichier n’est pas un ZIP standard pris en charge.');
  let cursor = central, total = 0;
  const entries = [], ranges = [], names = new Set();
  for (let index = 0; index < count; index++) {
    ensure(cursor + 46 <= eocd && u32(cursor) === 0x02014b50, 'E_ZIP_HEADER', 'Répertoire ZIP invalide.');
    const madeBy = u16(cursor + 4), flags = u16(cursor + 8), method = u16(cursor + 10);
    const crc = u32(cursor + 16), compressedSize = u32(cursor + 20), size = u32(cursor + 24);
    const nameLength = u16(cursor + 28), extraLength = u16(cursor + 30), commentLength = u16(cursor + 32);
    const disk = u16(cursor + 34), attributes = u32(cursor + 38), offset = u32(cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    ensure(end <= eocd && nameLength > 0 && nameLength <= 1024, 'E_ZIP_HEADER', 'Nom ou entrée ZIP tronqués.');
    ensure(disk === 0 && size !== 0xffffffff && compressedSize !== 0xffffffff && offset !== 0xffffffff,
      'E_ZIP_ZIP64', 'ZIP64 ou archive multivolume non pris en charge.');
    ensure(!(flags & 0x0041), 'E_ZIP_ENCRYPTED', 'Les ZIP chiffrés ou protégés par mot de passe ne sont pas pris en charge.');
    ensure((flags & ~0x080e) === 0, 'E_ZIP_FLAGS', 'Options ZIP non prises en charge.');
    ensure(method === 0 || method === 8, 'E_ZIP_METHOD', 'Compression ZIP non prise en charge : utiliser Stockage ou Deflate.');
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const entryName = decodeName(rawName, flags), folded = entryName.toLowerCase();
    ensure(!names.has(folded), 'E_ZIP_DUPLICATE', 'Noms de fichiers dupliqués ou ambigus dans le ZIP.');
    names.add(folded);
    const unixType = (attributes >>> 16) & 0xf000;
    ensure([0, 0x8000, 0x4000].includes(unixType),
      'E_ZIP_LINK', 'Liens et fichiers spéciaux refusés dans le ZIP.');
    const directory = entryName.endsWith('/') || !!(attributes & 0x10) || ((madeBy >>> 8) === 3 && unixType === 0x4000);
    total += size;
    ensure(total <= MAX_TOTAL_BYTES && (!directory || size === 0), 'E_ZIP_LIMIT', 'Contenu déclaré du ZIP trop volumineux ou dossier incohérent.');
    validateExtra(bytes, cursor + 46 + nameLength, extraLength);
    // Validate every local header, including entries that will never be extracted.
    ensure(offset + 30 <= central && u32(offset) === 0x04034b50, 'E_ZIP_HEADER', 'En-tête local ZIP invalide.');
    const localNameLength = u16(offset + 26), localExtraLength = u16(offset + 28);
    const dataStart = offset + 30 + localNameLength + localExtraLength;
    ensure(dataStart <= central && localNameLength === nameLength && flags === u16(offset + 6) && method === u16(offset + 8),
      'E_ZIP_HEADER', 'En-têtes ZIP local et central différents.');
    const localName = bytes.subarray(offset + 30, offset + 30 + localNameLength);
    ensure(localName.every((value, i) => value === rawName[i]), 'E_ZIP_HEADER', 'Noms ZIP local et central différents.');
    validateExtra(bytes, offset + 30 + localNameLength, localExtraLength);
    let dataEnd = dataStart + compressedSize;
    ensure(dataEnd <= central, 'E_ZIP_HEADER', 'Données ZIP tronquées ou hors limites.');
    const localCrc = u32(offset + 14), localCompressed = u32(offset + 18), localSize = u32(offset + 22);
    if (flags & 8) {
      ensure((localCrc === 0 || localCrc === crc) && (localCompressed === 0 || localCompressed === compressedSize) && (localSize === 0 || localSize === size),
        'E_ZIP_HEADER', 'Tailles locales ZIP incohérentes.');
      const matches = start => start + 12 <= central && u32(start) === crc && u32(start + 4) === compressedSize && u32(start + 8) === size;
      if (matches(dataEnd)) dataEnd += 12;
      else if (dataEnd + 16 <= central && u32(dataEnd) === 0x08074b50 && matches(dataEnd + 4)) dataEnd += 16;
      else ensure(false, 'E_ZIP_HEADER', 'Descripteur de données ZIP absent ou incohérent.');
    } else ensure(localCrc === crc && localCompressed === compressedSize && localSize === size,
      'E_ZIP_HEADER', 'Tailles ou CRC locaux ZIP différents du répertoire.');
    if (method === 0) ensure(compressedSize === size, 'E_ZIP_HEADER', 'Taille incohérente pour un fichier ZIP non compressé.');
    ranges.push([offset, dataEnd]);
    if (!directory && ROM_SUFFIX.test(entryName)) {
      ensure(size >= MIN_ROM_BYTES && size <= MAX_ROM_BYTES && size % 4 === 0,
        'E_ZIP_LIMIT', 'ROM du ZIP hors limites : de 4 Kio à 64 Mio, taille multiple de quatre.');
      entries.push(Object.freeze({ id: index, name: entryName, size, compressedSize, method, crc32: crc, dataStart }));
    }
    cursor = end;
  }
  ensure(cursor === eocd && cursor - central === centralSize, 'E_ZIP_HEADER', 'Répertoire ZIP incomplet ou données supplémentaires non prises en charge.');
  ranges.sort((a, b) => a[0] - b[0]);
  ensure(ranges.every((range, i) => i === 0 || ranges[i - 1][1] <= range[0]), 'E_ZIP_OVERLAP', 'Entrées ZIP qui se chevauchent.');
  ensure(entries.length > 0, 'E_ZIP_NO_ROM', 'Aucune ROM .z64, .n64 ou .v64 trouvée dans le ZIP.');
  const archive = Object.freeze({ bytes, entries: Object.freeze(entries), archive: Object.freeze({ name, size: bytes.length }) });
  archives.set(archive, { bytes, entries: archive.entries });
  return archive;
}

export async function readZipFile(file, { signal } = {}) {
  ensure(file && /\.zip$/i.test(file.name), 'E_ZIP_EXTENSION', 'Choisissez une archive .zip.');
  ensure(Number.isSafeInteger(file.size) && file.size >= 22 && file.size <= MAX_ZIP_BYTES,
    'E_ZIP_LIMIT', 'Archive ZIP trop courte ou trop volumineuse : maximum 96 Mio.');
  checkAbort(signal);
  const buffer = await file.arrayBuffer();
  checkAbort(signal);
  ensure(buffer instanceof ArrayBuffer && buffer.byteLength === file.size, 'E_ZIP_READ', 'Lecture du ZIP incomplète.');
  const inspected = inspectZipBytes(new Uint8Array(buffer), file.name);
  const archive = Object.freeze({ ...inspected, archive: Object.freeze({ ...inspected.archive, sha256: await sha256(inspected.bytes) }) });
  archives.set(archive, archives.get(inspected));
  checkAbort(signal);
  return archive;
}

export async function extractZipEntry(archive, id, { signal } = {}) {
  checkAbort(signal);
  const inspected = archives.get(archive);
  ensure(inspected, 'E_ZIP_SELECTION', 'Archive non inspectée.');
  const entry = inspected.entries.find(item => item.id === id);
  ensure(entry, 'E_ZIP_SELECTION', 'Choisissez une ROM présente dans cette archive.');
  ensure(entry.size >= MIN_ROM_BYTES && entry.size <= MAX_ROM_BYTES && entry.size % 4 === 0,
    'E_ZIP_LIMIT', 'Taille de ROM ZIP hors limites.');
  const compressed = inspected.bytes.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
  let output, crc = 0xffffffff;
  if (entry.method === 0) {
    output = compressed.slice();
    crc = crcUpdate(crc, output);
  } else {
    let inflator;
    try { inflator = new DecompressionStream('deflate-raw'); }
    catch { throw new RomFileError('E_ZIP_BROWSER', 'Décompression ZIP indisponible. Mettez Chrome à jour ou importez la ROM extraite.'); }
    output = new Uint8Array(entry.size);
    const reader = new Blob([compressed]).stream().pipeThrough(inflator).getReader();
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    let written = 0;
    try {
      while (true) {
        checkAbort(signal);
        const { value, done } = await reader.read();
        checkAbort(signal);
        if (done) break;
        ensure(written + value.length <= entry.size && written + value.length <= MAX_ROM_BYTES,
          'E_ZIP_LIMIT', 'Décompression arrêtée : la ROM dépasse sa taille déclarée ou 64 Mio.');
        output.set(value, written); written += value.length; crc = crcUpdate(crc, value);
      }
      ensure(written === entry.size, 'E_ZIP_SIZE', 'Taille décompressée différente du répertoire ZIP.');
    } catch (error) {
      await reader.cancel().catch(() => {});
      if (error instanceof RomFileError) throw error;
      throw new RomFileError('E_ZIP_DEFLATE', 'Données compressées ZIP invalides ou tronquées.');
    } finally {
      signal?.removeEventListener('abort', abort);
      reader.releaseLock();
    }
  }
  checkAbort(signal);
  ensure(((crc ^ 0xffffffff) >>> 0) === entry.crc32, 'E_ZIP_CRC', 'CRC-32 du ZIP incorrect : contenu corrompu, lancement refusé.');
  return output;
}

export async function prepareZipRom(archive, id, options = {}) {
  const bytes = await extractZipEntry(archive, id, options);
  const entry = archives.get(archive).entries.find(item => item.id === id);
  const prepared = await prepareRomBytes(bytes, entry.name, 'local-zip');
  checkAbort(options.signal);
  return { bytes: prepared.bytes, metadata: Object.freeze({ ...prepared.metadata,
    archive_name: archive.archive.name, archive_size: archive.archive.size,
    archive_sha256: archive.archive.sha256 ?? null, archive_entry: entry.name,
    archive_crc32: entry.crc32.toString(16).padStart(8, '0'), archive_crc_verified: true }) };
}
