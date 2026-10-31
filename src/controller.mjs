import { copy, freeze, labAssert, LabError, digest, systemClock } from './common.mjs';
import { validateFixture } from './fixtures.mjs';
import { SimulationAdapter, SIM_BUILD, normalizeStepArguments } from './simulator.mjs';
import { Journal } from './journal.mjs';
import { MemoryStore, ConsentAuthority, namespace, wrapSnapshot, validateSnapshot } from './storage.mjs';
export class SessionController {
  constructor({ adapterFactory = () => new SimulationAdapter(), clock = systemClock, deadlines = {}, profile = 'Karl-lab' } = {}) {
    labAssert(/^[a-zA-Z0-9_-]{1,40}$/.test(profile), 'E_NAMESPACE', 'Profil invalide.');
    this.adapterFactory = adapterFactory; this.clock = clock; this.profile = profile; this.deadlines = { initialize: 5000, load: 5000, start: 2000, pause: 2000, resume: 2000, serialize: 3000, restore: 3000, rebuildHost: 2000, step: 2000, setAudio: 2000, ...deadlines };
    this.journal = new Journal({ clock }); this.consent = new ConsentAuthority(clock); this.store = new MemoryStore({ journal: this.journal, consent: this.consent });
    this.state = 'IDLE'; this.generation = 0; this.request = 0; this.busy = null; this.adapter = null; this.selected = null; this.loadedHash = null; this.launchedHash = null; this.lastError = null; this.listeners = new Set(); this.simulationConfiguration = null;
    this.journal.append('lab.open', { actual_engine_available: false, backend: 'volatile-memory', external_connections: false });
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  notify() { for (const fn of this.listeners) { try { fn(this.view()); } catch { /* UI observer errors cannot alter the controller. */ } } }
  view() {
    return freeze({ state: this.state, generation: this.generation, busy: this.busy?.operation ?? null, profile: this.profile, selected: this.selected ? { name: this.selected.content.name, sha256: this.selected.sha256, region: this.selected.content.region, kind: 'TEXT_FIXTURE_NOT_ROM' } : null, loaded_sha256: this.loadedHash, launched_sha256: this.launchedHash, identity_domain: 'SIMULATION_ONLY_NOT_ROM_EXECUTION', simulation_configuration: copy(this.simulationConfiguration), last_error: copy(this.lastError), descriptor: this.adapter?.descriptor() ?? { kind: 'absent', n64_engine: false }, probes: this.adapter?.probe() ?? null, snapshots: this.selected ? this.store.list(this.ns()) : [] });
  }
  ns() { labAssert(this.selected, 'E_NOT_READY', 'Fixture requise.'); return namespace(this.profile, this.selected.sha256, SIM_BUILD); }
  async run(operation, allowed, action) {
    const requestId = ++this.request;
    if (this.journal.hashError || this.journal.events.length >= this.journal.maxEvents) {
      const failure = this.journal.hashError ?? new LabError('E_JOURNAL_FULL', 'Journal plein : exporter et ouvrir un laboratoire neuf.');
      this.generation++; this.busy?.aborter.abort(failure); this.adapter?.dispose(); this.adapter = null; this.loadedHash = null; this.launchedHash = null; this.state = 'ERROR'; this.lastError = { code: failure.code, message: failure.message }; this.notify(); throw failure;
    }
    if (this.busy || !allowed.includes(this.state)) {
      const error = new LabError(this.busy ? 'E_BUSY' : 'E_TRANSITION', this.busy ? 'Une opération est déjà en cours.' : 'Transition interdite : ' + this.state + ' → ' + operation);
      this.journal.append('command.rejected', { request_id: requestId, operation, code: error.code, state: this.state }, this.generation); throw error;
    }
    const context = { requestId, operation, generation: this.generation, touched: false, aborter: new AbortController() }; this.busy = context; this.lastError = null;
    try {
      this.journal.append('command.accepted', { request_id: requestId, operation, state: this.state }, this.generation); this.notify();
      const result = await action(context); this.assertCurrent(context);
      await this.journal.flush(); this.assertCurrent(context);
      this.journal.append('command.completed', { request_id: requestId, operation, state: this.state }, this.generation);
      await this.journal.flush(); this.assertCurrent(context);
      return copy(result ?? null);
    } catch (error) {
      const e = error instanceof LabError ? error : new LabError('E_INTERNAL', error.message ?? 'Erreur interne.');
      if (context.generation === this.generation) {
        if (context.touched || ['E_JOURNAL_FULL', 'E_JOURNAL_HASHING', 'E_CRYPTO'].includes(e.code)) { context.aborter.abort(e); this.adapter?.dispose(); this.adapter = null; this.loadedHash = null; this.launchedHash = null; this.generation++; this.state = 'ERROR'; }
        this.lastError = { code: e.code, message: e.message, details: copy(e.details) };
      }
      if (!this.journal.hashError && this.journal.events.length < this.journal.maxEvents) this.journal.append('command.' + (e.code === 'E_TIMEOUT' ? 'timed_out' : e.code === 'E_STALE_GENERATION' ? 'stale' : 'failed'), { request_id: requestId, operation, code: e.code, touched_adapter: context.touched, details: copy(e.details) }, this.generation); throw e;
    } finally { if (this.busy === context) this.busy = null; this.notify(); }
  }
  assertCurrent(context) { labAssert(this.generation === context.generation && !context.aborter.signal.aborted, 'E_STALE_GENERATION', 'Réponse d’une génération abandonnée.'); }
  async call(context, method, argument = {}) {
    this.assertCurrent(context); context.touched = true;
    const adapter = this.adapter; labAssert(adapter, 'E_NOT_READY', 'Adaptateur absent.');
    const controller = context.aborter; let timer; let cancel;
    const cancelled = new Promise((_, reject) => { cancel = () => reject(controller.signal.reason ?? new LabError('E_ABORTED', 'Annulé.')); controller.signal.addEventListener('abort', cancel, { once: true }); });
    timer = setTimeout(() => controller.abort(new LabError('E_TIMEOUT', 'Délai dépassé : ' + method)), this.deadlines[method] ?? 3000);
    try { const result = await Promise.race([Promise.resolve().then(() => adapter[method](argument, { signal: controller.signal, generation: context.generation, request_id: context.requestId })), cancelled]); this.assertCurrent(context); return result; }
    finally { clearTimeout(timer); controller.signal.removeEventListener('abort', cancel); }
  }
  async initialize() {
    return this.run('initialize', ['IDLE', 'STOPPED', 'ERROR'], async ctx => {
      this.generation++; ctx.generation = this.generation; this.selected = null; this.loadedHash = null; this.launchedHash = null; this.simulationConfiguration = null;
      this.adapter = this.adapterFactory(); const d = this.adapter.descriptor();
      if (!(this.adapter.kind === 'simulation' && d.simulated === true && d.n64_engine === false && d.build === SIM_BUILD && d.wasm_sha256 === null)) { this.adapter.dispose?.(); this.adapter = null; throw new LabError('E_ENGINE_NOT_AUTHORIZED', 'Seul l’adaptateur synthétique est autorisé en phase 1A.'); }
      this.simulationConfiguration = this.adapter.injectionConfiguration?.() ?? { domain: 'SIMULATION_ONLY', configuration_reported: false };
      this.journal.append('simulation.configuration', { configuration: copy(this.simulationConfiguration) }, this.generation);
      this.state = 'INITIALIZING'; this.notify(); const result = await this.call(ctx, 'initialize');
      labAssert(result.ready === true && result.simulated === true, 'E_UNCONFIRMED', 'Initialisation non confirmée.'); this.state = 'READY'; return result;
    });
  }
  async select(fixture) { return this.run('select', ['READY', 'SELECTED'], async ctx => { const valid = await validateFixture(fixture); this.assertCurrent(ctx); this.selected = valid; this.loadedHash = null; this.launchedHash = null; this.state = 'SELECTED'; this.journal.append('identity.selected', { fixture_sha256: valid.sha256, kind: 'TEXT_FIXTURE_NOT_ROM' }, this.generation); return { selected: true }; }); }
  async load() { return this.run('load', ['SELECTED'], async ctx => { this.state = 'LOADING'; this.notify(); const result = await this.call(ctx, 'load', copy(this.selected)); labAssert(result.simulated === true && result.fixture_sha256 === this.selected.sha256, 'E_IDENTITY', 'Identité synthétique refusée avant lancement. Vérifiez la configuration d’injection consignée.', { expected_fixture_sha256: this.selected.sha256, reported_fixture_sha256: result.fixture_sha256 }); this.loadedHash = result.fixture_sha256; this.state = 'LOADED'; this.journal.append('identity.loaded', { fixture_sha256: this.loadedHash }, this.generation); return result; }); }
  async start() { return this.run('start', ['LOADED'], async ctx => { const result = await this.call(ctx, 'start'); labAssert(result.simulated === true && result.fixture_sha256 === this.loadedHash && result.simulated_loops === 1, 'E_IDENTITY', 'Démarrage synthétique non confirmé.'); this.launchedHash = result.fixture_sha256; this.state = 'RUNNING'; this.journal.append('identity.launched_simulated', { fixture_sha256: this.launchedHash, actual_rom_executed: false }, this.generation); return result; }); }
  async pause() { return this.run('pause', ['RUNNING'], async ctx => { this.state = 'PAUSING'; this.notify(); const r = await this.call(ctx, 'pause'); labAssert(r.paused === true, 'E_UNCONFIRMED', 'Pause non confirmée.'); this.state = 'PAUSED'; return r; }); }
  async resume() { return this.run('resume', ['PAUSED'], async ctx => { const r = await this.call(ctx, 'resume'); labAssert(r.fixture_sha256 === this.loadedHash && r.simulated_loops === 1, 'E_IDENTITY', 'Reprise non confirmée.'); this.launchedHash = r.fixture_sha256; this.state = 'RUNNING'; return r; }); }
  async advance(args = {}) {
    return this.run('step', ['RUNNING'], async ctx => {
      const normalized = normalizeStepArguments(args), before = this.adapter.probe();
      this.journal.append('simulation.step.requested', { inputs: normalized, domain: 'SIMULATION_ONLY' }, this.generation);
      const probes = await this.call(ctx, 'step', normalized);
      let code = null;
      if (probes.simulated_loops !== 1 || probes.actual_n64_loops !== 0) code = 'E_LOOP';
      else if (probes.simulated_audio_state !== 'running') code = 'E_AUDIO_BLOCKED';
      else if (probes.speed !== null && (probes.speed > 1.05 || probes.speed < 0.95)) code = 'E_CLOCK_DRIFT';
      else if (probes.simulated_underruns > before.simulated_underruns) code = 'E_PCM_UNDERRUN';
      if (code) { await this.call(ctx, 'pause'); this.state = 'PAUSED'; this.lastError = { code, message: 'Garde-fou déclenché sur données synthétiques. Session mise en pause.' }; this.journal.append('guard.paused', { code, probes }, this.generation); }
      return probes;
    });
  }
  async changeAudio(state) { return this.run('setAudio', ['RUNNING', 'PAUSED'], async ctx => { labAssert(['running', 'suspended', 'closed'].includes(state), 'E_AUDIO', 'État audio fictif invalide.'); this.journal.append('simulation.audio.requested', { state, domain: 'SIMULATION_ONLY' }, this.generation); const p = await this.call(ctx, 'setAudio', { state }); if (this.state === 'RUNNING' && state !== 'running') { await this.call(ctx, 'pause'); this.state = 'PAUSED'; this.lastError = { code: 'E_AUDIO_BLOCKED', message: 'Graphe audio fictif indisponible : pause.' }; this.journal.append('guard.paused', { code: 'E_AUDIO_BLOCKED' }, this.generation); } return p; }); }
  async saveSnapshot() { return this.run('serialize', ['RUNNING', 'PAUSED', 'LOADED'], async ctx => { const previous = this.state; this.state = 'SNAPSHOTTING'; this.notify(); await this.call(ctx, 'pause'); this.journal.append('snapshot.safe_point', { cpu_rsp_renderer: 'synthetic-barrier' }, this.generation); const payload = await this.call(ctx, 'serialize'); const envelope = await wrapSnapshot({ payload, fixtureHash: this.selected.sha256, build: SIM_BUILD, profile: this.profile, region: this.selected.content.region }); this.assertCurrent(ctx); const id = this.store.putSnapshot(this.ns(), envelope, { generation: this.generation }); if (previous === 'RUNNING') await this.call(ctx, 'resume'); this.state = previous; return { id, envelope }; }); }
  async restoreSnapshot(envelope, options = {}) {
    return this.run('restore', ['RUNNING', 'PAUSED', 'LOADED'], async ctx => {
      labAssert(options && Object.getPrototypeOf(options) === Object.prototype && Object.keys(options).every(k => k === 'resume'), 'E_SCHEMA', 'Options de restauration synthétique invalides.');
      const resume = Object.hasOwn(options, 'resume') ? options.resume : false;
      labAssert(typeof resume === 'boolean', 'E_SCHEMA', 'Reprise explicite : booléen requis, aucune coercition.');
      const payload = await validateSnapshot(copy(envelope), { fixture_sha256: this.selected.sha256, adapter_build: SIM_BUILD, profile: this.profile, region: this.selected.content.region }); this.assertCurrent(ctx);
      this.journal.append('restore.validated', { envelope_sha256: envelope.envelope_sha256 }, this.generation); this.state = 'RESTORING'; this.notify();
      await this.call(ctx, 'pause'); this.journal.append('restore.safe_point', {}, this.generation);
      const r = await this.call(ctx, 'restore', payload); labAssert(r.restored === true && r.simulated === true, 'E_UNCONFIRMED', 'Restauration synthétique non confirmée.');
      const host = await this.call(ctx, 'rebuildHost'); labAssert(host.rebuilt === true && host.pcm_purged === true, 'E_UNCONFIRMED', 'Reconstruction hôte fictive non confirmée.');
      this.journal.append('restore.host_rebuilt_pcm_purged_reanchored', { simulated: true }, this.generation);
      if (resume) { const started = await this.call(ctx, 'resume'); labAssert(started.fixture_sha256 === this.loadedHash && started.simulated_loops === 1, 'E_IDENTITY', 'Reprise après restauration non confirmée.'); this.launchedHash = started.fixture_sha256; this.state = 'RUNNING'; } else this.state = 'PAUSED';
      return { restored: true, simulated: true, probes: this.adapter.probe() };
    });
  }
  stop() {
    const old = this.busy; this.generation++; old?.aborter.abort(new LabError('E_STALE_GENERATION', 'Arrêt explicite de la génération.')); this.adapter?.dispose(); this.adapter = null; this.loadedHash = null; this.launchedHash = null; this.selected = null; this.state = 'STOPPED'; this.lastError = null;
    if (!this.journal.hashError && this.journal.events.length < this.journal.maxEvents) this.journal.append('session.stopped', { cancelled_request: old?.requestId ?? null }, this.generation);
    else this.lastError = { code: this.journal.hashError?.code ?? 'E_JOURNAL_FULL', message: 'Arrêt effectué ; journal indisponible, ouvrir un laboratoire neuf.' }; this.notify(); return { stopped: true };
  }
  async requestSystemConsent(payload) {
    labAssert(this.selected && ['LOADED', 'RUNNING', 'PAUSED'].includes(this.state) && !this.busy, 'E_NOT_READY', 'Session stable requise.');
    const ns = this.ns(), generation = this.generation, revision = this.store.readSystem(ns).revision, payloadHash = await digest(payload);
    labAssert(generation === this.generation && !this.busy, 'E_STALE_GENERATION', 'Session changée pendant la demande.');
    return { token: this.consent.issue({ namespace: ns, expectedRevision: revision, payloadHash, generation }), expectedRevision: revision };
  }
  async writeSystem(payload, approval) { return this.run('writeSystem', ['LOADED', 'RUNNING', 'PAUSED'], async ctx => { const r = await this.store.writeSystem(this.ns(), payload, { ...approval, generation: ctx.generation, assertCurrent: () => this.assertCurrent(ctx) }); this.assertCurrent(ctx); return r; }); }
  async diagnostic() { return { schema: 'n64lab/diagnostic/v1', warning: 'SIMULATION ONLY - NO ROM OR REAL N64 ENGINE', controller: this.view(), host: { monotonic_ms: this.clock.monotonic(), measurement_scope: 'UI HOST ONLY, NOT N64 PERFORMANCE' }, journal: await this.journal.export() }; }
}
