// SPDX-License-Identifier: MIT
// Catalogue de cheats PS1 — source : libretro-database (CC BY-SA 4.0)
// Commit : 073c9d3fadb8c15d0145c608dd102b67a7c82407

const MAX_CATALOG_BYTES = 4 * 1024 * 1024;
let catalogPromise = null;

function assert(ok, message) { if (!ok) throw new Error(message); }

/**
 * Charge le catalogue de cheats PS1.
 * Retourne { bySerial, byTitle, serialMap, meta } ou un catalogue vide.
 */
export const CATALOG_STATE = { LOADED: 'loaded', LOAD_ERROR: 'load_error', EMPTY: 'empty' };
let catalogState = null;

export function getCatalogState() { return catalogState; }

export function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch('data/psx-catalog.json')
      .then(async response => {
        if (!response.ok) {
          catalogState = CATALOG_STATE.LOAD_ERROR;
          throw new Error(`Catalogue introuvable (HTTP ${response.status}).`);
        }
        const text = await response.text();
        assert(text.length <= MAX_CATALOG_BYTES, 'Catalogue trop volumineux.');
        const data = JSON.parse(text);
        assert(data && typeof data === 'object', 'Catalogue invalide.');
        catalogState = CATALOG_STATE.LOADED;
        return {
          bySerial: data.bySerial || {},
          byTitle: data.byTitle || {},
          serialMap: data.serialMap || {},
          meta: data.meta || {},
        };
      })
      .catch(err => {
        if (!catalogState) catalogState = CATALOG_STATE.LOAD_ERROR;
        throw err;
      });
  }
  return catalogPromise;
}

/**
 * Trouve les cheats pour un jeu.
 * @param {string|null} serial - Numéro de série (ex: SLUS-01156)
 * @param {string|null} title - Titre du jeu (fallback, peut inclure extension)
 * @returns {Promise<{status, cheats, candidates}>}
 *   status: 'match' | 'ambiguous' | 'no_match' | 'load_error'
 *   cheats: Array<{name, code, source}> si match unique
 *   candidates: Array<{catalogTitle, codes}> si ambiguous
 */
export async function findCheatsForGame(serial, title) {
  let catalog;
  try {
    catalog = await loadCatalog();
  } catch (err) {
    return { status: 'load_error', cheats: [], candidates: [], error: err.message };
  }
  
  // 1. Lookup par serial direct
  if (serial && catalog.bySerial[serial]) {
    return { status: 'match', cheats: catalog.bySerial[serial].map(c => ({ ...c, validated: false })), candidates: [] };
  }
  
  // 2. Lookup via serialMap (serial -> titre)
  if (serial && catalog.serialMap[serial]) {
    const mappedTitle = catalog.serialMap[serial];
    if (catalog.byTitle[mappedTitle]) {
      return { status: 'match', cheats: catalog.byTitle[mappedTitle].map(c => ({ ...c, validated: false })), candidates: [] };
    }
  }
  
  // 3. Candidats par titre de base exact (sans extension, sans région)
  if (title) {
    const candidates = candidatesByStem(catalog, title);
    if (candidates.length === 1) {
      return { status: 'match', cheats: candidates[0].codes.map(c => ({ ...c, validated: false })), candidates: [] };
    }
    if (candidates.length > 1) {
      return { status: 'ambiguous', cheats: [], candidates };
    }
    // 3b. Fallback P2: matching par mots sur le titre nettoyé
    // (ex: "Final Fantasy 5" -> "Final Fantasy Anthology - Final Fantasy V")
    const cleanTitle = titleStem(title);
    const wordCandidates = [];
    for (const [key, codes] of Object.entries(catalog.byTitle || {})) {
      if (titleMatches(cleanTitle, key)) {
        wordCandidates.push({ catalogTitle: key, codes });
      }
    }
    if (wordCandidates.length === 1) {
      return { status: 'match', cheats: wordCandidates[0].codes.map(c => ({ ...c, validated: false })), candidates: [] };
    }
    if (wordCandidates.length > 1) {
      return { status: 'ambiguous', cheats: [], candidates: wordCandidates };
    }
  }
  
  return { status: 'no_match', cheats: [], candidates: [] };
}

/**
 * Normalise un titre pour le matching flou.
 * Convertit les chiffres romains en arabes (V->5, VII->7, etc.)
 */
export function normalizeTitle(title) {
  let t = title.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const romans = { 'viii': '8', 'vii': '7', 'ix': '9', 'vi': '6', 'iv': '4', 'v': '5', 'iii': '3', 'ii': '2', 'i': '1', 'x': '10' };
  t = t.split(' ').map(w => romans[w] || w).join(' ');
  return t;
}

/**
 * Retire l'extension du fichier disque (.chd, .pbp, .iso, etc.)
 */
export function stripDiscExtension(filename) {
  return String(filename ?? '').replace(/\.(chd|pbp|iso|bin|img|cue)$/i, '').trim();
}

/**
 * Extrait le titre de base : sans extension, sans tag de région final.
 * Ex: "NBA Jam Extreme (E).chd" -> "nba jam extreme"
 */
export function titleStem(value) {
  return normalizeTitle(
    stripDiscExtension(value)
      .replace(/\s*[\(\[]\s*(USA|Europe|World|Japan|Germany|France|Italy|E|U|J|PAL|NTSC|FR|US|EU)[\s,\)\]]*\s*$/i, '')
      .replace(/\s+(USA|Europe|World|Japan|Germany|France|Italy|FR|US|EU|PAL|NTSC)$/i, '')
  );
}

/**
 * Trouve les candidats par titre de base exact.
 * Retourne [{ catalogTitle, codes }] — JAMAIS de mélange entre candidats.
 */
export function candidatesByStem(catalog, filename) {
  const stem = titleStem(filename);
  if (!stem) return [];
  return Object.entries(catalog.byTitle || {})
    .filter(([key]) => titleStem(key) === stem)
    .map(([key, codes]) => ({ catalogTitle: key, codes }));
}

/**
 * Vérifie si tous les mots significatifs du titre cherché
 * apparaissent comme mots entiers dans la clé du catalogue.
 */
export function titleMatches(searchTitle, catalogKey) {
  const searchWords = normalizeTitle(searchTitle).split(' ').filter(w => w.length > 1 || /^\d+$/.test(w));
  const keyWords = new Set(normalizeTitle(catalogKey).split(' '));
  return searchWords.length > 0 && searchWords.every(w => keyWords.has(w));
}

/**
 * Retourne les métadonnées du catalogue.
 */
export async function catalogMeta() {
  const catalog = await loadCatalog();
  return catalog.meta;
}
