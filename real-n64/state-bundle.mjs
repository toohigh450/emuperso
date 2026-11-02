// SPDX-License-Identifier: MIT
// Atomic RAM + native-save snapshot. Integrity/identity belong to SaveStore.
export const STATE_BUNDLE_HEADER_BYTES = 24;
export const MAX_STATE_BUNDLE_BYTES = 64 * 1024 * 1024;
export const MAX_STATE_BATTERY_BYTES = 1024 * 1024;
const MAGIC = new Uint8Array([0x4e, 0x48, 0x55, 0x42, 0x53, 0x56, 0x31, 0]); // NHUBSV1\0

export class StateBundleError extends Error {
  constructor(code, message) { super(message); this.name = 'StateBundleError'; this.code = code; }
}
function ensure(condition, code, message) { if (!condition) throw new StateBundleError(code, message); }
function byteView(value, name) {
  if (ArrayBuffer.isView(value) && value.BYTES_PER_ELEMENT === 1) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') return new Uint8Array(value);
  throw new StateBundleError('E_BUNDLE_TYPE', name + ' : tableau d’octets attendu.');
}
function rejectRom(bytes) {
  if (bytes.length < 4) return;
  const magic = [...bytes.subarray(0, 4)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  ensure(!['80371240', '37804012', '40123780'].includes(magic), 'E_BUNDLE_ROM', 'Une ROM ne doit pas être utilisée comme état.');
}

export function packStateBundle(stateBytes, nativeBytes = null) {
  const state = byteView(stateBytes, 'État'), battery = nativeBytes === null ? null : byteView(nativeBytes, 'Sauvegarde native');
  ensure(state.length > 0, 'E_BUNDLE_LENGTH', 'État vide.');
  ensure(battery === null || battery.length > 0, 'E_BUNDLE_LENGTH', 'Sauvegarde native vide : utiliser null pour une absence.');
  ensure(battery === null || battery.length <= MAX_STATE_BATTERY_BYTES, 'E_BUNDLE_LIMIT', 'Sauvegarde native supérieure à 1 Mio.');
  const total = STATE_BUNDLE_HEADER_BYTES + state.length + (battery?.length ?? 0);
  ensure(total <= MAX_STATE_BUNDLE_BYTES, 'E_BUNDLE_LIMIT', 'État groupé supérieur à 64 Mio.');
  rejectRom(state);
  const output = new Uint8Array(total), header = new DataView(output.buffer);
  output.set(MAGIC); header.setUint32(8, state.length, true); header.setUint32(12, battery?.length ?? 0, true);
  header.setUint32(16, battery === null ? 0 : 1, true); header.setUint32(20, 0, true);
  output.set(state, STATE_BUNDLE_HEADER_BYTES);
  if (battery) output.set(battery, STATE_BUNDLE_HEADER_BYTES + state.length);
  return output;
}

export function unpackStateBundle(payload) {
  const bytes = byteView(payload, 'État groupé');
  ensure(bytes.length >= STATE_BUNDLE_HEADER_BYTES && bytes.length <= MAX_STATE_BUNDLE_BYTES,
    'E_BUNDLE_LIMIT', 'État groupé tronqué ou supérieur à 64 Mio.');
  const header = new DataView(bytes.buffer, bytes.byteOffset, STATE_BUNDLE_HEADER_BYTES);
  ensure(MAGIC.every((byte, index) => bytes[index] === byte), 'E_BUNDLE_MAGIC', 'Format d’état groupé non reconnu.');
  const stateLength = header.getUint32(8, true), nativeLength = header.getUint32(12, true), flags = header.getUint32(16, true);
  ensure(flags <= 1 && header.getUint32(20, true) === 0, 'E_BUNDLE_FLAGS', 'Options d’état groupé non prises en charge.');
  ensure(stateLength > 0 && nativeLength <= MAX_STATE_BATTERY_BYTES &&
    ((flags === 0 && nativeLength === 0) || (flags === 1 && nativeLength > 0)),
  'E_BUNDLE_LENGTH', 'Longueurs ou présence de sauvegarde native incohérentes.');
  const total = STATE_BUNDLE_HEADER_BYTES + stateLength + nativeLength;
  ensure(total <= MAX_STATE_BUNDLE_BYTES && total === bytes.length,
    'E_BUNDLE_LENGTH', 'Contenu d’état groupé tronqué ou données supplémentaires.');
  const state = bytes.slice(STATE_BUNDLE_HEADER_BYTES, STATE_BUNDLE_HEADER_BYTES + stateLength);
  rejectRom(state);
  return { state, battery: flags ? bytes.slice(STATE_BUNDLE_HEADER_BYTES + stateLength) : null };
}
