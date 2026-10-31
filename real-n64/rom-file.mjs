// SPDX-License-Identifier: MIT
// Local format recognition only: no promise of executable code, CRC or compatibility.
export const MAX_ROM_BYTES = 64 * 1024 * 1024;
export const MIN_ROM_BYTES = 4096;
export class RomFileError extends Error {
  constructor(code, message) { super(message); this.code = code; this.name = 'RomFileError'; }
}
function assert(ok, code, message) { if (!ok) throw new RomFileError(code, message); }
export function validateFileDescriptor(file) {
  assert(file && typeof file.name === 'string' && /\.(z64|n64|v64)$/i.test(file.name), 'E_EXTENSION', 'Format ROM attendu : .z64, .n64 ou .v64. Pour un ZIP, utilisez Choisir une ROM dans l’interface.');
  assert(Number.isSafeInteger(file.size) && file.size >= MIN_ROM_BYTES, 'E_SIZE', 'Fichier trop court : au moins 4 096 octets sont requis.');
  assert(file.size <= MAX_ROM_BYTES, 'E_SIZE', 'Ce prototype accepte au maximum 64 Mio par ROM.');
  assert(file.size % 4 === 0, 'E_ALIGNMENT', 'La taille de la ROM doit être un multiple de quatre octets.');
  return file.name.split('.').at(-1).toLowerCase();
}
export function detectRomFormat(bytes) {
  assert(bytes instanceof Uint8Array && bytes.length >= 4, 'E_FORMAT', 'En-tête N64 absent.');
  const magic = [...bytes.subarray(0, 4)].map(x => x.toString(16).padStart(2, '0')).join('');
  const format = { '80371240': 'z64', '37804012': 'v64', '40123780': 'n64' }[magic];
  assert(format, 'E_FORMAT', 'Signature N64 non reconnue : le nom du fichier ne suffit pas à valider une ROM.');
  return format;
}
export function normalizeRom(bytes) {
  assert(bytes instanceof Uint8Array && bytes.length >= MIN_ROM_BYTES && bytes.length <= MAX_ROM_BYTES, 'E_SIZE', 'Taille ROM hors des limites du prototype.');
  assert(bytes.length % 4 === 0, 'E_ALIGNMENT', 'ROM non alignée sur quatre octets.');
  const format = detectRomFormat(bytes), canonical = bytes.slice();
  if (format === 'v64') for (let i = 0; i < canonical.length; i += 2) [canonical[i], canonical[i+1]] = [canonical[i+1], canonical[i]];
  if (format === 'n64') for (let i = 0; i < canonical.length; i += 4) [canonical[i],canonical[i+1],canonical[i+2],canonical[i+3]] = [canonical[i+3],canonical[i+2],canonical[i+1],canonical[i]];
  return { format, canonical };
}
export async function sha256(bytes) {
  assert(globalThis.crypto?.subtle, 'E_CRYPTO', 'SHA-256 indisponible. Utilisez le serveur localhost dans un navigateur récent.');
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function prepareRomBytes(bytes, name, source = 'local-file') {
  const extension = validateFileDescriptor({ name, size: bytes.byteLength });
  const { format, canonical } = normalizeRom(bytes);
  const [sourceHash, canonicalHash] = await Promise.all([sha256(bytes), sha256(canonical)]);
  return { bytes: canonical, metadata: Object.freeze({ source, name, size: bytes.byteLength, filename_extension: extension, detected_format: format, extension_mismatch: extension !== format, source_sha256: sourceHash, canonical_sha256: canonicalHash, canonical_format: 'z64', validation_scope: 'Signature, taille et ordre des octets seulement ; CRC, code et compatibilité non validés.' }) };
}
export async function prepareLocalRom(file) {
  validateFileDescriptor(file); // reject size/extension before reading the file
  const buffer = await file.arrayBuffer();
  assert(buffer instanceof ArrayBuffer && buffer.byteLength === file.size, 'E_READ', 'Le fichier a changé ou sa lecture est incomplète.');
  return prepareRomBytes(new Uint8Array(buffer), file.name);
}
