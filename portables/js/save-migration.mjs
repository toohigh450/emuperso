// Reprise des sauvegardes GB / GBC / GBA / DS nommées d'après l'ancien nom de fichier de la ROM.
//
// Le moteur (EmulatorJS 4.2.3) range la sauvegarde de cartouche dans la base IndexedDB « /data/saves »
// sous « /data/saves/<dossier du cœur>/<nom de la ROM transmise>.<extension> ». Jusqu'en 0.3.0-alpha.1,
// GB/GBC/GBA/DS transmettaient le nom du fichier de l'utilisateur : une ROM renommée perdait sa
// sauvegarde, et deux ROM différentes de même nom la partageaient. Elles reçoivent maintenant, comme
// NES/SNES, un nom tiré de l'empreinte (rom-<sha256>-<cœur>).
//
// Au premier lancement sous le nouveau nom, l'ancienne sauvegarde est COPIÉE vers le nouveau nom.
// L'original n'est jamais modifié ni supprimé, et une sauvegarde déjà présente sous le nouveau nom
// n'est jamais remplacée (écriture par « add », refusée si la clé existe).

export const ENGINE_SAVE_DB = '/data/saves';
export const ENGINE_SAVE_STORE = 'FILE_DATA';

// Dossier créé par le moteur pour chaque cœur (nom de bibliothèque libretro). Vérifiés en démarrant
// le vrai cœur (tests/real-save-migration.mjs), sauf melonDS (BIOS requis) : lu dans le binaire du cœur.
export const CORE_SAVE_FOLDERS = {
  fceumm: 'FCEUmm',
  snes9x: 'Snes9x',
  gambatte: 'Gambatte',
  mgba: 'mGBA',
  desmume2015: 'DeSmuME 2015',
  desmume: 'DeSmuME',
  melonds: 'melonDS',
};

// Consoles dont les sauvegardes existantes suivent l'ancien nommage.
export const LEGACY_SAVE_SYSTEMS = new Set(['gb', 'gbc', 'gba', 'nds']);

function filesOf(keys, folder, stem) {
  const prefix = `${ENGINE_SAVE_DB}/${folder}/${stem}.`;
  // Extension simple seulement (srm, rtc, dsv, sav…) : « Zelda.v2.srm » n'est pas une sauvegarde de « Zelda ».
  return keys.filter((k) => k.startsWith(prefix) && /^[a-z0-9]+$/i.test(k.slice(prefix.length)));
}

/**
 * Décide quoi copier, sans rien écrire. keys : clés présentes dans la base du moteur.
 * oldStems : anciens noms candidats par ordre de préférence (nom actuel du fichier, puis nom
 * enregistré au lancement précédent de la même ROM).
 */
export function planSaveMigration({ coreId, newStem, oldStems, keys }) {
  const folder = CORE_SAVE_FOLDERS[coreId];
  if (!folder) return { action: 'none', reason: 'unknown-core', copies: [] };
  if (filesOf(keys, folder, newStem).length) return { action: 'none', reason: 'already-present', copies: [] };
  const seen = new Set();
  for (const stem of oldStems) {
    if (!stem || stem === newStem || seen.has(stem)) continue;
    seen.add(stem);
    const found = filesOf(keys, folder, stem);
    if (found.length) {
      const prefix = `${ENGINE_SAVE_DB}/${folder}/${stem}.`;
      const copies = found.map((from) => ({ from, to: `${ENGINE_SAVE_DB}/${folder}/${newStem}.${from.slice(prefix.length)}` }));
      return { action: 'copy', reason: 'legacy-found', fromStem: stem, copies };
    }
  }
  return { action: 'none', reason: 'no-legacy', copies: [] };
}

const request = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

// Ouvre la base du moteur sans jamais la créer : si elle n'existe pas encore, il n'y a rien à reprendre.
function openEngineDb(idb) {
  return new Promise((resolve, reject) => {
    let created = false;
    const r = idb.open(ENGINE_SAVE_DB);
    r.onupgradeneeded = () => { created = true; r.transaction.abort(); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => (created ? resolve(null) : reject(r.error));
  });
}

/**
 * Copie l'ancienne sauvegarde vers le nom tiré de l'empreinte, si besoin.
 * À appeler quand aucun moteur n'est ouvert (le moteur réécrit toute la base à chaque synchronisation).
 * Retourne le plan exécuté ({ action, reason, fromStem, copies }).
 */
export async function migrateLegacySave({ coreId, newStem, oldStems, idb = globalThis.indexedDB }) {
  const db = await openEngineDb(idb);
  if (!db) return { action: 'none', reason: 'no-engine-db', copies: [] };
  try {
    if (!db.objectStoreNames.contains(ENGINE_SAVE_STORE)) return { action: 'none', reason: 'no-engine-db', copies: [] };
    const keys = (await request(db.transaction(ENGINE_SAVE_STORE).objectStore(ENGINE_SAVE_STORE).getAllKeys())).map(String);
    const plan = planSaveMigration({ coreId, newStem, oldStems, keys });
    if (plan.action !== 'copy') return plan;
    const tx = db.transaction(ENGINE_SAVE_STORE, 'readwrite');
    const store = tx.objectStore(ENGINE_SAVE_STORE);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Copie de la sauvegarde annulée.'));
    });
    for (const { from, to } of plan.copies) {
      const value = await request(store.get(from));
      if (value) store.add(value, to); // « add » : refusé si une sauvegarde existe déjà sous ce nom.
    }
    await done;
    return plan;
  } finally {
    db.close();
  }
}
