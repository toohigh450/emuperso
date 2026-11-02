// Fichiers de codes au format libretro (.cht) : lecture, association à une version précise du jeu.
// Règles : aucun code n'est actif par défaut, aucun code n'est présenté comme vérifié en jeu,
// et un fichier d'une autre version/région du même jeu n'est jamais appliqué sans choix explicite.

export const CHEAT_FOLDER_ALIASES = {
  gb: 'game boy',
  gbc: 'game boy color',
  gba: 'game boy advance',
  nds: 'nintendo ds',
  // Dossiers de la base libretro : « Nintendo - Nintendo Entertainment System », « Nintendo - Super Nintendo… ».
  nes: 'nintendo entertainment system',
  snes: 'super nintendo entertainment system',
  genesis: 'sega - mega drive - genesis',
  // « Sony - PlayStation Portable » ; les noms de fichiers y finissent par « [US] [ULUS-10080] ».
  psp: 'playstation portable',
};

/** Déduit la console d'après les dossiers du chemin (ex. « Nintendo - Game Boy Advance/… »). */
export function inferSystemFromPath(path) {
  const parts = String(path || '').split(/[\\/]/).slice(0, -1);
  for (let i = parts.length - 1; i >= 0; i--) {
    const norm = parts[i].toLowerCase().replace(/^(?:nintendo|sony)\s*-\s*/, '').replace(/\s+/g, ' ').trim();
    for (const [sys, alias] of Object.entries(CHEAT_FOLDER_ALIASES)) {
      if (norm === alias || norm === sys) return sys;
    }
  }
  return null;
}

/** Lit un fichier .cht (format texte « cheatN_desc / cheatN_code »). */
export function parseCht(text) {
  const rows = new Map();
  const unquote = (v) => {
    const t = v.trim();
    return t.startsWith('"') && t.endsWith('"') && t.length >= 2 ? t.slice(1, -1) : t;
  };
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const m = /^cheat(\d+)_(desc|code|enable)\s*=\s*(.*)$/i.exec(line);
    if (!m) continue;
    const idx = Number(m[1]);
    if (!rows.has(idx)) rows.set(idx, {});
    rows.get(idx)[m[2].toLowerCase()] = unquote(m[3]);
  }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, r]) => ({ desc: r.desc || '', code: r.code || '' }))
    .filter((c) => c.code.length > 0);
}

/** Métadonnée facultative : rom_sha256 = "<64 chiffres hexadécimaux>".
 * Une déclaration invalide ou contradictoire ne doit jamais devenir une suggestion par nom.
 */
export function cheatIdentity(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => /^\s*(?:#\s*)?rom_sha256\s*=/i.test(line));
  const hashes = lines.map((line) => /^\s*(?:#\s*)?rom_sha256\s*=\s*(?:"([a-f0-9]{64})"|([a-f0-9]{64}))\s*$/i.exec(line));
  const unique = new Set(hashes.filter(Boolean).map((m) => (m[1] || m[2]).toLowerCase()));
  return { declared: lines.length > 0, sha256: hashes.every(Boolean) && unique.size === 1 ? [...unique][0] : null };
}

/** Identifiant de disque PSP à la fin d'un nom de fichier libretro (« … [US] [ULUS-10080].cht »), ou null. */
export function discIdOfCheatName(name) {
  const m = /\[([A-Z]{4}-\d{5})\]\s*(?:\.[^.]+)?$/i.exec(String(name || '').replace(/^.*[\\/]/, ''));
  return m ? m[1].toUpperCase() : null;
}

/**
 * Le nom est une suggestion. Seule une empreinte déclarée peut identifier les octets.
 * PSP : discId (lu dans UMD_DATA.BIN ou PARAM.SFO) désigne le disque bien plus sûrement qu'un nom,
 * mais pas sa révision : la correspondance reste une suggestion à confirmer (sameDisc).
 */
export function classifyCheatFiles(romName, hex, files, { discId = null } = {}) {
  const identified = files.filter((f) => f.romSha256 === hex && !f.reviewRequired);
  let candidates = files.filter((f) => !f.identityDeclared && !f.romSha256);
  const sameDisc = discId ? candidates.filter((f) => discIdOfCheatName(f.name) === discId) : [];
  if (sameDisc.length) candidates = candidates.filter((f) => !sameDisc.includes(f));
  return { identified, sameDisc, ...matchCheatFiles(romName, candidates) };
}

export function linkedCheatValid(link, file, hex) {
  return !!(link && file && link.romSha256 === hex && link.contentSha256 &&
    link.contentSha256 === file.contentSha256 && (!file.identityDeclared || file.romSha256 === hex));
}

const DEVICE = '(?:pro\\s+)?(?:code\\s*breaker|game\\s*shark|action\\s*replay|game\\s*genie|xploder|datel)[^)]*';
const DEVICE_SUFFIX = new RegExp(`\\s*\\(${DEVICE}\\)\\s*$`, 'i');

/** Retire l'extension et le suffixe d'appareil de triche, garde région/version. */
export function normalizeName(name) {
  let s = String(name || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').trim();
  while (DEVICE_SUFFIX.test(s)) s = s.replace(DEVICE_SUFFIX, '');
  return s.replace(/\s+/g, ' ').toLowerCase();
}

/** Titre sans aucune parenthèse (région, version, appareil). */
export function baseTitle(name) {
  return normalizeName(name).replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Classe les fichiers de codes d'une console par rapport au nom de la ROM.
 * exact : même nom (étiquettes de région et version comprises) → suggestions à confirmer.
 * sameTitle : même titre mais autre région/version → NON appliqués par défaut.
 */
export function matchCheatFiles(romName, files) {
  const full = normalizeName(romName);
  const base = baseTitle(romName);
  const exact = [];
  const sameTitle = [];
  for (const f of files) {
    if (normalizeName(f.name) === full) exact.push(f);
    else if (base && baseTitle(f.name) === base) sameTitle.push(f);
  }
  return { exact, sameTitle };
}

/** Appareil de triche indiqué en fin de nom de fichier (Code Breaker, GameShark…), ou ''. */
export function deviceLabel(name) {
  const base = String(name || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').trim();
  const m = DEVICE_SUFFIX.exec(base);
  return m ? m[0].trim().replace(/^\(|\)$/g, '') : '';
}

/** Format attendu par EJS_cheats : [[nom, valeur], …]. */
export function toEjsCheats(cheats) {
  return cheats.filter((c) => c.code).map((c, i) => [c.desc || `Code ${i + 1}`, c.code]);
}
