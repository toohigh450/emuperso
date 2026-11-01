// SPDX-License-Identifier: MIT
import { findCoreOptionLine, coreOptionLists } from './core-options.mjs';
// One disposable browser realm per engine session. No ROM or save is uploaded.
import { computeInputs, padType } from './input-profile.mjs';
const contexts = new Set();
let emulator = null, romURL = null, closed = false, notify = () => {}, sessionId = null;
const note = (type, data = {}) => { if (!closed) notify(type, data); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
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

function loadScript(name) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'vendor/data/src/' + name;
    script.onload = resolve; script.onerror = () => reject(new Error('Dépendance locale absente : ' + name));
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
  for (const context of contexts) if (context.state === 'running') await context.suspend();
}
async function play() {
  gm().toggleFastForward(0); gm().toggleSlowMotion(0); emulator.play();
  await resumeAudio();
}
async function close() {
  if (closed) return snapshot();
  inputProfile = null; cancelAnimationFrame(inputRaf);
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

const inputState = { mode: 'native', reason: 'Commandes natives EmulatorJS.', pad_type_requested: 'standard', pad_type_listed: null };
let inputRaf = 0, inputProfile = null, padId = null; const sentInputs = new Map();
function pollInputs() {
  if (closed || !inputProfile) return;
  try {
    const pads = [...(navigator.getGamepads?.() ?? [])].filter(item => item?.connected), pad = pads.find(item => item.mapping === 'standard') ?? pads[0] ?? null;
    if ((pad?.id ?? null) !== padId) { padId = pad?.id ?? null; note('input.pad', { id: padId, mapping: pad?.mapping ?? null }); }
    const manager = emulator?.gameManager;
    if (manager) for (const [id, value] of Object.entries(computeInputs(pad, inputProfile))) if (sentInputs.get(id) !== value) { sentInputs.set(id, value); manager.simulateInput(0, Number(id), value); }
    inputRaf = requestAnimationFrame(pollInputs);
  } catch (error) { inputProfile = null; inputState.mode = 'disabled'; inputState.reason = 'Erreur du lecteur de manette : ' + error.message; note('input.error', { message: error.message }); }
}
function verifyInput(profile) {
  const manager = gm(), live = emulator.controls?.[0], wanted = padType(profile);
  // Instrumentation (audit RC-1.9) : si l'option « reste introuvable », capturer le
  // FORMAT BRUT réellement renvoyé par le cœur pour savoir pourquoi, sans exposer
  // tout le contenu. Le prochain diagnostic terrain révélera le vrai format.
  const raw = (() => { try { return manager.getCoreOptions?.() ?? null; } catch (e) { return `ERREUR:${e.message}`; } })();
  const rawStr = typeof raw === 'string' ? raw : (raw == null ? null : JSON.stringify(raw));
  inputState.core_options_raw = rawStr == null
    ? { present: false, type: typeof raw }
    : { present: true, type: typeof raw, length: rawStr.length, lines: rawStr.split('\n').length,
        sample: rawStr.slice(0, 200), mentions_pad: /pad1type/i.test(rawStr) };
  const line = findCoreOptionLine(rawStr ?? '', 'pcsx_rearmed_pad1type');
  const optInfo = coreOptionLists(rawStr ?? '', 'pcsx_rearmed_pad1type', wanted);
  Object.assign(inputState, { pad_type_requested: wanted, pad_type_listed: optInfo.listed, core_option_line: line?.slice(0, 300) ?? null });
  const snapshotControls = () => Object.fromEntries(Array.from({ length: 24 }, (_, i) => [i, live?.[i] ? { key: live[i].value ?? '', pad: live[i].value2 ?? '' } : null]));
  note('input.verify', { requested_pad_type: wanted, core_option_line: inputState.core_option_line, controls: live ? snapshotControls() : 'table-illisible' });
  if (profile.native) { Object.assign(inputState, { mode: 'native', reason: 'Commandes natives d’EmulatorJS (choix de l’utilisateur).' }); return; }
  let bound = live ? Object.keys(snapshotControls()).filter(i => live[i]?.value2) : [];
  if (bound.length) { for (const i of bound) live[i].value2 = ''; bound = Object.keys(snapshotControls()).filter(i => live[i]?.value2); }
  if (bound.length) { Object.assign(inputState, { mode: 'native', reason: 'Liaisons manette natives impossibles à retirer (' + bound.join(',') + ') : ma disposition est désactivée pour éviter les doubles commandes.' }); return; }
  inputProfile = profile; sentInputs.clear(); inputRaf = requestAnimationFrame(pollInputs);
  inputState.mode = 'custom';
  inputState.reason = (live ? '' : 'Table des commandes du moteur illisible : doubles commandes possibles. ') + (line ? (inputState.pad_type_listed ? '' : 'Valeur « ' + wanted + ' » absente de l’option du cœur. ') : 'Option pcsx_rearmed_pad1type introuvable dans le cœur : type de manette non appliqué. ');
}
async function start(config, callback) {
  if (emulator || closed) throw new Error('Une session isolée ne peut démarrer qu’une seule fois.');
  notify = callback; sessionId = config.sessionId;
  window.EJS_DEBUG_XX = true;
  for (const name of ['emulator.js', 'nipplejs.js', 'shaders.js', 'storage.js', 'gamepad.js', 'GameManager.js', 'socket.io.min.js', 'compression.js']) await loadScript(name);
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/data/emulator.css'; document.head.appendChild(css);
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
      this.gameManager.writeFile('/data/saves/PCSX-ReARMed/' + stem + '.srm', new Uint8Array(config.battery));
    }
    originalStart.call(this);
  };
  romURL = URL.createObjectURL(config.file);
  const profile = config.input ?? { analog: 'off', stickToDpad: true, deadzone: 0.2, native: true };
  const unbound = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [i, { value2: '' }]));
  // Contrat EmulatorJS : defaultControllers doit définir les 4 joueurs (0-3),
  // sinon setupKeys() plante sur this.controls[1] (undefined).
  // Joueur 0 = neutralisé (mapping custom) ; joueurs 1-3 = bindings natifs préservés.
  const defaultControllers = { 0: unbound, 1: {}, 2: {}, 3: {} };
  const options = {
    gameUrl: romURL, dataPath: 'vendor/data/', system: 'pcsx_rearmed', gameName: config.gameName,
    startOnLoad: true, ...(profile.native ? {} : { defaultControllers }), threads: false, language: 'en-US', shaders: window.EJS_SHADERS,
    disableDatabases: true, disableLocalStorage: true, cacheLimit: 0, volume: 0.45,
    defaultOptions: { webgl2Enabled: config.legacy ? 'disabled' : 'enabled', ejs_threads: 'disabled', pcsx_rearmed_pad1type: padType(profile) },
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
    const expected = '/data/saves/PCSX-ReARMed/' + emulator.fileName.replace(/\.[^.]+$/, '') + '.srm';
    if (actual !== expected) throw new Error('Chemin de sauvegarde native différent du chemin préparé.');
    note('battery.injected', { bytes: config.battery.length });
  }
  verifyInput(profile);
  return snapshot();
}
function captureState() { return new Uint8Array(gm().getState()); }
function captureBattery() {
  const value = gm().getSaveFile();
  return value?.length ? new Uint8Array(value) : null;
}
async function loadState(bytes) {
  const manager = gm();
  const input = new Uint8Array(bytes), reference = captureState();
  // PS1 observation: native load_state returns 0 for valid AND invalid payloads. Assumed unreliable for PS1 too:
  // size is checked here and frame progression is checked after the load.
  if (input.length !== reference.length || input.length < 64) {
    throw new Error('Taille de l’état différente de celle du moteur neuf : état incompatible.');
  }
  note('state.header.unchecked', { reason: 'En-tête PS1 non vérifié : taille seulement.' });
  await pause(); manager.toggleFastForward(0); manager.toggleSlowMotion(0);
  manager.clearEJSResetTimer();
  const path = '/hub-verified-state.bin'; manager.FS.writeFile(path, new Uint8Array(bytes));
  let nativeStatus;
  nativeStatus = manager.functions.loadState(path, 0);
  // The native frontend can queue a load task. Keep the verified payload until
  // that task has had time to run, as the pinned upstream wrapper does.
  setTimeout(() => { try { manager.FS.unlink(path); } catch {} }, 5000);
  note('state.native.return', { native_status: nativeStatus });
  await play();
  const before = manager.getFrameNum(); await wait(450); const after = manager.getFrameNum();
  if (after <= before || after - before > 90) throw new Error('Progression du moteur anormale après restauration.');
  return { native_status: nativeStatus, frame_before: before, frame_after: after, contexts: snapshot().contexts };
}
function setCheats(cheats) {
  const manager = gm(); manager.resetCheat();
  try {
    cheats.forEach((cheat, index) => manager.setCheat(index, true, cheat.code));
  } catch (error) {
    // P0-B (audit GPT RC-1.7) : ne jamais laisser d'application partielle.
    // Si setCheat() échoue au milieu de la liste, tout effacer pour un état déterministe.
    try { manager.resetCheat(); } catch {}
    note('cheats.apply_failed', { message: String((error && error.message) || error) });
    throw error;
  }
  note('cheats.applied', { count: cheats.length });
}
window.PS1Engine = Object.freeze({ start, close, pause, play, resumeAudio, snapshot, captureState,
  captureBattery, loadState, setCheats, inputStatus: () => ({ ...inputState }),
  capabilities: () => {
    const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2');
    const supported = !!gl; gl?.getExtension('WEBGL_lose_context')?.loseContext(); return { webgl2: supported };
  }
});
