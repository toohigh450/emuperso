// SPDX-License-Identifier: MIT
import { findCoreOptionLine, coreOptionLists, coreOptionKeys, coreOptionCurrent } from './core-options.mjs';
import { contentStartupError } from './startup-error.mjs';
// One disposable browser realm per engine session. No ROM or save is uploaded.
import { computeInputs, padType } from './input-profile.mjs';
import { watchTouch } from './touch-editor.mjs';
// Tactile (mandat Controller V2) : masqué quand une manette est branchée, boutons déplaçables ; réglé par la page.
export const PS1_TOUCH_KEY = 'emuperso-ps1-touch';
let touchWatch = null;
const contexts = new Set();
let emulator = null, romURL = null, closed = false, notify = () => {}, sessionId = null;
let startupFailure = null;
let cheatsQuarantined = false;
function requireTrustedCheats() {
  if (cheatsQuarantined) throw new Error('Moteur en quarantaine : captures et réactivation refusées. Recréez une session saine.');
}
async function quarantineCheats() {
  cheatsQuarantined = true;
  note('cheats.quarantined', { captures_blocked: true, recovery: 'new-realm' });
  await pause();
}
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
  if (startupFailure) throw new Error(startupFailure);
  if (closed || !emulator?.started || !emulator.gameManager) throw new Error('Session moteur non disponible.');
  return emulator.gameManager;
}
function snapshot() {
  return { session_id: sessionId, closed, started: !!emulator?.started, paused: emulator?.paused ?? true,
    frame: emulator?.gameManager?.getFrameNum?.() ?? 0,
    startup_failure: startupFailure, cheats_quarantined: cheatsQuarantined,
    contexts: [...contexts].map(context => ({ state: context.state, sample_rate: context.sampleRate })) };
}
async function resumeAudio() {
  requireTrustedCheats();
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
  requireTrustedCheats();
  gm().toggleFastForward(0); gm().toggleSlowMotion(0); emulator.play();
  await resumeAudio();
}
async function close() {
  if (closed) return snapshot();
  inputProfile = null; cancelAnimationFrame(inputRaf); touchWatch?.stop();
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
  const rawStr = typeof raw === 'string' ? raw : (raw == null ? null : (() => { try { return JSON.stringify(raw); } catch { return '[non-sérialisable]'; } })());
  inputState.core_options_raw = rawStr == null
    ? { present: false, type: typeof raw }
    : { present: true, type: typeof raw, length: rawStr.length, lines: rawStr.split('\n').length,
        sample: rawStr.slice(0, 200), mentions_pad: /pad1type/i.test(rawStr) };
  const line = findCoreOptionLine(raw, 'pcsx_rearmed_pad1type');
  const optInfo = coreOptionLists(raw, 'pcsx_rearmed_pad1type', wanted);
  Object.assign(inputState, { pad_type_requested: wanted, pad_type_listed: optInfo.listed, pad_type_reported: coreOptionCurrent(raw, 'pcsx_rearmed_pad1type'), pad_type_verified: false, core_option_line: line?.slice(0, 300) ?? null });
  const snapshotControls = () => Object.fromEntries(Array.from({ length: 24 }, (_, i) => [i, live?.[i] ? { key: live[i].value ?? '', pad: live[i].value2 ?? '' } : null]));
  note('input.verify', { requested_pad_type: wanted, core_option_line: inputState.core_option_line, controls: live ? snapshotControls() : 'table-illisible' });
  if (profile.native) { Object.assign(inputState, { mode: 'native', reason: 'Commandes natives d’EmulatorJS (choix de l’utilisateur).' }); return; }
  let bound = live ? Object.keys(snapshotControls()).filter(i => live[i]?.value2) : [];
  if (bound.length) { for (const i of bound) live[i].value2 = ''; bound = Object.keys(snapshotControls()).filter(i => live[i]?.value2); }
  if (bound.length) { Object.assign(inputState, { mode: 'native', reason: 'Liaisons manette natives impossibles à retirer (' + bound.join(',') + ') : ma disposition est désactivée pour éviter les doubles commandes.' }); return; }
  inputProfile = profile; sentInputs.clear(); inputRaf = requestAnimationFrame(pollInputs);
  inputState.mode = 'custom';
  inputState.reason = (live ? '' : 'Table des commandes du moteur illisible : doubles commandes possibles. ') + (line ? (inputState.pad_type_listed ? '' : 'Valeur « ' + wanted + ' » absente de l’option du cœur. ') : 'Le cœur utilise les périphériques libretro, non exposés par ce runtime : type de manette demandé non vérifié. ');
}
const baseStem = name => String(name).split('/').pop().replace(/\.[^.]+$/, '');
function heap() {
  const m = performance.memory;
  return m ? { js_heap_used_mib: Math.round(m.usedJSHeapSize / 1048576), js_heap_limit_mib: Math.round(m.jsHeapSizeLimit / 1048576) } : {};
}
async function start(config, callback) {
  if (emulator || closed) throw new Error('Une session isolée ne peut démarrer qu’une seule fois.');
  notify = callback; sessionId = config.sessionId;
  window.EJS_DEBUG_XX = true;
  for (const name of ['emulator.js', 'nipplejs.js', 'shaders.js', 'storage.js', 'gamepad.js', 'GameManager.js', 'socket.io.min.js', 'compression.js']) await loadScript(name);
  // Observer la vraie décompression du JEU, pas celle du cœur. Les fichiers vendor
  // restent inchangés et vérifiables par le lock. Ces mesures ne bornent pas le pic.
  const originalCompression = window.EmulatorJS.prototype.checkCompression;
  window.EmulatorJS.prototype.checkCompression = async function(data, message, fileCallback) {
    if (!/\.(rar|zip|7z)$/i.test(config.file?.name ?? '') || message !== this.localization('Decompress Game Data', false))
      return originalCompression.call(this, data, message, fileCallback);
    const started = performance.now(); let files = 0, expandedBytes = 0;
    note('engine.archive.decompression.before', { compressed_bytes: data.byteLength, ...heap() });
    const measuredCallback = (name, bytes) => {
      files++; expandedBytes += bytes.byteLength;
      return fileCallback(name, bytes);
    };
    try {
      const result = await originalCompression.call(this, data, message, typeof fileCallback === 'function' ? measuredCallback : fileCallback);
      if (typeof fileCallback !== 'function') for (const bytes of Object.values(result)) { files++; expandedBytes += bytes.byteLength; }
      note('engine.archive.decompression.after', { compressed_bytes: data.byteLength, expanded_bytes: expandedBytes, files,
        ms: Math.round(performance.now() - started), peak_measured: false, ...heap() });
      return result;
    } catch (error) {
      note('engine.archive.decompression.failed', { message: String(error.message ?? error), files, expanded_bytes: expandedBytes, ...heap() });
      throw error;
    }
  };
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
  const originalInitModule = window.EmulatorJS.prototype.initModule;
  window.EmulatorJS.prototype.initModule = function(...args) {
    const runtime = window.EJS_Runtime;
    window.EJS_Runtime = options => {
      const observe = message => {
        const failure = contentStartupError(message);
        if (failure) { startupFailure = failure; note('engine.content.rejected', { message: failure }); }
      };
      return runtime({ ...options,
        print: message => { observe(message); options.print?.(message); },
        printErr: message => { observe(message); options.printErr?.(message); },
      });
    };
    return originalInitModule.apply(this, args);
  };
  window.EmulatorJS.prototype.setupSettingsMenu = function(...args) {
    let rawOptions = null;
    try { rawOptions = this.gameManager.getCoreOptions(); }
    catch (error) { note('input.options.failed', { message: String(error.message || error) }); }
    const coreKeys = coreOptionKeys(rawOptions);
    this.config.hideSettings = [...coreKeys, 'webgl2Enabled', 'ejs_threads', 'fastForward', 'ff-ratio', 'slowMotion', 'sm-ratio', 'rewind', 'rewind-granularity', 'vsync', 'save-state-slot', 'save-state-location', 'save-save-interval'];
    return originalSettings.apply(this, args);
  };
  const originalStart = window.EmulatorJS.prototype.startGame;
  window.EmulatorJS.prototype.startGame = function() {
    if (config.battery?.length) {
      // Une archive place le jeu dans un sous-dossier (« Jeu (USA)/Jeu (USA).cue ») ; le cœur
      // nomme la sauvegarde d'après le seul nom de fichier.
      const stem = baseStem(this.fileName);
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
  // Commandes tactiles PS1 (mandat Controller V2) : le moteur affichait la manette générique Y/X/B/A, sans
  // L1/R1/L2/R2. △ ○ ✕ □ (PCSX : △ = X, ○ = A, ✕ = B, □ = Y), croix, stick analogique, gâchettes, Select/Start ;
  // sans Fast/Slow. Les profils de manette physique (input-presets.mjs) ne changent pas.
  const PS1_TOUCH = [
    { type: 'button', text: '△', id: 'triangle', location: 'right', left: 40, top: 0, bold: true, input_value: 9 },
    { type: 'button', text: '□', id: 'square', location: 'right', left: 0, top: 40, bold: true, input_value: 1 },
    { type: 'button', text: '○', id: 'circle', location: 'right', left: 81, top: 40, bold: true, input_value: 8 },
    { type: 'button', text: '✕', id: 'cross', location: 'right', left: 40, top: 80, bold: true, input_value: 0 },
    { type: 'dpad', id: 'dpad', location: 'left', left: '50%', top: '-40%', joystickInput: false, inputValues: [4, 5, 6, 7] },
    { type: 'zone', id: 'stick', location: 'left', left: '40%', top: '120%', joystickInput: true, inputValues: [16, 17, 18, 19] },
    { type: 'button', text: 'L1', id: 'l1', block: true, location: 'top', left: 10, top: -90, bold: true, input_value: 10 },
    { type: 'button', text: 'L2', id: 'l2', block: true, location: 'top', left: 70, top: -90, bold: true, input_value: 12 },
    { type: 'button', text: 'R2', id: 'r2', block: true, location: 'top', right: 135, top: -90, bold: true, input_value: 13 },
    { type: 'button', text: 'R1', id: 'r1', block: true, location: 'top', right: 75, top: -90, bold: true, input_value: 11 },
    { type: 'button', text: 'Select', id: 'select', location: 'center', left: -5, fontSize: 15, block: true, input_value: 2 },
    { type: 'button', text: 'Start', id: 'start', location: 'center', left: 60, fontSize: 15, block: true, input_value: 3 },
  ];
  const options = {
    VirtualGamepadSettings: PS1_TOUCH,
    gameUrl: romURL, dataPath: 'vendor/data/', system: 'pcsx_rearmed', gameName: config.gameName,
    startOnLoad: true, ...(profile.native ? {} : { defaultControllers }), threads: false, language: 'en-US', shaders: window.EJS_SHADERS,
    disableDatabases: true, disableLocalStorage: true, cacheLimit: 0, volume: 0.45,
    defaultOptions: { webgl2Enabled: config.legacy ? 'disabled' : 'enabled', ejs_threads: 'disabled' },
    buttonOpts: { rightClick: false, saveState: false, loadState: false, quickSave: false, quickLoad: false,
      saveSavFiles: false, loadSavFiles: false, cheat: false, restart: false, exitEmulation: false, netplay: false }
  };
  emulator = new window.EmulatorJS('#game', options); window.EJS_emulator = emulator;
  touchWatch = watchTouch({ key: PS1_TOUCH_KEY, emulator: () => (closed ? null : emulator) });
  window.EMUPERSO_editTouch = () => touchWatch.edit();
  emulator.storage.states = new window.EJS_DUMMYSTORAGE();
  emulator.on('ready', () => note('engine.ready'));
  emulator.on('start', () => note('engine.start.callback'));
  emulator.on('exit', () => note('engine.exit'));
  // Une archive est décompressée en mémoire par le moteur avant le démarrage : délai étendu
  // et progression du moteur (« Decompress Game Data NN% ») recopiée dans le diagnostic.
  const archive = /\.(rar|zip|7z)$/i.test(config.file?.name ?? '');
  const t0 = performance.now(), deadline = t0 + (archive ? 300000 : 45000);
  let lastText = '', lastNote = 0;
  if (archive) note('engine.archive.start', { name: config.file.name, size: config.file.size, ...heap() });
  while (!closed && (!emulator.started || !emulator.gameManager || emulator.gameManager.getFrameNum() < 5)) {
    if (startupFailure) throw new Error(startupFailure);
    if (performance.now() > deadline || emulator.failedToStart) throw new Error(archive
      ? 'Le moteur n’a pas fini de décompresser et démarrer l’archive dans le délai prévu (5 min). Mémoire insuffisante possible : essayez la version décompressée.'
      : 'Le moteur n’a pas confirmé son démarrage dans le délai prévu.');
    const text = archive ? String(emulator.textElem?.innerText ?? '') : '';
    if (text && text !== lastText && performance.now() - lastNote > 2000) {
      lastText = text; lastNote = performance.now();
      note('engine.archive.progress', { text: text.slice(0, 80), ms: Math.round(performance.now() - t0), ...heap() });
    }
    await wait(50);
  }
  if (archive) note('engine.archive.done', { file_in_archive: emulator.fileName, ms: Math.round(performance.now() - t0), ...heap() });
  if (startupFailure) throw new Error(startupFailure);
  if (closed) throw new Error('Session interrompue.');
  if (config.battery?.length) {
    const actual = emulator.gameManager.getSaveFilePath();
    const expected = '/data/saves/PCSX-ReARMed/' + baseStem(emulator.fileName) + '.srm';
    if (actual !== expected) throw new Error('Chemin de sauvegarde native différent du chemin préparé.');
    note('battery.injected', { bytes: config.battery.length });
  }
  verifyInput(profile);
  return snapshot();
}
function captureState() { requireTrustedCheats(); return new Uint8Array(gm().getState()); }
function captureBattery() {
  requireTrustedCheats();
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
  requireTrustedCheats();
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
  captureBattery, loadState, setCheats, quarantineCheats, inputStatus: () => ({ ...inputState }),
  capabilities: () => {
    const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2');
    const supported = !!gl; gl?.getExtension('WEBGL_lose_context')?.loseContext(); return { webgl2: supported };
  }
});
