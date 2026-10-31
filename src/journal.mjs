import { copy, freeze, canonical, digest, labAssert, systemClock, LabError } from './common.mjs';
export class Journal {
  constructor({ clock = systemClock, maxEvents = 10000 } = {}) { this.clock = clock; this.maxEvents = maxEvents; this.events = []; this.tail = Promise.resolve(); this.lastMono = -Infinity; this.hashError = null; }
  append(type, data = {}, generation = 0) {
    if (this.hashError) throw this.hashError;
    labAssert(this.events.length < this.maxEvents, 'E_JOURNAL_FULL', 'Journal plein : exporter puis ouvrir une nouvelle session du laboratoire.');
    const mono = this.clock.monotonic();
    labAssert(Number.isFinite(mono) && mono >= this.lastMono, 'E_CLOCK', 'Horloge hôte non monotone.');
    labAssert(canonical(data).length <= 16384, 'E_SIZE', 'Événement de journal trop volumineux.');
    this.lastMono = mono;
    const event = { seq: this.events.length + 1, utc: this.clock.utc(), host_monotonic_ms: mono, generation, type, evidence_domain: 'SIMULATION_ONLY', data: copy(data) };
    const record = { event: freeze(event), previous_sha256: null, sha256: null }; this.events.push(record);
    this.tail = this.tail.then(async () => { if (this.hashError) return; record.previous_sha256 = event.seq === 1 ? 'GENESIS' : this.events[event.seq - 2].sha256; record.sha256 = await digest({ previous_sha256: record.previous_sha256, event }); }).catch(() => { this.hashError = new LabError('E_JOURNAL_HASHING', 'Scellement SHA-256 impossible ; journal non vérifiable.'); });
    return copy(event);
  }
  async flush() { await this.tail; if (this.hashError) throw this.hashError; }
  async export() {
    const length = this.events.length, pendingPrefix = this.tail;
    await pendingPrefix;
    if (this.hashError) throw this.hashError;
    const records = this.events.slice(0, length);
    return copy({ schema: 'n64lab/journal/v1', warning: 'SIMULATION ONLY. Hash chain = integrity, not authentication or proof of N64 execution.', records, head_sha256: records.at(-1)?.sha256 ?? null });
  }
  async verify(exported) {
    labAssert(exported?.schema === 'n64lab/journal/v1' && Array.isArray(exported.records) && exported.records.length <= this.maxEvents, 'E_JOURNAL_SCHEMA', 'Journal invalide.');
    let previous = 'GENESIS', mono = -Infinity;
    for (let i = 0; i < exported.records.length; i++) {
      const r = exported.records[i];
      labAssert(r.event?.seq === i + 1 && r.event.evidence_domain === 'SIMULATION_ONLY' && r.event.host_monotonic_ms >= mono && r.previous_sha256 === previous, 'E_JOURNAL_CHAIN', 'Chaîne ou ordre du journal invalide.');
      labAssert(await digest({ previous_sha256: previous, event: r.event }) === r.sha256, 'E_JOURNAL_HASH', 'Journal altéré.');
      previous = r.sha256; mono = r.event.host_monotonic_ms;
    }
    labAssert(exported.head_sha256 === (exported.records.length ? previous : null), 'E_JOURNAL_HEAD', 'Tête du journal invalide.');
    return true;
  }
}
