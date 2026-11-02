// SPDX-License-Identifier: MIT
// Read one known 0.3 prototype battery record. Never create/upgrade/write/delete
// the old database, enumerate its files, or inspect another project's path.
export const LEGACY_BATTERY_DB = '/data/saves';
export const LEGACY_BATTERY_STORE = 'FILE_DATA';
export const MAX_LEGACY_BATTERY_BYTES = 1024 * 1024;
export const LEGACY_REFERENCE_SHA256 = 'f18280a16c83721bdd56564701d505f96346784f36168402e5431b12499e2252';
const TIMEOUT_MS = 2000;

export class LegacyBatteryError extends Error {
  constructor(code, message, cause) { super(message, { cause }); this.name = 'LegacyBatteryError'; this.code = code; }
}
function ensure(ok, code, message) { if (!ok) throw new LegacyBatteryError(code, message); }
export function legacyBatteryPath(rom_sha256, { reference = false } = {}) {
  ensure(typeof rom_sha256 === 'string' && /^[a-f0-9]{64}$/i.test(rom_sha256), 'E_LEGACY_IDENTITY', 'Empreinte ROM invalide pour rechercher une sauvegarde 0.3.');
  const hash = rom_sha256.toLowerCase();
  ensure(typeof reference === 'boolean', 'E_LEGACY_IDENTITY', 'Type de référence invalide.');
  ensure(!reference || hash === LEGACY_REFERENCE_SHA256, 'E_LEGACY_IDENTITY', 'La sauvegarde de référence 0.3 ne correspond pas à cette ROM.');
  return '/data/saves/Mupen64Plus-Next/' + (reference ? 'DEMO N64 EMUPERSO' : 'EMUPERSO_LOCAL_' + hash) + '.srm';
}
function copyContents(record) {
  if (record === undefined) return null;
  ensure(record && typeof record === 'object', 'E_LEGACY_RECORD', 'Ancienne sauvegarde 0.3 malformée ; original conservé.');
  const source = record.contents;
  const bytes = ArrayBuffer.isView(source) && source.BYTES_PER_ELEMENT === 1 ?
    new Uint8Array(source.buffer, source.byteOffset, source.byteLength) :
    Object.prototype.toString.call(source) === '[object ArrayBuffer]' ? new Uint8Array(source) : null;
  ensure(bytes && bytes.length > 0 && bytes.length <= MAX_LEGACY_BATTERY_BYTES,
    'E_LEGACY_SIZE', 'Ancienne sauvegarde vide, invalide ou supérieure à 1 Mio ; original conservé.');
  return bytes.slice();
}

export async function readLegacyBattery(rom_sha256, options = {}) {
  const path = legacyBatteryPath(rom_sha256, options);
  const factory = globalThis.indexedDB;
  // Opening a missing DB would create it. Without an enumeration API, skip the
  // migration rather than probing with open() and accidentally changing storage.
  if (!factory || typeof factory.databases !== 'function') return null;
  let timeout;
  let databases;
  try {
    databases = await Promise.race([
      factory.databases(),
      new Promise(resolve => { timeout = setTimeout(() => resolve(null), TIMEOUT_MS); }),
    ]);
  } catch (error) {
    throw new LegacyBatteryError('E_LEGACY_ACCESS', 'Lecture des anciennes sauvegardes indisponible ; aucune donnée ancienne modifiée.', error);
  } finally { clearTimeout(timeout); }
  if (!Array.isArray(databases) || !databases.some(item => item.name === LEGACY_BATTERY_DB)) return null;
  return new Promise((resolve, reject) => {
    let db = null, settled = false, creationPrevented = false;
    const finish = (value, error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); db?.close();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    let request;
    try { request = factory.open(LEGACY_BATTERY_DB); }
    catch (error) { finish(null, new LegacyBatteryError('E_LEGACY_ACCESS', 'Ancienne base inaccessible ; original conservé.', error)); return; }
    request.onupgradeneeded = () => {
      // It disappeared between databases() and open(). Abort the implicit new
      // database transaction; do not create a store or leave a new database.
      creationPrevented = true;
      request.transaction.abort();
    };
    request.onerror = () => {
      if (creationPrevented) finish(null);
      else finish(null, new LegacyBatteryError('E_LEGACY_ACCESS', 'Ancienne base inaccessible ; original conservé.', request.error));
    };
    request.onblocked = () => finish(null);
    request.onsuccess = () => {
      db = request.result;
      if (settled) { db.close(); return; }
      db.onversionchange = () => { db.close(); finish(null); };
      if (!db.objectStoreNames.contains(LEGACY_BATTERY_STORE)) { finish(null); return; }
      let transaction;
      try { transaction = db.transaction(LEGACY_BATTERY_STORE, 'readonly'); }
      catch (error) { finish(null, new LegacyBatteryError('E_LEGACY_ACCESS', 'Anciennes données indisponibles ; original conservé.', error)); return; }
      let copied = null, readFailure = null;
      const get = transaction.objectStore(LEGACY_BATTERY_STORE).get(path);
      get.onsuccess = () => { try { copied = copyContents(get.result); } catch (error) { readFailure = error; } };
      transaction.oncomplete = () => finish(copied, readFailure);
      transaction.onerror = () => {};
      transaction.onabort = () => finish(null, readFailure ?? new LegacyBatteryError('E_LEGACY_ACCESS', 'Lecture interrompue ; ancienne sauvegarde conservée.', transaction.error));
    };
  });
}
