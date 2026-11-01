// SPDX-License-Identifier: MIT
import { prepareLocalRom, prepareRomBytes } from './rom-file.mjs';
import { readZipFile, prepareZipRom } from './zip-rom.mjs';
import { SaveStore, makeStateEnvelope, verifyEnvelope, MAX_SAVE_BYTES, sha256 } from './save-store.mjs';
import { SessionController } from './session-controller.mjs';
import { readLegacyBattery } from './legacy-battery.mjs';
import { packStateBundle, unpackStateBundle } from './state-bundle.mjs';
import { romCheatIdentity, loadCheatCatalog, lookupCheats, resolveCheatCode, validateManualCheat } from './cheat-catalog.mjs';
const $ = id => document.getElementById(id), records = [], vault = new SaveStore();
let phase = 'idle', busy = false, reading = false, generation = 0, selected = null, activeRom = null, lock = null;
let zipPending = null, importAbort = null, saveList = [], catalog = null, cheatRows = [], catalogTicket = 0;
let sequence = 0, lastNativeHash = null;
const sessions = new SessionController($('game'), (type, data) => {
  event(type, data);
  if (type === 'session.stage') {
    const labels = { 'pause-current': 'Mise en pause de la partie actuelle…', 'start-candidate': 'Démarrage du moteur isolé…', 'restore-and-verify': 'Chargement de l’état et vérification de la mémoire…', 'commit-storage': 'Validation finale du stockage…' };
    status(labels[data.stage] ?? 'Opération en cours…');
  }
  if (type === 'gamepad.connected') $('gamepads').textContent = data.id;
  if (type === 'state.unguarded.blocked') status('Utilisez les boutons de sauvegarde vérifiée de l’application ; le chargement direct du moteur est désactivé.');
  if (type === 'config.change.blocked') status('Les paramètres du moteur restent fixes pour préserver la compatibilité des états.');
});
Object.defineProperty(window, 'EJS_emulator', { configurable: true, get: () => sessions.emulator });
function event(type, data = {}) {
  records.push({ seq: ++sequence, utc: new Date().toISOString(), host_monotonic_ms: performance.now(), type, data });
  if (records.length > 600) records.shift(); $('log').textContent = JSON.stringify(records, null, 2);
}
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function saveStatus(message, error = false) { $('save-status').textContent = message; $('save-status').classList.toggle('error', error); }
function controls() {
  const active = !!sessions.current;
  $('start').disabled = busy; $('choose-rom').disabled = busy; $('reload').disabled = busy;
  $('launch-local').disabled = busy || reading || !selected;
  $('launch-local').textContent = active ? 'Changer pour cette ROM' : 'Lancer la ROM choisie';
  $('zip-use').disabled = busy || reading || !zipPending;
  for (const id of ['reset-clean', 'reset-before-cheats', 'state-save', 'state-load', 'state-previous', 'battery-save', 'battery-load', 'battery-previous', 'save-export', 'save-import', 'cheat-add', 'cheat-disable-all']) $(id).disabled = busy || !active;
  for (const input of $('cheat-list').querySelectorAll('input,select')) input.disabled = busy || !active || input.dataset.unsupported === 'true';
  audioStatus();
}
function audioStatus() {
  const contexts = sessions.current?.api.snapshot().contexts ?? [];
  $('audio-state').textContent = contexts.map(c => `${c.state}, ${c.sample_rate} Hz`).join(' ; ') || 'Aucun contexte créé';
  $('audio').disabled = busy || !contexts.length;
}
function identity(meta) {
  $('rom-name').textContent = meta?.name ?? 'Aucune ROM choisie';
  $('rom-sha').textContent = meta?.canonical_sha256 ?? 'Non lu'; $('rom-source-sha').textContent = meta?.source_sha256 ?? 'Non lu';
  $('rom-format').textContent = meta ? `${meta.detected_format.toUpperCase()} → Z64 · ${meta.size.toLocaleString('fr-FR')} octets` : 'Non reconnu';
  $('rom-origin').textContent = !meta ? 'Aucune' : meta.source === 'reference-demo' ? 'Démo de référence' : meta.source === 'local-zip' ? `ZIP local : ${meta.archive_name} — ${meta.archive_entry}` : 'Fichier local';
}
function clearZipChoice() { zipPending = null; $('zip-choice-panel').hidden = true; $('zip-entry').replaceChildren(); }
function invalidateImport() { ++generation; importAbort?.abort(); importAbort = null; clearZipChoice(); reading = false; }
function acceptPrepared(prepared) {
  selected = prepared; identity(prepared.metadata); event('rom.local.selected', prepared.metadata);
  const prefix = prepared.metadata.source === 'local-zip' ? 'ROM extraite du ZIP ; CRC vérifié. ' : '';
  status(prefix + (prepared.metadata.extension_mismatch ? `En-tête ${prepared.metadata.detected_format.toUpperCase()} malgré l’extension .${prepared.metadata.filename_extension} : la signature est prioritaire. ` : '') + 'Fichier prêt. Cliquez sur le bouton de lancement ; la compatibilité du jeu reste à vérifier.');
}
async function operation(task) {
  if (busy) return; busy = true; controls();
  try { await task(); }
  catch (error) {
    const message = error.code === 'E_RESTORE_UNPROVEN'
      ? 'Cette version ne peut pas confirmer la reprise de cet état, parfois très proche du démarrage. La partie actuelle et les sauvegardes sont conservées. Essayez une autre copie ou la sauvegarde native, puis exportez le diagnostic.'
      : error.message || 'Opération interrompue. La session précédente est conservée.';
    event('operation.failed', { message, detail: error.message, code: error.code ?? 'E_OPERATION' });
    status(message, true); saveStatus(message, true);
  }
  finally { busy = false; phase = sessions.current ? 'started' : 'idle'; controls(); }
}
async function optionalLoad(identity, slot, kind) {
  try { return await vault.load(identity, slot, { kind }); }
  catch (error) { if (error.code === 'E_EMPTY') return null; throw error; }
}
function stateCheats(session = sessions.current) { return session?.history ?? []; }
async function prepareNativeWrite(current, { bytes = current.api.captureBattery(), slot = 1, label = 'Sauvegarde native' } = {}) {
  if (!bytes) return null;
  const history = stateCheats(current);
  let envelope = await makeStateEnvelope(bytes, current.identity, { kind: 'battery', label, cheats: history });
  const baseline = current.beforeCheats?.native_sha256 ?? (current.tainted ? (await optionalLoad(current.identity, 2, 'battery'))?.envelope.payload_sha256 : null);
  if (baseline && baseline === envelope.payload_sha256 && history.length) {
    envelope = await makeStateEnvelope(bytes, current.identity, { kind: 'battery', label, cheats: [] });
  }
  return { envelope, slot, entry: { slot, envelope, deduplicate: true }, bytes: bytes.length };
}
async function saveNative({ slot = 1, label = 'Sauvegarde native', force = false } = {}) {
  const current = sessions.current; if (!current) return null;
  const native = await prepareNativeWrite(current, { slot, label });
  if (!native) { if (force) saveStatus('Le jeu n’a pas encore produit de sauvegarde native. Les save states restent séparés.'); return null; }
  const [written] = await vault.putBatch(current.identity, [native.entry]);
  if (slot === 1) lastNativeHash = native.envelope.payload_sha256;
  if (force || !written.skipped_unchanged) {
    saveStatus(!written.skipped_unchanged ? 'Sauvegarde native conservée localement — ' + new Date().toLocaleTimeString('fr-FR') : 'Sauvegarde native déjà à jour ; la copie précédente est conservée.');
    event('battery.saved', { bytes: native.bytes, slot, payload_sha256: native.envelope.payload_sha256, skipped_unchanged: written.skipped_unchanged });
  }
  return native.envelope;
}
async function refreshSaves() {
  if (!sessions.current) { saveList = []; return; }
  saveList = await vault.list(sessions.current.identity, { kind: 'state' });
  const chosen = Number($('save-slot').value), found = saveList.find(row => row.slot === chosen);
  $('slot-info').textContent = found ? `État ${chosen} · ${new Date(found.created_utc).toLocaleString('fr-FR')} · révision ${found.revision}${found.cheats.length ? ' · mémoire marquée par des cheats' : ''}` : `Emplacement ${chosen} vide pour ce jeu et ce moteur.`;
}
async function refreshSavesOrWarn() {
  try { await refreshSaves(); return true; }
  catch (error) {
    saveList = [];
    $('slot-info').textContent = 'Liste des états temporairement indisponible ; vos données restent dans le coffre.';
    saveStatus('Opération validée. L’affichage de la liste des états a échoué ; réessayez la sélection ou exportez le diagnostic.', true);
    event('storage.list.warning', { code: error.code ?? 'E_STORAGE', message: error.message, committed_operation_unchanged: true });
    return false;
  }
}
async function startPrepared(prepared, { state = null, batteryOverride, restoreNative = false, cheats = [], history = [] } = {}) {
  invalidateImport(); phase = state ? 'restoring' : 'loading';
  if (sessions.current && !state && !restoreNative) await saveNative({ force: true });
  const candidate = await sessions.prepare(prepared, { legacy: state || restoreNative ? sessions.current?.legacy : undefined });
  let inheritedHistory = [];
  try {
    let storedNative = batteryOverride === undefined ? await optionalLoad(candidate.identity, 1, 'battery') : null;
    if (batteryOverride === undefined && !storedNative) {
      const legacy = await readLegacyBattery(prepared.metadata.canonical_sha256, { reference: prepared.metadata.source === 'reference-demo' });
      if (legacy) {
        const envelope = await makeStateEnvelope(legacy, candidate.identity, { kind: 'battery', label: 'Copie en lecture seule du prototype 0.3' });
        await vault.put(candidate.identity, 1, envelope); storedNative = { bytes: legacy, envelope };
        event('battery.legacy.copied', { bytes: legacy.length, payload_sha256: envelope.payload_sha256 });
      }
    }
    const native = batteryOverride !== undefined ? batteryOverride : storedNative?.bytes ?? null;
    inheritedHistory = storedNative?.envelope.metadata.cheats.map(row => ({ ...row, enabled: false })) ?? [];
    status(state ? 'Restauration dans une session neuve…' : 'Démarrage du jeu…');
    candidate.history = history.length ? history : inheritedHistory;
    candidate.tainted = candidate.history.length > 0;
    await sessions.start(candidate, { battery: native, state, cheats,
      expectedIdentity: state || restoreNative ? sessions.current?.identity : null,
      beforeCommit: state || restoreNative ? async () => {
        if (restoreNative) {
          const captured = candidate.api.captureBattery();
          if (!native || !captured || await sha256(captured) !== await sha256(native)) {
            throw Object.assign(new Error('La sauvegarde native relue par le cœur diffère de la copie demandée. Restauration annulée ; le coffre et la partie précédente sont conservés.'), { code: 'E_NATIVE_RESTORE_VERIFY' });
          }
          candidate.nativeRestoreProof = { payload_sha256: await sha256(captured), bytes: captured.length, verified: true };
          return;
        }
        // No persistent write is allowed before native restoration is witnessed.
        // A storage failure here still resumes the retained, untouched session.
        const restoredNative = await prepareNativeWrite(candidate);
        if (restoredNative?.entry) await vault.putBatch(candidate.identity, [restoredNative.entry]);
      } : null });
  } catch (error) { if (candidate.frame.isConnected && sessions.current !== candidate) await sessions.dispose(candidate); throw error; }
  candidate.history = history.length ? history : inheritedHistory; candidate.cheats = cheats; candidate.tainted = candidate.history.length > 0;
  activeRom = prepared.metadata; selected = null; lastNativeHash = null; identity(activeRom);
  $('rom-current').textContent = activeRom.name; $('engine-state').textContent = 'Moteur lancé : ' + activeRom.name;
  phase = 'started'; status('Session lancée. Vérifiez l’image et le son ; vous pouvez choisir un autre jeu sans fermer l’application.');
  event('rom.validated', { ...activeRom, license: activeRom.source === 'reference-demo' ? 'MIT homebrew reference' : 'Not asserted for local user file' });
  await refreshSavesOrWarn(); void renderCatalog(); controls();
}
async function reference() {
  const response = await fetch('homebrew/fallback-open/build-info.json'); if (!response.ok) throw new Error('Démo absente.'); lock = await response.json();
  const rom = await fetch('homebrew/fallback-open/demo-emuperso-open.z64'); if (!rom.ok) throw new Error('Démo absente.');
  const prepared = await prepareRomBytes(new Uint8Array(await rom.arrayBuffer()), 'demo-emuperso-open.z64', 'reference-demo');
  if (prepared.metadata.source_sha256 !== lock.rom.sha256) throw new Error('Empreinte de la démo non conforme.');
  event('rom.fetched', { bytes: prepared.bytes.length, sha256: prepared.metadata.source_sha256 }); return prepared;
}
$('choose-rom').onclick = $('reload').onclick = () => { if (busy) return; $('rom-file').value = ''; $('rom-file').click(); };
$('rom-file').onchange = async eventObject => {
  const file = eventObject.target.files[0]; if (!file || busy) return;
  invalidateImport(); const ticket = generation; importAbort = new AbortController(); const controller = importAbort;
  selected = null; reading = true; identity(null); controls(); status('Lecture du fichier local…');
  try {
    let prepared;
    if (/\.zip$/i.test(file.name)) {
      const archive = await readZipFile(file, { signal: controller.signal }); if (ticket !== generation) return;
      event('rom.zip.inspected', { ...archive.archive, rom_count: archive.entries.length });
      if (archive.entries.length > 1) {
        zipPending = { archive, ticket, controller };
        for (const entry of archive.entries) { const option = document.createElement('option'); option.value = String(entry.id); option.textContent = `${entry.name} — ${entry.size.toLocaleString('fr-FR')} octets`; $('zip-entry').appendChild(option); }
        $('zip-choice-panel').hidden = false; status('Choisissez la ROM à préparer dans ce ZIP.'); return;
      }
      prepared = await prepareZipRom(archive, archive.entries[0].id, { signal: controller.signal });
    } else prepared = await prepareLocalRom(file);
    if (ticket === generation) acceptPrepared(prepared);
  } catch (error) { if (ticket === generation) { event('rom.local.rejected', { code: error.code ?? 'E_READ', message: error.message }); status(error.message, true); } }
  finally { if (ticket === generation) { reading = false; controls(); } }
};
$('zip-use').onclick = async () => {
  if (busy || reading || !zipPending) return;
  const pending = zipPending, id = Number($('zip-entry').value); clearZipChoice(); reading = true; controls();
  try { const prepared = await prepareZipRom(pending.archive, id, { signal: pending.controller.signal }); if (pending.ticket === generation) acceptPrepared(prepared); }
  catch (error) { if (pending.ticket === generation) { event('rom.local.rejected', { code: error.code, message: error.message }); status(error.message, true); } }
  finally { if (pending.ticket === generation) { reading = false; controls(); } }
};
$('zip-cancel').onclick = () => { invalidateImport(); selected = null; identity(activeRom); controls(); status('Choix dans le ZIP annulé.'); };
$('start').onclick = () => operation(async () => { invalidateImport(); await startPrepared(await reference()); });
$('launch-local').onclick = () => { if (selected && !reading) { const choice = selected; void operation(() => startPrepared(choice)); } };
$('audio').onclick = () => operation(async () => { const contexts = await sessions.current.api.resumeAudio(); status(contexts.some(context => context.state === 'suspended') ? 'Audio encore suspendu : cliquez dans le jeu puis réessayez.' : 'Audio repris.'); });
$('battery-save').onclick = () => operation(() => saveNative({ force: true }));
async function loadNative(previous) {
  const current = sessions.current, loaded = await vault.load(current.identity, 1, { kind: 'battery', previous });
  if (!confirm('Redémarrer depuis cette sauvegarde native ? La progression non enregistrée en mémoire sera abandonnée. Les trois emplacements d’état restent intacts.')) return;
  await startPrepared(current.prepared, { batteryOverride: loaded.bytes, restoreNative: true,
    history: loaded.envelope.metadata.cheats.map(row => ({ ...row, enabled: false })) });
  event('battery.loaded', { previous, payload_sha256: loaded.envelope.payload_sha256, verification: sessions.current.nativeRestoreProof });
  saveStatus('Sauvegarde native relue par le vrai cœur et vérifiée ; utilisez le menu du jeu pour reprendre la partie. Les états enregistrés restent intacts.');
}
$('battery-load').onclick = () => operation(() => loadNative(false));
$('battery-previous').onclick = () => operation(() => loadNative(true));
$('state-save').onclick = () => operation(async () => {
  const current = sessions.current, slot = Number($('save-slot').value);
  try {
    await current.api.pause();
    const stateBytes = current.api.captureState(), nativeBytes = current.api.captureBattery();
    const bundle = packStateBundle(stateBytes, nativeBytes);
    const envelope = await makeStateEnvelope(bundle, current.identity, { kind: 'state', label: current.prepared.metadata.name.slice(0, 120), cheats: stateCheats(current) });
    const native = await prepareNativeWrite(current, { bytes: nativeBytes });
    const [saved] = await vault.putBatch(current.identity, [{ slot, envelope }, ...(native?.entry ? [native.entry] : [])]);
    event('state.saved', { slot, revision: saved.revision, payload_sha256: envelope.payload_sha256 });
    saveStatus('État enregistré dans l’emplacement ' + slot + '. La version précédente reste récupérable.'); await refreshSavesOrWarn();
  } finally { await current.api.play(); }
});
async function loadUserState(previous) {
  const current = sessions.current, slot = Number($('save-slot').value), loaded = await vault.load(current.identity, slot, { kind: 'state', previous });
  const history = loaded.envelope.metadata.cheats;
  if (history.length && !confirm('Cet état contient une mémoire modifiée par des cheats. Le charger rétablira ces modifications. Continuer ?')) return;
  const cheats = history.filter(row => row.enabled !== false).map(row => ({ ...row, code: validateManualCheat(row.code) }));
  const bundle = unpackStateBundle(loaded.bytes);
  await startPrepared(current.prepared, { state: bundle.state, batteryOverride: bundle.battery, cheats, history });
  event('state.loaded', { slot, previous, payload_sha256: loaded.envelope.payload_sha256, verification: sessions.current.restoreProof }); saveStatus(sessions.current.restoreProof?.already_equivalent ? 'La mémoire est déjà conforme à cet état ; aucune transition de progression n’est revendiquée.' : 'État chargé : restauration de mémoire confirmée. Vérifiez votre progression, l’image et le son.');
}
$('state-load').onclick = () => operation(() => loadUserState(false));
$('state-previous').onclick = () => operation(() => loadUserState(true));
$('save-slot').onchange = () => { void refreshSaves().catch(error => saveStatus(error.message, true)); };
$('reset-clean').onclick = () => operation(async () => {
  if (!confirm('Redémarrer le jeu sans cheats ? La partie en mémoire recommencera ; les sauvegardes conservées ne seront pas effacées.')) return;
  await startPrepared(sessions.current.prepared); event('cheats.reset.clean'); status('Session et mémoire neuves, cheats désactivés. La sauvegarde native du jeu est conservée.');
});
async function preCheatCheckpoint() {
  const current = sessions.current; if (current.tainted) return;
  const token = 'avant-cheats-' + crypto.randomUUID();
  try {
    await current.api.pause();
    const nativeBytes = current.api.captureBattery();
    const bundle = packStateBundle(current.api.captureState(), nativeBytes);
    const state = await makeStateEnvelope(bundle, current.identity, { kind: 'checkpoint', label: token });
    const native = nativeBytes ? await makeStateEnvelope(nativeBytes, current.identity, { kind: 'battery', label: token }) : null;
    await vault.putBatch(current.identity, [{ slot: 2, envelope: state }, ...(native ? [{ slot: 2, envelope: native }] : [])]);
    current.beforeCheats = { token, hasBattery: !!nativeBytes, native_sha256: native?.payload_sha256 ?? null };
    event('cheats.checkpoint.saved', { token, native: !!nativeBytes });
  } finally { await current.api.play(); }
}
$('reset-before-cheats').onclick = () => operation(async () => {
  const current = sessions.current, saved = await vault.load(current.identity, 2, { kind: 'checkpoint' });
  const bundle = unpackStateBundle(saved.bytes);
  if (!confirm('Revenir au point d’avant les cheats ? La progression depuis ce point sera abandonnée. Les états enregistrés restent conservés.')) return;
  await startPrepared(current.prepared, { state: bundle.state, batteryOverride: bundle.battery });
  event('cheats.reset.before'); status('Point d’avant les cheats restauré ; aucun cheat actif.');
});
async function toggleCheat(row, enabled, parameter = null) {
  const current = sessions.current, code = row.manual ? validateManualCheat(row.code) : resolveCheatCode(row, parameter);
  if (enabled) await preCheatCheckpoint();
  const remaining = current.cheats.filter(cheat => cheat.id !== row.id);
  if (enabled) remaining.push({ id: row.id, name: row.name, code, enabled: true });
  current.api.setCheats(remaining); current.cheats = remaining;
  const history = (current.history ?? []).filter(cheat => cheat.id !== row.id);
  history.push({ id: row.id, name: row.name, code, enabled }); current.history = history; current.tainted = true;
  event('cheats.changed', { count: remaining.length });
  $('cheat-status').textContent = `${remaining.length} cheat(s) actif(s). Désactiver arrête les écritures ; un redémarrage propre ou le point d’avant cheats retire les effets en mémoire.`; renderCheatRows();
}
function renderCheatRows() {
  const query = $('cheat-search').value.trim().toLocaleLowerCase('fr-FR'), current = sessions.current; $('cheat-list').replaceChildren();
  const rows = cheatRows.filter(row => !query || (row.name + ' ' + (row.description ?? '')).toLocaleLowerCase('fr-FR').includes(query));
  for (const row of rows) {
    const container = document.createElement('div'); container.className = 'cheat-row';
    const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.dataset.cheatId = row.id; input.dataset.unsupported = String(!row.supported);
    input.checked = !!current?.cheats.find(cheat => cheat.id === row.id);
    const title = document.createElement('span'); title.textContent = row.name; label.append(input, title); container.append(label);
    let select = null;
    if (row.options?.length) {
      select = document.createElement('select'); select.setAttribute('aria-label', 'Valeur pour ' + row.name);
      for (const option of row.options) { const item = document.createElement('option'); item.value = option.value; item.textContent = option.label; select.append(item); } container.append(select);
    }
    const note = document.createElement('small'); note.textContent = row.supported ? row.manual ? 'Code manuel : non validé automatiquement.' : 'Catalogue communautaire : effets non vérifiés sur votre ROM.' : row.unsupported_reason; container.append(note);
    input.onchange = () => { const enable = input.checked; void operation(() => toggleCheat(row, enable, select?.value)).then(renderCheatRows); };
    if (select) select.onchange = () => { if (input.checked) void operation(() => toggleCheat(row, true, select.value)); };
    $('cheat-list').append(container);
  }
  $('cheat-count').textContent = `${rows.length} code(s) affiché(s) sur ${cheatRows.length}.`; controls();
}
async function renderCatalog(variantId = null) {
  const current = sessions.current, ticket = ++catalogTicket; cheatRows = []; $('cheat-list').replaceChildren(); $('cheat-variant').hidden = true; $('cheat-status').textContent = 'Recherche des codes pour ce jeu…';
  try {
    catalog ??= await loadCheatCatalog();
    const result = await lookupCheats(romCheatIdentity(current.prepared.bytes), { catalog, variantId });
    if (ticket !== catalogTicket || current !== sessions.current) return;
    if (result.ambiguous) {
      $('cheat-variant').replaceChildren(); const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Identification ambiguë : choisir la variante'; $('cheat-variant').append(empty);
      for (const game of result.matches) { const option = document.createElement('option'); option.value = game.id; option.textContent = game.name; $('cheat-variant').append(option); } $('cheat-variant').hidden = false;
    }
    cheatRows = [...result.cheats];
    const manuals = new Map([...(current.manualCheats ?? []), ...(current.history ?? []).filter(row => row.id.startsWith('manual-'))].map(row => [row.id, row]));
    for (const manual of manuals.values()) cheatRows.push({ ...manual, manual: true, supported: true, options: [] });
    $('cheat-status').textContent = result.ambiguous ? 'Plusieurs variantes partagent cet en-tête : aucun code sélectionné automatiquement.' : result.found ? `${result.game.name} · codes liés à l’en-tête/région, effets non vérifiés ici. Aucun code activé par le catalogue.` : 'Aucun code du catalogue pour cet en-tête. Vous pouvez ajouter un code manuel.';
    $('catalog-info').textContent = `Catalogue local : ${catalog.game_count} versions, ${catalog.cheat_count} codes répertoriés. Une correspondance d’en-tête ne garantit pas la compatibilité d’un code.`; renderCheatRows();
  } catch (error) { if (ticket === catalogTicket) { $('cheat-status').textContent = error.message + ' Les codes manuels restent disponibles.'; event('cheats.catalog.unavailable', { message: error.message }); } }
}
$('cheat-search').oninput = renderCheatRows;
$('cheat-variant').onchange = () => { if ($('cheat-variant').value) void renderCatalog($('cheat-variant').value); };
$('cheat-add').onclick = () => operation(async () => {
  const name = $('cheat-manual-name').value.trim(), code = validateManualCheat($('cheat-manual-code').value);
  if (!name || name.length > 120) throw new Error('Donnez un nom court à ce code.');
  const row = { id: 'manual-' + crypto.randomUUID(), name, description: '', code, manual: true, supported: true, options: [] };
  (sessions.current.manualCheats ??= []).push(row); cheatRows.push(row);
  $('cheat-manual-name').value = ''; $('cheat-manual-code').value = ''; renderCheatRows(); $('cheat-status').textContent = 'Code ajouté désactivé. Cochez-le pour l’appliquer après création du point de retour.';
});
$('cheat-disable-all').onclick = () => operation(async () => {
  const current = sessions.current; current.api.setCheats([]); current.cheats = []; current.history = (current.history ?? []).map(row => ({ ...row, enabled: false }));
  renderCheatRows(); event('cheats.changed', { count: 0 }); $('cheat-status').textContent = 'Tous les codes sont désactivés. Pour retirer leurs effets en mémoire, utilisez Réinitialiser sans cheats ou Revenir avant les cheats.';
});
function downloadJSON(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url;
  anchor.download = filename.replace(/\.json$/i, '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  // Allow the browser download manager time to consume the Blob, including on
  // slower machines after a large save export. This timer never blocks the UI.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
$('save-export').onclick = () => operation(async () => {
  const stored = await vault.load(sessions.current.identity, Number($('save-slot').value), { kind: 'state' }), bytes = stored.bytes;
  let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  downloadJSON({ ...stored.envelope, payload: undefined, payload_base64: btoa(binary) }, 'N64-sauvegarde-emplacement-' + $('save-slot').value + '.json'); saveStatus('Copie de sauvegarde exportée sur votre PC. Elle contient l’état du jeu, aucune ROM.');
});
$('save-import').onclick = () => { $('save-import-file').value = ''; $('save-import-file').click(); };
$('save-import-file').onchange = inputEvent => {
  const file = inputEvent.target.files[0]; if (!file || busy || !sessions.current) return;
  void operation(async () => {
    if (!/\.json$/i.test(file.name) || file.size > 90 * 1024 * 1024) throw new Error('Copie d’état JSON attendue, 90 Mio maximum.');
    const record = JSON.parse(await file.text()), encoded = record.payload_base64;
    if (typeof encoded !== 'string' || encoded.length > Math.ceil(MAX_SAVE_BYTES / 3) * 4 || encoded.length % 4 !== 0) throw new Error('Contenu de sauvegarde encodé invalide.');
    const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
    if (/[^A-Za-z0-9+/]/.test(encoded.slice(0, encoded.length - padding))) throw new Error('Contenu de sauvegarde encodé invalide.');
    const binary = atob(encoded), payload = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) payload[i] = binary.charCodeAt(i);
    const envelope = { schema: record.schema, id: record.id, created_utc: record.created_utc, kind: record.kind,
      identity: record.identity, payload_size: record.payload_size, payload_sha256: record.payload_sha256,
      header_sha256: record.header_sha256, metadata: record.metadata, payload };
    await verifyEnvelope(envelope, sessions.current.identity, { kind: 'state' });
    unpackStateBundle(payload);
    if (!confirm('Importer cette copie dans l’emplacement choisi ? La version actuelle sera conservée en version précédente.')) return;
    await vault.put(sessions.current.identity, Number($('save-slot').value), envelope); await refreshSavesOrWarn();
    event('state.imported', { slot: Number($('save-slot').value), payload_sha256: envelope.payload_sha256 }); saveStatus('Copie importée et vérifiée. Le jeu en cours n’a pas été remplacé.');
  });
};
$('persist-request').onclick = async () => {
  try { const granted = await navigator.storage?.persist?.(); saveStatus(granted ? 'Stockage persistant accordé par le navigateur.' : 'Le navigateur n’a pas accordé la persistance renforcée. Exportez vos sauvegardes importantes.'); } catch (error) { saveStatus(error.message, true); }
};
function diagnostic() {
  return { schema: 'emuperso/real-engine-diagnostic/v2', scope: 'REAL_ENGINE_TRIAL_NOT_SYNTHETIC_LAB', warning: 'No ROM or save payload bytes in this diagnostic. Metadata can reveal game and cheat names.',
    host: { user_agent: navigator.userAgent, cross_origin_isolated: crossOriginIsolated }, phase, local_selection: selected ? { ...selected.metadata } : null, active_rom: activeRom ? { ...activeRom } : null,
    identity: sessions.current?.identity ?? null, session: sessions.diagnostic(), storage: { database: vault.databaseName }, cheats: { active: sessions.current?.cheats ?? [], tainted: sessions.current?.tainted ?? false }, saves: saveList,
    rom_build: lock, contexts: (sessions.current?.api.snapshot().contexts ?? []).map(c => ({ state: c.state, sample_rate: c.sample_rate })), records: structuredClone(records) };
}
$('export').onclick = () => downloadJSON(diagnostic(), 'EMUPERSO-moteur-reel-diagnostic.json');
window.RealN64 = Object.freeze({ diagnostic, version: '0.5.0-rc1-verified-restore', get engineWindow() { return (sessions.candidate ?? sessions.current)?.frame.contentWindow ?? null; } });
setInterval(() => { audioStatus(); if (!busy && !reading && !zipPending && sessions.current) void operation(() => saveNative()); }, 15000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && !busy && !reading && !zipPending && sessions.current) void operation(() => saveNative()); });
window.addEventListener('pagehide', () => { importAbort?.abort(); void sessions.current?.api.close(); });
window.addEventListener('error', error => { event('browser.error', { message: error.message }); status(error.message, true); });
window.addEventListener('unhandledrejection', error => { event('browser.unhandledrejection', { message: String(error.reason) }); status(String(error.reason), true); });
event('page.open', { engine_started: false }); controls();
