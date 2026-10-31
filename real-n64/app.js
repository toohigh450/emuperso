// SPDX-License-Identifier: MIT
import { prepareLocalRom, prepareRomBytes } from './rom-file.mjs';
const $ = id => document.getElementById(id), records = [], contexts = new Set();
let phase = 'idle', reading = false, generation = 0, selected = null, activeRom = null, romURL = null, lock = null;
function event(type, data = {}) { records.push({ seq: records.length + 1, utc: new Date().toISOString(), host_monotonic_ms: performance.now(), type, data }); $('log').textContent = JSON.stringify(records, null, 2); }
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function controls() { $('start').disabled = phase !== 'idle'; $('choose-rom').disabled = phase !== 'idle'; $('launch-local').disabled = phase !== 'idle' || reading || !selected; }
function identity(meta) {
  $('rom-name').textContent = meta?.name ?? 'Aucune ROM choisie';
  $('rom-sha').textContent = meta?.canonical_sha256 ?? 'Non lu';
  $('rom-source-sha').textContent = meta?.source_sha256 ?? 'Non lu';
  $('rom-format').textContent = meta ? `${meta.detected_format.toUpperCase()} → Z64 · ${meta.size.toLocaleString('fr-FR')} octets` : 'Non reconnu';
  $('rom-origin').textContent = meta ? meta.source === 'reference-demo' ? 'Démo homebrew de référence' : 'Fichier du PC — lu dans ce navigateur' : 'Aucune';
}
function audioStatus() { $('audio-state').textContent = [...contexts].map(c => `${c.state}, ${c.sampleRate} Hz`).join(' ; ') || 'Aucun contexte créé'; $('audio').disabled = !contexts.size; }
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, options) => { if (String(input) === 'https://cdn.emulatorjs.org/stable/data/version.json') { event('runtime.update_check.local'); return nativeFetch('vendor/data/version.json', options); } return nativeFetch(input, options); };
const NativeAudioContext = window.AudioContext;
if (NativeAudioContext) { window.AudioContext = class extends NativeAudioContext { constructor(...args) { super(...args); contexts.add(this); event('audio.context.created', { sample_rate: this.sampleRate, state: this.state }); this.addEventListener('statechange', () => { audioStatus(); event('audio.context.state', { state: this.state }); }); audioStatus(); } }; if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext; }
const nativeGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (kind, ...args) { const context = nativeGetContext.call(this, kind, ...args); if (context && ['webgl', 'webgl2', 'experimental-webgl'].includes(kind)) { event('video.context.created', { kind }); this.addEventListener('webglcontextlost', () => event('video.context.lost')); } return context; };
for (const method of ['instantiate', 'instantiateStreaming']) { const original = WebAssembly[method]; if (original) WebAssembly[method] = async function (...args) { const result = await original.apply(this, args); event('wasm.instantiated', { method, export_count: Object.keys(result.instance?.exports ?? result.exports ?? {}).length }); return result; }; }
window.addEventListener('error', e => { event('browser.error', { message: e.message, stack: e.error?.stack }); status('Erreur du moteur / navigateur : ' + e.message, true); });
window.addEventListener('unhandledrejection', e => { event('browser.unhandledrejection', { message: String(e.reason), stack: e.reason?.stack }); status('Erreur du moteur / navigateur : ' + e.reason, true); });
window.addEventListener('gamepadconnected', e => { event('gamepad.connected', { id: e.gamepad.id, mapping: e.gamepad.mapping }); $('gamepads').textContent = e.gamepad.id; });
$('audio').onclick = async () => { try { for (const c of contexts) if (c.state === 'suspended') await c.resume(); audioStatus(); event('audio.resume.requested'); } catch (e) { event('audio.resume.failed', { message: e.message }); status(e.message, true); } };
$('choose-rom').onclick = () => { if (phase !== 'idle') return; $('rom-file').value = ''; $('rom-file').click(); };
$('rom-file').onchange = async e => {
  const file = e.target.files[0]; if (!file || phase !== 'idle') return;
  const ticket = ++generation; selected = null; reading = true; identity(null); controls(); status('Lecture et vérification du fichier dans le navigateur…');
  try {
    const prepared = await prepareLocalRom(file);
    if (ticket !== generation || phase !== 'idle') return;
    selected = prepared; identity(prepared.metadata); event('rom.local.selected', prepared.metadata);
    status(prepared.metadata.extension_mismatch ? `En-tête ${prepared.metadata.detected_format.toUpperCase()} détecté malgré l’extension .${prepared.metadata.filename_extension}. La signature est prioritaire. Fichier prêt, compatibilité non vérifiée.` : 'Format reconnu. Le fichier reste local ; vous pouvez lancer la ROM choisie. Compatibilité non vérifiée.');
  } catch (error) { if (ticket === generation && phase === 'idle') { event('rom.local.rejected', { code: error.code ?? 'E_READ', message: error.message }); status(error.message, true); } }
  finally { if (ticket === generation && phase === 'idle') { reading = false; controls(); } }
};
async function launch(source) {
  if (phase !== 'idle' || (source === 'local-file' && (!selected || reading))) return;
  const localChoice = selected; ++generation; reading = false; phase = 'preparing'; selected = null; activeRom = null; lock = null; controls();
  let loaderRequested = false;
  try {
    let prepared;
    if (source === 'reference-demo') {
      identity(null); status('Vérification de la démo homebrew de référence…');
      const response = await fetch('homebrew/fallback-open/build-info.json', { cache: 'no-store' }); if (!response.ok) throw new Error('Démo de référence absente : consultez le guide de préparation.'); lock = await response.json();
      // Fixed reference path: no user filename becomes a server URL.
      const fetched = await fetch('homebrew/fallback-open/demo-emuperso-open.z64', { cache: 'no-store' }); if (!fetched.ok) throw new Error('ROM homebrew compilée absente.');
      prepared = await prepareRomBytes(new Uint8Array(await fetched.arrayBuffer()), 'demo-emuperso-open.z64', source);
      if (prepared.metadata.source_sha256 !== lock.rom.sha256) throw new Error('SHA-256 de la démo différent du relevé de compilation.');
      event('rom.fetched', { bytes: prepared.bytes.length, sha256: prepared.metadata.source_sha256 });
    } else prepared = localChoice;
    activeRom = prepared.metadata; identity(activeRom); event('rom.validated', { ...activeRom, license: source === 'reference-demo' ? 'MIT homebrew reference' : 'Not asserted for local user file' });
    romURL = URL.createObjectURL(new Blob([prepared.bytes], { type: 'application/octet-stream' }));
    window.EJS_player = '#game'; window.EJS_DEBUG_XX = true; window.EJS_core = 'mupen64plus_next';
    window.EJS_gameName = source === 'reference-demo' ? 'DEMO N64 EMUPERSO' : 'EMUPERSO_LOCAL_' + activeRom.canonical_sha256 + '.z64';
    window.EJS_gameUrl = romURL; window.EJS_pathtodata = 'vendor/data/'; window.EJS_startOnLoaded = true; window.EJS_language = 'en-US';
    window.EJS_Buttons = { saveState: false, loadState: false, saveSavFiles: false, loadSavFiles: false, quickSave: false, quickLoad: false, netplay: false };
    window.EJS_threads = false; window.EJS_defaultOptions = { webgl2Enabled: new URLSearchParams(location.search).has('legacy') ? 'disabled' : 'enabled', ejs_threads: 'disabled', 'mupen64plus-cpucore': 'pure_interpreter' };
    window.EJS_disableDatabases = true; window.EJS_disableLocalStorage = true; window.EJS_CacheLimit = 0; window.EJS_volume = 0.45; window.EJS_noAutoFocus = false;
    window.EJS_ready = () => { event('engine.ready'); $('engine-state').textContent = 'Interface EmulatorJS prête ; vidéo à vérifier.'; };
    window.EJS_onGameStart = () => { phase = 'started'; event('engine.start.callback'); $('engine-state').textContent = 'Callback de lancement reçu — mupen64plus_next.'; status('Moteur lancé. Vérifiez l’image et les commandes : la compatibilité du jeu n’est pas déduite de ce callback.'); audioStatus(); };
    window.EJS_onExit = () => { phase = 'exited'; event('engine.exit'); status('Moteur quitté. Rechargez pour changer de ROM.'); };
    const script = document.createElement('script'); script.src = 'vendor/data/loader.js';
    script.onerror = () => { phase = 'error'; status('Dépendances EmulatorJS absentes. Exécutez tools/fetch_runtime.py, puis rechargez.', true); };
    phase = 'loading'; loaderRequested = true; document.body.appendChild(script); event('engine.loader.requested', { core: 'mupen64plus_next', threads: false, source, canonical_sha256: activeRom.canonical_sha256 });
  } catch (error) {
    if (!loaderRequested) { phase = 'idle'; activeRom = null; lock = null; if (romURL) URL.revokeObjectURL(romURL); romURL = null; identity(null); controls(); }
    event('launch.failed', { message: error.message }); status(error.message, true);
  }
}
$('start').onclick = () => launch('reference-demo');
$('launch-local').onclick = () => launch('local-file');
$('reload').onclick = () => { if (confirm('Recharger cet essai pour changer de ROM ? Aucun fichier original ne sera modifié.')) location.reload(); };
window.addEventListener('pagehide', () => { if (romURL) URL.revokeObjectURL(romURL); });
function diagnostic() { return { schema: 'emuperso/real-engine-diagnostic/v1', scope: 'REAL_ENGINE_TRIAL_NOT_SYNTHETIC_LAB', warning: 'Format recognition and engine callbacks do not prove compatibility. No ROM bytes are included.', host: { user_agent: navigator.userAgent, cross_origin_isolated: crossOriginIsolated }, phase, local_selection: selected ? { ...selected.metadata } : null, active_rom: activeRom ? { ...activeRom } : null, rom_build: lock, contexts: [...contexts].map(c => ({ state: c.state, sample_rate: c.sampleRate })), records: structuredClone(records) }; }
$('export').onclick = () => { const u = URL.createObjectURL(new Blob([JSON.stringify(diagnostic(), null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = u; a.download = 'EMUPERSO-moteur-reel-diagnostic.json'; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); };
window.RealN64 = Object.freeze({ diagnostic, version: '0.2.0-local-import' }); event('page.open', { engine_started: false }); controls();
