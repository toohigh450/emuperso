// SPDX-License-Identifier: MIT
import { prepareLocalRom, prepareRomBytes } from './rom-file.mjs';
import { readZipFile, prepareZipRom } from './zip-rom.mjs';
const $ = id => document.getElementById(id), records = [], contexts = new Set();
let phase = 'idle', reading = false, generation = 0, selected = null, activeRom = null, romURL = null, lock = null;
let zipPending = null, importAbort = null;
function event(type, data = {}) { records.push({ seq: records.length + 1, utc: new Date().toISOString(), host_monotonic_ms: performance.now(), type, data }); $('log').textContent = JSON.stringify(records, null, 2); }
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function controls() { $('start').disabled = phase !== 'idle'; $('choose-rom').disabled = phase !== 'idle'; $('launch-local').disabled = phase !== 'idle' || reading || !selected; $('zip-use').disabled = phase !== 'idle' || reading || !zipPending; }
function clearZipChoice() { zipPending = null; $('zip-choice-panel').hidden = true; $('zip-entry').replaceChildren(); }
function invalidateImport() { ++generation; importAbort?.abort(); importAbort = null; clearZipChoice(); reading = false; }
function acceptPrepared(prepared) {
  selected = prepared; identity(prepared.metadata); event('rom.local.selected', prepared.metadata);
  const zipNote = prepared.metadata.source === 'local-zip' ? 'ROM extraite du ZIP dans le navigateur ; CRC vérifié. ' : '';
  status(zipNote + (prepared.metadata.extension_mismatch ? `En-tête ${prepared.metadata.detected_format.toUpperCase()} détecté malgré l’extension .${prepared.metadata.filename_extension}. La signature est prioritaire. Fichier prêt, compatibilité non vérifiée.` : 'Format reconnu. Le fichier reste local ; vous pouvez lancer la ROM choisie. Compatibilité non vérifiée.'));
}
function identity(meta) {
  $('rom-name').textContent = meta?.name ?? 'Aucune ROM choisie';
  $('rom-sha').textContent = meta?.canonical_sha256 ?? 'Non lu';
  $('rom-source-sha').textContent = meta?.source_sha256 ?? 'Non lu';
  $('rom-format').textContent = meta ? `${meta.detected_format.toUpperCase()} → Z64 · ${meta.size.toLocaleString('fr-FR')} octets` : 'Non reconnu';
  $('rom-origin').textContent = meta ? meta.source === 'reference-demo' ? 'Démo homebrew de référence' : meta.source === 'local-zip' ? `ZIP local : ${meta.archive_name} — ${meta.archive_entry}` : 'Fichier du PC — lu dans ce navigateur' : 'Aucune';
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
  invalidateImport(); const ticket = generation; importAbort = new AbortController(); const controller = importAbort;
  selected = null; reading = true; identity(null); controls(); status('Lecture et vérification du fichier dans le navigateur…');
  try {
    let prepared;
    if (/\.zip$/i.test(file.name)) {
      status('Inspection du ZIP local et recherche des ROM…');
      const archive = await readZipFile(file, { signal: controller.signal });
      if (ticket !== generation || phase !== 'idle') return;
      event('rom.zip.inspected', { ...archive.archive, rom_count: archive.entries.length });
      if (archive.entries.length > 1) {
        zipPending = { archive, ticket, controller };
        for (const entry of archive.entries) { const option = document.createElement('option'); option.value = String(entry.id); option.textContent = `${entry.name} — ${entry.size.toLocaleString('fr-FR')} octets`; $('zip-entry').appendChild(option); }
        $('zip-choice-panel').hidden = false;
        status(`${archive.entries.length} ROM trouvées dans le ZIP. Choisissez celle à préparer.`);
        return;
      }
      status('Extraction de la ROM du ZIP dans le navigateur et vérification du CRC…');
      prepared = await prepareZipRom(archive, archive.entries[0].id, { signal: controller.signal });
    } else prepared = await prepareLocalRom(file);
    if (ticket !== generation || phase !== 'idle') return;
    acceptPrepared(prepared);
  } catch (error) { if (ticket === generation && phase === 'idle') { event('rom.local.rejected', { code: error.code ?? 'E_READ', message: error.message }); status(error.message, true); } }
  finally { if (ticket === generation && phase === 'idle') { reading = false; controls(); } }
};
$('zip-use').onclick = async () => {
  if (phase !== 'idle' || reading || !zipPending) return;
  const pending = zipPending, id = Number($('zip-entry').value); clearZipChoice(); reading = true; controls();
  status('Extraction de la ROM choisie dans le navigateur et vérification du CRC…');
  try {
    const prepared = await prepareZipRom(pending.archive, id, { signal: pending.controller.signal });
    if (pending.ticket === generation && phase === 'idle') acceptPrepared(prepared);
  } catch (error) { if (pending.ticket === generation && phase === 'idle') { event('rom.local.rejected', { code: error.code ?? 'E_ZIP', message: error.message }); status(error.message, true); } }
  finally { if (pending.ticket === generation && phase === 'idle') { reading = false; controls(); } }
};
$('zip-cancel').onclick = () => { if (phase !== 'idle') return; invalidateImport(); selected = null; identity(null); controls(); status('Choix dans le ZIP annulé. Vous pouvez choisir un autre fichier ou lancer la démo.'); };
async function launch(source) {
  if (phase !== 'idle' || (source === 'local-file' && (!selected || reading))) return;
  const localChoice = selected; invalidateImport(); phase = 'preparing'; selected = null; activeRom = null; lock = null; controls();
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
    script.onerror = () => { phase = 'error'; status('Dépendances du moteur absentes. Fermez cet essai puis relancez DEMARRER-N64.bat.', true); };
    phase = 'loading'; loaderRequested = true; document.body.appendChild(script); event('engine.loader.requested', { core: 'mupen64plus_next', threads: false, source, canonical_sha256: activeRom.canonical_sha256 });
  } catch (error) {
    if (!loaderRequested) { phase = 'idle'; activeRom = null; lock = null; if (romURL) URL.revokeObjectURL(romURL); romURL = null; identity(null); controls(); }
    event('launch.failed', { message: error.message }); status(error.message, true);
  }
}
$('start').onclick = () => launch('reference-demo');
$('launch-local').onclick = () => launch('local-file');
$('reload').onclick = () => { if (confirm('Recharger cet essai pour changer de ROM ? Aucun fichier original ne sera modifié.')) location.reload(); };
window.addEventListener('pagehide', () => { importAbort?.abort(); if (romURL) URL.revokeObjectURL(romURL); });
function diagnostic() { return { schema: 'emuperso/real-engine-diagnostic/v1', scope: 'REAL_ENGINE_TRIAL_NOT_SYNTHETIC_LAB', warning: 'Format recognition and engine callbacks do not prove compatibility. No ROM bytes are included.', host: { user_agent: navigator.userAgent, cross_origin_isolated: crossOriginIsolated }, phase, local_selection: selected ? { ...selected.metadata } : null, active_rom: activeRom ? { ...activeRom } : null, rom_build: lock, contexts: [...contexts].map(c => ({ state: c.state, sample_rate: c.sampleRate })), records: structuredClone(records) }; }
$('export').onclick = () => { const u = URL.createObjectURL(new Blob([JSON.stringify(diagnostic(), null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = u; a.download = 'EMUPERSO-moteur-reel-diagnostic.json'; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); };
window.RealN64 = Object.freeze({ diagnostic, version: '0.3.0-local-zip' }); event('page.open', { engine_started: false }); controls();
