// SPDX-License-Identifier: MIT
// Lanceur GameCube ALPHA : valide l'image, prépare __portablesBoots pour gcplayer.html,
// persiste la carte mémoire 2 Mio en IndexedDB (local uniquement).
import { isZip, listCandidates } from './zip.mjs';

const $ = (id) => document.getElementById(id);
const GC_EXTENSIONS = new Set(['iso', 'gcm', 'rvz', 'dol', 'bin']);
const GC_ZIP_ACCEPT = new Set(['iso', 'gcm', 'rvz', 'dol']);
const GC_MAGIC = 0xc2339f3d;
const MEMCARD_BYTES = 2 * 1024 * 1024;
const GC_MAX_BYTES = 1536 * 1024 * 1024;
const MiB = 1024 * 1024;

const say = (text, isError = false) => { $('status').textContent = text; $('status').classList.toggle('error', isError); };
const log = (kind, message) => {
  const line = document.createElement('div');
  line.className = 'log-line' + (kind === 'erreur moteur' || kind === 'avertissement sauvegarde' ? ' warn' : '');
  line.textContent = `[${kind}] ${message}`;
  $('log').appendChild(line); $('log').scrollTop = $('log').scrollHeight;
};
const extensionOf = (name) => { const m = /\.([^.\\/]+)$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; };
const stemOf = (name) => String(name || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
const fmtSize = (n) => n >= GiB ? `${(n / GiB).toFixed(1)} Gio` : `${Math.ceil(n / MiB)} Mio`;
const GiB = 1024 * MiB;

function gameCubeIdFromHead(head) {
  if (!head || head.length < 0x20) return null;
  const magic = ((head[0x1c] << 24) | (head[0x1d] << 16) | (head[0x1e] << 8) | head[0x1f]) >>> 0;
  if (magic !== GC_MAGIC) return null;
  const id = String.fromCharCode(head[0], head[1], head[2], head[3], head[4], head[5]);
  return /^[A-Z0-9]{6}$/.test(id) ? id : null;
}

// --- Carte mémoire : IndexedDB local, une image de 2 Mio par jeu ---
const cardDB = (() => {
  const open = () => new Promise((ok, ko) => {
    const r = indexedDB.open('emuperso-gamecube-v1', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('cards'); r.result.createObjectStore('meta'); };
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  });
  const run = async (mode, fn) => {
    const db = await open();
    try { return await new Promise((ok, ko) => { const q = fn(db.transaction(mode === 'read' ? 'readonly' : 'readwrite').objectStore(mode === 'read' ? 'cards' : 'cards')); q.onsuccess = () => ok(q.result); q.onerror = () => ko(q.error); }); }
    finally { db.close(); }
  };
  return {
    get: (key) => run('read', s => s.get(key)),
    set: (key, value) => run('write', s => s.put(value, key)),
  };
})();
let currentCardKey = null, currentCard = null, cardDirty = false;
async function loadCard(key) {
  currentCardKey = key; currentCard = null; cardDirty = false;
  try {
    const rec = await cardDB.get(key);
    if (rec && rec.bytes instanceof Uint8Array && rec.bytes.length === MEMCARD_BYTES) {
      currentCard = rec.bytes;
      $('card-status').textContent = `Carte mémoire : ${fmtSize(rec.bytes.length)} enregistrée (${new Date(rec.utc).toLocaleString('fr-FR')})`;
      return;
    }
  } catch { /* stockage indisponible : carte vierge */ }
  $('card-status').textContent = 'Carte mémoire : neuve (2 Mio vierges) — le jeu la formatera si besoin.';
}
function scheduleCardSave() { cardDirty = true; }
async function flushCard() {
  if (!cardDirty || !currentCardKey || !currentCard) return;
  cardDirty = false;
  try { await cardDB.set(currentCardKey, { bytes: currentCard, utc: new Date().toISOString() }); $('card-status').textContent = `Carte mémoire enregistrée (${fmtSize(currentCard.length)}).`; }
  catch { $('card-status').textContent = 'Carte mémoire : sauvegarde locale impossible (stockage navigateur).'; }
}
setInterval(() => { if (cardDirty) void flushCard(); }, 5000);
window.addEventListener('pagehide', () => { void flushCard(); });

// --- Validation de l'image ---
async function validateFile(file) {
  const ext = extensionOf(file.name);
  if (!GC_EXTENSIONS.has(ext) && ext !== 'zip') throw new Error(`Format non reconnu (.${ext || '?'}). Acceptés : .iso, .gcm, .rvz, .dol, .bin ou un .zip qui en contient un.`);
  if (file.size === 0) throw new Error('Le fichier est vide.');
  if (file.size > GC_MAX_BYTES) throw new Error(`Image trop grosse (${fmtSize(file.size)}, maximum ${fmtSize(GC_MAX_BYTES)}).`);
  if (ext === 'zip') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isZip(bytes)) throw new Error('Ce .zip n’est pas une archive ZIP valide.');
    const candidates = listCandidates(bytes, GC_ZIP_ACCEPT).filter(c => GC_EXTENSIONS.has(extensionOf(c.name)));
    if (candidates.length !== 1) throw new Error(candidates.length === 0 ? 'Aucun jeu GameCube dans ce ZIP.' : `Plusieurs images GameCube dans ce ZIP (${candidates.map(c => c.name).join(', ')}) : extrais celle voulue et choisis-la directement.`);
    return { romName: file.name, note: `Jeu dans le ZIP : ${candidates[0].name}` };
  }
  if (ext === 'iso' || ext === 'gcm' || ext === 'bin') {
    const head = new Uint8Array(await file.slice(0, 0x20).arrayBuffer());
    if (!gameCubeIdFromHead(head)) throw new Error('En-tête GameCube absent : le mot de magie à 0x1C ne correspond pas à une image de disque GameCube.');
  }
  return { romName: file.name, note: ext === 'rvz' ? 'Image RVZ compressée : en-tête non vérifiable, le moteur contrôle au chargement.' : ext === 'dol' ? 'DOL : homebrew/exécutable, sans en-tête de disque.' : '' };
}

// --- Boot : crée l'iframe gcplayer et lui fournit __portablesBoots ---
let bootId = null, running = false;
async function launch(file, info) {
  stopEngine();
  $('player').replaceChildren();
  $('log').replaceChildren();
  say('Préparation…');
  await loadCard(stemOf(file.name));
  const memcard = currentCard ? new Uint8Array(currentCard) : null;
  bootId = `gc${Date.now().toString(36)}`;
  window.__portablesBoots = window.__portablesBoots || {};
  const events = {
    onReady() { say('Moteur prêt.'); },
    onStart() { running = true; say('Jeu lancé.'); $('launch').disabled = true; },
    onExit() { running = false; say('Session terminée.'); $('launch').disabled = false; },
    onError(message) { say(message, true); log('erreur moteur', message); $('launch').disabled = false; },
  };
  window.__portablesBoots[bootId] = {
    boot: {
      rom: { name: file.name, file, bytes: null, size: file.size },
      gc: { memcard },
      onLog: log,
      onSaveUpdate: ({ save }) => {
        if (save && save.length === MEMCARD_BYTES) {
          currentCard = new Uint8Array(save);
          scheduleCardSave();
        }
      },
    },
    events,
  };
  const frame = document.createElement('iframe');
  frame.className = 'player-frame';
  frame.title = 'Émulateur GameCube (Gecko WASM/WebGPU)';
  frame.setAttribute('allow', 'autoplay; gamepad; fullscreen');
  frame.setAttribute('allowfullscreen', '');
  frame.src = `gcplayer.html?id=${encodeURIComponent(bootId)}`;
  $('player').appendChild(frame);
  if (info.note) log('avertissement', info.note);
  log('etape', `Image : ${file.name} (${fmtSize(file.size)})`);
}
function stopEngine() {
  if (bootId && window.__portablesBoots) {
    const entry = window.__portablesBoots[bootId];
    delete window.__portablesBoots[bootId];
    if (entry && entry.control && typeof entry.control.flush === 'function') { try { entry.control.flush(); } catch {} }
  }
  bootId = null; running = false;
  $('launch').disabled = !$('game-file').files.length;
}

// --- UI ---
$('pick').onclick = () => $('game-file').click();
$('game-file').onchange = () => { $('launch').disabled = !$('game-file').files.length; say('Prêt.'); };
$('launch').onclick = async () => {
  const file = $('game-file').files[0]; if (!file) return;
  $('launch').disabled = true;
  try {
    const info = await validateFile(file);
    if (file.size > 256 * MiB && !confirm(`Image de ${fmtSize(file.size)}. Le moteur WASM la charge entièrement en mémoire (interprété, sans audio, vitesse souvent sous le natif). Continuer ?`)) { say('Ouverture annulée.'); return; }
    await launch(file, info);
  } catch (error) { say(error.message, true); }
  finally { $('launch').disabled = !file; }
};
$('stop').onclick = () => { stopEngine(); $('player').replaceChildren(); say('Session fermée.'); };
$('export-card').onclick = async () => {
  await flushCard();
  if (!currentCard) { say('Aucune carte mémoire pour ce jeu.', true); return; }
  const blob = new Blob([currentCard], { type: 'application/octet-stream' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${stemOf($('game-file').files[0]?.name || 'gamecube')}-memcard-2mb.mcr`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
$('import-card').onclick = () => $('card-file').click();
$('card-file').onchange = async () => {
  const file = $('card-file').files[0]; $('card-file').value = ''; if (!file) return;
  if (file.size !== MEMCARD_BYTES) { say('Sauvegarde GameCube : image de carte mémoire de 2 Mio attendue (.mcr/.raw/.bin).', true); return; }
  currentCard = new Uint8Array(await file.arrayBuffer()); cardDirty = true;
  if (running) say('Carte importée : elle sera utilisée à la prochaine session (le moteur ne la recharge pas à chaud).', true);
  else say('Carte importée.');
  await flushCard();
};
window.addEventListener('pagehide', stopEngine);

// Pré-vérification WebGPU (informatif ; gcplayer refait le contrôle complet)
if (!navigator.gpu) log('avertissement', 'Ce navigateur n’a pas WebGPU : utilise Chrome/Edge récent (ou Safari 26+).');
else navigator.gpu.requestAdapter().then(a => { if (a) $('webgpu-badge').hidden = false; }).catch(() => {});
say('Prêt. Choisis une image GameCube.');
