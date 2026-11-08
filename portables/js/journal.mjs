// Journal de diagnostic du lanceur : derniers évènements (statuts, erreurs du lanceur et du moteur),
// exportable en texte après un problème. Aucun octet de jeu ni de sauvegarde : des noms, des messages,
// l'environnement du navigateur. Gardé aussi dans localStorage pour survivre à un rechargement.
const MAX = 400;
const KEY = 'emuperso-journal';
let entries = [];
try { entries = JSON.parse(localStorage.getItem(KEY) || '[]').slice(-MAX); } catch { entries = []; }
let saveTimer = 0;

const clip = (v) => String(v ?? '').replace(/\s+/g, ' ').slice(0, 600);

export function log(kind, message, data) {
  entries.push({ t: new Date().toISOString(), kind: clip(kind).slice(0, 30), msg: clip(message), ...(data ? { data: clip(JSON.stringify(data)) } : {}) });
  if (entries.length > MAX) entries = entries.slice(-MAX);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch { /* stockage plein ou bloqué */ } }, 300);
}

export function entriesSnapshot() { return entries.slice(); }

/** Texte à envoyer : environnement, jeu en cours (noms seulement), puis les évènements, du plus ancien au plus récent. */
export function exportText(context = {}) {
  const nav = globalThis.navigator || {};
  const head = [
    'EMUPERSO — journal du lanceur',
    `Exporté : ${new Date().toISOString()}`,
    `Page : ${globalThis.location ? location.origin + location.pathname + location.search : '?'}`,
    `Navigateur : ${nav.userAgent || '?'}`,
    `Mémoire annoncée : ${nav.deviceMemory ?? '?'} Gio · cœurs : ${nav.hardwareConcurrency ?? '?'} · isolation : ${globalThis.crossOriginIsolated ? 'oui' : 'non'} · tactile : ${nav.maxTouchPoints ?? 0}`,
    ...Object.entries(context).map(([k, v]) => `${k} : ${clip(v)}`),
    '',
  ];
  return `${head.join('\n')}${entries.map((e) => `${e.t}  [${e.kind}] ${e.msg}${e.data ? `  ${e.data}` : ''}`).join('\n')}\n`;
}

export function clearJournal() {
  entries = [];
  try { localStorage.removeItem(KEY); } catch { /* rien à effacer */ }
}
