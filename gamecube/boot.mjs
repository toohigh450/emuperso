// SPDX-License-Identifier: MIT
// Lanceur GameCube ALPHA : valide l'image, prépare __portablesBoots pour gcplayer.html,
// persiste la carte mémoire 2 Mio en IndexedDB (local uniquement).
import { isZip, listCandidates, readEntryPrefix } from './zip.mjs';

const $ = (id) => document.getElementById(id);
// .dol exclu : le chargeur plante (panic hors limites upstream Gecko).
const GC_EXTENSIONS = new Set(['iso', 'gcm', 'rvz', 'bin']);
const GC_ZIP_ACCEPT = new Set(['iso', 'gcm', 'rvz']);
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
// Filet synchrone : cardDB (IndexedDB) peut être tué par le déchargement de
// page sur pagehide — même risque que la carte PS1. localStorage.setItem est
// synchrone et survit ; 2 Mio -> ~2,7 Mio base64 (quota ~5 Mio, try/catch).
const cardLsKey = key => 'emuperso-gc-card:' + key;
// Évince les miroirs les plus anciens (hors clé courante) jusqu'à ce que
// l'écriture passe — une carte fait ~2,7 Mio base64 et le quota est ~5 Mio.
function cardLsEvictExcept(keepKey) {
  const entries = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('emuperso-gc-card:') || k === keepKey) continue;
      let utc = '';
      try { utc = JSON.parse(localStorage.getItem(k) || '{}').utc || ''; } catch { }
      entries.push([k, utc]);
    }
    entries.sort((a, b) => a[1].localeCompare(b[1]));
    for (const [k] of entries) localStorage.removeItem(k);
  } catch { }
}
function cardLsWrite(key, bytes) {
  let payload;
  try {
    let bin = ''; const CH = 8192;
    for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
    payload = JSON.stringify({ utc: new Date().toISOString(), b64: btoa(bin) });
  } catch { return false; }
  try { localStorage.setItem(cardLsKey(key), payload); return true; }
  catch {
    try {
      cardLsEvictExcept(cardLsKey(key));
      localStorage.setItem(cardLsKey(key), payload);
      return true;
    } catch { return false; }
  }
}
function cardLsRead(key) {
  try {
    const raw = localStorage.getItem(cardLsKey(key)); if (!raw) return null;
    const { utc, b64 } = JSON.parse(raw); if (!utc || !b64) return null;
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.length === MEMCARD_BYTES ? { bytes, utc } : null;
  } catch { return null; }
}
async function loadCard(key, legacyKey = null) {
  currentCardKey = key; currentCard = null; cardDirty = false;
  // Identité par ID de disque quand l'en-tête le fournit (gc:XXXXXX) ; repli
  // non destructif sur l'ancienne clé stem pour les cartes déjà enregistrées.
  const keys = legacyKey && legacyKey !== key ? [key, legacyKey] : [key];
  let rec = null;
  for (const k of keys) {
    try {
      const got = await cardDB.get(k);
      if (got && got.bytes instanceof Uint8Array && got.bytes.length === MEMCARD_BYTES && (!rec || Date.parse(got.utc || '') > Date.parse(rec.utc || ''))) rec = { bytes: got.bytes, utc: got.utc };
    } catch { /* stockage indisponible : carte vierge */ }
    const ls = cardLsRead(k);
    if (ls && (!rec || Date.parse(ls.utc) > Date.parse(rec.utc || ''))) rec = ls;
  }
  if (rec) {
    currentCard = rec.bytes;
    $('card-status').textContent = `Carte mémoire : ${fmtSize(rec.bytes.length)} enregistrée (${new Date(rec.utc).toLocaleString('fr-FR')})`;
    return;
  }
  $('card-status').textContent = 'Carte mémoire : neuve (2 Mio vierges) — le jeu la formatera si besoin.';
}
function scheduleCardSave() { cardDirty = true; }
async function flushCard() {
  if (!cardDirty || !currentCardKey || !currentCard) return;
  cardDirty = false;
  // Le miroir synchrone part AVANT la transaction IndexedDB : il survit même
  // si la page se décharge pendant l'écriture asynchrone.
  const mirrored = cardLsWrite(currentCardKey, currentCard);
  try {
    await cardDB.set(currentCardKey, { bytes: currentCard, utc: new Date().toISOString() });
    $('card-status').textContent = `Carte mémoire enregistrée (${fmtSize(currentCard.length)}).` + (mirrored ? '' : ' (miroir localStorage indisponible : quota).');
  } catch {
    $('card-status').textContent = mirrored
      ? 'Carte mémoire : sauvegarde locale impossible (stockage navigateur).'
      : 'Carte mémoire : sauvegarde locale impossible — stockage plein (ni IndexedDB ni miroir).';
  }
}
setInterval(() => { if (cardDirty) void flushCard(); }, 5000);
window.addEventListener('pagehide', () => { void flushCard(); });

// RVZ : en-tête propre (~0x58 octets) puis l'en-tête disque GameCube — vérifié
// sur images réelles (magic 'RVZ' à 0x00, GC_MAGIC à 0x58+0x1C).
function gcIdFromRvzHead(head) {
  if (!head) return null;
  if (head.length >= 3 && head[0] === 0x52 && head[1] === 0x56 && head[2] === 0x5a && head.length >= 0x78) {
    return gameCubeIdFromHead(head.subarray(0x58));
  }
  return gameCubeIdFromHead(head.subarray(0, Math.min(0x20, head.length)));
}

// --- Validation de l'image ---
async function validateFile(file) {
  const ext = extensionOf(file.name);
  if (!GC_EXTENSIONS.has(ext) && ext !== 'zip') throw new Error(`Format non reconnu (.${ext || '?'}). Acceptés : .iso, .gcm, .rvz, .bin ou un .zip qui en contient un (.dol non pris en charge : le moteur plante).`);
  if (file.size === 0) throw new Error('Le fichier est vide.');
  if (file.size > GC_MAX_BYTES) throw new Error(`Image trop grosse (${fmtSize(file.size)}, maximum ${fmtSize(GC_MAX_BYTES)}).`);
  if (ext === 'zip') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isZip(bytes)) throw new Error('Ce .zip n’est pas une archive ZIP valide.');
    const candidates = listCandidates(bytes, GC_ZIP_ACCEPT).filter(c => GC_EXTENSIONS.has(extensionOf(c.name)));
    if (candidates.length !== 1) throw new Error(candidates.length === 0 ? 'Aucun jeu GameCube dans ce ZIP.' : `Plusieurs images GameCube dans ce ZIP (${candidates.map(c => c.name).join(', ')}) : extrais celle voulue et choisis-la directement.`);
    // ID de disque lisible dans l'en-tête de l'image interne (préfixe seulement,
    // sans décompresser l'archive entière) — même identité que les fichiers lâches.
    const inner = candidates[0], innerExt = extensionOf(inner.name);
    let discId = null;
    try {
      if (innerExt !== 'dol') { // garde-fou : dol n'entre plus par les extensions, mais un zip peut en cacher un
        const need = innerExt === 'rvz' ? 0x78 : 0x20;
        const prefix = await readEntryPrefix(bytes, inner, need);
        if (prefix && prefix.length >= need) discId = innerExt === 'rvz' ? gcIdFromRvzHead(prefix) : gameCubeIdFromHead(prefix);
      }
    } catch { /* en-tête illisible : repli sur le nom de fichier */ }
    return { romName: file.name, discId, note: `Jeu dans le ZIP : ${inner.name}` };
  }
  if (ext === 'iso' || ext === 'gcm' || ext === 'bin') {
    const head = new Uint8Array(await file.slice(0, 0x20).arrayBuffer());
    const discId = gameCubeIdFromHead(head);
    if (!discId) throw new Error('En-tête GameCube absent : le mot de magie à 0x1C ne correspond pas à une image de disque GameCube.');
    return { romName: file.name, discId, note: '' };
  }
  if (ext === 'rvz') {
    const head = new Uint8Array(await file.slice(0, 0x78).arrayBuffer());
    const discId = gcIdFromRvzHead(head);
    return { romName: file.name, discId, note: discId ? '' : 'Image RVZ : en-tête disque non lisible, la carte mémoire sera identifiée par le nom de fichier.' };
  }
  return { romName: file.name, note: ext === 'dol' ? 'DOL : homebrew/exécutable, sans en-tête de disque.' : '' };
}

// --- Boot : crée l'iframe gcplayer et lui fournit __portablesBoots ---
let bootId = null, running = false, perfTimer = null;
async function launch(file, info) {
  await stopEngine();
  $('player').replaceChildren();
  $('log').replaceChildren();
  say('Préparation…');
  // Carte identifiée par l'ID de disque de l'en-tête quand disponible
  // (deux images homonymes ou renommées ne partagent plus la même carte) ;
  // sinon par le nom de fichier comme avant. Repli non destructif sur l'ancienne clé.
  const stem = stemOf(file.name);
  await loadCard(info.discId ? `gc:${info.discId}` : stem, stem);
  const memcard = currentCard ? new Uint8Array(currentCard) : null;
  bootId = `gc${Date.now().toString(36)}`;
  window.__portablesBoots = window.__portablesBoots || {};
  const events = {
    onReady() { say('Moteur prêt.'); },
    onStart() { running = true; say('Jeu lancé.'); $('launch').disabled = true; if ($('stop')) $('stop').disabled = false; },
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
  // Indicateur de vie : get_perf() = [fps, % vitesse native]. Interpréteur
  // WASM sans JIT — ~16-23 % attendu ; les intros DVD peuvent mettre des
  // minutes avant la première image sur les gros jeux.
  const perfEl = $('perf');
  clearInterval(perfTimer);
  perfTimer = setInterval(() => {
    try {
      const entry = bootId && window.__portablesBoots && window.__portablesBoots[bootId];
      const p = entry && entry.control && entry.control.getPerf && entry.control.getPerf();
      if (perfEl && p && p[0] > 0) {
        perfEl.hidden = false;
        perfEl.textContent = `Moteur : ${p[0].toFixed(1)} fps · ${p[1].toFixed(0)} % de la vitesse native — interpréteur WASM, la lenteur est normale (les intros DVD peuvent prendre plusieurs minutes).`;
      }
    } catch {}
  }, 2000);
  if (info.note) log('avertissement', info.note);
  log('etape', `Image : ${file.name} (${fmtSize(file.size)})`);
}
async function stopEngine() {
  clearInterval(perfTimer); perfTimer = null;
  const perfEl = $('perf'); if (perfEl) perfEl.hidden = true;
  if (bootId && window.__portablesBoots) {
    const entry = window.__portablesBoots[bootId];
    delete window.__portablesBoots[bootId];
    if (entry && entry.control && typeof entry.control.flush === 'function') { try { entry.control.flush(); } catch {} }
    // Le vidage final peut livrer la dernière image de carte via onSaveUpdate
    // de façon asynchrone : laisser passer le message puis persister AVANT que
    // launch() ne remplace currentCard/currentCardKey par le jeu suivant.
    await new Promise(r => setTimeout(r, 80));
    await flushCard();
  }
  bootId = null; running = false;
  $('launch').disabled = !$('game-file').files.length;
  if ($('stop')) $('stop').disabled = true;
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
$('stop').onclick = async () => { await stopEngine(); $('player').replaceChildren(); say('Session fermée.'); };
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
  // La carte importée vise le jeu actuellement sélectionné dans le sélecteur
  // (pas forcément celui de la dernière session) : même dérivation de clé
  // que launch() — ID de disque quand lisible, sinon nom de fichier.
  const sel = $('game-file').files[0];
  let key = null;
  if (sel) {
    try {
      const info = await validateFile(sel);
      key = info.discId ? `gc:${info.discId}` : stemOf(sel.name);
    } catch { key = stemOf(sel.name); }
  } else if (currentCardKey) key = currentCardKey;
  if (!key) { say('Sélectionne d’abord une image de jeu, puis importe la carte.', true); return; }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mirrored = cardLsWrite(key, bytes);
  let idbOk = true;
  try { await cardDB.set(key, { bytes, utc: new Date().toISOString() }); }
  catch { idbOk = false; }
  if (key === currentCardKey) { currentCard = bytes; cardDirty = false; }
  if (!idbOk && !mirrored) { say('Import impossible : stockage navigateur plein.', true); return; }
  if (running) say('Carte importée : elle sera utilisée à la prochaine session (le moteur ne la recharge pas à chaud).', true);
  else say(`Carte importée pour ${sel ? stemOf(sel.name) : 'le jeu courant'}.`);
};
// pagehide : pas de délai possible — vidage moteur + flush carte immédiat.
window.addEventListener('pagehide', () => {
  try { const e = bootId && window.__portablesBoots && window.__portablesBoots[bootId]; e && e.control && e.control.flush && e.control.flush(); } catch { }
  void flushCard(); void stopEngine();
});

// Pré-vérification WebGPU (informatif ; gcplayer refait le contrôle complet)
if (!navigator.gpu) log('avertissement', 'Ce navigateur n’a pas WebGPU : utilise Chrome/Edge récent (ou Safari 26+).');
else navigator.gpu.requestAdapter().then(a => { if (a) $('webgpu-badge').hidden = false; }).catch(() => {});
say('Prêt. Choisis une image GameCube.');
