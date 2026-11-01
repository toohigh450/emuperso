// SPDX-License-Identifier: MIT
// Reconnaissance locale seulement : ni compatibilité, ni code, ni pistes audio ne sont validés.
export const MIN_BYTES = 64 * 1024, MAX_BYTES = 900 * 1024 * 1024;
export class DiscFileError extends Error { constructor(code, message) { super(message); this.name = 'DiscFileError'; this.code = code; } }
const fail = (code, message) => { throw new DiscFileError(code, message); };
export function validateDescriptor(file) {
  const ext = /\.([a-z0-9]+)$/i.exec(file?.name ?? '')?.[1]?.toLowerCase();
  if (ext === 'cue') fail('E_CUE', 'Un fichier .cue ne contient pas le jeu. Choisissez le .bin (jeu à piste unique), un .iso ou un .chd. Les jeux à plusieurs pistes .bin ne sont pas pris en charge dans cette version.');
  if (!['iso', 'bin', 'img', 'chd', 'pbp'].includes(ext)) fail('E_EXTENSION', 'Format attendu : .iso, .bin, .img, .chd ou .pbp.');
  if (!Number.isSafeInteger(file.size) || file.size < MIN_BYTES) fail('E_SIZE', 'Fichier trop court pour un disque PS1 (minimum 64 Kio).');
  if (file.size > MAX_BYTES) fail('E_SIZE', 'Ce prototype accepte au maximum 900 Mio par disque.');
  return ext;
}
export function inspectDisc(bytes, size, ext) {
  const notes = [], text = n => new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(n, bytes.length)));
  let serial = null, sector = null;
  if (ext === 'chd' || ext === 'pbp') {
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
export async function prepareDisc(file) {
  const ext = validateDescriptor(file);
  let buffer;
  try { buffer = await file.arrayBuffer(); } catch { fail('E_READ', 'Lecture impossible : fichier modifié ou trop gros pour la mémoire du navigateur.'); }
  if (buffer.byteLength !== file.size) fail('E_READ', 'Le fichier a changé ou sa lecture est incomplète.');
  const bytes = new Uint8Array(buffer), info = inspectDisc(bytes, file.size, ext), hash = await sha256(bytes);
  return { file, metadata: Object.freeze({ source: 'local-file', name: file.name, size: file.size, filename_extension: ext, detected_format: ext,
    sector_size: info.sector_size, serial: info.serial, notes: Object.freeze(info.notes), source_sha256: hash, canonical_sha256: hash,
    validation_scope: 'Extension, taille, signature et numéro de série indicatif seulement ; lancement et compatibilité non validés.' }) };
}
