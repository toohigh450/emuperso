/** Independent, read-only verifier of synthetic export hashes.
 * Does not import the application, execute a core, restore a file, or write input.
 * ECMAScript string/number serialization + UTF-16 key ordering, UTF-8, SHA-256.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const MAX_BYTES = 2 * 1024 * 1024;
export function canonicalText(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalText).join(',') + ']';
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('JSON simple et nombres finis requis.');
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalText(value[k])).join(',') + '}';
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = value => Buffer.from(canonicalText(value), 'utf8');
function parse(raw) {
  if (!Buffer.isBuffer(raw) || raw.length > MAX_BYTES) throw new RangeError('Buffer JSON requis, maximum 2 Mio.');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
}
export function verifyPairBuffers(diagnosticRaw, snapshotRaw) {
  const diagnostic = parse(diagnosticRaw), snapshot = parse(snapshotRaw);
  if (diagnostic?.schema !== 'n64lab/diagnostic/v1' || diagnostic.journal?.schema !== 'n64lab/journal/v1' || !Array.isArray(diagnostic.journal.records) || diagnostic.journal.records.length > 10000 || snapshot?.schema !== 'n64lab/synthetic-snapshot/v1') throw new TypeError('Exports synthétiques v1 requis.');
  let expectedPrevious = 'GENESIS', declaredPrevious = 'GENESIS', lastMono = -Infinity;
  const records = diagnostic.journal.records.map((record, i) => {
    const preimage = bytes({ previous_sha256: record.previous_sha256, event: record.event });
    const computed = sha(preimage), e = record.event;
    const check = { seq: e.seq, preimage_utf8_bytes: preimage.length, declared_sha256: record.sha256, recomputed_sha256: computed, hash_matches: record.sha256 === computed, declared_link_matches: record.previous_sha256 === declaredPrevious, recomputed_link_matches: record.previous_sha256 === expectedPrevious, metadata_valid: e.seq === i + 1 && e.evidence_domain === 'SIMULATION_ONLY' && Number.isFinite(e.host_monotonic_ms) && e.host_monotonic_ms >= lastMono };
    lastMono = e.host_monotonic_ms; expectedPrevious = computed; declaredPrevious = record.sha256;
    return check;
  });
  const head = records.length ? expectedPrevious : null;
  const payload = bytes(snapshot.payload), { envelope_sha256, ...unsigned } = snapshot, envelope = bytes(unsigned);
  const payloadHash = sha(payload), envelopeHash = sha(envelope);
  const identity = diagnostic.controller.selected?.sha256;
  const result = {
    method: { encoding: 'UTF-8 without BOM, no trailing newline in preimages', keys: 'recursive Object.keys(value).sort(), UTF-16 ordering', numbers_and_strings: 'ECMAScript JSON.stringify, finite numbers only', digest: 'SHA-256 via independent node:crypto (no application imports)', scope: 'Integrity and cross-file consistency, not signatures, execution evidence or full schema validation' },
    files: { diagnostic: { raw_bytes: diagnosticRaw.length, raw_sha256: sha(diagnosticRaw), canonical_json_sha256: sha(bytes(diagnostic)) }, snapshot: { raw_bytes: snapshotRaw.length, raw_sha256: sha(snapshotRaw), canonical_json_sha256: sha(bytes(snapshot)) } },
    journal: { count: records.length, records, declared_head_sha256: diagnostic.journal.head_sha256, recomputed_head_sha256: head, head_matches: diagnostic.journal.head_sha256 === head },
    snapshot: { payload_utf8_bytes: payload.length, declared_payload_bytes: snapshot.payload_bytes, payload_bytes_match: payload.length === snapshot.payload_bytes, recomputed_payload_sha256: payloadHash, payload_matches: payloadHash === snapshot.payload_sha256, unsigned_envelope_utf8_bytes: envelope.length, recomputed_envelope_sha256: envelopeHash, envelope_matches: envelopeHash === envelope_sha256, payload_preimage_utf8: payload.toString('utf8'), unsigned_envelope_preimage_utf8: envelope.toString('utf8') },
    correspondence: { selected_loaded_launched_snapshot: typeof identity === 'string' && diagnostic.controller.loaded_sha256 === identity && diagnostic.controller.launched_sha256 === identity && snapshot.fixture_sha256 === identity, snapshot_list_references_payload: diagnostic.controller.snapshots.some(s => s.sha256 === snapshot.payload_sha256) }
  };
  result.integrity_valid = records.every(r => r.hash_matches && r.declared_link_matches && r.recomputed_link_matches && r.metadata_valid) && result.journal.head_matches && result.snapshot.payload_bytes_match && result.snapshot.payload_matches && result.snapshot.envelope_matches;
  result.correspondence_valid = Object.values(result.correspondence).every(Boolean);
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const defaultDir = resolve(root, 'references/transmission/02_PREUVES');
  try {
    const diagnostic = readFileSync(process.argv[2] ?? resolve(defaultDir, 'N64Lab-diagnostic-SIMULATION.json'));
    const snapshot = readFileSync(process.argv[3] ?? resolve(defaultDir, 'N64Lab-SYNTHETIC.lab-snapshot.json'));
    const result = verifyPairBuffers(diagnostic, snapshot);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.integrity_valid || !result.correspondence_valid) process.exitCode = 1;
  } catch (error) { process.stderr.write('ÉCHOUÉ — ' + error.message + '\n'); process.exitCode = 1; }
}
