import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SAVE_SCHEMA, MAX_SAVE_BYTES, SaveStore, makeStateEnvelope, verifyEnvelope, fingerprintConfig } from '../save-store.mjs';

const identity = Object.freeze({ rom_sha256: 'a'.repeat(64), engine_sha256: 'b'.repeat(64), config_sha256: 'c'.repeat(64), state_schema: 'n64lab-state-v1' });
const payload = new Uint8Array([1, 2, 3, 4, 5, 6]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('Configuration : ordre des propriétés stable, changement de valeur distinct', async () => {
  const first = await fingerprintConfig({ threads: false, core: 'pure_interpreter' });
  assert.equal(first, hash('{"core":"pure_interpreter","threads":false}'));
  assert.equal(first, await fingerprintConfig({ core: 'pure_interpreter', threads: false }));
  assert.notEqual(first, await fingerprintConfig({ threads: true, core: 'pure_interpreter' }));
});
test('Enveloppe : copie source, empreinte indépendante et lecture exacte', async () => {
  const input = payload.slice();
  const envelope = await makeStateEnvelope(input, identity, { label: 'Essai synthétique', cheats: [] });
  assert.equal(envelope.schema, SAVE_SCHEMA);
  assert.equal(envelope.payload_sha256, hash(input));
  input[0] = 99;
  assert.deepEqual(await verifyEnvelope(envelope, identity), payload);
  assert(Object.isFrozen(envelope)); assert(Object.isFrozen(envelope.identity)); assert(Object.isFrozen(envelope.metadata));
});
test('Toute différence ROM, moteur, configuration ou format est bloquée', async () => {
  const envelope = await makeStateEnvelope(payload, identity);
  for (const field of Object.keys(identity)) {
    const changed = { ...identity, [field]: field === 'state_schema' ? 'n64lab-state-v2' : 'd'.repeat(64) };
    await assert.rejects(verifyEnvelope(envelope, changed), { code: 'E_INCOMPATIBLE' });
  }
});
test('Contenu et métadonnées modifiés sont refusés', async () => {
  const envelope = await makeStateEnvelope(payload, identity, { cheats: [{ name: 'test', code: '80000000 0001' }] });
  const badBytes = structuredClone(envelope); badBytes.payload[0] ^= 255;
  await assert.rejects(verifyEnvelope(badBytes, identity), { code: 'E_INTEGRITY' });
  for (const change of [e => { e.metadata.label = 'modifié'; }, e => { e.metadata.cheats = []; }, e => { e.payload_size++; }]) {
    const altered = structuredClone(envelope); change(altered);
    await assert.rejects(verifyEnvelope(altered, identity), { code: 'E_INTEGRITY' });
  }
});
test('État, sauvegarde système et checkpoint sont des types séparés', async () => {
  const battery = await makeStateEnvelope(payload, identity, { kind: 'battery' });
  await assert.rejects(verifyEnvelope(battery, identity), { code: 'E_KIND' });
  assert.deepEqual(await verifyEnvelope(battery, identity, { kind: 'battery' }), payload);
  const checkpoint = await makeStateEnvelope(payload, identity, { kind: 'checkpoint' });
  await assert.rejects(verifyEnvelope(checkpoint, identity), { code: 'E_KIND' });
  assert.deepEqual(await verifyEnvelope(checkpoint, identity, { kind: 'checkpoint' }), payload);
});
test('Schéma, dates et métadonnées invalides sont refusés proprement', async () => {
  const envelope = await makeStateEnvelope(payload, identity);
  const wrongSchema = structuredClone(envelope); wrongSchema.schema = 'unknown';
  await assert.rejects(verifyEnvelope(wrongSchema, identity), { code: 'E_SCHEMA' });
  const badDate = structuredClone(envelope); badDate.created_utc = 'not-a-date';
  await assert.rejects(verifyEnvelope(badDate, identity), { code: 'E_METADATA' });
  await assert.rejects(makeStateEnvelope(payload, identity, { cheats: [undefined] }), { code: 'E_METADATA' });
  await assert.rejects(makeStateEnvelope(payload, identity, { label: 'x'.repeat(121) }), { code: 'E_METADATA' });
});
test('Aucune ROM brute ne passe pour un état ; bornes appliquées avant copie', async () => {
  for (const signature of [[0x80,0x37,0x12,0x40], [0x37,0x80,0x40,0x12], [0x40,0x12,0x37,0x80]]) {
    await assert.rejects(makeStateEnvelope(new Uint8Array(signature), identity), { code: 'E_ROM_PAYLOAD' });
  }
  await assert.rejects(makeStateEnvelope(new Uint8Array(), identity), { code: 'E_SIZE' });
  await assert.rejects(makeStateEnvelope(new Uint8Array(MAX_SAVE_BYTES + 1), identity), { code: 'E_SIZE' });
});
test('Limite positive : 64 Mio synthétiques vérifiés, sans moteur', async () => {
  const bytes = new Uint8Array(MAX_SAVE_BYTES); bytes[bytes.length - 1] = 1;
  const envelope = await makeStateEnvelope(bytes, identity);
  assert.equal(envelope.payload_size, MAX_SAVE_BYTES);
  assert.equal(hash(await verifyEnvelope(envelope, identity)), hash(bytes));
});
test('La base est distincte des stockages moteur et des projets originaux', async () => {
  assert.throws(() => new SaveStore('/data/saves'), { code: 'E_DATABASE' });
  assert.throws(() => new SaveStore('Conker'), { code: 'E_DATABASE' });
  const store = new SaveStore();
  await assert.rejects(store.open(), { code: 'E_STORAGE' });
});

test('Écriture groupée : refus avant ouverture si liste, doublon ou membre invalide', async () => {
  const store = new SaveStore(); let opened = 0;
  store.open = async () => { opened++; throw new Error('No database access expected'); };
  const state = await makeStateEnvelope(payload, identity);
  await assert.rejects(store.putBatch(identity, []), { code: 'E_BATCH' });
  await assert.rejects(store.putBatch(identity, Array.from({ length: 10 }, () => ({ slot: 1, envelope: state }))), { code: 'E_BATCH' });
  await assert.rejects(store.putBatch(identity, [{ slot: 1, envelope: state }, { slot: 1, envelope: state }]), { code: 'E_BATCH' });
  const corrupt = structuredClone(state); corrupt.payload[0] ^= 255;
  await assert.rejects(store.putBatch(identity, [{ slot: 1, envelope: state }, { slot: 2, envelope: corrupt }]), { code: 'E_INTEGRITY' });
  const otherRom = await makeStateEnvelope(payload, { ...identity, rom_sha256: 'd'.repeat(64) });
  await assert.rejects(store.putBatch(identity, [{ slot: 1, envelope: state }, { slot: 2, envelope: otherRom }]), { code: 'E_INCOMPATIBLE' });
  assert.equal(opened, 0);
});

test('Écriture groupée : taille totale bornée avant copie ou accès IndexedDB', async () => {
  const store = new SaveStore(); let opened = 0;
  store.open = async () => { opened++; throw new Error('No database access expected'); };
  const large = new Uint8Array(MAX_SAVE_BYTES);
  await assert.rejects(store.putBatch(identity, [1, 2, 3].map(slot => ({ slot, envelope: { payload: large } }))), { code: 'E_BATCH' });
  assert.equal(opened, 0);
});

async function withIndexedDBFault(api, run) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { value: api, configurable: true, writable: true });
  try { await run(); }
  finally {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original);
    else delete globalThis.indexedDB;
  }
}
function heldTransaction(store, { irreversibleCommit = false } = {}) {
  let aborted = false;
  return {
    error: null, aborts: 0,
    objectStore() { return store; },
    abort() {
      if (aborted || irreversibleCommit) throw new DOMException('Transaction already finished', 'InvalidStateError');
      aborted = true; this.aborts++;
      queueMicrotask(() => this.onabort?.());
    }
  };
}

test('Ouverture IDB expirée : erreur bornée, connexion tardive fermée et nouvel essai indépendant', async () => {
  const requests = []; let closed = 0;
  await withIndexedDBFault({ open() { const request = { result: { close() { closed++; } } }; requests.push(request); return request; } }, async () => {
    const vault = new SaveStore(undefined, { timeoutMs: 20 });
    await assert.rejects(vault.open(), { code: 'E_STORAGE_TIMEOUT' });
    assert.equal(vault.pending, null);
    requests[0].onsuccess(); assert.equal(closed, 1);
    let upgradeAborted = 0;
    requests[0].transaction = { abort() { upgradeAborted++; } };
    requests[0].onupgradeneeded(); assert.equal(upgradeAborted, 1);
    const retry = vault.open(); const pending = vault.pending;
    requests[0].onsuccess(); assert.equal(vault.pending, pending);
    requests[1].onsuccess(); await retry;
    await vault.close(); assert.equal(closed, 3);
  });
});

test('Lecture IDB bloquée : transaction annulée avant rejet, sans attente de requête isolée', async () => {
  const request = {}, transaction = heldTransaction({ get() { return request; } });
  await withIndexedDBFault({}, async () => {
    const vault = new SaveStore(undefined, { timeoutMs: 20 });
    vault.pending = Promise.resolve({ transaction() { return transaction; }, close() {} });
    await assert.rejects(vault.record('synthetic-key'), { code: 'E_STORAGE_TIMEOUT' });
    assert.equal(transaction.aborts, 1);
  });
});

test('Groupe IDB bloqué : abort réel avant rejet et aucun put issu de callbacks tardifs', async () => {
  const requests = []; let writes = 0;
  const transaction = heldTransaction({ get() { const request = {}; requests.push(request); return request; }, put() { writes++; } });
  await withIndexedDBFault({}, async () => {
    const vault = new SaveStore(undefined, { timeoutMs: 20 });
    vault.pending = Promise.resolve({ transaction() { return transaction; }, close() {} });
    vault.record = async () => undefined;
    const a = await makeStateEnvelope(new Uint8Array([31]), identity);
    const b = await makeStateEnvelope(new Uint8Array([41]), identity, { kind: 'battery' });
    await assert.rejects(vault.putBatch(identity, [{ slot: 1, envelope: a }, { slot: 1, envelope: b }]), { code: 'E_STORAGE_TIMEOUT' });
    assert.equal(transaction.aborts, 1); assert.equal(writes, 0);
    for (const request of requests) request.onsuccess();
    assert.equal(writes, 0);
  });
});

test('Course avec commit irréversible : attend complete et ne prétend pas avoir annulé une écriture', async () => {
  let request;
  const transaction = heldTransaction({ get() { request = {}; setTimeout(() => { request.result = 'committed-result'; request.onsuccess(); }, 1); return request; } }, { irreversibleCommit: true });
  await withIndexedDBFault({}, async () => {
    const vault = new SaveStore(undefined, { timeoutMs: 10 });
    vault.pending = Promise.resolve({ transaction() { setTimeout(() => transaction.oncomplete(), 25); return transaction; }, close() {} });
    assert.equal(await vault.record('synthetic-key'), 'committed-result');
    assert.equal(transaction.aborts, 0);
  });
});

test('Déduplication groupée : option booléenne explicite, jamais une chaîne coercible', async () => {
  const vault = new SaveStore(); let opened = 0;
  vault.open = async () => { opened++; throw new Error('No database access expected'); };
  const envelope = await makeStateEnvelope(payload, identity, { kind: 'battery' });
  for (const deduplicate of ['true', 1, null, {}]) {
    await assert.rejects(vault.putBatch(identity, [{ slot: 1, envelope, deduplicate }]), { code: 'E_BATCH' });
  }
  assert.equal(opened, 0);
});
