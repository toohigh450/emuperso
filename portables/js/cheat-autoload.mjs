// Chargement automatique des fichiers de codes du jeu ouvert, depuis le site lui-même
// (dossier cheats-portables publié avec le portail, catalogue des noms construit par tools/build-portail.mjs).
// Règles conservées : aucun code activé, aucune association imposée. Les fichiers trouvés arrivent
// dans le panneau Codes comme suggestions à confirmer (même disque pour la PSP, même titre sinon).
import { parseRomName } from './romnames.mjs';
import { discIdOfCheatName, parseCht } from './cheats.mjs';

export const CHEAT_FOLDERS = Object.freeze({
  nes: 'Nintendo - Nintendo Entertainment System',
  snes: 'Nintendo - Super Nintendo Entertainment System',
  gb: 'Nintendo - Game Boy',
  gbc: 'Nintendo - Game Boy Color',
  gba: 'Nintendo - Game Boy Advance',
  nds: 'Nintendo - Nintendo DS',
  genesis: 'Sega - Mega Drive - Genesis',
  psp: 'Sony - PlayStation Portable',
});
export const MAX_AUTOLOAD = 8;

/** Titre comparable entre noms No-Intro « Jeu (USA) » et GoodTools « Jeu [USA][!] » : minuscules, sans accents ni ponctuation. */
export function titleKey(name) {
  const file = String(name || '').replace(/^.*[\\/]/, '');
  return parseRomName(file).title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/^the\s+|,\s*the\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Fichiers du catalogue qui correspondent au jeu : même identifiant de disque (PSP), sinon même titre.
 * Les mêmes régions passent en premier ; au plus MAX_AUTOLOAD fichiers.
 */
export function findCheatCandidates(system, romName, discId, names) {
  const list = Array.isArray(names) ? names : [];
  if (system === 'psp') return discId ? list.filter((n) => discIdOfCheatName(n) === discId).slice(0, MAX_AUTOLOAD) : [];
  const key = titleKey(romName);
  if (!key) return [];
  const regions = new Set(parseRomName(String(romName).replace(/^.*[\\/]/, '')).regions);
  const score = (n) => {
    const info = parseRomName(n);
    const shared = info.regions.filter((r) => regions.has(r)).length;
    return (shared ? 0 : 10) + (info.regions.length ? 0 : 5) + (/\((?:action replay|game genie|code breaker|gameshark|rumbles)/i.test(n) ? 1 : 0);
  };
  return list.filter((n) => titleKey(n) === key).sort((a, b) => score(a) - score(b) || a.localeCompare(b)).slice(0, MAX_AUTOLOAD);
}

let catalogue = null;
/** Catalogue des noms de fichiers (un seul téléchargement par visite) ; null hors du site construit. */
export async function loadCatalogue(base = '../cheats-portables/') {
  if (catalogue) return catalogue;
  try {
    const r = await fetch(`${base}catalogue.json`, { cache: 'force-cache' });
    catalogue = r.ok ? await r.json() : {};
  } catch { catalogue = {}; }
  return catalogue;
}

/**
 * Trouve, télécharge et importe (désactivés) les fichiers de codes du jeu. Ne remplace jamais un fichier
 * déjà importé. Retourne { found, imported } (noms).
 */
export async function autoloadCheats({ store, system, romName, altName = null, discId, base = '../cheats-portables/' }) {
  const folder = CHEAT_FOLDERS[system];
  if (!folder) return { found: [], imported: [] };
  const list = (await loadCatalogue(base))[folder];
  // altName : titre complet tiré de l'archive quand la version à l'intérieur a un nom tronqué.
  let names = findCheatCandidates(system, romName, discId, list);
  if (!names.length && altName) names = findCheatCandidates(system, altName, discId, list);
  const existing = new Set((await store.listCheatFiles(system)).map((f) => f.path));
  const entries = [];
  for (const name of names) {
    const path = `${folder}/${name}`;
    if (existing.has(path)) continue;
    const r = await fetch(`${base}${encodeURIComponent(folder)}/${encodeURIComponent(name)}`, { cache: 'force-cache' });
    if (!r.ok) continue;
    const text = await r.text();
    if (!parseCht(text).length) continue; // aucun code utilisable (vibrations seulement, par exemple)
    entries.push(await store.prepareCheatFile({ system, path, name, text }));
  }
  if (entries.length) await store.commitCheatFiles(entries);
  return { found: names, imported: entries.map((e) => e.name) };
}
