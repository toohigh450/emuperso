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
      return { status: 'match', cheats: candidates[0].codes.map(c => ({ ...c, validated: false })), candidates: [],
               catalogTitle: candidates[0].catalogTitle, catalogRegion: detectRegion(candidates[0].catalogTitle),
               catalogRegions: detectRegions(candidates[0].catalogTitle) };
    }
    if (candidates.length > 1) {
      // P1 (audit GPT RC-1.3) : classer les candidats par région connue.
      // Ex: "GT2 (Europe).bin" → candidat Europe en premier, pas USA.
      const gameReg = detectRegion(stripDiscExtension(title || ''));
      if (gameReg) {
        candidates.sort((a, b) => {
          const aRegions = detectRegions(a.catalogTitle) || [];
          const bRegions = detectRegions(b.catalogTitle) || [];
          const aMatch = regionsCompatible(gameReg, aRegions) ? 0 : 1;
          const bMatch = regionsCompatible(gameReg, bRegions) ? 0 : 1;
          return aMatch - bMatch;
        });
      }
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
      return { status: 'match', cheats: wordCandidates[0].codes.map(c => ({ ...c, validated: false })), candidates: [],
               catalogTitle: wordCandidates[0].catalogTitle, catalogRegion: detectRegion(wordCandidates[0].catalogTitle),
               catalogRegions: detectRegions(wordCandidates[0].catalogTitle) };
    }
    if (wordCandidates.length > 1) {
      // P1 : même classement par région pour le fallback par mots
      const gameReg = detectRegion(stripDiscExtension(title || ''));
      if (gameReg) {
        wordCandidates.sort((a, b) => {
          const aRegions = detectRegions(a.catalogTitle) || [];
          const bRegions = detectRegions(b.catalogTitle) || [];
          const aMatch = regionsCompatible(gameReg, aRegions) ? 0 : 1;
          const bMatch = regionsCompatible(gameReg, bRegions) ? 0 : 1;
          return aMatch - bMatch;
        });
      }
      return { status: 'ambiguous', cheats: [], candidates: wordCandidates };
    }
  }

  // P1 (audit GPT RC-1.3) : si aucun match mais titre ressemble à un mod,
  // chercher le jeu de base et le proposer comme CANDIDAT NON VÉRIFIÉ.
  // Jamais auto-activé — l'utilisateur doit choisir explicitement.
  // P1-A (audit GPT RC-1.4) : détecter le mod sur le titre BRUT, avant titleStem().
  // titleStem() normalise "v6.1" en "v6 1" et supprime les parenthèses, ce qui casse
  // la détection de version. Ex: "GT2 Plus (Beta v6.1)" doit donner base "Gran Turismo 2".
  const modInfo = detectMod(stripDiscExtension(title || ''));
  if (modInfo.isMod && modInfo.baseTitle) {
    // Chercher le jeu de base (récursif, mais sans re-détecter les mods)
    const baseStem = titleStem(modInfo.baseTitle);
    const baseCandidates = [];
    for (const [catalogTitle, codes] of Object.entries(catalog.byTitle)) {
      if (titleMatches(baseStem, catalogTitle)) {
        baseCandidates.push({ catalogTitle, codes });
      }
    }
    if (baseCandidates.length > 0) {
      return {
        status: 'mod_candidate',
        cheats: [],
        candidates: baseCandidates,
        modInfo: { originalTitle: title, baseTitle: modInfo.baseTitle },
      };
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

// Shared structural metadata parser; no language-to-country inference.
export { regionEvidence } from './region-evidence.mjs';
import { regionEvidence, stripLanguageMetadata } from './region-evidence.mjs';
export const stripLanguageList = stripLanguageMetadata;
export const detectRegion = value => regionEvidence(value).region;
export const detectRegions = value => {
  const evidence = regionEvidence(value);
  return evidence.regions.length ? evidence.regions : null;
};

/**
 * R1 : vérifie si la région du jeu est compatible avec l'ensemble des régions du catalogue.
 * Ex: gameRegion='Europe', catalogRegions=['USA','Europe'] → true (pas de conflit)
 */
export function regionsCompatible(gameRegion, catalogRegions) {
  if (!gameRegion || !catalogRegions || catalogRegions.length === 0) return false;
  return catalogRegions.includes(gameRegion);
}

/**
 * P1 (audit GPT RC-1.3) : détecte si un titre ressemble à un mod/hack.
 * Ex: "Gran Turismo 2 Plus (Beta v6.1)" → { isMod: true, baseTitle: "Gran Turismo 2" }
 * Les cheats du jeu de base sont proposés comme CANDIDATS NON VÉRIFIÉS, jamais auto-activés.
 */
export function detectMod(title) {
  const v = String(title || '');
  // Indicateurs de mods/hacks/versions modifiées
  const modPattern = /\b(plus|beta|alpha|mod|hack|patched|undub|retrostage|kaizo|randomizer|rebirth|remix|deluxe|extended|ultimate)\b/i;
  const versionPattern = /\bv\d+\.\d+/i; // v6.1, v1.2, etc.
  const isMod = modPattern.test(v) || versionPattern.test(v);
  if (!isMod) return { isMod: false, baseTitle: null };
  // Extraire le titre de base en retirant les indicateurs de mod
  let base = v
    .replace(/\b(plus|beta|alpha|mod|hack|patched|undub|retrostage|kaizo|randomizer|rebirth|remix|deluxe|extended|ultimate)\b/gi, '')
    .replace(/\bv\d+\.\d+[^)]*/gi, '') // v6.1, v6.1 (Simulation Mode), etc.
    .replace(/\([^)]*(simulation mode|arcade mode)[^)]*\)/gi, '') // (Simulation Mode)
    .replace(/\s+/g, ' ')
    .trim();
  // Nettoyer les parenthèses vides restantes
  base = base.replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim();
  return { isMod: true, baseTitle: base || null };
}
export function stripDiscExtension(filename) {
  return String(filename ?? '').replace(/\.(chd|pbp|iso|bin|img|cue)$/i, '').trim();
}

/**
 * Extrait le titre de base : sans extension, sans tag de région final.
 * Ex: "NBA Jam Extreme (E).chd" -> "nba jam extreme"
 */
export function titleStem(value) {
  // P3 (audit RC-1.9) : retirer les tags entre parenthèses/crochets OÙ QU'ILS SOIENT,
  // pas seulement en fin de chaîne. Un jeu « Final Fantasy VII (USA) (Disc 1) » doit
  // donner le même stem que « Final Fantasy VII (USA) ». On enlève :
  //  - les tags disque/CD (Disc 1, CD2, Disque 1…),
  //  - les listes de langues (En,Fr,De), (En,Ja)…,
  //  - les tags de région/révision (USA), (Europe), (En), (Rev 1), (v1.1)…
  const disc = /\s*[\(\[]\s*(disc|disk|disque|cd)\s*\d+[^)\]]*[\)\]]/gi;
  const langList = /\s*[\(\[]\s*([A-Za-z]{2}(\s*,\s*[A-Za-z]{2})+)\s*[\)\]]/g;
  const regionRev = /\s*[\(\[]\s*(USA|Europe|World|Japan|Asia|Germany|France|Italy|Spain|Netherlands|Sweden|Australia|Korea|E|U|J|K|PAL|NTSC(?:[-\s]?[UJ])?|FR|US|EU|JP|En|Fr|De|It|Es|Nl|Sv|Pt|Rev\s*\d+|v\d+(\.\d+)*|Beta|Proto|Demo)([\s,\)\]][^)\]]*)?[\)\]]/gi;
  let t = stripLanguageMetadata(stripDiscExtension(value));
  // P1 (audit GPT/Méo RC-1.9) : suffixes à TIRETS fréquents hors No-Intro
  // (« Gran Turismo 2-PSX-PAL-CD1 »). On ne retire QUE des tokens connus, jamais
  // un mot quelconque, pour ne pas casser « Spider-Man », « X-Men », « Ri-Oh »…
  // La région (PAL/NTSC) reste détectée sur le nom d'origine par detectRegion().
  const dashTags = /-(PSX|PS1|PSONE|PSX1|PAL|SECAM|NTSC(?:-?[UJ])?|NTSCU|NTSCJ|USA|US|EUR?|EU|JAP?|JP|World|CD\s*\d+|Disc\s*\d+|Disk\s*\d+|Disque\s*\d+|Rev\s*\d+|v\d+(?:\.\d+)*)(?=-|\s|$)/gi;
  let dprev; do { dprev = t; t = t.replace(dashTags, ' '); } while (t !== dprev);
  let prev;
  do { prev = t; t = t.replace(disc, ' ').replace(langList, ' ').replace(regionRev, ' '); } while (t !== prev);
  // Tag de région en suffixe sans parenthèses (ex: « Final Fantasy 5 FR »).
  t = t.replace(/\s+(USA|Europe|World|Japan|Germany|France|Italy|FR|US|EU|PAL|NTSC)$/i, '');
  return normalizeTitle(t);
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
