// SPDX-License-Identifier: MIT
// Version de l'application — mettre à jour à chaque release
const APP_VERSION = 'RC-1.9';
import { prepareDisc } from './disc-file.mjs';
import { SaveStore, makeStateEnvelope } from './save-store.mjs';
import { packStateBundle, unpackStateBundle } from './state-bundle.mjs';
import { SessionController } from './session-controller.mjs';
import { normalizeInput } from './input-profile.mjs';
import { PROFILES, DEFAULT_PROFILE_ID, resolveProfile } from './input-presets.mjs';
import { findCheatsForGame, catalogMeta, loadCatalog, detectRegion, detectRegions, regionsCompatible, detectMod } from './cheat-catalog-psx.mjs';
import { createCheatController, codeValid, gameKey } from './cheat-controller.mjs';
const $ = id => document.getElementById(id), vault = new SaveStore('emuperso-real-saves-v1-ps1'), records = [];
let selected = null, busy = false, meta = null;
const say = (id, text, error = false) => { $(id).textContent = text; $(id).classList.toggle('error', error); };
function event(type, data = {}) { records.push({ utc: new Date().toISOString(), type, data }); if (records.length > 500) records.shift(); $('log').textContent = JSON.stringify(records.slice(-80), null, 1); }
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
  for (const id of ['audio', 'state-save', 'state-load', 'state-previous', 'battery-save', 'cheat-add', 'cheat-off', 'in-apply']) $(id).disabled = busy || !on;
  for (const box of $('cheat-list').querySelectorAll('input')) box.disabled = busy || !on;
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
    box.textContent = '⚠️ L’état du moteur est INCERTAIN (une resynchronisation a échoué). Les nouvelles activations sont bloquées.';
    const btn = document.createElement('button'); btn.textContent = 'Resynchroniser le moteur';
    btn.onclick = () => operation(async () => { await ctl.resync(); });
    box.append(document.createElement('br'), btn); list.append(box);
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
  for (const cheat of v.cheats) {
    const row = document.createElement('label'), box = document.createElement('input'); box.type = 'checkbox';
    box.checked = cheat.state === 'applied';
    box.onchange = () => operation(async () => { await ctl.toggle(cheat.index, box.checked); });
    const badge = cheat.source === 'catalogue' ? (cheat.validated ? ' ✅' : ' 📥') : '';
    const stateTag = cheat.state === 'pending' ? ' ⏳ en attente' : '';
    row.append(box, ` ${cheat.display} (${cheat.source}${badge}${stateTag})`); list.append(row);
  }
  controls();
}
ctl.subscribe(renderCheats);
async function optionalLoad(identity, slot, kind, previous = false) {
  try { return await vault.load(identity, slot, { kind, previous }); } catch (error) { if (error.code === 'E_EMPTY') return null; throw error; }
}
async function saveBattery(force) {
  const current = sessions.current; if (!current) return;
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
async function launch(prepared, { state = null, battery, cheatList = [], input } = {}) {
  if (sessions.current) await saveBattery(false).catch(error => event('battery.save.failed', { message: error.message }));
  const config = input ?? normalizeInput(await inputDB.get(gameKey(prepared.metadata)).catch(() => null)),
    candidate = await sessions.prepare(prepared, config);
  try {
    const stored = battery === undefined ? await optionalLoad(candidate.batteryIdentity, 1, 'battery') : null;
    say('status', state ? 'Restauration dans une session neuve…' : 'Démarrage du jeu…');
    // B02 : aucune réinjection de cheats au démarrage. Les cheats restaurés (cheatList) sont confiés
    // au contrôleur, qui ne les applique qu'après validation de l'édition et de la région.
    await sessions.start(candidate, { battery: battery === undefined ? stored?.bytes ?? null : battery, state, cheats: [] });
  } catch (error) { if (candidate.frame.isConnected && sessions.current !== candidate) await sessions.dispose(candidate); throw error; }
  meta = prepared.metadata; selected = null; show(meta); $('current').textContent = meta.name; $('d-engine').textContent = 'Moteur lancé — fonctionnement non validé par un test réel';
  await ctl.startSession(meta, cheatList); await refreshSlots();
  const savedProfile = (candidate.input && candidate.input._profile) || DEFAULT_PROFILE_ID;
  fillInput(candidate.input); $('in-profile').value = PROFILES[savedProfile] ? savedProfile : DEFAULT_PROFILE_ID; showPad(candidate);
  say('status', 'Session lancée. Vérifiez l’image, le son et la manette ; vous pouvez choisir un autre jeu sans fermer la page.');
}
async function loadState(previous) {
  const current = sessions.current, slot = Number($('slot').value), loaded = await vault.load(current.identity, slot, { kind: 'state', previous });
  const bundle = unpackStateBundle(loaded.bytes), list = loaded.envelope.metadata.cheats ?? [];
  if (list.length && !confirm('Cet état a été enregistré avec des cheats actifs. Le charger rétablira leurs effets. Continuer ?')) return;
  await launch(current.prepared, { state: bundle.state, battery: bundle.battery, cheatList: list, input: current.input });
  event('state.loaded', { slot, previous, payload_sha256: loaded.envelope.payload_sha256 }); say('save-note', 'État restauré dans une session neuve. Vérifiez image, son et commandes.');
}
$('choose').onclick = () => $('disc-file').click();
$('disc-file').onchange = () => operation(async () => {
  const file = $('disc-file').files[0]; $('disc-file').value = ''; if (!file) return;
  selected = null; show(null); say('status', 'Lecture et vérification locales (le fichier ne quitte pas ce PC)…');
  selected = await prepareDisc(file); show(selected.metadata);
  say('status', `Disque prêt : ${selected.metadata.name}. ${sessions.current ? 'Le jeu en cours reste ouvert jusqu’au lancement.' : 'Cliquez sur Lancer.'}`);
});
$('launch').onclick = () => operation(() => launch(selected));
$('audio').onclick = () => operation(async () => { await sessions.current.api.resumeAudio(); });
$('battery-save').onclick = () => operation(() => saveBattery(true));
$('slot').onchange = () => { void refreshSlots().catch(error => say('save-note', error.message, true)); };
$('state-save').onclick = () => operation(async () => {
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
  const blob = new Blob([JSON.stringify({ app: 'emuperso-ps1-web ' + APP_VERSION, tested: false, game: meta && { name: meta.name, size: meta.size, serial: meta.serial, sha256: meta.canonical_sha256 }, session: sessions.diagnostic(), events: records }, null, 1)], { type: 'application/json' });
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
show(null); renderCheats();
