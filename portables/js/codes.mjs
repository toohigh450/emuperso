// Codes de triche saisis à la main : validation, normalisation et décodage, NES et SNES.
// Les formats acceptés sont ceux que lisent réellement les cœurs (fceumm et snes9x, fonction
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
export function parseCheatCode(system, input) {
  const raw = String(input || '').trim();
  if (!raw) return { ok: false, error: 'Code vide.' };
  if (raw.length > 400) return { ok: false, error: 'Code trop long (400 caractères maximum).' };
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

/** Description lisible : « $91D9 ← $AD si $xx ». */
export function describeCode(parsed) {
  if (!parsed.ok) return parsed.error;
  return parsed.parts.map((p) => p.address == null ? `${p.text} (${p.format})` :
    `${p.format} : $${hex(p.address, p.address > 0xffff ? 6 : 4)} ← $${hex(p.value, 2)}${p.compare == null ? '' : ` si $${hex(p.compare, 2)}`}`).join(' ; ');
}
