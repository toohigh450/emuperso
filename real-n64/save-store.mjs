// SPDX-License-Identifier: MIT
// Original local save vault. No filesystem access, ROM storage, or network calls.
export const SAVE_SCHEMA = 'emuperso/save-envelope/v1';
export const SAVE_DB_NAME = 'emuperso-real-saves-v1';
export const MAX_SAVE_BYTES = 64 * 1024 * 1024;
export const SAVE_SLOTS = 3;
export const MAX_BATCH_SAVES = 9;
export const MAX_BATCH_BYTES = 2 * MAX_SAVE_BYTES;
export const STORAGE_TIMEOUT_MS = 8000;
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
function storageTimeout() {
  return new SaveStoreError('E_STORAGE_TIMEOUT', 'Le stockage local ne répond pas. L’opération a été annulée ; les sauvegardes déjà enregistrées sont conservées. Fermez les autres onglets de l’émulateur, puis réessayez.');
}
function transactionDone(transaction, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false, timeoutFailure = null;
    const finish = (ok, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (ok) resolve(value); else reject(value);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      // A rejected timeout must never leave a transaction able to commit later.
      // If commit is already irreversible, wait for its native completion rather
      // than falsely report that an existing save was preserved unchanged.
      timeoutFailure = storageTimeout();
      try { transaction.abort(); } catch { timeoutFailure = null; return; }
      finish(false, timeoutFailure);
    }, timeoutMs);
    transaction.oncomplete = () => finish(true);
    transaction.onabort = () => finish(false, timeoutFailure ?? idbError(transaction.error));
    transaction.onerror = () => {};
  });
}
async function readTransaction(db, timeoutMs, makeRequest) {
  const transaction = db.transaction('slots', 'readonly'), done = transactionDone(transaction, timeoutMs);
  let received = false, result;
  try {
    const request = makeRequest(transaction.objectStore('slots'));
    request.onsuccess = () => { received = true; result = request.result; };
    // An IDB request error aborts its transaction by default.
    await done;
    ensure(received, 'E_STORAGE', 'La réponse du stockage local est absente. Aucune donnée enregistrée n’a été modifiée.');
    return result;
  } catch (error) {
    try { transaction.abort(); } catch { /* already complete/aborted */ }
    void done.catch(() => {});
    throw idbError(error);
  }
}

export class SaveStore {
  constructor(databaseName = SAVE_DB_NAME, { timeoutMs = STORAGE_TIMEOUT_MS } = {}) {
    ensure(typeof databaseName === 'string' && /^emuperso-real-saves-v1(?:-[a-zA-Z0-9_-]+)?$/.test(databaseName), 'E_DATABASE', 'Nom de base de sauvegardes interdit.');
    ensure(Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 60000, 'E_TIMEOUT', 'Délai de stockage invalide.');
    this.timeoutMs = timeoutMs;
    this.databaseName = databaseName;
    this.pending = null;
  }
  async open() {
    ensure(globalThis.indexedDB, 'E_STORAGE', 'Stockage IndexedDB indisponible dans ce navigateur.');
    if (!this.pending) {
      const opening = new Promise((resolve, reject) => {
        const request = indexedDB.open(this.databaseName, 1);
        let settled = false, timeoutFailure = null;
        const fail = error => {
          if (settled) return;
          settled = true; clearTimeout(timer); reject(error);
        };
        const timer = setTimeout(() => {
          if (settled) return;
          timeoutFailure = storageTimeout();
          try { request.transaction?.abort(); } catch { /* No active upgrade. */ }
          fail(timeoutFailure);
        }, this.timeoutMs);
        request.onupgradeneeded = () => {
          if (settled) { try { request.transaction.abort(); } catch {} return; }
          const store = request.result.createObjectStore('slots', { keyPath: 'key' });
          store.createIndex('group', 'group', { unique: false });
        };
        request.onsuccess = () => {
          const db = request.result;
          if (settled) { db.close(); return; }
          settled = true; clearTimeout(timer);
          db.onversionchange = () => { db.close(); if (this.pending === opening) this.pending = null; };
          resolve(db);
        };
        request.onerror = () => fail(timeoutFailure ?? idbError(request.error));
        request.onblocked = () => fail(new SaveStoreError('E_BLOCKED', 'Fermez les autres onglets de l’émulateur pour ouvrir les sauvegardes.'));
      }).catch(error => { if (this.pending === opening) this.pending = null; throw idbError(error); });
      this.pending = opening;
    }
    return this.pending;
  }
  async address(identity, slot, kind) {
    const group = kindValue(kind) + ':' + await identityKey(identity);
    return { group, key: group + ':' + slotValue(slot) };
  }
  async record(key) {
    try { return await readTransaction(await this.open(), this.timeoutMs, store => store.get(key)); }
    catch (error) { throw idbError(error); }
  }
  async put(identity, slot, envelope) {
    const [written] = await this.putBatch(identity, [{ slot, envelope }]);
    return written;
  }
  async putBatch(identity, entries) {
    // Clone every input before the first await, including the shared identity.
    // No checksum work belongs inside the short-lived IDB transaction below.
    const normalized = normalizeIdentity(identity);
    ensure(Array.isArray(entries) && entries.length > 0 && entries.length <= MAX_BATCH_SAVES,
      'E_BATCH', 'Un groupe doit contenir de 1 à 9 sauvegardes.');
    let totalBytes = 0;
    for (const entry of entries) {
      ensure(plain(entry) && plain(entry.envelope), 'E_BATCH', 'Entrée de sauvegarde groupée invalide.');
      ensure(entry.deduplicate === undefined || typeof entry.deduplicate === 'boolean', 'E_BATCH', 'Option de déduplication invalide.');
      const payload = entry.envelope.payload;
      const length = ArrayBuffer.isView(payload) && payload.BYTES_PER_ELEMENT === 1 ? payload.byteLength :
        Object.prototype.toString.call(payload) === '[object ArrayBuffer]' ? payload.byteLength : 0;
      ensure(length > 0 && length <= MAX_SAVE_BYTES, 'E_SIZE', 'Sauvegarde vide ou trop volumineuse : maximum 64 Mio.');
      totalBytes += length;
    }
    ensure(totalBytes <= MAX_BATCH_BYTES, 'E_BATCH', 'Groupe de sauvegardes trop volumineux : maximum 128 Mio.');
    let snapshots;
    try { snapshots = structuredClone(entries); } catch (error) { throw idbError(error, 'Sauvegardes non sérialisables.'); }
    const prepared = [], keys = new Set();
    for (const { slot, envelope, deduplicate = false } of snapshots) {
      const kind = envelope.kind;
      await verifyEnvelope(envelope, normalized, { kind });
      const address = await this.address(normalized, slot, kind);
      ensure(!keys.has(address.key), 'E_BATCH', 'Un emplacement ne peut apparaître deux fois dans une écriture groupée.');
      keys.add(address.key);
      prepared.push({ slot, kind, envelope, address, deduplicate });
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const before = await Promise.all(prepared.map(entry => this.record(entry.address.key)));
      await Promise.all(before.map(async (record, index) => {
        if (!record) return;
        const { address, slot, kind } = prepared[index];
        ensure(record.key === address.key && record.group === address.group && record.slot === slot && record.kind === kind &&
          Number.isSafeInteger(record.revision) && record.revision > 0 && record.current,
        'E_INTEGRITY', 'Index de sauvegarde corrompu ; aucune écriture effectuée.');
        await verifyEnvelope(record.current, normalized, { kind });
      }));
      const db = await this.open();
      try {
        return await new Promise((resolve, reject) => {
          const transaction = db.transaction('slots', 'readwrite'), store = transaction.objectStore('slots');
          const observed = new Array(prepared.length), revisions = new Array(prepared.length);
          const committed = new Array(prepared.length), skipped = new Array(prepared.length).fill(false);
          let conflict = false, writeFailure, settled = false, remaining = prepared.length;
          transactionDone(transaction, this.timeoutMs).then(() => {
            settled = true;
            resolve(prepared.map(({ slot, kind }, index) => ({
              slot, kind, revision: revisions[index], id: committed[index].id, created_utc: committed[index].created_utc,
              payload_size: committed[index].payload_size, payload_sha256: committed[index].payload_sha256,
              skipped_unchanged: skipped[index]
            })));
          }, error => {
            settled = true;
            reject(writeFailure ?? (conflict ? new SaveStoreError('E_CONFLICT', 'Sauvegardes modifiées par un autre onglet ; nouvelle tentative.') : error));
          });
          // Read and compare every member before queuing any write. The single
          // transaction commits all current/previous pairs together or none.
          for (let index = 0; index < prepared.length; index++) {
            const request = store.get(prepared[index].address.key);
            request.onsuccess = () => {
              if (settled) return;
              try {
                observed[index] = request.result;
                if (--remaining !== 0) return;
                for (let i = 0; i < prepared.length; i++) {
                  const current = observed[i], expected = before[i];
                  if ((current?.revision ?? 0) !== (expected?.revision ?? 0) ||
                      current?.current?.id !== expected?.current?.id ||
                      current?.current?.header_sha256 !== expected?.current?.header_sha256) {
                    conflict = true; transaction.abort(); return;
                  }
                  ensure((current?.revision ?? 0) < Number.MAX_SAFE_INTEGER,
                    'E_INTEGRITY', 'Compteur de révision hors limites ; aucune écriture effectuée.');
                }
                const updated = new Date().toISOString();
                for (let i = 0; i < prepared.length; i++) {
                  const { address, slot, kind, envelope, deduplicate } = prepared[i], current = observed[i];
                  // The member remains in every read/CAS even if its write can
                  // be skipped. An outside-of-transaction dedupe would race a
                  // concurrent native save and break the state/native pairing.
                  if (deduplicate && current?.current && current.current.payload_sha256 === envelope.payload_sha256 &&
                      current.current.payload_size === envelope.payload_size && canonical(current.current.metadata) === canonical(envelope.metadata)) {
                    revisions[i] = current.revision; committed[i] = current.current; skipped[i] = true;
                  } else {
                    revisions[i] = (current?.revision ?? 0) + 1; committed[i] = envelope;
                    store.put({ ...address, slot, kind, revision: revisions[i], updated_utc: updated,
                      current: envelope, previous: current?.current ?? null });
                  }
                }
              } catch (error) { writeFailure = idbError(error); transaction.abort(); }
            };
          }

        });
      } catch (error) { const failure = idbError(error); if (failure.code !== 'E_CONFLICT' || attempt === 3) throw failure; }
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
    const records = await readTransaction(db, this.timeoutMs, store => store.index('group').getAll(group));
    // Deliberately no save payloads in list/diagnostic data.
    return records.sort((a, b) => a.slot - b.slot).map(record => ({ slot: record.slot, kind: record.kind, revision: record.revision,
      id: record.current.id, created_utc: record.current.created_utc, updated_utc: record.updated_utc,
      label: record.current.metadata.label, cheats: structuredClone(record.current.metadata.cheats),
      payload_size: record.current.payload_size, has_previous: !!record.previous, payload_verified: false }));
  }
  async delete(identity, slot, { kind = 'state' } = {}) {
    const { key } = await this.address(identity, slot, kind), db = await this.open();
    const transaction = db.transaction('slots', 'readwrite'), done = transactionDone(transaction, this.timeoutMs);
    transaction.objectStore('slots').delete(key);
    await done;
  }
  async close() {
    const pending = this.pending, db = pending ? await pending.catch(() => null) : null;
    db?.close(); if (this.pending === pending) this.pending = null;
  }
}
