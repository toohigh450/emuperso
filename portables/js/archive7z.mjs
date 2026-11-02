// Archives .7z dans le navigateur, avec le décompresseur d'EmulatorJS 4.2.3 (compression/extract7z.js,
// même version que le moteur). Le fichier est vérifié par son SHA-256 avant d'être exécuté.
// Deux passages : le premier ne garde que les noms et tailles (pour choisir la version), le second ne
// garde que le fichier choisi ; les autres variantes ne restent jamais en mémoire.
import { toHex } from './hash.mjs';

export const EXTRACT7Z_SHA256 = '4ac9933b995a516cb6b3ca4027db860278372a20c21c405d93ceb1998498853a';
// Plafond vérifié : 250 Mio lus (Super Robot Taisen OG2, 57 versions) ; à 479 Mio, le décompresseur
// d'EmulatorJS s'arrête faute de mémoire (abort). Au-delà, extraire la version voulue avec 7-Zip.
export const MAX_7Z_BYTES = 256 * 1024 * 1024;
export const LARGE_7Z_BYTES = 128 * 1024 * 1024;
const TIMEOUT_MS = 120000;

export function is7z(bytes) {
  return bytes.length >= 6 && bytes[0] === 0x37 && bytes[1] === 0x7a && bytes[2] === 0xbc && bytes[3] === 0xaf && bytes[4] === 0x27 && bytes[5] === 0x1c;
}

let workerUrl = null;
async function workerSource(paths) {
  if (workerUrl) return workerUrl;
  let lastError = null;
  for (const base of paths) {
    try {
      const r = await fetch(`${base}compression/extract7z.js`, { cache: 'force-cache' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      const hex = toHex(await crypto.subtle.digest('SHA-256', bytes));
      if (hex !== EXTRACT7Z_SHA256) throw new Error('empreinte du décompresseur inattendue');
      workerUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/javascript' }));
      return workerUrl;
    } catch (err) { lastError = err; }
  }
  throw new Error(`Décompresseur 7z indisponible (${lastError ? lastError.message : 'aucune source'}). Vérifie la connexion Internet.`);
}

/**
 * Parcourt l'archive. keep(nom, taille) dit s'il faut garder les octets d'un fichier.
 * onProgress(0..100). Retourne { entries: [{ name, size }], kept: { nom: Uint8Array } }.
 */
async function run(bytes, paths, keep, onProgress) {
  const url = await workerSource(paths);
  return new Promise((resolve, reject) => {
    const worker = new Worker(url);
    const entries = [];
    const kept = {};
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Archive 7z trop longue à lire ou endommagée.')); }, TIMEOUT_MS);
    worker.onerror = (e) => { clearTimeout(timer); worker.terminate(); reject(new Error(`Archive 7z illisible (${e.message || 'erreur du décompresseur'}).`)); };
    worker.onmessage = (e) => {
      const m = e.data;
      if (!m) return;
      if (m.t === 4 && onProgress && m.total) onProgress(Math.floor((m.current / m.total) * 100));
      if (m.t === 2 && m.file && !m.file.endsWith('/')) {
        const size = m.data ? m.data.byteLength ?? m.data.length : m.size || 0;
        entries.push({ name: m.file, size });
        if (keep(m.file, size)) kept[m.file] = new Uint8Array(m.data);
      }
      if (m.t === 1) { clearTimeout(timer); worker.terminate(); resolve({ entries, kept }); }
    };
    worker.postMessage(bytes);
  });
}

/** Liste du contenu (noms et tailles). keep(nom, taille) peut garder quelques versions probables, pour éviter un second passage. */
export async function list7z(bytes, paths, onProgress, keep = () => false) {
  return run(bytes, paths, keep, onProgress);
}

/** Octets d'un seul fichier de l'archive. */
export async function extract7z(bytes, paths, name, { maxBytes = MAX_7Z_BYTES, onProgress } = {}) {
  const { kept } = await run(bytes, paths, (n, size) => n === name && size <= maxBytes, onProgress);
  if (!kept[name]) throw new Error(`« ${name} » introuvable dans l’archive ou trop gros.`);
  return kept[name];
}
