// SPDX-License-Identifier: MIT
// One disposable browser realm per engine session. No ROM or save is uploaded.
import { inspectNativeState, makeRestoreWitness, compareRestoreWitness } from './native-state.mjs';
import { sriValue, verifyRuntimeBytes } from './runtime-integrity.mjs';
const contexts = new Set();
let emulator = null, romURL = null, closed = false, notify = () => {}, sessionId = null;
const note = (type, data = {}) => { if (!closed) notify(type, data); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const failure = (code, message) => Object.assign(new Error(message), { code });
async function bounded(promise, milliseconds, code, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(failure(code, message)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
let restoreAttempt = null;
for (const level of ['log', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    const text = args.filter(value => typeof value === 'string').join(' ');
    if (restoreAttempt && /(?:\[ERROR\]|not a valid.*savestate|failed.{0,80}(?:state|file)|(?:state|savestate).{0,80}(?:failed|invalid|error|cannot))/i.test(text)) {
      restoreAttempt.errors.push(text.slice(0, 500));
      note('state.native.rejected', { code: 'E_NATIVE_REJECTED', message: 'Le cœur a signalé une erreur pendant le chargement.' });
    }
    original(...args);
  };
}
const NativeContext = window.AudioContext;
if (NativeContext) {
  window.AudioContext = class extends NativeContext {
    constructor(...args) {
      super(...args); contexts.add(this);
      note('audio.context.created', { state: this.state, sample_rate: this.sampleRate });
      this.addEventListener('statechange', () => note('audio.context.state', { state: this.state }));
    }
  };
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
}
const nativeContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
  const result = nativeContext.call(this, kind, ...args);
  if (result && /^(webgl|webgl2|experimental-webgl)$/.test(kind)) {
    note('video.context.created', { kind });
    this.addEventListener('webglcontextlost', () => note('video.context.lost'));
  }
  return result;
};
for (const method of ['instantiate', 'instantiateStreaming']) {
  const original = WebAssembly[method];
  if (original) WebAssembly[method] = async function(...args) {
    const value = await original.apply(this, args);
    note('wasm.instantiated', { method, export_count: Object.keys(value.instance?.exports ?? value.exports ?? {}).length });
    return value;
  };
}
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, options) => String(input) === 'https://cdn.emulatorjs.org/stable/data/version.json'
  ? nativeFetch('vendor/data/version.json', options) : nativeFetch(input, options);
window.addEventListener('error', event => note('browser.error', { message: event.message }));
window.addEventListener('unhandledrejection', event => note('browser.unhandledrejection', { message: String(event.reason) }));
window.addEventListener('gamepadconnected', event => note('gamepad.connected', { id: event.gamepad.id, mapping: event.gamepad.mapping }));

function loadScript(name, files) {
  return new Promise((resolve, reject) => {
    const resource = 'data/src/' + name, hash = files[resource];
    const script = document.createElement('script');
    const timer = setTimeout(() => { script.remove(); reject(failure('E_RUNTIME_SCRIPT_TIMEOUT', 'Le chargement d’une dépendance moteur a expiré : ' + name)); }, 10000);
    script.integrity = sriValue(hash); script.crossOrigin = 'anonymous'; script.src = 'vendor/' + resource;
    script.onload = () => { clearTimeout(timer); note('integrity.resource.verified', { resource, sha256: hash, mechanism: 'browser-sri' }); resolve(); };
    script.onerror = () => { clearTimeout(timer); reject(failure('E_RUNTIME_SCRIPT', 'Dépendance moteur absente, altérée ou refusée : ' + name)); };
    document.head.appendChild(script);
  });
}
function gm() {
  if (closed || !emulator?.started || !emulator.gameManager) throw new Error('Session moteur non disponible.');
  return emulator.gameManager;
}
function snapshot() {
  return { session_id: sessionId, closed, started: !!emulator?.started, paused: emulator?.paused ?? true,
    frame: emulator?.gameManager?.getFrameNum?.() ?? 0,
    contexts: [...contexts].map(context => ({ state: context.state, sample_rate: context.sampleRate })) };
}
async function resumeAudio() {
  await Promise.allSettled([...contexts].filter(context => context.state === 'suspended').map(context =>
    Promise.race([context.resume(), wait(1000)])));
  if ([...contexts].some(context => context.state === 'suspended')) note('audio.resume.pending', { action: 'Cliquer Activer / reprendre l’audio.' });
  return snapshot().contexts;
}
async function pause() {
  if (emulator?.started) emulator.pause();
  for (const context of contexts) if (context.state === 'running') {
    await bounded(context.suspend(), 1200, 'E_AUDIO_SUSPEND_TIMEOUT', 'Le système audio n’a pas confirmé sa mise en pause. Chargement annulé ; la partie et les sauvegardes sont conservées. Réactivez l’audio puis réessayez.');
  }
}
async function play() {
  gm().toggleFastForward(0); gm().toggleSlowMotion(0); emulator.play();
  await resumeAudio();
}
async function close() {
  if (closed) return snapshot();
  if (emulator?.gameManager) {
    try { emulator.gameManager.resetCheat(); emulator.gameManager.toggleMainLoop(0); } catch {}
    try { emulator.Module.pauseMainLoop?.(); } catch {}
  }
  await Promise.allSettled([...contexts].map(context => context.state !== 'closed' ? context.close() : undefined));
  closed = true;
  if (romURL) URL.revokeObjectURL(romURL);
  const result = snapshot();
  // Release links between the detached realm, its large Wasm heap and parent
  // callbacks instead of relying solely on eventual iframe garbage collection.
  if (emulator) { emulator.storage = null; emulator.gameManager = null; emulator.Module = null; }
  emulator = null; window.EJS_emulator = null; notify = () => {}; contexts.clear();
  return result;
}

async function start(config, callback) {
  if (emulator || closed) throw new Error('Une session isolée ne peut démarrer qu’une seule fois.');
  notify = callback; sessionId = config.sessionId;
  window.EJS_DEBUG_XX = true;
  for (const name of ['emulator.js', 'nipplejs.js', 'shaders.js', 'storage.js', 'gamepad.js', 'GameManager.js', 'socket.io.min.js', 'compression.js']) {
    await loadScript(name, config.runtimeFiles);
    if (closed) throw failure('E_SESSION_CLOSED', 'Session interrompue pendant la préparation.');
  }
  const originalDownload = window.EmulatorJS.prototype.downloadFile;
  window.EmulatorJS.prototype.downloadFile = async function(path, progress, notWithPath, options = {}) {
    if (typeof path !== 'string' || path.startsWith('blob:') || path.startsWith('data:')) return originalDownload.call(this, path, progress, notWithPath, options);
    const base = new URL(this.config.dataPath, location.href), url = new URL(notWithPath ? path : base.href + path, location.href);
    if (url.origin !== location.origin || !url.href.startsWith(base.href)) {
      this.failedToStart = true;
      throw failure('E_RUNTIME_EXTERNAL', 'Une dépendance moteur extérieure à cette livraison a été refusée.');
    }
    const resource = 'data/' + url.href.slice(base.href.length).split('?')[0];
    try {
      const response = await nativeFetch(url, { method: options.method ?? 'GET', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw failure('E_RUNTIME_HTTP', 'Dépendance moteur indisponible : ' + resource);
      if (options.method === 'HEAD') return { headers: Object.fromEntries(response.headers) };
      const buffer = await response.arrayBuffer();
      const hash = await verifyRuntimeBytes(buffer, config.runtimeFiles[resource], resource);
      note('integrity.resource.verified', { resource, sha256: hash, mechanism: 'actual-response-bytes' });
      let data = buffer;
      if (options.responseType === 'text') { data = new TextDecoder().decode(buffer); try { data = JSON.parse(data); } catch {} }
      if (progress) progress(' 100%');
      return { data, headers: Object.fromEntries(response.headers) };
    } catch (error) {
      this.failedToStart = true;
      note('integrity.resource.failed', { resource, code: error.code ?? 'E_RUNTIME_FETCH', message: error.message });
      return -1;
    }
  };
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/data/emulator.css'; css.integrity = sriValue(config.runtimeFiles['data/emulator.css']); css.crossOrigin = 'anonymous'; document.head.appendChild(css);
  // Own adapter: keep the unmodified vendor files hash-verifiable. The engine's
  // automatic IDBFS writes are replaced by a session-local MEMFS directory.
  const OriginalManager = window.EJS_GameManager;
  window.EJS_GameManager = class extends OriginalManager {
    async mountFileSystems() { this.mkdir('/data'); this.mkdir('/data/saves'); }
    loadState() { note('state.unguarded.blocked', { source: 'vendor-wrapper' }); return false; }
    quickLoad() { note('state.unguarded.blocked', { source: 'quick-load' }); return false; }
    setVariable(option, value) {
      if (this.EJS.started) { note('config.change.blocked', { option }); return; }
      return super.setVariable(option, value);
    }
    simulateInput(player, index, value) {
      if (index >= 24 && index <= 29) return; // no unguarded quick-load / speed toggles
      return super.simulateInput(player, index, value);
    }
  };
  document.addEventListener('drop', event => { event.preventDefault(); event.stopImmediatePropagation(); note('state.unguarded.blocked', { source: 'drop' }); }, true);
  document.addEventListener('dragover', event => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
  const originalSettings = window.EmulatorJS.prototype.setupSettingsMenu;
  window.EmulatorJS.prototype.setupSettingsMenu = function(...args) {
    const coreKeys = (this.gameManager.getCoreOptions() || '').split('\n').map(line => line.split('; ')[0].split('|')[0]).filter(Boolean);
    this.config.hideSettings = [...coreKeys, 'webgl2Enabled', 'ejs_threads', 'fastForward', 'ff-ratio', 'slowMotion', 'sm-ratio', 'rewind', 'rewind-granularity', 'vsync', 'save-state-slot', 'save-state-location', 'save-save-interval'];
    return originalSettings.apply(this, args);
  };
  const originalStart = window.EmulatorJS.prototype.startGame;
  window.EmulatorJS.prototype.startGame = function() {
    if (config.battery?.length) {
      const stem = this.fileName.replace(/\.[^.]+$/, '');
      this.gameManager.writeFile('/data/saves/Mupen64Plus-Next/' + stem + '.srm', new Uint8Array(config.battery));
    }
    originalStart.call(this);
  };
  romURL = URL.createObjectURL(new Blob([config.bytes], { type: 'application/octet-stream' }));
  const options = {
    gameUrl: romURL, dataPath: 'vendor/data/', system: 'mupen64plus_next', gameName: config.gameName,
    startOnLoad: true, threads: false, language: 'en-US', shaders: window.EJS_SHADERS,
    disableDatabases: true, disableLocalStorage: true, cacheLimit: 0, volume: 0.45,
    defaultOptions: { webgl2Enabled: config.legacy ? 'disabled' : 'enabled', ejs_threads: 'disabled', 'mupen64plus-cpucore': 'pure_interpreter' },
    buttonOpts: { rightClick: false, saveState: false, loadState: false, quickSave: false, quickLoad: false,
      saveSavFiles: false, loadSavFiles: false, cheat: false, restart: false, exitEmulation: false, netplay: false }
  };
  emulator = new window.EmulatorJS('#game', options); window.EJS_emulator = emulator;
  emulator.storage.states = new window.EJS_DUMMYSTORAGE();
  emulator.on('ready', () => note('engine.ready'));
  emulator.on('start', () => note('engine.start.callback'));
  emulator.on('exit', () => note('engine.exit'));
  const deadline = performance.now() + 45000;
  while (!closed && (!emulator.started || !emulator.gameManager || emulator.gameManager.getFrameNum() < 5)) {
    if (performance.now() > deadline || emulator.failedToStart) throw new Error('Le moteur n’a pas confirmé son démarrage dans le délai prévu.');
    await wait(50);
  }
  if (closed) throw new Error('Session interrompue.');
  if (config.battery?.length) {
    const actual = emulator.gameManager.getSaveFilePath();
    const expected = '/data/saves/Mupen64Plus-Next/' + emulator.fileName.replace(/\.[^.]+$/, '') + '.srm';
    if (actual !== expected) throw new Error('Chemin de sauvegarde native différent du chemin préparé.');
    note('battery.injected', { bytes: config.battery.length });
  }
  return snapshot();
}
function captureState() { return new Uint8Array(gm().getState()); }
function captureBattery() {
  const value = gm().getSaveFile();
  return value?.length ? new Uint8Array(value) : null;
}
async function waitFrames(manager, count, milliseconds = 3000) {
  const before = manager.getFrameNum(), deadline = performance.now() + milliseconds;
  while (manager.getFrameNum() - before < count) {
    if (closed || performance.now() > deadline) throw failure('E_RESTORE_STALLED', 'Le moteur ne progresse plus pendant la vérification. Chargement annulé ; la session précédente est conservée.');
    await wait(20);
  }
}
async function loadState(bytes) {
  const manager = gm(), input = new Uint8Array(bytes);
  const expected = inspectNativeState(input);
  const path = '/hub-verified-state-' + crypto.randomUUID() + '.bin';
  const attempt = { errors: [], ranges: [], consumed_bytes: 0 };
  const originalRead = manager.FS.read;
  let trackedRead, nativeStatus, stage = 'prepare-memory-witness';
  try {
    await pause();
    const beforeA = captureState();
    await play(); await waitFrames(manager, 2); await wait(250); await pause();
    const beforeB = captureState(), fresh = inspectNativeState(beforeB);
    if (expected.rom_md5 !== fresh.rom_md5 || expected.core_version !== fresh.core_version) {
      throw failure('E_RESTORE_NATIVE_IDENTITY', 'Le format natif ou l’identité interne de cet état diffère du jeu lancé. Aucune sauvegarde modifiée.');
    }
    const witness = makeRestoreWitness(input, beforeA, beforeB);
    note('state.witness.prepared', { anchors: witness.total, strong: witness.strong, already_equivalent: witness.already_equivalent });
    manager.toggleFastForward(0); manager.toggleSlowMotion(0); manager.clearEJSResetTimer();
    manager.FS.writeFile(path, input);
    // Observe actual reads by the native frontend. A fresh session naturally
    // reaching the same RAM values is not proof that it consumed this state.
    trackedRead = function(stream, buffer, offset, length, position, ...rest) {
      const start = position === undefined ? stream.position : position;
      const count = originalRead.call(this, stream, buffer, offset, length, position, ...rest);
      if (stream.path === path && count > 0) {
        if (!Number.isSafeInteger(start) || start < 0 || start + count > input.length) {
          attempt.errors.push('Native state read outside verified payload.');
        } else {
          let matches = true;
          for (let i = 0; i < count; i++) if ((buffer[offset + i] & 255) !== input[start + i]) { matches = false; break; }
          if (!matches) attempt.errors.push('Native state read differs from verified payload.');
          else {
            attempt.ranges.push([start, start + count]);
            attempt.ranges.sort((a, b) => a[0] - b[0]);
            let end = 0;
            for (const range of attempt.ranges) { if (range[0] > end) break; end = Math.max(end, range[1]); }
            attempt.consumed_bytes = end;
            if (end === input.length && !attempt.immediateScheduled) {
              attempt.immediateScheduled = true;
              // Run only after the current native call stack has returned.
              // Observe, without changing RAM, whether its complete contents
              // match before another animation-frame iteration can advance it.
              queueMicrotask(() => {
                if (closed || restoreAttempt !== attempt) return;
                try {
                  const observed = inspectNativeState(captureState()).rdram;
                  let different = 0;
                  for (let i = 0; i < observed.length; i++) if (observed[i] !== expected.rdram[i]) different++;
                  attempt.immediate = { exact_rdram: different === 0, different_bytes: different, bytes: observed.length };
                  note('state.memory.immediate.observed', attempt.immediate);
                } catch (error) { note('state.memory.immediate.unavailable', { message: error.message }); }
              });
            }
          }
        }
      }
      return count;
    };
    manager.FS.read = trackedRead;
    restoreAttempt = attempt; stage = 'native-load';
    nativeStatus = manager.functions.loadState(path, 0);
    note('state.native.return', { native_status: nativeStatus, success_inferred: false });
    // The frontend queues this operation; its integer return is NOT an ACK.
    // Observe the serialized RDRAM of the actual running core, without changing it.
    emulator.play(); const audio = resumeAudio();
    stage = 'verify-rdram';
    const deadline = performance.now() + 6000; let proof = null, lastObserved = null;
    while (!closed && performance.now() < deadline) {
      await wait(16);
      if (attempt.errors.length) throw failure('E_NATIVE_REJECTED', 'Le cœur a refusé le chargement de cet état. La partie précédente et le coffre restent conservés.');
      const observed = compareRestoreWitness(witness, captureState());
      lastObserved = observed;
      if (attempt.consumed_bytes === input.length && (observed.verified || observed.equivalent)) { proof = observed; break; }
    }
    if (!proof) {
      note('state.verify.unconfirmed', { native_payload_read_bytes: attempt.consumed_bytes,
        native_payload_expected_bytes: input.length, witness: lastObserved, anchors: witness.total });
      throw failure('E_RESTORE_UNCONFIRMED', 'La mémoire du jeu n’a pas confirmé la restauration dans le délai prévu. Chargement annulé ; aucune sauvegarde écrasée. Exportez le diagnostic pour analyse.');
    }
    stage = 'verify-progress';
    const before = manager.getFrameNum(), startTime = performance.now();
    await waitFrames(manager, 2);
    const after = manager.getFrameNum(), elapsed = performance.now() - startTime;
    if (attempt.errors.length) throw failure('E_NATIVE_REJECTED', 'Le cœur a signalé une erreur après désérialisation. La session précédente est conservée.');
    await audio;
    const result = { native_status: nativeStatus, frame_before: before, frame_after: after,
      observed_elapsed_ms: elapsed, native_payload_read_bytes: attempt.consumed_bytes,
      native_payload_expected_bytes: input.length, memory: proof, already_equivalent: !!proof.already_equivalent,
      immediate_memory: attempt.immediate ?? null,
      contexts: snapshot().contexts };
    note(proof.verified ? 'state.memory.verified' : 'state.memory.equivalent', result);
    return result;
  } catch (error) {
    note('state.restore.failed', { code: error.code ?? 'E_RESTORE', stage, message: error.message });
    throw error;
  } finally {
    restoreAttempt = null;
    if (manager.FS.read === trackedRead) manager.FS.read = originalRead;
    try { manager.FS.unlink(path); } catch {}
  }
}
function setCheats(cheats) {
  const manager = gm(); manager.resetCheat();
  cheats.forEach((cheat, index) => manager.setCheat(index, true, cheat.code));
  note('cheats.applied', { count: cheats.length });
}
window.N64Engine = Object.freeze({ start, close, pause, play, resumeAudio, snapshot, captureState,
  captureBattery, loadState, setCheats,
  capabilities: () => {
    const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2');
    const supported = !!gl; gl?.getExtension('WEBGL_lose_context')?.loseContext(); return { webgl2: supported };
  }
});
