// SPDX-License-Identifier: MIT
// Read-only attestation of the pinned RetroArch/Mupen64Plus state format.
// RAM witnesses prove selected bytes, never the entire CPU/RSP/RDP/audio state.
export const MAX_NATIVE_STATE_BYTES = 64 * 1024 * 1024;
export const MUPEN_STATE_VERSION = 0x00010900;
export const MUPEN_STATE_BYTES = 16793412;
export const RDRAM_BYTES = 8 * 1024 * 1024;
export const RDRAM_CORE_OFFSET = 444;
export const RESTORE_ANCHOR_BYTES = 32;
export const MAX_RESTORE_ANCHORS = 128;
const PAGE_BYTES = 4096;
const MIN_MATCH_RATIO = 0.90;
const privateWitnesses = new WeakMap();
const text = new TextDecoder('ascii', { fatal: true });

export class NativeStateError extends Error {
  constructor(code, message) { super(message); this.name = 'NativeStateError'; this.code = code; }
}
function ensure(condition, code, message) { if (!condition) throw new NativeStateError(code, message); }
function bytesView(input) {
  if (ArrayBuffer.isView(input) && input.BYTES_PER_ELEMENT === 1)
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (Object.prototype.toString.call(input) === '[object ArrayBuffer]') return new Uint8Array(input);
  throw new NativeStateError('E_NATIVE_TYPE', 'Le contenu natif de l’état doit être un tableau d’octets.');
}
function equal(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function tag(bytes, offset) { return String.fromCharCode(...bytes.subarray(offset, offset + 4)); }

/** Parse, without copying or modifying, the pinned native state container.
 * Unknown printable chunk tags remain allowed, with strict bounds and a terminal
 * END chunk. Padding contents are not constrained: upstream need not zero them.
 * Mupen payload size/version are pinned, rather than accepting another layout on
 * the assumption that its RAM happens to start at the same offset.
 */
export function inspectNativeState(input) {
  const bytes = bytesView(input);
  ensure(bytes.length >= 24 && bytes.length <= MAX_NATIVE_STATE_BYTES,
    'E_NATIVE_SIZE', 'État natif vide, tronqué ou trop volumineux (64 Mio maximum).');
  ensure(String.fromCharCode(...bytes.subarray(0, 7)) === 'RASTATE' && bytes[7] === 1,
    'E_NATIVE_FORMAT', 'Conteneur de sauvegarde natif ou version RetroArch non pris en charge.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 8, memory = null, ended = false;
  const chunks = [];
  while (cursor < bytes.length) {
    ensure(chunks.length < 64 && cursor % 8 === 0 && cursor + 8 <= bytes.length,
      'E_NATIVE_CHUNK', 'Répertoire de blocs de l’état natif invalide ou tronqué.');
    const marker = tag(bytes, cursor), size = view.getUint32(cursor + 4, true);
    ensure(/^[\x20-\x7e]{4}$/.test(marker), 'E_NATIVE_CHUNK', 'Identifiant de bloc natif invalide.');
    const offset = cursor + 8, padded = Math.ceil(size / 8) * 8;
    ensure(offset + padded <= bytes.length, 'E_NATIVE_CHUNK', 'Taille de bloc natif hors du fichier.');
    const info = Object.freeze({ tag: marker, offset, size }); chunks.push(info);
    if (marker === 'END ') {
      ensure(size === 0 && offset === bytes.length, 'E_NATIVE_END', 'Fin de l’état natif invalide ou données supplémentaires.');
      ended = true; break;
    }
    if (marker === 'MEM ') {
      ensure(memory === null, 'E_NATIVE_CHUNK', 'Plusieurs blocs mémoire dans le même état natif.');
      ensure(size === MUPEN_STATE_BYTES, 'E_NATIVE_CORE_SIZE', 'Taille de l’état du cœur Mupen64Plus incompatible avec cette version.');
      memory = info;
    }
    cursor = offset + padded;
  }
  ensure(ended && memory, 'E_NATIVE_END', 'État natif incomplet : bloc mémoire ou fin absent.');
  ensure(memory.size === MUPEN_STATE_BYTES, 'E_NATIVE_CORE_SIZE', 'Taille de l’état du cœur Mupen64Plus incompatible avec cette version.');
  const start = memory.offset;
  ensure(String.fromCharCode(...bytes.subarray(start, start + 8)) === 'M64+SAVE',
    'E_NATIVE_CORE', 'Le bloc mémoire n’est pas un état Mupen64Plus reconnu.');
  const version = view.getUint32(start + 8, false);
  ensure(version === MUPEN_STATE_VERSION, 'E_NATIVE_CORE_VERSION', 'Version du format Mupen64Plus incompatible.');
  const md5 = text.decode(bytes.subarray(start + 12, start + 44));
  ensure(/^[0-9a-fA-F]{32}$/.test(md5), 'E_NATIVE_ROM', 'Identité ROM interne de l’état natif invalide.');
  const ramOffset = start + RDRAM_CORE_OFFSET;
  ensure(ramOffset + RDRAM_BYTES <= start + memory.size,
    'E_NATIVE_CORE_SIZE', 'Mémoire N64 tronquée dans l’état natif.');
  return Object.freeze({ format: 'retroarch-rastate-1/mupen64plus-1.9',
    container_version: 1, core_version: version, core_payload_size: memory.size,
    rom_md5: md5.toLowerCase(), rdram_offset: ramOffset,
    rdram: bytes.subarray(ramOffset, ramOffset + RDRAM_BYTES), chunks: Object.freeze(chunks) });
}
function sameIdentity(expected, other) {
  ensure(expected.format === other.format && expected.core_payload_size === other.core_payload_size &&
    expected.rom_md5 === other.rom_md5,
  'E_NATIVE_IDENTITY', 'Les états natifs ne correspondent pas au même jeu et au même format du cœur.');
}

/** Select at most one stable 32-byte anchor per 4 KiB page, spread over RAM.
 * An anchor is "strong" here only in the documented, limited sense that at least
 * two of its bytes differ from the fresh baseline. This is a differential RAM
 * observation, not authentication or a proof of every emulated subsystem.
 * Baselines must be two genuinely fresh native captures taken apart by the caller.
 * The module cannot establish that independent capture provenance itself.
 */
export function makeRestoreWitness(expectedInput, beforeInputA, beforeInputB) {
  const expected = inspectNativeState(expectedInput), beforeA = inspectNativeState(beforeInputA),
    beforeB = inspectNativeState(beforeInputB);
  sameIdentity(expected, beforeA); sameIdentity(expected, beforeB);
  const ram = expected.rdram, a = beforeA.rdram, b = beforeB.rdram;
  const pages = new Map();
  let differentBytes = 0, unstableBytes = 0, equivalentB = true, eligible = 0;
  for (let offset = 0; offset < RDRAM_BYTES; offset += RESTORE_ANCHOR_BYTES) {
    let changed = 0, stable = true;
    for (let j = 0; j < RESTORE_ANCHOR_BYTES; j++) {
      if (ram[offset + j] !== a[offset + j]) { changed++; differentBytes++; }
      if (a[offset + j] !== b[offset + j]) { stable = false; unstableBytes++; }
      if (ram[offset + j] !== b[offset + j]) equivalentB = false;
    }
    if (!stable || changed === 0) continue;
    eligible++;
    const page = Math.floor(offset / PAGE_BYTES), previous = pages.get(page);
    if (!previous || changed > previous.changed_bytes)
      pages.set(page, { offset, length: RESTORE_ANCHOR_BYTES, changed_bytes: changed, strong: changed >= 2 });
  }
  const candidates = [...pages.values()], count = Math.min(candidates.length, MAX_RESTORE_ANCHORS);
  const selected = [];
  for (let i = 0; i < count; i++) {
    const index = count <= 1 ? 0 : Math.floor(i * (candidates.length - 1) / (count - 1));
    selected.push(candidates[index]);
  }
  if (selected.length && !selected.some(anchor => anchor.strong)) {
    const strongest = candidates.reduce((best, anchor) =>
      anchor.changed_bytes > best.changed_bytes ? anchor : best, candidates[0]);
    if (strongest.strong) selected[selected.length - 1] = strongest;
  }
  selected.sort((left, right) => left.offset - right.offset);
  const strong = selected.filter(anchor => anchor.strong).length;
  const equivalent = differentBytes === 0 && equivalentB;
  ensure(strong > 0 || equivalent, 'E_RESTORE_UNPROVEN',
    'Restauration non confirmable : aucun témoin mémoire stable suffisamment distinct du démarrage. L’ancienne session est conservée.');
  const anchors = Object.freeze(selected.map(anchor => Object.freeze({ ...anchor })));
  const witness = Object.freeze({ schema: 'emuperso/ram-restore-witness/v1',
    format: expected.format, core_payload_size: expected.core_payload_size,
    rom_md5: expected.rom_md5, total: anchors.length, strong,
    different_bytes: differentBytes, unstable_bytes: unstableBytes,
    eligible_blocks: eligible, eligible_pages: candidates.length,
    min_match_ratio: MIN_MATCH_RATIO, already_equivalent: equivalent, anchors });
  privateWitnesses.set(witness, { anchors: anchors.map(anchor => ({ ...anchor,
    expected: ram.slice(anchor.offset, anchor.offset + anchor.length) })),
    fullEquivalent: equivalent ? ram.slice() : null });
  return witness;
}

/** Compare a fresh native capture with the copied expected witnesses.
 * verified=true requires >=90% complete anchors and at least one strong match.
 * already-equivalent RAM has a separate mode and never proves a load transition.
 */
export function compareRestoreWitness(witness, observedInput) {
  const privateData = privateWitnesses.get(witness);
  ensure(privateData, 'E_RESTORE_WITNESS', 'Témoins de restauration absents ou provenant d’une autre session.');
  const observed = inspectNativeState(observedInput);
  sameIdentity(witness, observed);
  if (witness.already_equivalent) {
    const equivalent = equal(privateData.fullEquivalent, observed.rdram);
    return Object.freeze({ matched: 0, total: 0, ratio: equivalent ? 1 : 0,
      matched_strong: 0, verified: false, already_equivalent: true,
      equivalent, restored: false, mode: 'already_equivalent' });
  }
  let matched = 0, matchedStrong = 0;
  for (const anchor of privateData.anchors) {
    if (equal(anchor.expected, observed.rdram.subarray(anchor.offset, anchor.offset + anchor.length))) {
      matched++; if (anchor.strong) matchedStrong++;
    }
  }
  const ratio = matched / witness.total;
  const verified = matchedStrong > 0 && ratio >= MIN_MATCH_RATIO;
  return Object.freeze({ matched, total: witness.total, ratio, matched_strong: matchedStrong,
    verified, already_equivalent: false, equivalent: false, restored: verified,
    mode: 'differential_ram' });
}
