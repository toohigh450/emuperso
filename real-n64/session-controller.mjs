// SPDX-License-Identifier: MIT
import { fingerprintConfig } from './save-store.mjs';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let lockPromise;
async function runtimeLock() {
  if (!lockPromise) lockPromise = fetch('docs/runtime-lock.json', { signal: AbortSignal.timeout(10000) }).then(response => {
    if (!response.ok) throw new Error('Manifeste du moteur absent.'); return response.json();
  }).catch(error => { lockPromise = null; throw error; });
  return lockPromise;
}
export class SessionController {
  constructor(container, report) { this.container = container; this.report = report; this.current = null; this.candidate = null; this.generation = 0; this.disposed = 0; }
  get emulator() { return (this.candidate ?? this.current)?.frame.contentWindow?.EJS_emulator; }
  async prepare(prepared, { legacy: requiredLegacy } = {}) {
    const id = ++this.generation, frame = document.createElement('iframe');
    frame.className = 'engine-frame'; frame.title = 'Session du jeu N64'; frame.allow = 'autoplay; fullscreen; gamepad';
    frame.src = 'engine.html'; frame.hidden = true;
    const loaded = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Interface moteur locale indisponible.')), 10000);
      frame.onload = () => { clearTimeout(timer); resolve(); };
      frame.onerror = () => { clearTimeout(timer); reject(new Error('Échec de l’interface moteur.')); };
    });
    this.container.appendChild(frame);
    try {
      await loaded;
      const api = frame.contentWindow.N64Engine;
      if (!api) throw new Error('Contrôleur moteur absent.');
      const capabilities = api.capabilities(), legacy = requiredLegacy ?? (new URLSearchParams(location.search).has('legacy') || !capabilities.webgl2);
      if (!legacy && !capabilities.webgl2) throw Object.assign(new Error('Le contexte WebGL2 requis par cet état est indisponible. La partie actuelle est conservée.'), { code: 'E_RESTORE_VIDEO' });
      const lock = await runtimeLock(), corePath = `data/cores/mupen64plus_next-${legacy ? 'legacy-' : ''}wasm.data`;
      if (!lock.files[corePath]) throw new Error('Empreinte du moteur sélectionné absente.');
      const identity = Object.freeze({ rom_sha256: prepared.metadata.canonical_sha256,
        engine_sha256: await fingerprintConfig({ core: lock.files[corePath], frontend: lock.files['data/src/emulator.js'], manager: lock.files['data/src/GameManager.js'] }),
        config_sha256: await fingerprintConfig({ cpu: 'pure_interpreter', threads: false, legacy, adapter: 'isolated-memfs-v1', audio: 0.45 }),
        state_schema: 'emuperso-real-state-v2' });
      return { id, frame, api, identity, legacy, prepared, runtimeFiles: lock.files, cheats: [] };
    } catch (error) { frame.remove(); throw error; }
  }
  async start(candidate, { battery = null, state = null, cheats = [], expectedIdentity = null, beforeCommit = null } = {}) {
    const previous = this.current;
    try {
      if (expectedIdentity && await fingerprintConfig(candidate.identity) !== await fingerprintConfig(expectedIdentity)) {
        throw Object.assign(new Error('Chargement annulé : la ROM, le moteur ou la configuration de la nouvelle session diffère de l’état enregistré. Aucune sauvegarde modifiée.'), { code: 'E_RESTORE_IDENTITY' });
      }
      this.report('session.stage', { generation: candidate.id, stage: 'pause-current' });
      if (previous) { await previous.api.pause(); previous.frame.hidden = true; }
      this.candidate = candidate; candidate.frame.hidden = false;
      const name = candidate.prepared.metadata.source === 'reference-demo' ? 'DEMO N64 EMUPERSO' : 'EMUPERSO_LOCAL_' + candidate.identity.rom_sha256 + '.z64';
      this.report('session.stage', { generation: candidate.id, stage: 'start-candidate' });
      await candidate.api.start({ sessionId: candidate.id, bytes: candidate.prepared.bytes, legacy: candidate.legacy, gameName: name, battery, runtimeFiles: candidate.runtimeFiles }, (type, data) => {
        if (this.current?.id === candidate.id || this.candidate?.id === candidate.id) this.report(type, { ...data, session_generation: candidate.id });
      });
      if (state) {
        this.report('session.stage', { generation: candidate.id, stage: 'restore-and-verify' });
        candidate.restoreProof = await candidate.api.loadState(state);
      }
      if (cheats.length) candidate.api.setCheats(cheats);
      candidate.cheats = cheats;
      this.report('session.stage', { generation: candidate.id, stage: 'commit-storage' });
      if (beforeCommit) await beforeCommit(candidate);
      this.current = candidate; this.candidate = null;
      if (previous) await this.dispose(previous);
      this.report('session.committed', { generation: candidate.id, previous_generation: previous?.id ?? null, rom_sha256: candidate.identity.rom_sha256 });
      return candidate;
    } catch (error) {
      this.candidate = null; await this.dispose(candidate);
      if (previous) {
        previous.frame.hidden = false;
        try { await previous.api.play(); }
        catch (rollbackError) { this.report('session.rollback.audio', { generation: previous.id, message: rollbackError.message }); }
      }
      this.report('session.rollback', { failed_generation: candidate.id, retained_generation: previous?.id ?? null, message: error.message });
      throw error;
    }
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
