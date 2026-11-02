// SPDX-License-Identifier: MIT
// Reconnaissance locale seulement : ni compatibilité, ni code, ni pistes audio ne sont validés.
export const MIN_BYTES = 64 * 1024, MAX_BYTES = 900 * 1024 * 1024;
export class DiscFileError extends Error { constructor(code, message) { super(message); this.name = 'DiscFileError'; this.code = code; } }
const fail = (code, message) => { throw new DiscFileError(code, message); };
// Archives (mandat Karl, 1 515 jeux en .rar) : le moteur EmulatorJS 4.2.3 les décompresse lui-même
// (data/src/compression.js : libunrar.wasm, extractzip, extract7z) et choisit le .cue s'il y en a un.
// L'application ne décompresse rien : elle vérifie la signature et prend l'empreinte de l'archive.
export const ARCHIVE_EXTENSIONS = ['rar', 'zip', '7z'];
export const isArchive = ext => ARCHIVE_EXTENSIONS.includes(ext);
export function archiveKind(bytes) {
  const b = i => bytes[i];
  if (b(0) === 0x50 && b(1) === 0x4b && [0x0304, 0x0506, 0x0708].includes((b(2) << 8) | b(3))) return 'zip';
  if (b(0) === 0x37 && b(1) === 0x7a && b(2) === 0xbc && b(3) === 0xaf && b(4) === 0x27 && b(5) === 0x1c) return '7z';
  if (b(0) === 0x52 && b(1) === 0x61 && b(2) === 0x72 && b(3) === 0x21 && b(4) === 0x1a && b(5) === 0x07 && (b(6) === 0 || (b(6) === 1 && b(7) === 0))) return 'rar';
  return null;
}
export function validateDescriptor(file) {
  const ext = /\.([a-z0-9]+)$/i.exec(file?.name ?? '')?.[1]?.toLowerCase();
  if (ext === 'cue') fail('E_CUE', 'Un fichier .cue ne contient pas le jeu. Choisissez le .bin (jeu à piste unique), un .iso, un .chd, ou l’archive .rar/.zip/.7z qui contient le .cue et ses pistes.');
  if (!['iso', 'bin', 'img', 'chd', 'pbp', ...ARCHIVE_EXTENSIONS].includes(ext)) fail('E_EXTENSION', 'Format attendu : .iso, .bin, .img, .chd, .pbp, ou une archive .rar, .zip, .7z.');
  if (!Number.isSafeInteger(file.size) || file.size < MIN_BYTES) fail('E_SIZE', 'Fichier trop court pour un disque PS1 (minimum 64 Kio).');
  // Mesuré (Chromium 152, EmulatorJS 4.2.3) : un PBP de 518 Mio démarre ; un PBP complet de 980 Mio
  // fait échouer le moteur (ErrnoError 28 dans son système de fichiers). Plafond maintenu.
  if (file.size > MAX_BYTES) fail('E_SIZE', `Ce prototype accepte au maximum 900 Mio par fichier : au-delà, le moteur échoue au chargement (mesuré avec un PBP de 980 Mio).${ext === 'pbp' ? ' Pour un PBP multi-disques, utilisez un fichier par disque (.chd ou .bin/.cue).' : ''}`);
  return ext;
}
export function inspectDisc(bytes, size, ext) {
  const notes = [], text = n => new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(n, bytes.length)));
  let serial = null, sector = null;
  if (isArchive(ext)) {
    const kind = archiveKind(bytes);
    if (kind !== ext) fail('E_FORMAT', kind ? `Ce fichier est une archive ${kind.toUpperCase()} nommée .${ext} : renommez-le en .${kind}.` : `Signature ${ext.toUpperCase()} absente : le nom du fichier ne suffit pas.`);
    notes.push(`Archive ${ext.toUpperCase()} : décompressée en mémoire par le moteur au lancement (plus long qu’un .bin). Numéro de série non lisible : la clé de ce jeu est l’empreinte de l’archive.`);
  } else if (ext === 'chd' || ext === 'pbp') {
    if (ext === 'chd' && text(8) !== 'MComprHD') fail('E_FORMAT', 'Signature CHD absente : le nom du fichier ne suffit pas.');
    if (ext === 'pbp' && (bytes[0] !== 0 || text(4).slice(1) !== 'PBP')) fail('E_FORMAT', 'Signature PBP absente : le nom du fichier ne suffit pas.');
    notes.push('Fichier compressé : numéro de série non lisible, la clé de ce jeu est l’empreinte du fichier.');
  } else {
    sector = size % 2352 === 0 ? 2352 : size % 2048 === 0 ? 2048 : null;
    if (!sector) notes.push('Taille inhabituelle (ni 2048 ni 2352 octets par secteur) : image peut-être incomplète.');
    if (!text(65536).includes('Sony Computer Entertainment')) notes.push('Marque PlayStation absente du début du disque : ce n’est peut-être pas un disque PS1.');
    const found = /BOOT\s*=\s*cdrom:\\?(?:\([^)]*\))?([A-Z]{4})[_-]?(\d{3})\.?(\d{2})/i.exec(text(8 * 1024 * 1024));
    if (found) serial = `${found[1]}-${found[2]}${found[3]}`.toUpperCase();
    else notes.push('Numéro de série non détecté : la clé de ce jeu est l’empreinte du fichier.');
  }
  return { serial, sector_size: sector, notes };
}
export async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) fail('E_CRYPTO', 'SHA-256 indisponible : utilisez le serveur local dans un navigateur récent.');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
}
// SHA-256 incrémental (FIPS 180-4) : WebCrypto n'offre qu'un hachage en une fois, qui
// impose de garder le disque entier en mémoire (et Chrome en fait une copie). Le résultat
// est identique à crypto.subtle.digest : les clés des sauvegardes existantes ne changent pas.
const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
export class Sha256 {
  constructor() {
    this.h = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    this.w = new Int32Array(64); this.buf = new Uint8Array(64); this.bufLen = 0; this.bytes = 0;
  }
  update(data) {
    let i = 0; const n = data.length; this.bytes += n;
    if (this.bufLen) {
      const take = Math.min(64 - this.bufLen, n);
      this.buf.set(data.subarray(0, take), this.bufLen); this.bufLen += take; i = take;
      if (this.bufLen < 64) return this;
      this.block(this.buf, 0); this.bufLen = 0;
    }
    for (; i + 64 <= n; i += 64) this.block(data, i);
    if (i < n) { this.buf.set(data.subarray(i), 0); this.bufLen = n - i; }
    return this;
  }
  block(d, p) {
    const w = this.w, h = this.h;
    for (let j = 0; j < 16; j++, p += 4) w[j] = (d[p] << 24) | (d[p + 1] << 16) | (d[p + 2] << 8) | d[p + 3];
    for (let j = 16; j < 64; j++) {
      const x = w[j - 15], y = w[j - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }
    let a = h[0], b = h[1], c = h[2], e3 = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let j = 0; j < 64; j++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (hh + S1 + ((e & f) ^ (~e & g)) + K[j] + w[j]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (e3 + t1) | 0; e3 = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + e3) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }
  hex() {
    const bits = this.bytes * 8, padLen = (this.bufLen < 56 ? 56 : 120) - this.bufLen, tail = new Uint8Array(padLen + 8);
    tail[0] = 0x80;
    const hi = Math.floor(bits / 2 ** 32), lo = bits >>> 0;
    for (let i = 0; i < 4; i++) { tail[padLen + i] = hi >>> (24 - 8 * i); tail[padLen + 4 + i] = lo >>> (24 - 8 * i); }
    const bytes = this.bytes; this.update(tail); this.bytes = bytes;
    return [...this.h].map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }
}

// P0 chargement (mandat RC-1.13, Karl) : lecture PAR BLOCS au lieu de file.arrayBuffer().
// Mesuré sur le PC de Karl : la première lecture d'un CHD sur le disque D: prend 5 à 35 s,
// sans aucun retour visuel, ce qui ressemble à un blocage. Ici : progression par bloc,
// annulation possible ENTRE deux blocs (un bloc déjà demandé au navigateur ne peut pas
// être interrompu), mémoire limitée à un bloc + l'en-tête, signature vérifiée dès le
// premier bloc (un faux CHD est refusé sans lire tout le fichier).
export const CHUNK_BYTES = 8 * 1024 * 1024, HEAD_BYTES = 8 * 1024 * 1024;
export async function prepareDisc(file, { onStage = () => {}, signal = null, chunkBytes = CHUNK_BYTES } = {}) {
  const t0 = performance.now(), ms = () => Math.round(performance.now() - t0);
  const ext = validateDescriptor(file);
  onStage('validated', { ext, size: file.size, ms: ms() });
  const head = new Uint8Array(Math.min(HEAD_BYTES, file.size)), hasher = new Sha256();
  let done = 0, info = null, hashMs = 0;
  onStage('read.start', { size: file.size, chunk_bytes: chunkBytes, ms: ms() });
  while (done < file.size) {
    if (signal?.aborted) fail('E_ABORTED', 'Préparation annulée. Le jeu en cours et les sauvegardes ne sont pas touchés.');
    const end = Math.min(done + chunkBytes, file.size);
    let part;
    try { part = new Uint8Array(await file.slice(done, end).arrayBuffer()); }
    catch (error) { fail('E_READ', `Lecture impossible à ${(done / 1048576).toFixed(0)} Mio : fichier déplacé, verrouillé, incomplet ou mémoire insuffisante (${error?.name ?? 'erreur'}).`); }
    if (part.byteLength !== end - done) fail('E_READ', 'Le fichier a changé ou sa lecture est incomplète.');
    if (done < head.length) head.set(part.subarray(0, Math.min(part.length, head.length - done)), done);
    const h0 = performance.now(); hasher.update(part); hashMs += performance.now() - h0;
    done = end;
    if (!info && done >= head.length) {
      onStage('inspect.start', { ms: ms() });
      info = inspectDisc(head, file.size, ext);
      onStage('inspect.done', { serial_found: !!info.serial, notes: info.notes.length, ms: ms() });
    }
    onStage('read.progress', { bytes: done, size: file.size, ms: ms() });
  }
  if (signal?.aborted) fail('E_ABORTED', 'Préparation annulée. Le jeu en cours et les sauvegardes ne sont pas touchés.');
  const hash = hasher.hex();
  const timings = { total_ms: ms(), hash_ms: Math.round(hashMs), bytes: done };
  onStage('hash.done', timings);
  return { file, timings, metadata: Object.freeze({ source: 'local-file', name: file.name, size: file.size, filename_extension: ext, detected_format: ext,
    sector_size: info.sector_size, serial: info.serial, notes: Object.freeze(info.notes), source_sha256: hash, canonical_sha256: hash,
    validation_scope: 'Extension, taille, signature et numéro de série indicatif seulement ; lancement et compatibilité non validés.' }) };
}
