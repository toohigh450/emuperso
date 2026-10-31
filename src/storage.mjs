import { copy, freeze, digest, canonical, exactKeys, isHash, labAssert, systemClock } from './common.mjs';
export function namespace(profile, fixtureHash, build) {
  labAssert(typeof profile === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(profile) && isHash(fixtureHash) && build === 'synthetic-adapter/1.0.2-candidate', 'E_NAMESPACE', 'Espace de données invalide. Aucun chemin de fichier accepté.');
  return canonical({ profile, fixture_sha256: fixtureHash, adapter_build: build });
}
export function checkNamespace(ns) {
  labAssert(typeof ns === 'string' && ns.length < 500, 'E_NAMESPACE', 'Namespace invalide.');
  let data; try { data = JSON.parse(ns); } catch { labAssert(false, 'E_NAMESPACE', 'Namespace JSON requis, pas un chemin.'); }
  exactKeys(data, ['profile', 'fixture_sha256', 'adapter_build']);
  labAssert(namespace(data.profile, data.fixture_sha256, data.adapter_build) === ns, 'E_NAMESPACE', 'Namespace non canonique.');
}
export class ConsentAuthority {
  constructor(clock = systemClock) { this.clock = clock; this.pending = new Map(); this.next = 0; }
  issue({ namespace: ns, expectedRevision, payloadHash, action = 'write-synthetic-system', generation = 0, ttlMs = 30000 }) {
    labAssert(typeof ns === 'string' && ns.length < 500 && isHash(payloadHash) && Number.isInteger(expectedRevision) && expectedRevision >= 0 && action === 'write-synthetic-system' && ttlMs > 0 && ttlMs <= 30000, 'E_CONSENT', 'Périmètre de consentement invalide.');
    checkNamespace(ns); labAssert(Number.isSafeInteger(generation) && generation >= 0, 'E_CONSENT', 'Génération invalide.');
    const token = 'consent-' + (++this.next); this.pending.set(token, { namespace: ns, expectedRevision, payloadHash, action, generation, expires: this.clock.monotonic() + ttlMs }); return token;
  }
  consume(token, scope) {
    const consent = this.pending.get(token); this.pending.delete(token);
    labAssert(consent && this.clock.monotonic() <= consent.expires && Object.entries(scope).every(([k, v]) => consent[k] === v), 'E_CONSENT', 'Consentement absent, expiré, réutilisé ou hors périmètre.');
  }
}
export class MemoryStore {
  constructor({ journal, consent } = {}) { this.journal = journal; this.consent = consent; this.snapshots = new Map(); this.system = new Map(); this.next = 0; }
  putSnapshot(ns, envelope, { generation = 0 } = {}) {
    checkNamespace(ns);
    const id = 'lab-snapshot-' + (++this.next);
    const record = freeze({ namespace: ns, envelope: copy(envelope) });
    this.journal?.append('storage.snapshot.commit', { id, namespace: ns, payload_sha256: envelope.payload_sha256, backend: 'volatile-memory', synthetic: true }, generation);
    this.snapshots.set(id, record); return id;
  }
  getSnapshot(ns, id) { checkNamespace(ns); const item = this.snapshots.get(id); labAssert(item && item.namespace === ns, 'E_NAMESPACE', 'Snapshot absent ou appartenant à un autre espace.'); return copy(item.envelope); }
  list(ns) { checkNamespace(ns); return [...this.snapshots].filter(([, v]) => v.namespace === ns).map(([id, v]) => ({ id, sha256: v.envelope.payload_sha256 })); }
  readSystem(ns) { checkNamespace(ns); return copy(this.system.get(ns) ?? { revision: 0, payload: null, sha256: null }); }
  async writeSystem(ns, payload, { token, expectedRevision, generation = 0, assertCurrent = () => {} } = {}) {
    checkNamespace(ns);
    exactKeys(payload, ['schema', 'synthetic', 'note']);
    labAssert(payload.schema === 'n64lab/synthetic-system/v1' && payload.synthetic === true && typeof payload.note === 'string' && payload.note.length <= 200, 'E_SCHEMA', 'Seules des données système fictives sont acceptées.');
    const previous = this.readSystem(ns), hash = await digest(payload);
    assertCurrent();
    this.consent?.consume(token, { namespace: ns, expectedRevision, payloadHash: hash, generation, action: 'write-synthetic-system' });
    labAssert(this.consent, 'E_CONSENT', 'Autorité de consentement manquante.');
    labAssert(this.readSystem(ns).revision === expectedRevision && previous.revision === expectedRevision, 'E_CONFLICT', 'Révision système modifiée ; aucun remplacement.');
    const record = freeze({ revision: previous.revision + 1, payload: copy(payload), sha256: hash });
    this.journal?.append('storage.system.commit', { namespace: ns, revision: record.revision, previous_sha256: previous.sha256, sha256: hash, backend: 'volatile-memory', consent: 'single-use-scoped', synthetic: true }, generation);
    this.system.set(ns, record);
    return copy(record);
  }
}
export function validateSyntheticPayload(payload) {
  exactKeys(payload, ['schema', 'synthetic', 'region', 'emulated_ms', 'cpu_steps', 'rsp_tasks', 'rdp_batches', 'vi_count', 'ai_count', 'ai_status']);
  labAssert(payload.schema === 'n64lab/synthetic-core/v1' && payload.synthetic === true && ['PAL', 'NTSC'].includes(payload.region), 'E_SCHEMA', 'Payload synthétique requis.');
  for (const k of ['emulated_ms', 'cpu_steps', 'rsp_tasks', 'rdp_batches', 'vi_count', 'ai_count', 'ai_status']) labAssert(Number.isSafeInteger(payload[k]) && payload[k] >= 0 && payload[k] <= 1e12, 'E_SCHEMA', 'Compteur synthétique invalide.');
  labAssert([0, 0x40000000, 0xC0000000].includes(payload.ai_status), 'E_SCHEMA', 'Statut AI synthétique invalide.');
}
export async function wrapSnapshot({ payload, fixtureHash, build, profile, region }) {
  validateSyntheticPayload(payload);
  const envelope = { schema: 'n64lab/synthetic-snapshot/v1', simulated: true, fixture_sha256: fixtureHash, adapter_build: build, profile, region, payload_bytes: new TextEncoder().encode(canonical(payload)).length, payload_sha256: await digest(payload), engine_wasm_sha256: null, payload: copy(payload) };
  return freeze({ ...envelope, envelope_sha256: await digest(envelope) });
}
export async function validateSnapshot(envelope, expected) {
  exactKeys(envelope, ['schema', 'simulated', 'fixture_sha256', 'adapter_build', 'profile', 'region', 'payload_bytes', 'payload_sha256', 'engine_wasm_sha256', 'payload', 'envelope_sha256']);
  labAssert(canonical(envelope).length < 16384, 'E_SIZE', 'Snapshot trop volumineux.');
  labAssert(envelope.schema === 'n64lab/synthetic-snapshot/v1' && envelope.simulated === true && envelope.engine_wasm_sha256 === null, 'E_SCHEMA', 'Snapshot synthétique uniquement, jamais un état N64.');
  const { envelope_sha256, ...unsigned } = envelope;
  labAssert(isHash(envelope_sha256) && await digest(unsigned) === envelope_sha256, 'E_INTEGRITY', 'Enveloppe altérée.');
  validateSyntheticPayload(envelope.payload);
  labAssert(isHash(envelope.payload_sha256) && await digest(envelope.payload) === envelope.payload_sha256 && envelope.payload_bytes === new TextEncoder().encode(canonical(envelope.payload)).length, 'E_INTEGRITY', 'Payload synthétique altéré.');
  for (const k of ['fixture_sha256', 'adapter_build', 'profile', 'region']) labAssert(envelope[k] === expected[k], 'E_VERSION', 'Compatibilité stricte non satisfaite : ' + k);
  labAssert(envelope.payload.region === envelope.region, 'E_VERSION', 'Région interne incohérente.');
  return copy(envelope.payload);
}
