// SPDX-License-Identifier: MIT
// Réparation en mémoire d'une feuille .cue dont les lignes FILE ne correspondent plus aux pistes de
// l'archive (packs renommés : « Jeu (Track 1).bin » ou « 100% Star » listés, « Jeu.bin » ou
// « 100 Star » fournis). Les fichiers de l'utilisateur ne sont jamais modifiés : seule la copie remise
// au moteur est corrigée. Rien n'est changé si toutes les pistes existent, ni si une correspondance
// est ambiguë (le cœur refusera alors le disque, comme avant).
const TRACK_FILE = /\.(bin|img|iso|wav)$/i;
const key = (name) => String(name).toLowerCase().replace(/\.[^.]+$/, '').replace(/\(track 0*1\)/g, '').replace(/[^a-z0-9]+/g, '');

/** names : noms des fichiers du même dossier que le .cue. Retourne { text, map } ou null. */
export function repairCue(text, names) {
  const source = String(text ?? '');
  const available = new Set(names);
  const refs = [...source.matchAll(/^\s*FILE\s+"([^"]+)"/gim)].map((m) => m[1]);
  const missing = [...new Set(refs.filter((ref) => !available.has(ref)))];
  if (!refs.length || !missing.length) return null;
  const free = names.filter((n) => TRACK_FILE.test(n) && !refs.includes(n));
  const map = new Map();
  for (const ref of missing) {
    const same = free.filter((n) => key(n) === key(ref));
    if (same.length === 1) map.set(ref, same[0]);
  }
  // Une seule piste encore manquante et un seul fichier de piste libre : c'est forcément elle.
  const left = missing.filter((ref) => !map.has(ref));
  const unused = free.filter((n) => ![...map.values()].includes(n));
  if (left.length === 1 && unused.length === 1) map.set(left[0], unused[0]);
  if (map.size !== missing.length || new Set(map.values()).size !== map.size) return null;
  return {
    text: source.replace(/^(\s*FILE\s+")([^"]+)(")/gim, (all, before, ref, after) => (map.has(ref) ? before + map.get(ref) + after : all)),
    map: Object.fromEntries(map),
  };
}
