import { copy, freeze, labAssert, abortError, sleep, LabError } from './common.mjs';
import { validateSyntheticPayload } from './storage.mjs';
export const SIM_BUILD = 'synthetic-adapter/1.0.2-candidate';
export function normalizeStepArguments(args = {}) {
  labAssert(args && Object.getPrototypeOf(args) === Object.prototype, 'E_SCHEMA', 'Options de fenêtre synthétique requises.');
  labAssert(Object.keys(args).every(k => ['wall_ms', 'emulated_ms', 'produce_pcm', 'consume_pcm'].includes(k)), 'E_SCHEMA', 'Option de fenêtre synthétique inconnue.');
  const normalized = { wall_ms: 1000, emulated_ms: 1000, produce_pcm: true, consume_pcm: true, ...args };
  labAssert([normalized.wall_ms, normalized.emulated_ms].every(x => Number.isSafeInteger(x) && x > 0 && x <= 10000), 'E_CLOCK', 'Fenêtre fictive : entiers de 1 à 10 000 ms requis.');
  labAssert(typeof normalized.produce_pcm === 'boolean' && typeof normalized.consume_pcm === 'boolean', 'E_SCHEMA', 'Les options PCM synthétiques doivent être booléennes.');
  return freeze(normalized);
}
export class SimulationAdapter {
  constructor({ delays = {}, failures = {}, dishonestLoadedHash = false, dishonestStartedHash = false } = {}) {
    this.kind = 'simulation'; this.delays = delays; this.failures = failures; this.dishonestLoadedHash = dishonestLoadedHash; this.dishonestStartedHash = dishonestStartedHash;
    this.disposed = false; this.ready = false; this.fixtureHash = null; this.region = null; this.loopLeases = new Set(); this.audio = { state: 'not_created', pcm_ms: 0, underruns: 0 }; this.virtualWall = 0; this.anchor = null; this.failNext = null;
  }
  injectionConfiguration() { return freeze({ domain: 'SIMULATION_ONLY', delays_ms: copy(this.delays), failures: copy(this.failures), dishonest_loaded_hash: Boolean(this.dishonestLoadedHash), dishonest_started_hash: Boolean(this.dishonestStartedHash) }); }
  descriptor() { return freeze({ kind: 'simulation', simulated: true, build: SIM_BUILD, n64_engine: false, wasm_sha256: null, actual_n64_loops: 0, actual_workers: 0, actual_webgl_contexts: 0, actual_audio_contexts: 0 }); }
  async gate(method, { signal } = {}) {
    abortError(signal); labAssert(!this.disposed, 'E_DISPOSED', 'Ancienne instance détruite.');
    if (this.delays[method]) await sleep(this.delays[method], signal);
    abortError(signal); labAssert(!this.disposed, 'E_DISPOSED', 'Instance détruite pendant l’opération.');
    if (this.failures[method] || this.failNext === method) { this.failNext = null; throw new LabError('E_ADAPTER', 'Erreur synthétique injectée : ' + method, { injected: true, method }); }
  }
  async initialize(args, context) { await this.gate('initialize', context); this.ready = true; return { ready: true, ...this.descriptor() }; }
  async load(fixture, context) {
    await this.gate('load', context); labAssert(this.ready, 'E_NOT_READY', 'Initialisation requise.');
    this.fixtureHash = fixture.sha256; this.region = fixture.content.region;
    this.core = { schema: 'n64lab/synthetic-core/v1', synthetic: true, region: this.region, emulated_ms: 0, cpu_steps: 0, rsp_tasks: 0, rdp_batches: 0, vi_count: 0, ai_count: 0, ai_status: 0 };
    return { fixture_sha256: this.dishonestLoadedHash ? '0'.repeat(64) : this.fixtureHash, simulated: true };
  }
  async start(args, context) { await this.gate('start', context); labAssert(this.core, 'E_NOT_READY', 'Aucune fixture chargée.'); this.loopLeases.add('only-simulation-loop'); this.audio.state = 'running'; this.reanchor(); return { fixture_sha256: this.dishonestStartedHash ? '0'.repeat(64) : this.fixtureHash, simulated: true, simulated_loops: this.loopLeases.size }; }
  async pause(args, context) { await this.gate('pause', context); this.loopLeases.clear(); return { paused: true, simulated: true }; }
  async resume(args, context) { await this.gate('resume', context); labAssert(this.core && this.audio.state !== 'closed', 'E_AUDIO', 'Graphe fictif indisponible.'); this.audio.state = 'running'; this.loopLeases.add('only-simulation-loop'); this.reanchor(); return { simulated: true, simulated_loops: this.loopLeases.size, fixture_sha256: this.fixtureHash }; }
  async serialize(args, context) { await this.gate('serialize', context); labAssert(this.loopLeases.size === 0 && this.core, 'E_POINT_UNSAFE', 'Point sûr fictif non atteint.'); return copy(this.core); }
  async restore(payload, context) { await this.gate('restore', context); labAssert(this.loopLeases.size === 0, 'E_POINT_UNSAFE', 'Une boucle fictive est encore active.'); validateSyntheticPayload(payload); this.core = copy(payload); return { restored: true, simulated: true }; }
  async rebuildHost(args, context) { await this.gate('rebuildHost', context); this.audio = { state: 'suspended', pcm_ms: 0, underruns: 0 }; this.reanchor(); return { rebuilt: true, pcm_purged: true, simulated: true }; }
  reanchor() { this.anchor = this.core ? { emulated_ms: this.core.emulated_ms, wall_ms: this.virtualWall } : null; }
  async step(args = {}, context) {
    const { wall_ms, emulated_ms, produce_pcm, consume_pcm } = normalizeStepArguments(args);
    await this.gate('step', context);
    labAssert(this.loopLeases.size === 1 && this.core, 'E_NOT_RUNNING', 'Aucune boucle de simulation active.');
    labAssert([wall_ms, emulated_ms].every(x => Number.isSafeInteger(x) && x > 0 && x <= 10000), 'E_CLOCK', 'Fenêtre temporelle fictive invalide.');
    this.virtualWall += wall_ms; this.core.emulated_ms += emulated_ms; this.core.cpu_steps += emulated_ms * 10; this.core.rsp_tasks++; this.core.rdp_batches++;
    this.core.vi_count += Math.round(emulated_ms * (this.region === 'PAL' ? 50 : 60) / 1000); this.core.ai_count += 1;
    let available = this.audio.pcm_ms + (produce_pcm ? emulated_ms : 0);
    if (consume_pcm && this.audio.state === 'running') { if (available < wall_ms) this.audio.underruns++; available = Math.max(0, available - wall_ms); }
    this.audio.pcm_ms = Math.min(250, available);
    this.core.ai_status = this.audio.pcm_ms >= 200 ? 0xC0000000 : this.audio.pcm_ms ? 0x40000000 : 0;
    return this.probe();
  }
  async setAudio({ state }, context) { await this.gate('setAudio', context); labAssert(['running', 'suspended', 'closed'].includes(state), 'E_AUDIO', 'État audio fictif invalide.'); this.audio.state = state; return this.probe(); }
  probe() {
    const wall = this.anchor ? this.virtualWall - this.anchor.wall_ms : 0, emulated = this.anchor && this.core ? this.core.emulated_ms - this.anchor.emulated_ms : 0;
    return freeze({ domain: 'SIMULATION_ONLY', virtual_wall_ms: this.virtualWall, emulated_ms: this.core?.emulated_ms ?? 0, window_wall_ms: wall, window_emulated_ms: emulated, speed: wall > 0 ? emulated / wall : null, vi_count: this.core?.vi_count ?? 0, ai_count: this.core?.ai_count ?? 0, ai_status: this.core?.ai_status ?? 0, simulated_audio_state: this.audio.state, simulated_pcm_ms: this.audio.pcm_ms, simulated_underruns: this.audio.underruns, simulated_loops: this.loopLeases.size, actual_n64_loops: 0, actual_audio_contexts: 0, actual_workers: 0, actual_webgl_contexts: 0 });
  }
  dispose() { this.disposed = true; this.loopLeases.clear(); this.audio.pcm_ms = 0; this.audio.state = 'closed'; this.core = null; this.fixtureHash = null; }
}
