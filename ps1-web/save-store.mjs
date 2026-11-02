// SPDX-License-Identifier: MIT
// Original local save vault. No filesystem access, ROM storage, or network calls.
export const SAVE_SCHEMA = 'emuperso/save-envelope/v1';
export const SAVE_DB_NAME = 'emuperso-real-saves-v1';
export const MAX_SAVE_BYTES = 64 * 1024 * 1024;
export const SAVE_SLOTS = 3;
const HASH = /^[a-f0-9]{64}$/;
// Checkpoints are separate from the three user state slots. They are internal
// rollback / pre-cheat snapshots and never replace a user-selected state slot.
const KINDS = new Set(['state', 'battery', 'checkpoint']);
const encoder = new TextEncoder();

export class SaveStoreError extends Error {
  constructor(code, message, cause) { super(message, { cause }); this.name = 'SaveStoreError'; this.code = code; }
}
function ensure(ok, code, message) { if (!ok) throw new SaveStoreError(code, message); }
function plain(value) { return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype; }
function canonical(value, depth = 0) {
  ensure(depth <= 12, 'E_METADATA', 'Métadonnées de sauvegarde trop imbriquées.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { ensure(Number.isFinite(value), 'E_METADATA', 'Nombre de métadonnée invalide.'); return JSON.stringify(value); }
  if (Array.isArray(value)) return '[' + Array.from(value, item => canonical(item, depth + 1)).join(',') + ']';
  ensure(plain(value), 'E_METADATA', 'Métadonnées de sauvegarde non sérialisables.');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key], depth + 1)).join(',') + '}';
}
export async function sha256(bytes) {
  ensure(globalThis.crypto?.subtle, 'E_CRYPTO', 'SHA-256 indisponible : utilisez le serveur localhost.');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function fingerprintConfig(config) {
  const text = canonical(config);
  ensure(encoder.encode(text).length <= 65536, 'E_METADATA', 'Configuration de sauvegarde trop volumineuse.');
  return sha256(encoder.encode(text));
}
export function normalizeIdentity(identity) {
  ensure(plain(identity), 'E_IDENTITY', 'Identité de sauvegarde absente.');
  const result = {};
  for (const key of ['rom_sha256', 'engine_sha256', 'config_sha256']) {
    ensure(typeof identity[key] === 'string' && HASH.test(identity[key].toLowerCase()), 'E_IDENTITY', 'Empreinte de sauvegarde invalide : ' + key);
    result[key] = identity[key].toLowerCase();
  }
  ensure(typeof identity.state_schema === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,79}$/.test(identity.state_schema), 'E_IDENTITY', 'Version du format d’état invalide.');
  result.state_schema = identity.state_schema;
  return Object.freeze(result);
}
async function identityKey(identity) { return sha256(encoder.encode(canonical(normalizeIdentity(identity)))); }
function kindValue(kind) { ensure(KINDS.has(kind), 'E_KIND', 'Type de sauvegarde inconnu.'); return kind; }
function slotValue(slot) { ensure(Number.isInteger(slot) && slot >= 1 && slot <= SAVE_SLOTS, 'E_SLOT', 'Choisissez un emplacement de 1 à 3.'); return slot; }
function payloadCopy(payload) {
  // A bridge may return a byte view from a same-origin iframe realm.
  const bytes = ArrayBuffer.isView(payload) && payload.BYTES_PER_ELEMENT === 1 ?
    new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength) :
    Object.prototype.toString.call(payload) === '[object ArrayBuffer]' ? new Uint8Array(payload) : payload;
  ensure(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= MAX_SAVE_BYTES, 'E_SIZE', 'Sauvegarde vide ou trop volumineuse : maximum 64 Mio.');
  if (bytes.length >= 4) {
    const signature = [...bytes.subarray(0, 4)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    ensure(!['80371240', '37804012', '40123780'].includes(signature), 'E_ROM_PAYLOAD', 'Une ROM ne doit pas être enregistrée comme sauvegarde.');
  }
  return bytes.slice();
}
function headerOf(envelope) {
  return { schema: envelope.schema, id: envelope.id, created_utc: envelope.created_utc,
    kind: envelope.kind, identity: envelope.identity, payload_size: envelope.payload_size,
    payload_sha256: envelope.payload_sha256, metadata: envelope.metadata };
}
function freezeMetadata(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeMetadata(child); Object.freeze(value); }
  return value;
}
export async function makeStateEnvelope(payload, identity, { kind = 'state', cheats = [], label = '' } = {}) {
  const normalized = normalizeIdentity(identity), bytes = payloadCopy(payload);
  kindValue(kind);
  ensure(typeof label === 'string' && label.length <= 120, 'E_METADATA', 'Nom de sauvegarde trop long.');
  ensure(Array.isArray(cheats) && cheats.length <= 256, 'E_METADATA', 'Liste de cheats de sauvegarde invalide.');
  const metadataText = canonical({ label, cheats });
  ensure(encoder.encode(metadataText).length <= 65536, 'E_METADATA', 'Métadonnées de sauvegarde trop volumineuses.');
  const random = crypto.getRandomValues(new Uint8Array(16));
  const envelope = { schema: SAVE_SCHEMA, id: [...random].map(byte => byte.toString(16).padStart(2, '0')).join(''),
    created_utc: new Date().toISOString(), kind, identity: normalized, payload_size: bytes.length,
    payload_sha256: await sha256(bytes), metadata: freezeMetadata(JSON.parse(metadataText)), payload: bytes };
  envelope.header_sha256 = await sha256(encoder.encode(canonical(headerOf(envelope))));
  return Object.freeze(envelope);
}
export async function verifyEnvelope(envelope, identity, { kind = 'state' } = {}) {
  kindValue(kind);
  ensure(plain(envelope) && envelope.schema === SAVE_SCHEMA, 'E_SCHEMA', 'Format de sauvegarde non reconnu.');
  const expected = normalizeIdentity(identity), actual = normalizeIdentity(envelope.identity);
  ensure(canonical(expected) === canonical(actual), 'E_INCOMPATIBLE', 'Sauvegarde incompatible : ROM, moteur, configuration ou format d’état différents.');
  ensure(envelope.kind === kind, 'E_KIND', 'Cette sauvegarde est d’un autre type.');
  const timestamp = typeof envelope.created_utc === 'string' ? new Date(envelope.created_utc) : null;
  ensure(typeof envelope.id === 'string' && /^[a-f0-9]{32}$/.test(envelope.id) && timestamp &&
    Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === envelope.created_utc,
  'E_METADATA', 'Date ou identifiant de sauvegarde invalide.');
  ensure(Number.isSafeInteger(envelope.payload_size) && HASH.test(envelope.payload_sha256) && HASH.test(envelope.header_sha256), 'E_INTEGRITY', 'Empreintes de sauvegarde invalides.');
  ensure(plain(envelope.metadata) && typeof envelope.metadata.label === 'string' && envelope.metadata.label.length <= 120 &&
    Array.isArray(envelope.metadata.cheats) && envelope.metadata.cheats.length <= 256, 'E_METADATA', 'Métadonnées de sauvegarde invalides.');
  const metadataText = canonical(envelope.metadata);
  ensure(encoder.encode(metadataText).length <= 65536, 'E_METADATA', 'Métadonnées de sauvegarde trop volumineuses.');
  const bytes = payloadCopy(envelope.payload);
  ensure(bytes.length === envelope.payload_size && await sha256(bytes) === envelope.payload_sha256,
    'E_INTEGRITY', 'Sauvegarde corrompue : empreinte du contenu différente.');
  ensure(await sha256(encoder.encode(canonical(headerOf(envelope)))) === envelope.header_sha256,
    'E_INTEGRITY', 'Sauvegarde corrompue : empreinte des métadonnées différente.');
  return bytes;
}
function idbError(error, message = 'Échec du stockage local.') {
  if (error instanceof SaveStoreError) return error;
  const code = error?.name === 'QuotaExceededError' ? 'E_QUOTA' : 'E_STORAGE';
  return new SaveStoreError(code, code === 'E_QUOTA' ? 'Espace local insuffisant. La sauvegarde précédente est conservée.' : message, error);
}
function requestResult(request) {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(idbError(request.error)); });
}
function transactionDone(transaction) {
  return new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onabort = () => reject(idbError(transaction.error)); transaction.onerror = () => {}; });
}

export class SaveStore {
  constructor(databaseName = SAVE_DB_NAME) {
    ensure(typeof databaseName === 'string' && /^emuperso-real-saves-v1(?:-[a-zA-Z0-9_-]+)?$/.test(databaseName), 'E_DATABASE', 'Nom de base de sauvegardes interdit.');
    this.databaseName = databaseName;
    this.pending = null;
  }
  async open() {
    ensure(globalThis.indexedDB, 'E_STORAGE', 'Stockage IndexedDB indisponible dans ce navigateur.');
    if (!this.pending) this.pending = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('slots', { keyPath: 'key' });
        store.createIndex('group', 'group', { unique: false });
      };
      request.onsuccess = () => { const db = request.result; if (blocked) { db.close(); return; } db.onversionchange = () => { db.close(); this.pending = null; }; resolve(db); };
      request.onerror = () => { this.pending = null; reject(idbError(request.error)); };
      request.onblocked = () => { blocked = true; this.pending = null; reject(new SaveStoreError('E_BLOCKED', 'Fermez les autres onglets du laboratoire pour ouvrir les sauvegardes.')); };
    }).catch(error => { this.pending = null; throw idbError(error); });
    return this.pending;
  }
  async address(identity, slot, kind) {
    const group = kindValue(kind) + ':' + await identityKey(identity);
    return { group, key: group + ':' + slotValue(slot) };
  }
  async record(key) {
    const db = await this.open(), transaction = db.transaction('slots', 'readonly');
    const done = transactionDone(transaction);
    const [result] = await Promise.all([requestResult(transaction.objectStore('slots').get(key)), done]);
    return result;
  }
  async put(identity, slot, envelope) {
    // Clone before awaits: callers cannot mutate bytes midway through validation.
    let snapshot;
    try { snapshot = structuredClone(envelope); } catch (error) { throw idbError(error, 'Sauvegarde non sérialisable.'); }
    const kind = snapshot?.kind;
    await verifyEnvelope(snapshot, identity, { kind });
    const address = await this.address(identity, slot, kind);
    for (let attempt = 0; attempt < 4; attempt++) {
      const before = await this.record(address.key);
      if (before?.current) await verifyEnvelope(before.current, identity, { kind });
      const db = await this.open();
      try {
        const revision = await new Promise((resolve, reject) => {
          const transaction = db.transaction('slots', 'readwrite'), store = transaction.objectStore('slots');
          let conflict = false, nextRevision, writeFailure;
          const request = store.get(address.key);
          request.onsuccess = () => {
            try {
              const current = request.result;
              if ((current?.revision ?? 0) !== (before?.revision ?? 0)) { conflict = true; transaction.abort(); return; }
              nextRevision = (current?.revision ?? 0) + 1;
              store.put({ ...address, slot, kind, revision: nextRevision, updated_utc: new Date().toISOString(),
                current: snapshot, previous: current?.current ?? null });
            } catch (error) { writeFailure = idbError(error); transaction.abort(); }
          };
          transaction.oncomplete = () => resolve(nextRevision);
          transaction.onerror = () => {};
          transaction.onabort = () => reject(writeFailure ?? (conflict ? new SaveStoreError('E_CONFLICT', 'Sauvegarde modifiée par un autre onglet ; nouvelle tentative.') : idbError(transaction.error)));
        });
        return { slot, kind, revision, id: snapshot.id, created_utc: snapshot.created_utc, payload_size: snapshot.payload_size };
      } catch (error) { if (error.code !== 'E_CONFLICT' || attempt === 3) throw error; }
    }
  }
  async load(identity, slot, { kind = 'state', previous = false } = {}) {
    const { key } = await this.address(identity, slot, kind), record = await this.record(key);
    const envelope = previous ? record?.previous : record?.current;
    ensure(envelope, 'E_EMPTY', previous ? 'Aucune version précédente dans cet emplacement.' : 'Cet emplacement est vide pour ce jeu et ce moteur.');
    const bytes = await verifyEnvelope(envelope, identity, { kind });
    return { envelope, bytes, revision: record.revision, previous: !!previous };
  }
  async list(identity, { kind = 'state' } = {}) {
    const { group } = await this.address(identity, 1, kind), db = await this.open();
    const transaction = db.transaction('slots', 'readonly'), done = transactionDone(transaction);
    const [records] = await Promise.all([requestResult(transaction.objectStore('slots').index('group').getAll(group)), done]);
    // Deliberately no save payloads in list/diagnostic data.
    return records.sort((a, b) => a.slot - b.slot).map(record => ({ slot: record.slot, kind: record.kind, revision: record.revision,
      id: record.current.id, created_utc: record.current.created_utc, updated_utc: record.updated_utc,
      label: record.current.metadata.label, cheats: structuredClone(record.current.metadata.cheats),
      payload_size: record.current.payload_size, has_previous: !!record.previous, payload_verified: false }));
  }
  async delete(identity, slot, { kind = 'state' } = {}) {
    const { key } = await this.address(identity, slot, kind), db = await this.open();
    const transaction = db.transaction('slots', 'readwrite'), done = transactionDone(transaction);
    transaction.objectStore('slots').delete(key);
    await done;
  }
  async close() { const db = this.pending ? await this.pending : null; db?.close(); this.pending = null; }
}
