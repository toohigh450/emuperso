// Catalogue des fichiers choisis par l'utilisateur (dossier ou sélection multiple).
// Seuls les NOMS et les poignées File sont gardés : aucun octet n'est lu avant le lancement d'un jeu,
// si bien qu'un dossier de 11 000 ROM SNES n'occupe que quelques mégaoctets de mémoire.
import { parseRomName, variantKey, variantLabel } from './romnames.mjs';
import { extensionOf } from './systems.mjs';

const EXT_SYSTEM = {
  nes: 'nes', unf: 'nes', unif: 'nes', sfc: 'snes', smc: 'snes', swc: 'snes', fig: 'snes',
  gb: 'gb', gbc: 'gbc', gba: 'gba', nds: 'nds',
  md: 'genesis', smd: 'genesis', gen: 'genesis',
};
const ARCHIVES = new Set(['zip', '7z']);
// Mots du chemin qui désignent une console, pour les archives dont le nom ne le dit pas.
const PATH_HINTS = [
  [/super ?nintendo|super ?famicom|\bsnes\b|\bsfc\b/i, 'snes'],
  [/game ?boy ?advance|\bgba\b/i, 'gba'],
  [/game ?boy ?colou?r|\bgbc\b/i, 'gbc'],
  [/nintendo ?ds|\bnds\b/i, 'nds'],
  [/game ?boy|\bgb\b/i, 'gb'],
  [/\bnes\b|famicom|nintendo entertainment/i, 'nes'],
  [/\bgenesis\b|mega ?drive|sega ?md/i, 'genesis'],
];
export const CATALOG_LIMIT = 200000;

export function systemFromPath(path) {
  const ext = extensionOf(path);
  if (EXT_SYSTEM[ext]) return EXT_SYSTEM[ext];
  const dirs = String(path).split(/[\\/]/).slice(0, -1);
  for (let i = dirs.length - 1; i >= 0; i--) {
    for (const [re, sys] of PATH_HINTS) if (re.test(dirs[i])) return sys;
  }
  return null;
}

/**
 * Construit l'index. files : itérable de { name, size, webkitRelativePath? } (File du navigateur).
 * Retourne { entries, skipped, truncated }.
 */
export function buildCatalog(files, { limit = CATALOG_LIMIT } = {}) {
  const entries = [];
  let skipped = 0;
  let truncated = false;
  const seen = new Map();
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    const ext = extensionOf(file.name);
    if (!EXT_SYSTEM[ext] && !ARCHIVES.has(ext)) { skipped++; continue; }
    if (entries.length >= limit) { truncated = true; break; }
    const info = parseRomName(file.name);
    const dupKey = `${file.name.toLowerCase()}|${file.size}`;
    const entry = {
      id: entries.length,
      file,
      name: file.name,
      path,
      size: file.size,
      ext,
      archive: ARCHIVES.has(ext),
      system: systemFromPath(path),
      info,
      key: variantKey(info.title),
      label: variantLabel(info),
      favKey: dupKey,
      duplicateOf: seen.has(dupKey) ? seen.get(dupKey) : null,
    };
    if (!seen.has(dupKey)) seen.set(dupKey, entry.id);
    entries.push(entry);
  }
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.name.localeCompare(b.name)));
  // Nombre de variantes par titre (régions, révisions, traductions, hacks).
  const counts = new Map();
  for (const e of entries) counts.set(e.key, (counts.get(e.key) || 0) + 1);
  for (const e of entries) e.variants = counts.get(e.key);
  return { entries, skipped, truncated };
}

/**
 * Filtre l'index. filters : { q, system, region, french, kind, hideBad, hideDuplicates, favorites, favSet }.
 * kind : 'tous' | 'originaux' | 'hacks' | 'traductions'.
 */
export function filterCatalog(entries, filters = {}) {
  const q = variantKey(filters.q || '');
  const words = q ? q.split(' ') : [];
  return entries.filter((e) => {
    if (filters.system && filters.system !== 'tous' && e.system !== filters.system) return false;
    if (filters.region && filters.region !== 'toutes' && !e.info.regions.includes(filters.region)) return false;
    if (filters.french && !e.info.french) return false;
    if (filters.kind === 'originaux' && !e.info.original) return false;
    if (filters.kind === 'hacks' && !e.info.hack) return false;
    if (filters.kind === 'traductions' && !e.info.translation) return false;
    if (filters.hideBad && (e.info.bad || e.info.overdump)) return false;
    if (filters.hideDuplicates && e.duplicateOf !== null) return false;
    if (filters.favorites && !(filters.favSet && filters.favSet.has(e.favKey))) return false;
    for (const w of words) if (!e.key.includes(w) && !e.name.toLowerCase().includes(w)) return false;
    return true;
  });
}

/** Fenêtre de lignes visibles pour une liste virtuelle (hauteur de ligne fixe). */
export function visibleWindow(total, scrollTop, viewport, rowHeight, overscan = 8) {
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(total, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
  return { first, last };
}
