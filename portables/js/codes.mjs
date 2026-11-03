// Codes de triche saisis à la main : validation, normalisation et décodage, NES, SNES et PSP.
// Les formats acceptés sont ceux que lisent réellement les cœurs (fceumm, snes9x et ppsspp, fonction
// retro_cheat_set) : un code refusé ici serait ignoré en silence par le moteur.
// Pour GB, GBC, GBA et DS, le format n'est pas contrôlé ici : le cœur décide.

const NES_GG = 'APZLGITYEOXUKSVN';
const SNES_GG = 'DF4709156BC8A23E';
const hex = (n, w) => n.toString(16).toUpperCase().padStart(w, '0');

export const CODE_FORMATS = {
  nes: [
    { id: 'gg6', label: 'Game Genie NES (6 lettres)', example: 'SXIOPO' },
    { id: 'gg8', label: 'Game Genie NES (8 lettres)', example: 'AEPPGLZA' },
    { id: 'raw', label: 'Brut adresse:valeur', example: '0075:09' },
    { id: 'rawc', label: 'Brut adresse?comparaison:valeur', example: '91D9?AD:A5' },
    { id: 'par', label: 'Pro Action Rocky (8 chiffres hexadécimaux)', example: '' },
  ],
  snes: [
    { id: 'gg', label: 'Game Genie SNES', example: 'C2AF-3D07' },
    { id: 'par', label: 'Pro Action Replay (8 chiffres hexadécimaux)', example: '7E0DBE05' },
    { id: 'raw', label: 'Brut adresse:valeur', example: '7E0DBE:05' },
    { id: 'rawc', label: 'Brut adresse=comparaison?valeur', example: '7E0DBE=03?05' },
  ],
  psp: [
    { id: 'cw', label: 'CWCheat (_L 0xAAAAAAAA 0xVVVVVVVV, une ligne par paire)', example: '_L 0x2024DA44 0x3F800000' },
  ],
};

// --- NES Game Genie ---------------------------------------------------------------
export function decodeNesGameGenie(code) {
  const s = String(code).toUpperCase();
  if (!/^[APZLGITYEOXUKSVN]{6}([APZLGITYEOXUKSVN]{2})?$/.test(s)) return null;
  const n = [...s].map((c) => NES_GG.indexOf(c));
  const address = 0x8000 + (((n[3] & 7) << 12) | ((n[5] & 7) << 8) | ((n[4] & 8) << 8) |
    ((n[2] & 7) << 4) | ((n[1] & 8) << 4) | (n[4] & 7) | (n[3] & 8));
  if (s.length === 6) {
    return { address, value: ((n[1] & 7) << 4) | ((n[0] & 8) << 4) | (n[0] & 7) | (n[5] & 8), compare: null };
  }
  return {
    address,
    value: ((n[1] & 7) << 4) | ((n[0] & 8) << 4) | (n[0] & 7) | (n[7] & 8),
    compare: ((n[7] & 7) << 4) | ((n[6] & 8) << 4) | (n[6] & 7) | (n[5] & 8),
  };
}

/** Inverse exact de decodeNesGameGenie (sert aux tests et aux ROM d'essai). */
export function encodeNesGameGenie(address, value, compare = null) {
  const a = address & 0x7fff;
  const n = new Array(compare === null ? 6 : 8).fill(0);
  n[0] = (value & 7) | ((value >> 4) & 8);
  n[1] = ((value >> 4) & 7) | ((a >> 4) & 8);
  n[2] = (a >> 4) & 7;
  n[3] = ((a >> 12) & 7) | (a & 8);
  n[4] = (a & 7) | ((a >> 8) & 8);
  if (compare === null) n[5] = ((a >> 8) & 7) | (value & 8);
  else {
    n[2] |= 8; // bit « 8 lettres » attendu par le décodeur matériel
    n[5] = ((a >> 8) & 7) | (compare & 8);
    n[6] = (compare & 7) | ((compare >> 4) & 8);
    n[7] = ((compare >> 4) & 7) | (value & 8);
  }
  return n.map((v) => NES_GG[v]).join('');
}

// --- SNES Game Genie ---------------------------------------------------------------
// Même transposition que S9xGameGenieToRaw (snes9x/cheats2.cpp).
function snesGgScramble(x) {
  return ((x & 0x003c00) << 10) + ((x & 0x00003c) << 14) + ((x & 0xf00000) >> 8) +
    ((x & 0x000003) << 10) + ((x & 0x00c000) >> 6) + ((x & 0x0f0000) >> 12) + ((x & 0x0003c0) >> 6);
}
export function decodeSnesGameGenie(code) {
  const s = String(code).toUpperCase();
  if (!/^[0-9A-F]{4}-[0-9A-F]{4}$/.test(s)) return null;
  const real = [...s.replace('-', '')].map((c) => SNES_GG.indexOf(c).toString(16)).join('');
  const data = parseInt(real, 16) >>> 0;
  return { address: snesGgScramble(data & 0xffffff), value: data >>> 24, compare: null };
}
export function encodeSnesGameGenie(address, value) {
  // La transposition est une permutation de 24 bits : on l'inverse bit par bit.
  let scrambled = 0;
  for (let bit = 0; bit < 24; bit++) {
    const target = snesGgScramble(1 << bit);
    if (address & target) scrambled |= 1 << bit;
  }
  const real = hex(((value & 0xff) << 24 >>> 0) + scrambled, 8);
  const g = [...real].map((c) => SNES_GG[parseInt(c, 16)]).join('');
  return `${g.slice(0, 4)}-${g.slice(4)}`;
}

/**
 * Analyse un code pour une console. Retourne { ok, code (forme envoyée au moteur), format, parts, error }.
 * Plusieurs codes peuvent être joints par « + » : chacun doit être valide.
 */
// Les codes Action Replay DS et CWCheat PSP du catalogue dépassent souvent 400 caractères (jusqu'à
// 15 049) : la limite reste un garde-fou contre un collage aberrant, pas une contrainte du moteur.
export const MAX_CODE_LENGTH = 20000;

/**
 * Lignes de codes actives qu'un cœur supporte. Genesis Plus GX n'en garde que 150 et plante au-delà
 * (« table index is out of bounds » : 147 lignes tiennent, 160 plantent, vu sur la collection). Une
 * ligne = un morceau séparé par « + ».
 */
export const ENGINE_CODE_LINES = Object.freeze({ genesis: 150 });

/** Codes actifs gardés dans l'ordre jusqu'à la limite du cœur ; dropped = codes laissés de côté. */
export function limitActiveCodes(system, codes) {
  const max = ENGINE_CODE_LINES[system];
  if (!max) return { codes: codes.slice(), dropped: 0, max: null };
  const kept = [];
  let lines = 0;
  for (const code of codes) {
    const n = String(code).split('+').filter((p) => p.trim()).length || 1;
    if (lines + n > max) continue;
    kept.push(code);
    lines += n;
  }
  return { codes: kept, dropped: codes.length - kept.length, max };
}

export function parseCheatCode(system, input) {
  const raw = String(input || '').trim();
  if (!raw) return { ok: false, error: 'Code vide.' };
  if (raw.length > MAX_CODE_LENGTH) return { ok: false, error: `Code trop long (${MAX_CODE_LENGTH} caractères maximum).` };
  if (system === 'psp') return parsePspCode(raw);
  if (system !== 'nes' && system !== 'snes') {
    if (/[^\x20-\x7e]/.test(raw)) return { ok: false, error: 'Caractères non pris en charge dans le code.' };
    return { ok: true, code: raw, format: 'libre', parts: [{ text: raw, format: 'non contrôlé' }], unchecked: true };
  }
  const pieces = raw.split(/\s*\+\s*|\s*[\r\n,;]+\s*/).filter(Boolean);
  const parts = [];
  for (const piece of pieces) {
    const p = system === 'nes' ? parseNesPiece(piece) : parseSnesPiece(piece);
    if (!p) {
      return { ok: false, error: `« ${piece} » n’est pas un code ${system === 'nes' ? 'NES' : 'SNES'} reconnu. Formats acceptés : ${CODE_FORMATS[system].map((f) => f.label).join(', ')}.` };
    }
    parts.push(p);
  }
  return { ok: true, code: parts.map((p) => p.text).join('+'), format: [...new Set(parts.map((p) => p.format))].join(' + '), parts };
}

function parseNesPiece(piece) {
  const s = piece.replace(/\s+/g, '').toUpperCase();
  const gg = decodeNesGameGenie(s);
  if (gg) return { text: s, format: s.length === 6 ? 'Game Genie (6)' : 'Game Genie (8)', ...gg };
  let m = /^([0-9A-F]{4}):([0-9A-F]{2})$/.exec(s);
  if (m) return { text: s, format: 'brut', address: parseInt(m[1], 16), value: parseInt(m[2], 16), compare: null };
  m = /^([0-9A-F]{4})\?([0-9A-F]{2}):([0-9A-F]{2})$/.exec(s);
  if (m) return { text: s, format: 'brut conditionnel', address: parseInt(m[1], 16), compare: parseInt(m[2], 16), value: parseInt(m[3], 16) };
  m = /^[0-9A-F]{8}$/.exec(s);
  if (m) return { text: s, format: 'Pro Action Rocky', address: null, value: null, compare: null };
  return null;
}

function parseSnesPiece(piece) {
  const s = piece.replace(/\s+/g, '').toUpperCase();
  const gg = decodeSnesGameGenie(s);
  if (gg) return { text: s, format: 'Game Genie', ...gg };
  let m = /^([0-9A-F]{6})([0-9A-F]{2})$/.exec(s);
  if (m) return { text: s, format: 'Pro Action Replay', address: parseInt(m[1], 16), value: parseInt(m[2], 16), compare: null };
  m = /^([0-9A-F]{6}):([0-9A-F]{2})$/.exec(s);
  if (m) return { text: `${m[1]}${m[2]}`, format: 'brut (converti en Pro Action Replay)', address: parseInt(m[1], 16), value: parseInt(m[2], 16), compare: null };
  m = /^([0-9A-F]{6})=([0-9A-F]{2})\?([0-9A-F]{2})$/.exec(s);
  if (m) return { text: s, format: 'brut conditionnel', address: parseInt(m[1], 16), compare: parseInt(m[2], 16), value: parseInt(m[3], 16) };
  m = /^([0-9A-F]{6})=([0-9A-F]{2})$/.exec(s);
  if (m) return { text: s, format: 'brut', address: parseInt(m[1], 16), value: parseInt(m[2], 16), compare: null };
  return null;
}

// --- PSP (CWCheat) -------------------------------------------------------------------
// ppsspp (retro_cheat_set) découpe le code sur les espaces et les « + », ignore les mots de deux
// lettres (« _L ») et range le reste par paires adresse / valeur dans le fichier CWCheat du jeu.
// Une ligne « _L 0x00000000 0x00000000 » ne fait rien d'utile : dans les fichiers libretro, c'est
// un titre de section (« [>>>General Cheats<<<] ») ; elle écrirait 0 au début de la mémoire du jeu.
function parsePspCode(raw) {
  const words = raw.split(/[\s+]+/).filter(Boolean);
  const values = [];
  for (const w of words) {
    if (/^_[A-Z]$/i.test(w)) {
      if (w.toUpperCase() !== '_L') return { ok: false, error: `« ${w} » : seules les lignes « _L » (codes) sont acceptées, pas les en-têtes de fichier CWCheat.` };
      continue;
    }
    const m = /^0x([0-9A-F]{8})$/i.exec(w);
    if (!m) return { ok: false, error: `« ${w} » n’est pas une valeur CWCheat (0x suivi de 8 chiffres hexadécimaux). Format : ${CODE_FORMATS.psp[0].label}.` };
    values.push(m[1].toUpperCase());
  }
  if (values.length === 0 || values.length % 2) return { ok: false, error: 'Code CWCheat incomplet : il faut des paires adresse / valeur (0xAAAAAAAA 0xVVVVVVVV).' };
  const parts = [];
  for (let i = 0; i < values.length; i += 2) {
    parts.push({ text: `_L 0x${values[i]} 0x${values[i + 1]}`, format: 'CWCheat', address: null, value: null, compare: null });
  }
  const placeholder = values.every((v) => v === '00000000');
  return { ok: true, code: parts.map((p) => p.text).join('+'), format: 'CWCheat', parts, placeholder,
    ...(placeholder ? { note: 'Ligne de titre (aucun code) : ne pas activer.' } : {}) };
}

/** Vrai si le code n'est qu'un titre de section d'un fichier .cht (rien à activer). */
export function isPlaceholderCode(system, code) {
  const parsed = parseCheatCode(system, code);
  return !!(parsed.ok && parsed.placeholder);
}

/** Description lisible : « $91D9 ← $AD si $xx ». */
export function describeCode(parsed) {
  if (!parsed.ok) return parsed.error;
  return parsed.parts.map((p) => p.address == null ? `${p.text} (${p.format})` :
    `${p.format} : $${hex(p.address, p.address > 0xffff ? 6 : 4)} ← $${hex(p.value, 2)}${p.compare == null ? '' : ` si $${hex(p.compare, 2)}`}`).join(' ; ');
}

/**
 * PSP : codes actifs qui écrivent une valeur différente à la même adresse (variantes exclusives,
 * comme « Start At Level 1 » et « Start At Level 2 »). Seules les écritures simples CWCheat
 * (types 0, 1 et 2 : 8, 16 et 32 bits) sont comparées. Retourne [[nomA, nomB, adresse], …].
 */
export function pspCodeConflicts(entries) {
  const writes = new Map();
  const out = [];
  for (const e of entries) {
    const values = String(e.code).match(/0x[0-9a-f]{8}/gi) || [];
    for (let i = 0; i + 1 < values.length; i += 2) {
      const word = parseInt(values[i].slice(2), 16) >>> 0;
      if ((word >>> 28) > 2) break; // code conditionnel ou multiple : les lignes suivantes ne sont pas des adresses
      const key = `${word >>> 28}:${(word & 0x0fffffff).toString(16)}`;
      const value = values[i + 1].toUpperCase();
      const seen = writes.get(key);
      if (seen && seen.value !== value && seen.name !== e.name && !out.some((c) => c[0] === seen.name && c[1] === e.name)) {
        out.push([seen.name, e.name, `0x${(0x08800000 + (word & 0x0fffffff)).toString(16).toUpperCase().padStart(8, "0")}`]);
      }
      if (!seen) writes.set(key, { value, name: e.name });
    }
  }
  return out;
}
