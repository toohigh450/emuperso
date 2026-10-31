import { SessionController } from './controller.mjs';
import { SimulationAdapter } from './simulator.mjs';
import { makeFixture } from './fixtures.mjs';
import { copy } from './common.mjs';
import { createLatestResultGate } from './latest-result.mjs';
const byId = id => document.getElementById(id);
const journalRenderGate = createLatestResultGate();
let laboratory, unsubscribe, fixtureBank = {}, latestView, downloadCount = 0;
const stateLabels = { IDLE: 'Non initialisé', INITIALIZING: 'Initialisation', READY: 'Prêt à sélectionner', SELECTED: 'Fixture sélectionnée', LOADING: 'Chargement fictif', LOADED: 'Chargé, non lancé', RUNNING: 'Simulation active', PAUSING: 'Pause en cours', PAUSED: 'Pause confirmée', SNAPSHOTTING: 'Snapshot synthétique', RESTORING: 'Restauration synthétique', ERROR: 'Erreur — instance invalidée', STOPPED: 'Arrêté' };
function announce(text, error = false) { byId('feedback').textContent = text; byId('feedback').classList.toggle('error', error); }
function createLab() {
  journalRenderGate.invalidate();
  unsubscribe?.(); laboratory?.stop();
  laboratory = new SessionController({
    adapterFactory: () => {
      const mode = byId('fault-mode').value;
      return new SimulationAdapter({ delays: mode === 'timeout' ? { load: 150 } : {}, dishonestLoadedHash: mode === 'identity', failures: mode === 'restore' ? { rebuildHost: true } : {} });
    }, deadlines: { load: 70 }
  });
  byId('events').replaceChildren(); byId('journal-count').textContent = '0'; byId('journal-head').textContent = '—';
  const bound = laboratory; unsubscribe = bound.onChange(v => { if (laboratory === bound) render(v); }); render(bound.view());
}
function shortHash(hash) { return hash ? hash.slice(0, 14) + '…' : '—'; }
function render(v) {
  latestView = v; byId('lifecycle').textContent = stateLabels[v.state] ?? v.state; byId('state-code').textContent = v.state;
  byId('generation').textContent = 'g' + v.generation; byId('pending-command').textContent = v.busy ?? 'Aucune';
  byId('selected-identity').textContent = v.selected ? v.selected.name + ' · ' + shortHash(v.selected.sha256) : 'Aucune';
  byId('loaded-identity').textContent = shortHash(v.loaded_sha256); byId('launched-identity').textContent = shortHash(v.launched_sha256);
  for (const [id, value] of [['selected-full', v.selected?.sha256], ['loaded-full', v.loaded_sha256], ['launched-full', v.launched_sha256]]) byId(id).textContent = value ?? 'ABSENT';
  byId('active-injection').textContent = 'Configuration retenue à l’initialisation : ' + (v.simulation_configuration ? JSON.stringify(v.simulation_configuration) : 'aucune.');
  const p = v.probes;
  byId('metric-speed').textContent = p?.speed == null ? '—' : p.speed.toFixed(2) + '×';
  byId('metric-audio').textContent = p?.simulated_audio_state ?? 'absent'; byId('metric-pcm').textContent = p ? p.simulated_pcm_ms + ' ms' : '—';
  byId('metric-loops').textContent = String(p?.simulated_loops ?? 0); byId('metric-vi-ai').textContent = p ? p.vi_count + ' / ' + p.ai_count : '—';
  byId('virtual-wall').textContent = p ? p.virtual_wall_ms + ' ms fictives' : '—'; byId('emulated-time').textContent = p ? p.emulated_ms + ' ms fictives' : '—';
  byId('ai-status').textContent = p ? '0x' + p.ai_status.toString(16).toUpperCase().padStart(8, '0') : '—';
  byId('real-engine').textContent = 'Aucun moteur · 0 boucle N64 · 0 worker · 0 contexte audio/GPU';
  byId('error-code').textContent = v.last_error ? v.last_error.code + ' · ' + v.last_error.message : 'Aucune erreur courante';
  byId('error-code').classList.toggle('warning', Boolean(v.last_error));
  document.querySelectorAll('[data-states]').forEach(button => { button.disabled = Boolean(v.busy) || !button.dataset.states.split(',').includes(v.state); });
  byId('stop').disabled = v.state === 'STOPPED'; byId('fault-mode').disabled = Boolean(v.busy) || !['IDLE', 'STOPPED', 'ERROR'].includes(v.state);
  const chosen = byId('snapshot-choice').value;
  byId('snapshot-choice').replaceChildren(...v.snapshots.map(s => { const option = document.createElement('option'); option.value = s.id; option.textContent = s.id + ' · ' + shortHash(s.sha256); return option; }));
  if (v.snapshots.some(s => s.id === chosen)) byId('snapshot-choice').value = chosen;
  for (const id of ['restore', 'restore-resume', 'corrupt', 'export-snapshot']) byId(id).disabled ||= !v.snapshots.length;
  byId('snapshot-count').textContent = String(v.snapshots.length);
  byId('system-revision').textContent = v.selected ? String(laboratory.store.readSystem(laboratory.ns()).revision) : '0';
  byId('snapshot-envelope').textContent = v.snapshots.length ? JSON.stringify(laboratory.store.getSnapshot(laboratory.ns(), byId('snapshot-choice').value), null, 2) : 'Aucun snapshot synthétique.';
  byId('identity-json').textContent = JSON.stringify({ domain: v.identity_domain, generation: v.generation, selected: v.selected, loaded_sha256: v.loaded_sha256, launched_sha256: v.launched_sha256, adapter: v.descriptor }, null, 2);
  const instance = laboratory, isCurrentRender = journalRenderGate.issue();
  byId('journal-freshness').dataset.status = 'pending'; byId('journal-freshness').textContent = 'Actualisation en cours — liste précédente éventuellement ancienne.';
  instance.journal.export().then(j => {
    if (laboratory !== instance || !isCurrentRender()) return;
    byId('journal-freshness').dataset.status = 'current'; byId('journal-freshness').textContent = 'Journal actualisé — préfixe confirmé de ' + j.records.length + ' événements.';
    byId('journal-count').textContent = String(j.records.length); byId('journal-head').textContent = j.head_sha256 ?? 'Aucun';
    byId('events').replaceChildren(...j.records.slice(-70).reverse().map(r => { const item = document.createElement('div'); item.className = 'event'; const title = document.createElement('strong'); title.textContent = '#' + r.event.seq + ' · g' + r.event.generation + ' · ' + r.event.type; const detail = document.createElement('span'); detail.textContent = JSON.stringify(r.event.data); item.append(title, detail); return item; }));
  }).catch(error => { if (laboratory === instance && isCurrentRender()) { byId('journal-freshness').dataset.status = 'stale'; byId('journal-freshness').textContent = 'Journal non actualisé — liste affichée potentiellement ancienne. ' + error.message; announce(error.message, true); } });
}
async function operate(fn) {
  const target = laboratory;
  if (!target) { announce('Laboratoire pas encore prêt ou WebCrypto indisponible.', true); return; }
  try { const result = await fn(target); if (laboratory !== target) return; render(target.view()); announce('Opération du laboratoire terminée. Domaine : simulation uniquement.'); return result; }
  catch (error) { if (laboratory === target) { render(target.view()); announce((error.code ?? 'E_UI') + ' — ' + error.message, true); } }
}
function currentSnapshot(c) { const id = byId('snapshot-choice').value; if (!id) throw new Error('Créer un snapshot synthétique avant de restaurer.'); return c.store.getSnapshot(c.ns(), id); }
function download(name, value) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); downloadCount++; setTimeout(() => URL.revokeObjectURL(url), 1000); }
function confirmation(message) { const dialog = byId('confirmation'); dialog.returnValue = ''; byId('confirmation-detail').textContent = message; return new Promise(resolve => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true }); dialog.showModal(); }); }
byId('initialize').onclick = () => operate(c => c.initialize());
byId('select').onclick = () => operate(c => c.select(fixtureBank[byId('fixture-choice').value]));
byId('load').onclick = () => operate(c => c.load());
byId('start').onclick = () => operate(c => c.start());
byId('pause').onclick = () => operate(c => c.pause());
byId('resume').onclick = () => operate(c => c.resume());
byId('stop').onclick = () => { if (!laboratory) { announce('Laboratoire pas encore prêt.', true); return; } laboratory.stop(); announce('Arrêt confirmé. Toute génération en attente a été invalidée.'); };
byId('step').onclick = () => operate(c => c.advance());
byId('drift').onclick = () => operate(c => c.advance({ wall_ms: 1000, emulated_ms: 1800 }));
byId('full-pcm').onclick = () => operate(c => c.advance({ consume_pcm: false }));
byId('pcm-empty').onclick = () => operate(c => c.advance({ produce_pcm: false }));
byId('suspend-audio').onclick = () => operate(c => c.changeAudio('suspended'));
byId('save').onclick = () => operate(async c => { const saved = await c.saveSnapshot(); byId('snapshot-choice').value = saved.id; return saved; });
byId('snapshot-choice').onchange = () => render(laboratory.view());
byId('restore').onclick = () => operate(c => c.restoreSnapshot(currentSnapshot(c)));
byId('restore-resume').onclick = () => operate(c => c.restoreSnapshot(currentSnapshot(c), { resume: true }));
byId('corrupt').onclick = () => operate(c => { const altered = copy(currentSnapshot(c)); altered.payload.cpu_steps++; return c.restoreSnapshot(altered); });
byId('export-snapshot').onclick = () => operate(c => { download('N64Lab-SYNTHETIC.lab-snapshot.json', currentSnapshot(c)); return { downloaded: 'synthetic-payload-only' }; });
byId('write-system').onclick = async () => {
  const target = laboratory; if (!target) return; const generation = target.generation;
  if (!await confirmation('Autoriser UNE révision de données système SYNTHÉTIQUES en mémoire volatile ? Ce jeton sera lié à la génération, à la cible, à la révision et au contenu. Aucune vraie sauvegarde ne sera écrite.')) { announce('Consentement refusé. Aucune écriture synthétique.'); return; }
  if (target !== laboratory || generation !== target.generation) { announce('Session changée : consentement abandonné.', true); return; }
  await operate(async c => { const payload = { schema: 'n64lab/synthetic-system/v1', synthetic: true, note: 'EXEMPLE DE DONNÉES SYSTÈME, PAS UNE SAUVEGARDE N64' }; const consent = await c.requestSystemConsent(payload); const result = await c.writeSystem(payload, consent); byId('system-revision').textContent = String(result.revision); return result; });
};
byId('verify-journal').onclick = () => operate(async c => { const journal = await c.journal.export(); await c.journal.verify(journal); byId('journal-verdict').textContent = 'CHAÎNE SHA-256 VÉRIFIÉE — intégrité, pas signature ni preuve d’émulation'; return { verified: true }; });
byId('export-diagnostic').onclick = () => operate(async c => { const d = await c.diagnostic(); d.host.browser_user_agent = navigator.userAgent; d.host.capability_presence_only = { crypto_subtle: Boolean(globalThis.crypto?.subtle), cross_origin_isolated: globalThis.crossOriginIsolated === true, audio_constructor_present: typeof globalThis.AudioContext === 'function', webgl2_constructor_present: typeof globalThis.WebGL2RenderingContext === 'function' }; download('N64Lab-diagnostic-SIMULATION.json', d); return { exported: true }; });
byId('reset').onclick = async () => { if (!await confirmation('Ouvrir un laboratoire neuf et effacer les fixtures sélectionnées, snapshots et journaux en mémoire ? Exportez d’abord les éléments souhaités. Aucun fichier de jeu ne sera affecté.')) return; createLab(); byId('snapshot-envelope').textContent = 'Aucun snapshot synthétique.'; byId('system-revision').textContent = '0'; byId('journal-verdict').textContent = 'Non vérifiée pour ce nouveau journal'; announce('Laboratoire neuf, données volatiles réinitialisées.'); };
for (const button of document.querySelectorAll('nav button')) button.onclick = () => { document.querySelectorAll('nav button').forEach(n => n.setAttribute('aria-current', n === button ? 'page' : 'false')); document.querySelectorAll('main>section').forEach(s => s.hidden = s.id !== button.dataset.target); byId('main').focus(); window.scrollTo(0, 0); };
globalThis.N64Lab = Object.freeze({ view: () => laboratory?.view(), diagnostic: () => laboratory.diagnostic(), verifyJournal: data => laboratory.journal.verify(data), version: '1.0.2-candidate-phase1a', downloads: () => downloadCount });
(async () => { try { if (!globalThis.crypto?.subtle) throw new Error('WebCrypto indisponible. Ouvrez le fichier dans un contexte local sûr ; aucun remplacement par un hash faible.'); fixtureBank = { pal: await makeFixture('PAL-A'), ntsc: await makeFixture('NTSC-A', 'NTSC'), second: await makeFixture('PAL-B') }; createLab(); announce('Fondation prête. Initialisez le simulateur ; aucune ROM ne peut être importée.'); } catch (error) { announce('E_CRYPTO_UNAVAILABLE — ' + error.message, true); } })();
