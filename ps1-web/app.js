// SPDX-License-Identifier: MIT
// Version de l'application — mettre à jour à chaque release
const APP_VERSION = 'RC-1.15-audit-candidate';
import { prepareDisc } from './disc-file.mjs';
import { SaveStore, makeStateEnvelope } from './save-store.mjs';
import { packStateBundle, unpackStateBundle } from './state-bundle.mjs';
import { SessionController } from './session-controller.mjs';
import { normalizeInput } from './input-profile.mjs';
import { PROFILES, DEFAULT_PROFILE_ID, resolveProfile } from './input-presets.mjs';
import { findCheatsForGame, catalogMeta, loadCatalog, detectRegion, detectRegions, regionsCompatible, detectMod } from './cheat-catalog-psx.mjs';
import { createCheatController, codeValid, gameKey } from './cheat-controller.mjs';
import { readTouch, writeTouch } from './touch-editor.mjs';
const $ = id => document.getElementById(id), vault = new SaveStore('emuperso-real-saves-v1-ps1'), records = [];
let selected = null, busy = false, meta = null, preparing = null, lastPrep = null;
// Heuristique héritée de Claude ; ni borne de décompression, ni garantie mémoire.
const ARCHIVE_MEMORY_FACTOR = 4.5, isArchiveName = name => /\.(rar|zip|7z)$/i.test(String(name ?? ''));
const say = (id, text, error = false) => { $(id).textContent = text; $(id).classList.toggle('error', error); };
// Journal gardé sur cet appareil : après un plantage ou un rechargement de l'onglet, l'export contient
// encore les évènements d'avant. Métadonnées seulement, comme le diagnostic.
const JOURNAL_KEY = 'emuperso-ps1-journal', pageLoadUtc = new Date().toISOString();
let earlierRecords = []; try { earlierRecords = JSON.parse(localStorage.getItem(JOURNAL_KEY) || '[]').slice(-300); } catch { earlierRecords = []; }
let journalTimer = 0;
const clipRecord = r => { const text = JSON.stringify(r); return text.length > 2000 ? { utc: r.utc, type: r.type, data: text.slice(0, 2000) } : r; };
function flushJournal() { clearTimeout(journalTimer); try { localStorage.setItem(JOURNAL_KEY, JSON.stringify([...earlierRecords, { utc: pageLoadUtc, type: 'page.load' }, ...records.map(clipRecord)].slice(-400))); } catch { /* stockage plein ou bloqué */ } }
const harmless = reason => reason?.name === 'NotAllowedError' || /not visible|wake ?lock|fullscreen|pointer ?lock|user gesture|play\(\) request/i.test(String(reason?.message ?? reason ?? ''));
function event(type, data = {}) { records.push({ utc: new Date().toISOString(), type, data }); if (records.length > 500) records.shift(); $('log').textContent = JSON.stringify(records.slice(-80), null, 1); clearTimeout(journalTimer); journalTimer = setTimeout(flushJournal, 300); }
window.addEventListener('pagehide', flushJournal);
window.addEventListener('error', e => event('browser.error', { message: e.message }));
window.addEventListener('unhandledrejection', e => {
  if (harmless(e.reason)) { e.preventDefault(); event('browser.refusal.ignored', { message: String(e.reason?.message ?? e.reason) }); return; }
  event('browser.unhandledrejection', { message: String(e.reason) });
});
const sessions = new SessionController($('game'), (type, data) => {
  event(type, data);
  if (type === 'state.unguarded.blocked') say('status', 'Utilisez les boutons de sauvegarde de l’application : le chargement direct du moteur est désactivé.');
});
const kv = name => {
  const run = async (mode, make) => {
    const db = await new Promise((ok, ko) => { const r = indexedDB.open(name, 1); r.onupgradeneeded = () => r.result.createObjectStore('games'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
    try { return await new Promise((ok, ko) => { const q = make(db.transaction('games', mode).objectStore('games')); q.onsuccess = () => ok(q.result); q.onerror = () => ko(q.error); }); } finally { db.close(); }
  };
  return { get: key => run('readonly', s => s.get(key)), set: (key, value) => run('readwrite', s => s.put(value, key)) };
};
const cheatDB = kv('emuperso-ps1-cheats-v1'), inputDB = kv('emuperso-ps1-input-v1'), editionDB = kv('emuperso-ps1-editions-v1');
// Toute la logique d'état des cheats vit dans cheat-controller.mjs (RC-1.9) : app.js ne fait
// que brancher le moteur, le catalogue, le stockage et l'affichage.
const ctl = createCheatController({
  getEngine: () => (sessions.current ? sessions.current.api : null),
  catalog: { find: findCheatsForGame, load: loadCatalog },
  regions: { detectRegion, detectRegions, regionsCompatible, detectMod },
  stores: { cheats: cheatDB, editions: editionDB },
  emit: (type, data) => event(type, data),
});
// Exposé pour les tests automatisés (sans effet en usage normal).
if (typeof window !== 'undefined') window.__cheatController = ctl;
function controls() {
  const on = !!sessions.current;
  $('choose').disabled = busy; $('launch').disabled = busy || !selected; $('launch').textContent = on ? 'Changer pour ce jeu' : 'Lancer';
  $('demo-homebrew').disabled = busy;
  $('prep-cancel').hidden = !preparing; $('prep-cancel').disabled = !preparing;
  for (const id of ['audio', 'state-save', 'state-load', 'state-previous', 'battery-save', 'cheat-add', 'cheat-off', 'in-apply']) $(id).disabled = busy || !on;
  if (ctl.view().engineSync === 'unknown') for (const id of ['state-save', 'battery-save']) $(id).disabled = true;
  for (const box of $('cheat-list').querySelectorAll('input')) box.disabled = busy || !on || !!box.rejected;
}
function show(m) {
  $('sel').textContent = m?.name ?? 'Aucun disque choisi';
  $('d-format').textContent = m ? `${m.detected_format.toUpperCase()} · ${m.size.toLocaleString('fr-FR')} octets` : '—';
  $('d-sha').textContent = m?.canonical_sha256 ?? '—'; $('d-serial').textContent = m ? (m.serial ?? 'non détecté (clé = empreinte du disque)') : '—';
  $('d-notes').textContent = m?.notes.join(' ') || '—';
}
async function operation(task) {
  if (busy) return; busy = true; controls();
  try { await task(); } catch (error) { say('status', error.message ?? String(error), true); event('operation.error', { code: error.code ?? null, message: error.message ?? String(error), stack: error.stack ? String(error.stack).slice(0, 2000) : null }); }
  finally { busy = false; controls(); }
}
// Rendu : une seule fonction, alimentée par l'instantané du contrôleur (jamais par des
// variables globales). Coché = appliqué dans le moteur ; ⏳ = en attente (non injecté).
let lastNoteKey = '';
function renderCheats() {
  const v = ctl.view(), list = $('cheat-list');
  list.replaceChildren();
  if (v.engineSync === 'unknown') {
    const box = document.createElement('div'); box.style.cssText = 'padding:8px;margin-bottom:8px;border:2px solid #f33;background:#3a0000;border-radius:6px;';
    box.textContent = '⚠️ Moteur INCERTAIN : activations et captures bloquées. Une session mise en quarantaine doit être recréée sans sauvegarder son état suspect.';
    const btn = document.createElement('button'); btn.textContent = 'Resynchroniser le moteur';
    btn.onclick = () => operation(async () => { await ctl.resync(); });
    box.append(document.createElement('br'), btn); list.append(box);
    const recover = document.createElement('button'); recover.textContent = 'Nouvelle session saine, sans capturer l’état incertain';
    recover.onclick = () => operation(async () => {
      if (!confirm('Recréer une session saine sans capturer l’état incertain ? Les sauvegardes existantes seront conservées. La progression non enregistrée sera abandonnée.')) return;
      await launch(sessions.current.prepared, { input: sessions.current.input, recover: true });
    });
    box.append(document.createElement('br'), recover);
  }
  if (v.region) {
    const warn = document.createElement('div');
    warn.style.cssText = 'padding:8px;margin-bottom:8px;border:1px solid #a90;background:#3a2a00;border-radius:6px;';
    warn.textContent = v.region.text;
    const btn = document.createElement('button'); btn.textContent = v.region.confirmLabel;
    btn.onclick = () => operation(async () => { await ctl.confirmRegion(); });
    warn.append(document.createElement('br'), btn); list.append(warn);
  }
  if (v.candidates.length) {
    const box = document.createElement('div'); box.style.cssText = 'margin:6px 0;';
    if (v.candidateKind === 'mod') {
      const mi = v.modInfo || {};
      box.textContent = `⚠️ Jeu modifié détecté (base : ${mi.baseTitle || 'inconnue'}). Les codes du jeu original sont NON VÉRIFIÉS pour ce mod et ne sont jamais activés automatiquement.`;
      box.style.cssText += 'padding:10px;border:2px solid #f90;background:#2a1a00;border-radius:6px;';
    }
    for (const cand of v.candidates) {
      const btn = document.createElement('button'); btn.style.cssText = 'margin:4px;';
      btn.textContent = v.candidateKind === 'mod'
        ? `Voir les ${cand.count} codes de « ${cand.title} » (NON VÉRIFIÉS)${cand.chosen ? ' ✔' : ''}`
        : `${cand.title} (${cand.count} codes)${cand.chosen ? ' ✔ choisie' : ''}`;
      btn.onclick = () => operation(async () => { await ctl.chooseCandidate(cand.index); });
      box.append(btn);
    }
    list.append(box);
  }
  say('cheat-info', v.info.text, v.info.warn);
  const noteKey = v.note.text + '|' + v.note.warn;
  if (v.note.text && noteKey !== lastNoteKey) say('save-note', v.note.text, v.note.warn);
  lastNoteKey = noteKey;
  if (v.edition && v.cheats.some(c => c.source === 'catalogue')) {
    const head = document.createElement('div'); head.className = 'cheat-edition';
    head.textContent = `Édition du catalogue : ${v.edition}`; list.append(head);
  }
  // P1 (mandat RC-1.13) : une ligne par cheat — case, nom, provenance, format, état réel,
  // raison précise d'un rejet. Un code rejeté garde sa case, désactivée.
  const STATE_TEXT = { applied: 'appliqué dans le moteur', pending: '⏳ en attente (non injecté)', off: 'désactivé' };
  for (const cheat of v.cheats) {
    const row = document.createElement('label'), box = document.createElement('input'); box.type = 'checkbox';
    row.className = 'cheat-row' + (cheat.incompatible ? ' rejected' : '');
    box.checked = cheat.state === 'applied'; box.rejected = cheat.incompatible;
    box.onchange = () => operation(async () => { await ctl.toggle(cheat.index, box.checked); });
    const badge = cheat.source === 'catalogue' ? (cheat.validated ? ' ✅' : ' 📥') : '';
    const name = document.createElement('span'); name.className = 'cheat-name'; name.textContent = ` ${cheat.display}`;
    const details = document.createElement('span'); details.className = 'cheat-meta';
    details.textContent = `Provenance : ${cheat.source}${cheat.origin && cheat.origin !== cheat.source ? ` (${cheat.origin})` : ''}${badge}`
      + ` · Format : ${cheat.format ?? 'inconnu'}`
      + ` · État : ${cheat.incompatible ? 'rejeté — ' + cheat.reason : STATE_TEXT[cheat.state] ?? cheat.state}`;
    row.append(box, name, details); list.append(row);
  }
  controls();
}
ctl.subscribe(renderCheats);
async function optionalLoad(identity, slot, kind, previous = false) {
  try { return await vault.load(identity, slot, { kind, previous }); } catch (error) { if (error.code === 'E_EMPTY') return null; throw error; }
}
async function saveBattery(force) {
  const current = sessions.current; if (!current) return;
  requireCaptureSafe();
  const bytes = current.api.captureBattery();
  if (!bytes) { if (force) say('save-note', 'Ce jeu n’a pas (encore) produit de carte mémoire ou de sauvegarde native.'); return; }
  await vault.put(current.batteryIdentity, 1, await makeStateEnvelope(bytes, current.batteryIdentity, { kind: 'battery', label: 'Carte mémoire' }));
  event('battery.saved', { bytes: bytes.length }); if (force) say('save-note', 'Carte mémoire enregistrée pour ce jeu.');
}
async function refreshSlots() {
  if (!sessions.current) return;
  const slot = Number($('slot').value), row = (await vault.list(sessions.current.identity, { kind: 'state' })).find(r => r.slot === slot);
  say('slot-info', row ? `Emplacement ${slot} : ${new Date(row.created_utc).toLocaleString('fr-FR')} · révision ${row.revision}${row.cheats.length ? ' · cheats actifs à l’enregistrement' : ''}` : `Emplacement ${slot} : vide pour ce jeu et ce moteur.`);
}
function requireCaptureSafe() {
  if (ctl.view().engineSync === 'unknown' || sessions.current?.api.snapshot?.()?.cheats_quarantined) {
    throw new Error('Capture refusée : moteur incertain. Recréez une session saine ; les sauvegardes existantes sont conservées.');
  }
}
function checkArchiveMemory(prepared, stage) {
  const m = globalThis.performance?.memory, need = ARCHIVE_MEMORY_FACTOR * prepared.metadata.size;
  const available = !!m && Number.isFinite(m.jsHeapSizeLimit) && m.jsHeapSizeLimit > 0 && Number.isFinite(m.usedJSHeapSize) && m.usedJSHeapSize >= 0;
  const free = available ? 0.9 * m.jsHeapSizeLimit - m.usedJSHeapSize : null;
  event('archive.memory.check', { stage, available, estimator_only: true, compressed_bytes: prepared.metadata.size,
    need_mib: +mib(need), free_mib: available ? +mib(free) : null, session_retained: !!sessions.current, ...memory() });
  if (available && need > free) {
    const error = new Error(`Mémoire de l’onglet insuffisante pour décompresser cette archive (estimation indicative ${mib(need)} Mio, disponible ${mib(Math.max(0, free))} Mio). `
      + (sessions.current ? 'Lancement refusé avant fermeture : le jeu en cours reste ouvert. Enregistrez votre partie avant de fermer ou recharger la page.' : 'Rechargez la page (F5) puis relancez : vos sauvegardes sont conservées.'));
    error.code = 'E_ARCHIVE_MEMORY'; throw error;
  }
}
async function launch(prepared, { state = null, battery, cheatList = [], input, recover = false } = {}) {
  if (recover && ctl.view().engineSync !== 'unknown') throw new Error('Aucune récupération de moteur incertain à effectuer.');
  const archive = isArchiveName(prepared.metadata.name);
  // Refus conservateur AVANT capture, confirmation et fermeture. On ne parie pas
  // sur la mémoire que le ramasse-miettes pourrait libérer après destruction du jeu.
  if (archive) checkArchiveMemory(prepared, 'preflight');
  if (sessions.current && !recover) {
    try { await saveBattery(false); }
    catch (error) { event('battery.save.failed', { message: error.message }); throw new Error('Changement de jeu annulé : sauvegarde native impossible. La session reste ouverte. ' + error.message); }
  }
  // Archives : après précontrôle conservateur, on ferme l'ancien jeu avec accord
  // pour éviter de maintenir deux moteurs pendant la décompression.
  let archiveClosed = false;
  if (archive) {
    if (sessions.current) {
      if (!recover && !confirm('Ce jeu est une archive : sa décompression peut dépasser l’estimation mémoire. Utilisez uniquement une archive de confiance. Le jeu en cours sera fermé AVANT le lancement. Sa carte mémoire vient d’être enregistrée ; la progression non enregistrée sera perdue. En cas d’échec du nouveau jeu, l’ancienne session ne pourra pas être rétablie. Continuer ?'))
        throw new Error('Lancement annulé : le jeu en cours reste ouvert.');
      checkArchiveMemory(prepared, 'before-close');
      const closing = meta?.name ?? null;
      await sessions.close(); ctl.endSession(); meta = null; $('current').textContent = 'Aucun';
      archiveClosed = true;
      event('session.closed.for_archive', { closed: closing, next: prepared.metadata.name, ...memory() });
    }
  }
  if (recover) event('session.recovery.requested', { unsafe_capture_skipped: true });
  let candidate;
  try {
    const config = input ?? normalizeInput(await inputDB.get(gameKey(prepared.metadata)).catch(() => null));
    candidate = await sessions.prepare(prepared, config);
    const stored = battery === undefined ? await optionalLoad(candidate.batteryIdentity, 1, 'battery') : null;
    say('status', state ? 'Restauration dans une session neuve…' : 'Démarrage du jeu…');
    // B02 : aucune réinjection de cheats au démarrage. Les cheats restaurés (cheatList) sont confiés
    // au contrôleur, qui ne les applique qu'après validation de l'édition et de la région.
    await sessions.start(candidate, { battery: battery === undefined ? stored?.bytes ?? null : battery, state, cheats: [] });
  } catch (error) {
    if (candidate?.frame.isConnected && sessions.current !== candidate) await sessions.dispose(candidate);
    if (archiveClosed) {
      event('archive.launch.failed.after_close', { message: error.message, ...memory() });
      const failure = new Error('Échec du lancement de l’archive. Le jeu précédent a déjà été fermé et ne peut pas être rétabli ; ses sauvegardes enregistrées sont conservées. ' + error.message);
      failure.code = error.code; throw failure;
    }
    throw error;
  }
  meta = prepared.metadata; selected = null; show(meta); $('current').textContent = meta.name; $('d-engine').textContent = 'Moteur lancé — fonctionnement non validé par un test réel';
  await ctl.startSession(meta, cheatList); await refreshSlots();
  const savedProfile = (candidate.input && candidate.input._profile) || DEFAULT_PROFILE_ID;
  fillInput(candidate.input); $('in-profile').value = PROFILES[savedProfile] ? savedProfile : DEFAULT_PROFILE_ID; showPad(candidate);
  say('status', 'Session lancée. Vérifiez l’image, le son et la manette ; vous pouvez choisir un autre jeu sans fermer la page.');
}
async function loadState(previous) {
  const current = sessions.current, slot = Number($('slot').value), loaded = await vault.load(current.identity, slot, { kind: 'state', previous });
  const bundle = unpackStateBundle(loaded.bytes), list = loaded.envelope.metadata.cheats ?? [];
  if (list.length && !confirm('Cet état mémorise des cheats. Ses données RAM peuvent déjà contenir leurs effets. Aucun code ne sera réactivé avant votre confirmation explicite dans la nouvelle session. Continuer ?')) return;
  await launch(current.prepared, { state: bundle.state, battery: bundle.battery, cheatList: list, input: current.input });
  event('state.loaded', { slot, previous, payload_sha256: loaded.envelope.payload_sha256 }); say('save-note', 'État chargé dans une session neuve ; taille et progression contrôlées, contenu natif non authentifié. Vérifiez image, son et commandes.');
}
$('choose').onclick = () => $('disc-file').click();

$('demo-homebrew').onclick = () => operation(async () => {
  // A tiny original MIT PS-X EXE in ISO9660, built from our own source code.
  // Always run through the exact normal disc preparation and session path.
  // Do not modify or upload the user's ROMs, saves or cheat data.
  event('demo.homebrew.requested', { replacing: !!sessions.current });
  say('status', 'Chargement de la démo PS1 libre (programme MIPS original)…');
  const response = await fetch('homebrew/demo-emuperso-ps1.iso', { cache: 'no-store' });
  if (!response.ok) throw new Error('Démo libre absente du site (HTTP ' + response.status + ').');
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== 131072) throw new Error('Démo libre incomplète (taille inattendue).');
  const file = new File([buffer], 'emuperso-homebrew.iso', { type: 'application/octet-stream' });
  const prepared = await prepareDisc(file, { onStage: (stage, data) => event('demo.disc.' + stage, data) });
  event('demo.homebrew.prepared', { size: buffer.byteLength, sha256: prepared.metadata.canonical_sha256 });
  await launch(prepared);
  const beforeFrame = sessions.current?.api?.snapshot?.()?.frame ?? 0;
  await new Promise(resolve => setTimeout(resolve, 1100));
  const afterFrame = sessions.current?.api?.snapshot?.()?.frame ?? 0;
  const progressing = afterFrame > beforeFrame;
  event('demo.homebrew.frames', { before: beforeFrame, after: afterFrame, progressing });
  say('status', 'Homebrew PS1 lancé. Écran rouge attendu : commande GPU native. '
    + (progressing ? 'Compteur moteur actif (' + beforeFrame + ' → ' + afterFrame + ' images).'
                   : 'Compteur moteur non confirmé : vérifier le diagnostic et l’image.')
    + ' Cette démo ne teste pas le son ni les manettes.', !progressing);
});

// P0 chargement (mandat RC-1.13) : chaque étape de préparation est horodatée dans le
// diagnostic ; un chien de garde signale toute absence de progression, et « Annuler la
// lecture » libère l'interface sans toucher au jeu en cours (le bloc déjà demandé au
// navigateur se termine en arrière-plan, son résultat est ignoré).
const mib = n => (n / 1048576).toFixed(0);
function memory() {
  const m = globalThis.performance?.memory;
  return { device_memory_gib: globalThis.navigator?.deviceMemory ?? null,
    js_heap_used_mib: m ? +mib(m.usedJSHeapSize) : null, js_heap_limit_mib: m ? +mib(m.jsHeapSizeLimit) : null };
}
const prepStatus = job => `Lecture et vérification locales (le fichier ne quitte pas ce PC)… ${mib(job.bytes)} / ${mib(job.size)} Mio`
  + (job.bytes && job.elapsed() > 500 ? ` · ${(job.bytes / 1048576 / (job.elapsed() / 1000)).toFixed(1)} Mio/s` : '');
function onPrepStage(job, stage, data) {
  if (preparing !== job) return;                          // préparation annulée ou remplacée
  job.stage = stage; job.last = performance.now();
  if (stage === 'read.progress') {
    job.bytes = data.bytes;
    const tenth = Math.floor(10 * data.bytes / data.size);
    if (tenth > job.loggedTenth) { job.loggedTenth = tenth; event('disc.read.progress', { bytes: data.bytes, size: data.size, ms: data.ms }); }
    say('status', prepStatus(job));
  } else event('disc.' + stage, data);
}
function watchPrep(job) {
  if (preparing !== job) return;
  const quiet = (performance.now() - job.last) / 1000;
  if (quiet < 10) return;
  const step = quiet >= 60 ? 60 : quiet >= 30 ? 30 : 10;
  if (step > job.stallLogged) { job.stallLogged = step; event('disc.stalled', { stage: job.stage, quiet_s: Math.round(quiet), bytes: job.bytes, size: job.size, ...memory() }); }
  say('status', `⚠️ Aucune progression depuis ${Math.round(quiet)} s (étape ${job.stage}, ${mib(job.bytes)} / ${mib(job.size)} Mio). Disque lent, fichier verrouillé ou mémoire saturée. « Annuler la lecture » ne touche pas au jeu en cours.`, true);
}
$('disc-file').onchange = () => operation(async () => {
  const file = $('disc-file').files[0]; $('disc-file').value = ''; if (!file) return;
  selected = null; show(null);
  const start = performance.now(), abort = new AbortController();
  let cancel; const cancelled = new Promise((_, ko) => { cancel = ko; });
  const job = preparing = { stage: 'selected', bytes: 0, size: file.size, last: start, loggedTenth: 0, stallLogged: 0,
    elapsed: () => performance.now() - start,
    cancel: () => { abort.abort(); const e = new Error('Lecture annulée. Le jeu en cours et les sauvegardes ne sont pas touchés.'); e.code = 'E_ABORTED'; cancel(e); } };
  controls(); say('status', prepStatus(job));
  event('disc.selected', { name: file.name, size: file.size, last_modified: file.lastModified ?? null, replacing: !!sessions.current, ...memory() });
  const watchdog = setInterval(() => watchPrep(job), 1000);
  try {
    const result = await Promise.race([prepareDisc(file, { signal: abort.signal, onStage: (stage, data) => onPrepStage(job, stage, data) }), cancelled]);
    selected = result; show(selected.metadata);
    lastPrep = { name: file.name, size: file.size, ok: true, ms: Math.round(job.elapsed()), ...result.timings };
    event('disc.ready', { ms: lastPrep.ms, hash_ms: result.timings?.hash_ms ?? null, ...memory() });
    say('status', `Disque prêt : ${selected.metadata.name}. ${sessions.current ? 'Le jeu en cours reste ouvert jusqu’au lancement.' : 'Cliquez sur Lancer.'}`);
  } catch (error) {
    lastPrep = { name: file.name, size: file.size, ok: false, stage: job.stage, bytes: job.bytes, code: error.code ?? null, ms: Math.round(job.elapsed()) };
    event(error.code === 'E_ABORTED' ? 'disc.cancelled' : 'disc.failed', { ...lastPrep, ...memory() });
    throw error;
  } finally { clearInterval(watchdog); if (preparing === job) preparing = null; }
});
$('prep-cancel').onclick = () => { preparing?.cancel(); };
$('launch').onclick = () => operation(async () => {
  const t = performance.now(), name = selected?.metadata?.name ?? null, replacing = !!sessions.current;
  event('launch.start', { name, replacing, ...memory() });
  try { await launch(selected); }
  catch (error) { event('launch.failed', { name, replacing, ms: Math.round(performance.now() - t), code: error.code ?? null, ...memory() }); throw error; }
  event('launch.done', { name, ms: Math.round(performance.now() - t), ...memory() });
});
$('audio').onclick = () => operation(async () => { await sessions.current.api.resumeAudio(); });
$('battery-save').onclick = () => operation(() => saveBattery(true));
$('slot').onchange = () => { void refreshSlots().catch(error => say('save-note', error.message, true)); };
$('state-save').onclick = () => operation(async () => {
  requireCaptureSafe();
  const current = sessions.current, slot = Number($('slot').value); await current.api.pause();
  try {
    const bundle = packStateBundle(current.api.captureState(), current.api.captureBattery());
    const saved = await vault.put(current.identity, slot, await makeStateEnvelope(bundle, current.identity, { kind: 'state', label: meta.name.slice(0, 120), cheats: ctl.activeCheats() }));
    await saveBattery(false); event('state.saved', { slot, revision: saved.revision });
    say('save-note', `État enregistré dans l’emplacement ${slot}. La version précédente reste récupérable.`); await refreshSlots();
  } finally { await current.api.play(); }
});
$('state-load').onclick = () => operation(() => loadState(false));
$('state-previous').onclick = () => operation(() => loadState(true));
$('cheat-off').onclick = () => operation(async () => { await ctl.disableAll(); });
$('serial-apply').onclick = () => operation(async () => { await ctl.applySerial($('serial-input').value); });
$('cheat-add').onclick = () => operation(async () => {
  await ctl.addManual($('cheat-name').value, $('cheat-code').value);
  $('cheat-name').value = ''; $('cheat-code').value = '';
});
$('export').onclick = () => {
  const env = { user_agent: globalThis.navigator?.userAgent ?? null, cores: globalThis.navigator?.hardwareConcurrency ?? null, ...memory() };
  const inProgress = preparing && { stage: preparing.stage, bytes: preparing.bytes, size: preparing.size, elapsed_ms: Math.round(preparing.elapsed()), quiet_ms: Math.round(performance.now() - preparing.last) };
  const blob = new Blob([JSON.stringify({ app: 'emuperso-ps1-web ' + APP_VERSION, tested: false, exported_utc: new Date().toISOString(), env,
    preparation: { in_progress: inProgress || null, last: lastPrep },
    game: meta && { name: meta.name, size: meta.size, serial: meta.serial, sha256: meta.canonical_sha256 }, session: sessions.diagnostic(), events: records, earlier_events: earlierRecords }, null, 1)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'EMUPERSO-ps1-diagnostic.json'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 5000);
};
const readInput = () => normalizeInput({ analog: $('in-analog').value, stickToDpad: $('in-dpad').checked, deadzone: Number($('in-dz').value), native: $('in-native').checked });
function applyProfileToUI(id) {
  const preset = PROFILES[id] ?? PROFILES[DEFAULT_PROFILE_ID] ?? Object.values(PROFILES)[0];
  if (!preset) return;
  const cfg = preset.config;
  $('in-analog').value = cfg.analog; $('in-dpad').checked = cfg.stickToDpad;
  $('in-dz').value = String(cfg.deadzone); $('in-dz-out').textContent = cfg.deadzone.toFixed(2).replace('.', ',');
  $('in-native').checked = cfg.native;
  $('in-profile').value = preset.id; event('input.profile', { profile: preset.id, label: preset.label });
}
$('in-profile').onchange = () => applyProfileToUI($('in-profile').value);
function fillInput(cfg) { $('in-analog').value = cfg.analog; $('in-dpad').checked = cfg.stickToDpad; $('in-dz').value = String(cfg.deadzone); $('in-dz-out').textContent = cfg.deadzone.toFixed(2).replace('.', ','); $('in-native').checked = cfg.native; }
function showPad(candidate) {
  const status = candidate.api.inputStatus?.(), cfg = candidate.input;
  say('pad-status', `${status?.mode === 'custom' ? 'Disposition personnalisée active' : status?.mode === 'disabled' ? 'Lecteur de manette désactivé' : 'Commandes natives d’EmulatorJS'} (aucun test réel). ${status?.reason ?? ''}Type émulé demandé : ${cfg.analog === 'off' ? 'numérique' : cfg.analog}. Si la manette n’est pas détectée, appuyez sur un de ses boutons.`, status?.mode === 'disabled');
  event('input.status', { ...status, profile: cfg });
}
$('in-dz').oninput = () => { $('in-dz-out').textContent = Number($('in-dz').value).toFixed(2).replace('.', ','); };
$('in-apply').onclick = () => operation(async () => {
  const cfg = { ...readInput(), _profile: $('in-profile').value }, current = sessions.current;
  if (!confirm('Le jeu va redémarrer avec ces commandes : la carte mémoire est enregistrée, mais la partie en cours non sauvegardée sera perdue. Les états enregistrés avec un autre type de manette restent séparés. Continuer ?')) return;
  await inputDB.set(gameKey(meta), cfg); await launch(current.prepared, { input: cfg });
});
// Ancien catalogue vide supprimé (RC-1.0) — le catalogue PS1 est dans data/psx-catalog.json
// Commandes tactiles (mandat Controller V2) : réglage de l'appareil, lu en direct par la page du moteur.
const PS1_TOUCH_KEY = 'emuperso-ps1-touch';
$('in-hide-touch').checked = readTouch(PS1_TOUCH_KEY).hideTouch;
$('in-hide-touch').onchange = () => { try { writeTouch(PS1_TOUCH_KEY, { ...readTouch(PS1_TOUCH_KEY), hideTouch: $('in-hide-touch').checked }); } catch { say('status', 'Réglage non enregistré : stockage du navigateur indisponible.', true); } };
$('in-move').onclick = async () => {
  const win = sessions.current?.frame.contentWindow;
  if (!win?.EMUPERSO_editTouch) { say('status', 'Lance un jeu sur l’écran tactile pour déplacer ses boutons.'); return; }
  say('status', 'Glisse les boutons dans la fenêtre du jeu, puis touche « Terminé ».'); $('game').scrollIntoView({ block: 'center' });
  try { await win.EMUPERSO_editTouch(); say('status', 'Position des boutons tactiles enregistrée sur cet appareil.'); event('input.touch.moved'); } catch (error) { say('status', error.message, true); }
};
show(null); renderCheats();
