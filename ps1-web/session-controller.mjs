// SPDX-License-Identifier: MIT
import { fingerprintConfig } from './save-store.mjs';
import { DEFAULT_INPUT } from './input-profile.mjs';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let lockPromise;
async function runtimeLock() {
  if (!lockPromise) lockPromise = fetch('docs/runtime-lock.json').then(response => {
    if (!response.ok) throw new Error('Manifeste du moteur absent.'); return response.json();
  }).catch(error => { lockPromise = null; throw error; });
  return lockPromise;
}
export class SessionController {
  constructor(container, report) { this.container = container; this.report = report; this.current = null; this.candidate = null; this.generation = 0; this.disposed = 0; }
  get emulator() { return (this.candidate ?? this.current)?.frame.contentWindow?.EJS_emulator; }
  async prepare(prepared, input = DEFAULT_INPUT, bios = null) {
    const id = ++this.generation, frame = document.createElement('iframe');
    frame.className = 'engine-frame'; frame.title = 'Session du jeu PS1'; frame.allow = 'autoplay; fullscreen; gamepad';
    frame.src = 'engine.html'; frame.hidden = true;
    const loaded = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Interface moteur locale indisponible.')), 10000);
      frame.onload = () => { clearTimeout(timer); resolve(); };
      frame.onerror = () => { clearTimeout(timer); reject(new Error('Échec de l’interface moteur.')); };
    });
    this.container.appendChild(frame);
    try {
      await loaded;
      const api = frame.contentWindow.PS1Engine;
      if (!api) throw new Error('Contrôleur moteur absent.');
      const capabilities = api.capabilities(), legacy = new URLSearchParams(location.search).has('legacy') || !capabilities.webgl2;
      const lock = await runtimeLock(), corePath = `data/cores/pcsx_rearmed-${legacy ? 'legacy-' : ''}wasm.data`;
      if (!lock.files[corePath]) throw new Error('Empreinte du moteur sélectionné absente.');
      const identity = Object.freeze({ rom_sha256: prepared.metadata.canonical_sha256,
        engine_sha256: await fingerprintConfig({ core: lock.files[corePath], frontend: lock.files['data/src/emulator.js'], manager: lock.files['data/src/GameManager.js'] }),
        // Un BIOS réel change le timing : les états HLE ne sont pas compatibles avec lui.
        config_sha256: await fingerprintConfig({ bios: bios ? 'personal-file' : 'hle', threads: false, legacy, adapter: 'isolated-memfs-v1', audio: 0.45, pad: input.analog }),
        state_schema: 'emuperso-ps1-state-v1' });
      // La carte mémoire ne dépend ni du type de manette ni du BIOS : elle reste partageable.
      const batteryIdentity = Object.freeze({ ...identity, config_sha256: await fingerprintConfig({ bios: 'hle', threads: false, legacy, adapter: 'isolated-memfs-v1', audio: 0.45 }) });
      return { id, frame, api, identity, batteryIdentity, input, legacy, prepared, bios, cheats: [] };
    } catch (error) { frame.remove(); throw error; }
  }
  async start(candidate, { battery = null, state = null, cheats = [] } = {}) {
    const previous = this.current;
    try {
      if (previous) { await previous.api.pause(); previous.frame.hidden = true; }
      this.candidate = candidate; candidate.frame.hidden = false;
      const name = 'EMUPERSO_LOCAL_' + candidate.identity.rom_sha256 + '.' + candidate.prepared.metadata.filename_extension;
      await candidate.api.start({ sessionId: candidate.id, file: candidate.prepared.file, legacy: candidate.legacy, gameName: name, battery, input: candidate.input, ...(candidate.bios ? { bios: candidate.bios } : {}) }, (type, data) => {
        if (this.current?.id === candidate.id || this.candidate?.id === candidate.id) this.report(type, { ...data, session_generation: candidate.id });
      });
      if (state) await candidate.api.loadState(state);
      if (cheats.length) candidate.api.setCheats(cheats);
      candidate.cheats = cheats;
      this.current = candidate; this.candidate = null;
      if (previous) await this.dispose(previous);
      this.report('session.committed', { generation: candidate.id, previous_generation: previous?.id ?? null, rom_sha256: candidate.identity.rom_sha256 });
      return candidate;
    } catch (error) {
      this.candidate = null; await this.dispose(candidate);
      if (previous) { previous.frame.hidden = false; await previous.api.play(); }
      this.report('session.rollback', { failed_generation: candidate.id, retained_generation: previous?.id ?? null, message: error.message });
      throw error;
    }
  }
  /** Ferme la session en cours sans remplaçante (libère sa mémoire avant un lancement lourd). */
  async close() {
    const session = this.current; if (!session) return;
    this.current = null; await this.dispose(session);
    this.report('session.closed', { generation: session.id });
  }
  async dispose(session) {
    try {
      const result = await Promise.race([session.api.close(), wait(1500).then(() => null)]);
      this.report('session.disposed', { generation: session.id, audio: result?.contexts ?? [], timeout: !result });
    } catch (error) { this.report('session.dispose.error', { generation: session.id, message: error.message }); }
    finally { session.frame.remove(); this.disposed++; }
  }
  diagnostic() { return { generation: this.generation, active_generation: this.current?.id ?? null,
    candidate_generation: this.candidate?.id ?? null, disposed: this.disposed,
    active: this.current?.api.snapshot() ?? null, frame_count: this.container.querySelectorAll('iframe').length }; }
}
