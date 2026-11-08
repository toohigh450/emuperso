// Reconnaissance des consoles et lecture des en-têtes de ROM (NES, SNES, Genesis, GB, GBC, GBA, DS).
// La PSP (images disque de plusieurs centaines de Mio) est analysée à part, par tranches : voir psp.mjs.
// Module pur : aucune dépendance au navigateur, testable avec Node.

const KiB = 1024;
const MiB = 1024 * KiB;

export const SYSTEMS = {
  nes: {
    id: 'nes',
    label: 'NES / Famicom',
    exts: ['nes', 'unf', 'unif'],
    ejsCore: 'nes', // cœur fceumm par défaut dans EmulatorJS ; donne aussi la manette tactile NES
    coreId: 'fceumm',
    maxBytes: 64 * MiB, // compilations multi-jeux comprises
    aspect: '4 / 3',
  },
  snes: {
    id: 'snes',
    label: 'Super Nintendo / Super Famicom',
    exts: ['sfc', 'smc', 'swc', 'fig'],
    ejsCore: 'snes', // cœur snes9x ; manette tactile A/B/X/Y/L/R
    coreId: 'snes9x',
    maxBytes: 8 * MiB + 512, // ExHiROM 64 Mbit + en-tête de copieur
    aspect: '4 / 3',
  },
  genesis: {
    id: 'genesis',
    label: 'Sega Genesis / Mega Drive',
    exts: ['md', 'smd', 'gen'],
    ejsCore: 'segaMD', // cœur genesis_plus_gx par défaut dans EmulatorJS ; pas de BIOS requis
    coreId: 'genesis_plus_gx',
    maxBytes: 16 * MiB, // inclut les homebrews et hacks étendus ; compatibilité du cœur à vérifier
    aspect: '4 / 3',
  },
  gb: {
    id: 'gb',
    label: 'Game Boy',
    exts: ['gb'],
    ejsCore: 'gb', // cœur gambatte par défaut dans EmulatorJS
    coreId: 'gambatte',
    maxBytes: 8 * MiB,
    aspect: '10 / 9',
  },
  gbc: {
    id: 'gbc',
    label: 'Game Boy Color',
    exts: ['gbc'],
    ejsCore: 'gb',
    coreId: 'gambatte',
    maxBytes: 8 * MiB,
    aspect: '10 / 9',
  },
  gba: {
    id: 'gba',
    label: 'Game Boy Advance',
    exts: ['gba'],
    ejsCore: 'gba',
    coreId: 'mgba',
    maxBytes: 32 * MiB,
    aspect: '3 / 2',
  },
  nds: {
    id: 'nds',
    label: 'Nintendo DS',
    exts: ['nds'],
    ejsCore: 'desmume2015',
    coreId: 'desmume2015',
    maxBytes: 1024 * MiB,
    aspect: '2 / 3',
  },
  psp: {
    id: 'psp',
    label: 'PlayStation Portable',
    exts: ['iso', 'cso', 'pbp'],
    ejsCore: 'psp', // cœur ppsspp, version à fils d'exécution seulement (isolation COOP/COEP requise)
    coreId: 'ppsspp',
    maxBytes: 1800 * MiB, // UMD double couche
    aspect: '16 / 9', // 480 × 272
  },
  arcade: {
    id: 'arcade',
    label: 'Arcade (MAME 2003-Plus / FBNeo)',
    exts: [], // un romset arcade est un .zip de puces sans format reconnaissable : voir analyzeArcade
    ejsCore: 'mame2003_plus',
    coreId: 'mame2003_plus',
    maxBytes: 256 * MiB,
    aspect: '4 / 3',
  },
};

// Cœurs arcade du moteur web : aucun MAME récent n'existe dans EmulatorJS. Un romset d'un MAME récent n'est
// reconnu que s'il n'a pas changé depuis ; le lanceur essaie un cœur puis l'autre et retient celui qui marche.
export const ARCADE_CORES = {
  mame2003_plus: { ejsCore: 'mame2003_plus', label: 'MAME 2003-Plus' },
  fbneo: { ejsCore: 'fbneo', label: 'FBNeo' },
};
export const ARCADE_CORE_ORDER = ['mame2003_plus', 'fbneo'];

// DOOM (jeux PC de Karl, versions GOG) : PrBoom lit le .wad du jeu complet (IWAD). Il reconnaît le jeu à
// son nom de fichier (doom2.wad, plutonia.wad…), qui ne doit donc pas changer.
export const DOOM_IWADS = Object.freeze({
  doom: 'DOOM', doom1: 'DOOM (shareware)', doomu: 'The Ultimate DOOM', doom2: 'DOOM II',
  plutonia: 'Final DOOM : The Plutonia Experiment', tnt: 'Final DOOM : TNT Evilution', freedoom1: 'Freedoom 1', freedoom2: 'Freedoom 2',
});
SYSTEMS.doom = {
  id: 'doom',
  label: 'DOOM (PrBoom)',
  exts: [],
  ejsCore: 'prboom',
  coreId: 'prboom',
  maxBytes: 64 * MiB,
  aspect: '4 / 3',
};

/** Fichier .wad : jeu complet (IWAD) accepté ; un niveau additionnel (PWAD) demande son jeu à côté. */
export function analyzeWad(fileName, bytes) {
  const name = String(fileName || '').replace(/^.*[\\/]/, '');
  const stem = name.replace(/\.wad$/i, '').toLowerCase();
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  const result = { ok: false, fileName: name, ext: 'wad', size: bytes.length, system: 'doom', title: DOOM_IWADS[stem] || name, code: stem, region: 'inconnue', version: 0, headerOk: false, warnings: [], errors: [] };
  if (magic === 'PWAD') result.errors.push('Ce .wad est un niveau additionnel (PWAD, par exemple un des Master Levels) : il ne se lance pas seul. Ouvre le jeu complet (doom2.wad…) ; les niveaux additionnels viendront plus tard.');
  else if (magic !== 'IWAD') result.errors.push('Ce fichier n’est pas un .wad de DOOM.');
  else if (bytes.length > SYSTEMS.doom.maxBytes) result.errors.push('Fichier trop gros pour le navigateur.');
  else if (bytes.length < 12) result.errors.push('En-tête WAD incomplet.');
  else {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getInt32(4, true);
    const directory = view.getInt32(8, true);
    if (count <= 0 || directory < 12 || directory + count * 16 > bytes.length) {
      result.errors.push('Répertoire WAD invalide ou tronqué.');
    } else {
      for (let i = 0; i < count; i++) {
        const offset = view.getInt32(directory + i * 16, true);
        const size = view.getInt32(directory + i * 16 + 4, true);
        if (offset < 0 || size < 0 || offset + size > bytes.length) {
          result.errors.push('Données WAD hors du fichier : archive invalide ou tronquée.');
          break;
        }
      }
    }
  }
  if (!result.errors.length && !DOOM_IWADS[stem]) result.warnings.push('Nom de fichier inhabituel : PrBoom reconnaît le jeu à son nom (doom.wad, doom2.wad, plutonia.wad, tnt.wad). Ne renomme pas le fichier.');
  if (!result.errors.length) { result.ok = true; result.headerOk = true; }
  return result;
}

// Cœurs DS proposés (le cœur choisi fait partie de l'espace de sauvegarde du jeu).
export const DS_CORES = {
  desmume2015: { ejsCore: 'desmume2015', label: 'DeSmuME 2015 (sans BIOS)', needsBios: false },
  desmume: { ejsCore: 'desmume', label: 'DeSmuME (sans BIOS)', needsBios: false },
  melonds: { ejsCore: 'melonds', label: 'melonDS (BIOS requis)', needsBios: true },
};

export const ROM_EXTENSIONS = new Set(['gb', 'gbc', 'gba', 'nds', 'nes', 'unf', 'unif', 'sfc', 'smc', 'swc', 'fig', 'md', 'smd', 'gen']);
// Extensions d'origine douteuse acceptées seulement si l'en-tête est reconnu.
export const LOOSE_EXTENSIONS = new Set(['bin', 'rom', 'sgb', 'dsi', 'srl']);
const EXT_SYSTEM = { nes: 'nes', unf: 'nes', unif: 'nes', sfc: 'snes', smc: 'snes', swc: 'snes', fig: 'snes', md: 'genesis', smd: 'genesis', gen: 'genesis' };
// Formats connus mais refusés, avec une explication claire.
export const UNSUPPORTED_FORMATS = {
  fds: 'Famicom Disk System (.fds) : demande le BIOS commercial disksys.rom, qui n’est ni fourni ni accepté ici.',
  qd: 'Famicom Disk System (.qd) : demande le BIOS commercial disksys.rom, qui n’est ni fourni ni accepté ici.',
  nsf: 'Fichier musical NES (.nsf) : ce n’est pas un jeu.',
  nsfe: 'Fichier musical NES (.nsfe) : ce n’est pas un jeu.',
  spc: 'Fichier musical SNES (.spc) : ce n’est pas un jeu.',
  bs: 'Satellaview (.bs) : prise en charge incomplète, non proposée.',
  st: 'Sufami Turbo (.st) : demande le BIOS commercial de la cartouche de base, non proposé.',
  '32x': 'Sega 32X (.32x) : cœur PicoDrive distinct, non intégré au lanceur Genesis.',
  ips: 'Patch .ips : applique-le d’abord à ta ROM avec un outil de patch, puis ouvre la ROM patchée.',
  bps: 'Patch .bps : applique-le d’abord à ta ROM avec un outil de patch, puis ouvre la ROM patchée.',
  ups: 'Patch .ups : applique-le d’abord à ta ROM avec un outil de patch, puis ouvre la ROM patchée.',
  chd: 'CHD : le cœur PSP de cette version d’EmulatorJS ne lit pas ce format. Convertis-le en ISO avec chdman (« chdman extractdvd -i jeu.chd -o jeu.iso »), puis en CSO avec maxcso si tu veux gagner de la place. Garde l’original.',
  zso: 'ZSO : le cœur PSP de cette version d’EmulatorJS ne lit pas ce format. Décompresse-le avec maxcso (--decompress) puis ouvre l’ISO ou recompresse-le en CSO.',
};

// BIOS, boot ROM et BIOS de copieurs (Super Wild Card…) rangés avec les jeux dans les collections :
// ce ne sont pas des jeux. Le lanceur n'en fournit et n'en demande aucun (sauf melonDS, importé à part).
const BIOS_NAME = /\[BIOS\]|\(BIOS\)|\bBIOS\b|\bboot ?rom\b|^(?:bios[79]|firmware|gba_bios|gb_bios|gbc_bios|sgb_bios|disksys)\.(?:bin|rom)$/i;
export const BIOS_MESSAGE = 'Ce fichier est un BIOS (logiciel interne d’une console ou d’un copieur), pas un jeu : il ne se lance pas ici. Aucun BIOS n’est nécessaire pour ces consoles, sauf melonDS pour la DS, à importer à part dans l’onglet Moteur. Il reste sur ton appareil, rien n’est envoyé.';
export function isBiosName(fileName) {
  return BIOS_NAME.test(String(fileName || '').replace(/^.*[\\/]/, ''));
}

/** Extension à donner au cœur (certains cœurs choisissent leur chargeur d'après elle). */
export function engineExtension(analysis) {
  if (analysis.system === 'nes') return analysis.format === 'UNIF' ? 'unf' : 'nes';
  if (analysis.system === 'snes') return analysis.copierHeader ? 'smc' : 'sfc';
  if (analysis.system === 'genesis') return ['md', 'smd', 'gen'].includes(analysis.ext) ? analysis.ext : 'md';
  if (analysis.system === 'psp') return analysis.format; // iso, cso ou pbp : ppsspp choisit son lecteur d'après l'extension
  return analysis.system;
}

export function extensionOf(fileName) {
  const m = /\.([^.\\/]+)$/.exec(String(fileName || ''));
  return m ? m[1].toLowerCase() : '';
}

export function stemOf(fileName) {
  return String(fileName || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
}

const GB_LOGO = [0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 0x00, 0x0b];
const GBA_LOGO = [0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21];

function startsWithAt(bytes, offset, pattern) {
  if (bytes.length < offset + pattern.length) return false;
  for (let i = 0; i < pattern.length; i++) if (bytes[offset + i] !== pattern[i]) return false;
  return true;
}

function asciiAt(bytes, start, end) {
  let out = '';
  for (let i = start; i < end && i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 0) break;
    out += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '?';
  }
  return out.trim();
}

const REGION_LETTERS = {
  J: 'Japon', E: 'USA', P: 'Europe', X: 'Europe', Y: 'Europe', Z: 'Europe',
  D: 'Allemagne', F: 'France', I: 'Italie', S: 'Espagne', H: 'Pays-Bas',
  U: 'Australie', K: 'Corée', C: 'Chine', O: 'International', A: 'Asie', V: 'Europe',
};

export function regionFromGameCode(code) {
  const letter = String(code || '').charAt(3).toUpperCase();
  return REGION_LETTERS[letter] || 'inconnue';
}

// --- Game Boy / Game Boy Color -------------------------------------------------
export function parseGb(bytes) {
  const info = { warnings: [], errors: [] };
  if (bytes.length < 0x150) {
    info.errors.push('Fichier trop petit pour contenir un en-tête Game Boy.');
    return info;
  }
  const cgbFlag = bytes[0x143];
  info.isColor = cgbFlag === 0x80 || cgbFlag === 0xc0;
  info.colorOnly = cgbFlag === 0xc0;
  info.title = asciiAt(bytes, 0x134, info.isColor ? 0x13f : 0x143);
  info.logoOk = startsWithAt(bytes, 0x104, GB_LOGO);
  let x = 0;
  for (let i = 0x134; i <= 0x14c; i++) x = (x - bytes[i] - 1) & 0xff;
  info.checksumOk = x === bytes[0x14d];
  info.version = bytes[0x14c];
  info.region = bytes[0x14a] === 0 ? 'Japon' : 'Hors Japon';
  info.headerOk = info.logoOk && info.checksumOk;
  const sizeCode = bytes[0x148];
  if (sizeCode <= 8) {
    const expected = (32 * KiB) << sizeCode;
    if (expected !== bytes.length) {
      info.warnings.push(`Taille inattendue : ${bytes.length} octets lus, ${expected} annoncés par l'en-tête.`);
    }
  }
  if (!info.logoOk) info.warnings.push("Le logo Nintendo de l'en-tête n'est pas reconnu.");
  if (info.logoOk && !info.checksumOk) info.warnings.push("La somme de contrôle de l'en-tête est incorrecte.");
  return info;
}

// --- Game Boy Advance -----------------------------------------------------------
export function parseGba(bytes) {
  const info = { warnings: [], errors: [] };
  if (bytes.length < 0xc0) {
    info.errors.push('Fichier trop petit pour contenir un en-tête Game Boy Advance.');
    return info;
  }
  info.title = asciiAt(bytes, 0xa0, 0xac);
  info.code = asciiAt(bytes, 0xac, 0xb0);
  info.maker = asciiAt(bytes, 0xb0, 0xb2);
  info.version = bytes[0xbc];
  info.region = regionFromGameCode(info.code);
  info.logoOk = startsWithAt(bytes, 0x04, GBA_LOGO);
  info.fixedOk = bytes[0xb2] === 0x96;
  let c = 0;
  for (let i = 0xa0; i <= 0xbc; i++) c = (c - bytes[i]) & 0xff;
  c = (c - 0x19) & 0xff;
  info.checksumOk = c === bytes[0xbd];
  info.headerOk = info.logoOk && info.fixedOk && info.checksumOk;
  if (!info.logoOk) info.warnings.push("Le logo Nintendo de l'en-tête n'est pas reconnu.");
  else if (!info.checksumOk) info.warnings.push("La somme de contrôle de l'en-tête est incorrecte.");
  return info;
}

// --- Nintendo DS ----------------------------------------------------------------
export function crc16Modbus(bytes, start, end) {
  let crc = 0xffff;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i];
    for (let b = 0; b < 8; b++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}

export function parseNds(bytes) {
  const info = { warnings: [], errors: [] };
  if (bytes.length < 0x200) {
    info.errors.push('Fichier trop petit pour contenir un en-tête Nintendo DS.');
    return info;
  }
  info.title = asciiAt(bytes, 0x00, 0x0c);
  info.code = asciiAt(bytes, 0x0c, 0x10);
  info.maker = asciiAt(bytes, 0x10, 0x12);
  info.unitCode = bytes[0x12];
  info.version = bytes[0x1e];
  info.region = regionFromGameCode(info.code);
  info.logoOk = startsWithAt(bytes, 0xc0, GBA_LOGO);
  const stored = bytes[0x15e] | (bytes[0x15f] << 8);
  info.checksumOk = crc16Modbus(bytes, 0x000, 0x15e) === stored;
  info.headerOk = info.logoOk && info.checksumOk;
  if (info.unitCode === 0x03) {
    info.errors.push('Jeu réservé à la DSi : non pris en charge par les cœurs DS proposés.');
  }
  if (!info.logoOk) info.warnings.push("Le logo Nintendo de l'en-tête n'est pas reconnu.");
  else if (!info.checksumOk) info.warnings.push("La somme de contrôle de l'en-tête est incorrecte.");
  return info;
}

// --- NES / Famicom --------------------------------------------------------------
const INES_MAGIC = [0x4e, 0x45, 0x53, 0x1a];
const UNIF_MAGIC = [0x55, 0x4e, 0x49, 0x46];

// Cartes courantes. Le nom n'est pas une promesse de compatibilité : voir COMPATIBILITE-NES-SNES.md.
export const NES_MAPPERS = {
  0: 'NROM', 1: 'MMC1 (SxROM)', 2: 'UxROM', 3: 'CNROM', 4: 'MMC3 / MMC6 (TxROM)', 5: 'MMC5 (ExROM)',
  7: 'AxROM', 9: 'MMC2 (PxROM)', 10: 'MMC4 (FxROM)', 11: 'Color Dreams', 13: 'CPROM', 16: 'Bandai FCG',
  18: 'Jaleco SS88006', 19: 'Namco 163', 21: 'Konami VRC4', 22: 'Konami VRC2', 23: 'Konami VRC2/VRC4',
  24: 'Konami VRC6', 25: 'Konami VRC4', 26: 'Konami VRC6', 32: 'Irem G-101', 33: 'Taito TC0190',
  34: 'BNROM / NINA-001', 48: 'Taito TC0690', 64: 'Tengen RAMBO-1', 65: 'Irem H3001', 66: 'GxROM',
  68: 'Sunsoft-4', 69: 'Sunsoft FME-7 / 5B', 71: 'Camerica', 73: 'Konami VRC3', 75: 'Konami VRC1',
  76: 'Namco 109', 79: 'NINA-03/06', 85: 'Konami VRC7', 87: 'Jaleco JF', 94: 'UN1ROM', 105: 'NES-EVENT',
  118: 'TxSROM (MMC3)', 119: 'TQROM (MMC3)', 140: 'Jaleco JF-11/14', 152: 'Bandai 74161', 180: 'UNROM (Crazy Climber)',
  184: 'Sunsoft-1', 185: 'CNROM + protection', 206: 'Namco 108 / DxROM', 210: 'Namco 175/340', 228: 'Action 52',
};
const NES_TIMING = ['NTSC', 'PAL', 'NTSC/PAL', 'Dendy'];

export function parseNes(bytes) {
  const info = { warnings: [], errors: [] };
  if (startsWithAt(bytes, 0, UNIF_MAGIC)) return parseUnif(bytes, info);
  if (bytes.length < 16 || !startsWithAt(bytes, 0, INES_MAGIC)) {
    info.errors.push('En-tête iNES absent : ce fichier n’est pas une ROM NES reconnue.');
    return info;
  }
  const f6 = bytes[6], f7 = bytes[7];
  const nes2 = (f7 & 0x0c) === 0x08;
  // En-têtes iNES 1.0 salis (ex. « DiskDude! ») : les octets 7 à 15 ne sont pas fiables.
  const dirty = !nes2 && (bytes[12] || bytes[13] || bytes[14] || bytes[15]);
  let mapper = (f6 >> 4) | (dirty ? 0 : f7 & 0xf0);
  let submapper = 0;
  let prgUnits = bytes[4];
  let chrUnits = bytes[5];
  if (nes2) {
    mapper |= (bytes[8] & 0x0f) << 8;
    submapper = bytes[8] >> 4;
    if ((bytes[9] & 0x0f) !== 0x0f) prgUnits |= (bytes[9] & 0x0f) << 8;
    if ((bytes[9] >> 4) !== 0x0f) chrUnits |= (bytes[9] >> 4) << 8;
  }
  info.format = nes2 ? 'NES 2.0' : 'iNES';
  info.mapper = mapper;
  info.submapper = submapper;
  info.mapperName = NES_MAPPERS[mapper] || `carte n° ${mapper}`;
  info.battery = !!(f6 & 0x02);
  info.trainer = !!(f6 & 0x04);
  info.mirroring = f6 & 0x08 ? 'quatre écrans' : f6 & 0x01 ? 'verticale' : 'horizontale';
  info.prgBytes = prgUnits * 16 * KiB;
  info.chrBytes = chrUnits * 8 * KiB;
  info.timing = nes2 ? NES_TIMING[bytes[12] & 0x03] : (!dirty && bytes[9] & 0x01 ? 'PAL' : 'NTSC (présumé)');
  info.vsSystem = (f7 & 0x03) === 1;
  info.headerOk = !dirty && prgUnits > 0;
  if (dirty) info.warnings.push('En-tête iNES ancien ou modifié : numéro de carte possiblement inexact.');
  if (prgUnits === 0) info.warnings.push('L’en-tête annonce 0 octet de programme.');
  const expected = 16 + (info.trainer ? 512 : 0) + info.prgBytes + info.chrBytes;
  if (prgUnits > 0 && expected !== bytes.length && (bytes[9] & 0x0f) !== 0x0f) {
    info.warnings.push(`Taille inattendue : ${bytes.length} octets lus, ${expected} annoncés par l'en-tête.`);
  }
  if (info.vsSystem) info.warnings.push('Jeu VS. System (arcade) : palette et contrôles possiblement différents.');
  if (!NES_MAPPERS[mapper]) info.warnings.push(`Carte n° ${mapper} peu courante : compatibilité non vérifiée.`);
  return info;
}

function parseUnif(bytes, info) {
  info.format = 'UNIF';
  if (bytes.length < 32) {
    info.errors.push('Fichier UNIF tronqué.');
    return info;
  }
  let p = 32;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (p + 8 <= bytes.length) {
    const id = asciiAt(bytes, p, p + 4);
    const len = view.getUint32(p + 4, true);
    const data = p + 8;
    if (data + len > bytes.length) { info.warnings.push('Bloc UNIF tronqué.'); break; }
    if (id === 'MAPR') info.board = asciiAt(bytes, data, data + len);
    else if (id === 'NAME') info.title = asciiAt(bytes, data, data + len);
    else if (id === 'TVCI') info.timing = NES_TIMING[bytes[data]] || 'inconnu';
    else if (id === 'BATR') info.battery = !!bytes[data];
    p = data + len;
  }
  if (!info.board) info.errors.push('Fichier UNIF sans nom de carte (bloc MAPR) : impossible à démarrer.');
  info.mapperName = info.board ? `UNIF ${info.board}` : 'UNIF';
  info.headerOk = !!info.board;
  info.timing = info.timing || 'NTSC (présumé)';
  return info;
}

// --- Super Nintendo / Super Famicom ------------------------------------------------
const SNES_COUNTRIES = {
  0: 'Japon', 1: 'USA', 2: 'Europe', 3: 'Suède', 4: 'Finlande', 5: 'Danemark', 6: 'France', 7: 'Pays-Bas',
  8: 'Espagne', 9: 'Allemagne', 10: 'Italie', 11: 'Chine', 12: 'Indonésie', 13: 'Corée', 14: 'International',
  15: 'Canada', 16: 'Brésil', 17: 'Australie',
};
const SNES_PAL = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 17]);
// Puces spéciales (quartet haut de l'octet de type) et prise en charge annoncée par Snes9x.
// « annoncée » n'est pas « vérifiée » : seuls les jeux testés figurent dans TESTS-NES-SNES.md.
export const SNES_CHIPS = {
  dsp: { label: 'DSP (DSP-1 à 4)', snes9x: true },
  superfx: { label: 'Super FX (GSU)', snes9x: true },
  obc1: { label: 'OBC1', snes9x: true },
  sa1: { label: 'SA-1', snes9x: true },
  sdd1: { label: 'S-DD1', snes9x: true },
  srtc: { label: 'S-RTC', snes9x: true },
  other: { label: 'Super Game Boy / Satellaview', snes9x: false },
  spc7110: { label: 'SPC7110', snes9x: true },
  st010: { label: 'ST010 / ST011', snes9x: true },
  st018: { label: 'ST018', snes9x: false },
  cx4: { label: 'Cx4', snes9x: true },
};
const SNES_CHIP_NIBBLE = { 0: 'dsp', 1: 'superfx', 2: 'obc1', 3: 'sa1', 4: 'sdd1', 5: 'srtc', 0xe: 'other' };
// Sous-type de puce (octet $xFBF) quand le type de cartouche vaut $Fx. Cx4 = $10 (Mega Man X2/X3).
const SNES_CUSTOM = { 0x00: 'spc7110', 0x01: 'st010', 0x02: 'st018', 0x10: 'cx4' };

function snesHeaderScore(bytes, base, expectHi) {
  if (base + 0x40 > bytes.length) return -1;
  let score = 0;
  const complement = bytes[base + 0x1c] | (bytes[base + 0x1d] << 8);
  const checksum = bytes[base + 0x1e] | (bytes[base + 0x1f] << 8);
  if ((complement ^ checksum) === 0xffff) score += 4;
  const mode = bytes[base + 0x15];
  if ((mode & 0xe0) === 0x20) score += 2;
  if (((mode & 0x01) === 1) === expectHi) score += 2;
  const reset = bytes[base + 0x3c] | (bytes[base + 0x3d] << 8);
  if (reset >= 0x8000) score += 2;
  let printable = 0;
  for (let i = 0; i < 21; i++) { const c = bytes[base + i]; if (c >= 0x20 && c < 0x7f) printable++; }
  if (printable >= 18) score += 2;
  if (bytes[base + 0x17] >= 0x07 && bytes[base + 0x17] <= 0x0d) score += 1;
  if (bytes[base + 0x19] <= 0x14) score += 1;
  return score;
}

/** Somme de contrôle SNES (puissance de deux, partie restante répétée), sans en-tête de copieur. */
export function snesChecksum(rom) {
  if (rom.length === 0) return 0;
  let pow = 1;
  while (pow * 2 <= rom.length) pow *= 2;
  let sum = 0;
  for (let i = 0; i < pow; i++) sum += rom[i];
  const rest = rom.length - pow;
  if (rest > 0) {
    let part = 0;
    for (let i = pow; i < rom.length; i++) part += rom[i];
    sum += part * (pow / rest);
  }
  return sum & 0xffff;
}

export function parseSnes(bytes) {
  const info = { warnings: [], errors: [] };
  info.copierHeader = bytes.length % 1024 === 512;
  const rom = info.copierHeader ? bytes.subarray(512) : bytes;
  if (rom.length < 0x8000) {
    info.errors.push('Fichier trop petit pour une ROM Super Nintendo (32 Kio minimum).');
    return info;
  }
  const candidates = [
    { base: 0x7fc0, layout: 'LoROM', hi: false },
    { base: 0xffc0, layout: 'HiROM', hi: true },
    { base: 0x40ffc0, layout: 'ExHiROM', hi: true },
  ].map((c) => ({ ...c, score: snesHeaderScore(rom, c.base, c.hi) })).filter((c) => c.score >= 0);
  // ExHiROM (plus de 4 Mio) : la copie d'en-tête en $FFC0 est souvent un modèle vide ; la vraie est en $40FFC0.
  for (const c of candidates) if (c.layout === 'ExHiROM' && rom.length > 0x400000 && (rom[c.base + 0x15] & 0x0f) === 0x05) c.score += 3;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best || best.score < 6) {
    info.errors.push('En-tête interne Super Nintendo introuvable : ce fichier n’est pas une ROM SNES reconnue.');
    return info;
  }
  const b = best.base;
  info.layout = best.layout;
  info.title = asciiAt(rom, b, b + 21);
  info.mapMode = rom[b + 0x15];
  if ((info.mapMode & 0x0f) === 0x03) info.layout = 'SA-1';
  if ((info.mapMode & 0x0f) === 0x05) info.layout = 'ExHiROM';
  info.fastRom = !!(info.mapMode & 0x10);
  const type = rom[b + 0x16];
  info.romSize = rom[b + 0x17] <= 0x0d ? (1 << rom[b + 0x17]) * KiB : 0;
  info.ramSize = rom[b + 0x18] && rom[b + 0x18] <= 0x09 ? (1 << rom[b + 0x18]) * KiB : 0;
  info.country = rom[b + 0x19];
  info.region = SNES_COUNTRIES[info.country] || 'inconnue';
  info.video = SNES_PAL.has(info.country) ? 'PAL' : 'NTSC';
  info.version = rom[b + 0x1b];
  if (rom[b + 0x1a] === 0x33) info.code = asciiAt(rom, b - 0x0e, b - 0x0a);
  info.battery = [0x02, 0x05, 0x06, 0x09, 0x0a].includes(type & 0x0f);
  info.chip = null;
  if ((type & 0x0f) >= 0x03) {
    const nibble = type >> 4;
    info.chip = nibble === 0x0f ? SNES_CUSTOM[rom[b - 1]] || 'other' : SNES_CHIP_NIBBLE[nibble] || 'other';
  }
  const complement = rom[b + 0x1c] | (rom[b + 0x1d] << 8);
  const checksum = rom[b + 0x1e] | (rom[b + 0x1f] << 8);
  info.checksumOk = (complement ^ checksum) === 0xffff && snesChecksum(rom) === checksum;
  info.headerOk = info.checksumOk;
  if (!info.checksumOk) info.warnings.push('Somme de contrôle interne différente : ROM modifiée (hack, traduction) ou mauvais dump possible.');
  if (info.copierHeader) info.warnings.push('En-tête de copieur de 512 octets détecté : il est conservé et ignoré par le moteur.');
  if (info.chip) {
    const spec = SNES_CHIPS[info.chip];
    if (!spec.snes9x) info.errors.push(`Puce ${spec.label} : non prise en charge par Snes9x.`);
    else info.warnings.push(`Puce spéciale ${spec.label} : prise en charge annoncée par Snes9x, plus lourde sur téléphone.`);
  }
  return info;
}

// --- Sega Mega Drive / Genesis --------------------------------------------------
// Aucun octet de ROM n'est réécrit. L'en-tête SEGA n'est pas une preuve d'authenticité
// ou de compatibilité ; certaines traductions/homebrews utilisent d'autres signatures.
// Les SMD interleavés gardent leur format : Genesis Plus GX les décode au chargement.
const SEGA_MAGIC = [0x53, 0x45, 0x47, 0x41];
export function parseGenesis(bytes, ext = 'md') {
  const info = { warnings: [], errors: [], headerOk: false, region: 'inconnue', title: '', format: ext === 'smd' ? 'SMD' : 'Mega Drive' };
  if (bytes.length < 0x200) {
    info.errors.push('Fichier trop petit pour une cartouche Sega Mega Drive / Genesis (minimum 512 octets).');
    return info;
  }
  if (!startsWithAt(bytes, 0x100, SEGA_MAGIC)) {
    info.warnings.push(ext === 'smd'
      ? 'Format SMD : en-tête SEGA non lisible sans désentrelacement ; validation du moteur requise.'
      : 'Signature SEGA non reconnue : fichier non authentifié, lancement à vérifier.');
    return info;
  }
  info.headerOk = true;
  info.title = asciiAt(bytes, 0x150, 0x180) || asciiAt(bytes, 0x120, 0x150);
  const flags = asciiAt(bytes, 0x1f0, 0x1f4).toUpperCase();
  const regions = [];
  if (flags.includes('J')) regions.push('Japon');
  if (flags.includes('U')) regions.push('USA');
  if (flags.includes('E')) regions.push('Europe');
  if (regions.length) info.region = regions.join(', ');
  if (regions.length === 1) info.video = regions[0] === 'Europe' ? 'PAL' : 'NTSC';
  return info;
}

// --- Détection ------------------------------------------------------------------
function detectByHeader(bytes) {
  if (startsWithAt(bytes, 0, INES_MAGIC) || startsWithAt(bytes, 0, UNIF_MAGIC)) return 'nes';
  if (startsWithAt(bytes, 0xc0, GBA_LOGO) && bytes.length >= 0x200) return 'nds';
  if (startsWithAt(bytes, 0x04, GBA_LOGO) && bytes.length >= 0xc0) return 'gba';
  if (startsWithAt(bytes, 0x104, GB_LOGO)) return bytes[0x143] === 0x80 || bytes[0x143] === 0xc0 ? 'gbc' : 'gb';
  if (startsWithAt(bytes, 0x100, SEGA_MAGIC)) return 'genesis';
  return null;
}

/**
 * Analyse un fichier de jeu. Ne modifie jamais les octets.
 * @param {string} fileName nom du fichier (ou de l'entrée ZIP)
 * @param {Uint8Array} bytes contenu brut
 */
/**
 * Romset arcade : un .zip confié tel quel au cœur, dont le nom court (« xxmissio.zip ») est celui du jeu
 * pour MAME et FBNeo. Rien n'est extrait ni modifié ; un BIOS arcade (neogeo.zip…) est refusé comme ailleurs.
 */
export function analyzeArcade(fileName, bytes) {
  const name = String(fileName || '').replace(/^.*[\\/]/, '');
  const stem = name.replace(/\.zip$/i, '');
  const result = { ok: false, fileName: name, ext: 'zip', size: bytes.length, system: 'arcade', title: stem, code: stem, region: 'inconnue', version: 0, headerOk: false, warnings: [], errors: [] };
  if (!/\.zip$/i.test(name)) result.errors.push('Un jeu arcade s’ouvre tel quel, en .zip (nom court MAME, par exemple xxmissio.zip).');
  else if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) result.errors.push('Ce fichier n’est pas un .zip valide.');
  else if (bytes.length > SYSTEMS.arcade.maxBytes) result.errors.push('Romset trop gros pour le navigateur (256 Mio au plus).');
  else if (isBiosName(name) || /^(neogeo|pgm|cpzn1|cpzn2|naomi|awbios|decocass|skns|stvbios|konamigx|nss|playch10|megaplay|isgsm)\.zip$/i.test(name)) result.errors.push(BIOS_MESSAGE);
  else if (!/^[a-z0-9_]{1,16}$/i.test(stem)) result.warnings.push('Nom de fichier inhabituel pour un romset : MAME et FBNeo reconnaissent le jeu à son nom court (par exemple xxmissio.zip). Ne renomme pas les fichiers.');
  if (!result.errors.length) { result.ok = true; result.headerOk = true; }
  return result;
}

export function analyzeRom(fileName, bytes) {
  const ext = extensionOf(fileName);
  const result = {
    ok: false,
    fileName,
    ext,
    size: bytes.length,
    system: null,
    title: '',
    code: '',
    region: 'inconnue',
    version: 0,
    headerOk: false,
    warnings: [],
    errors: [],
  };

  if (bytes.length === 0) {
    result.errors.push('Le fichier est vide.');
    return result;
  }

  if (UNSUPPORTED_FORMATS[ext]) {
    result.errors.push(UNSUPPORTED_FORMATS[ext]);
    return result;
  }
  if (isBiosName(fileName)) {
    result.errors.push(BIOS_MESSAGE);
    return result;
  }
  let system = null;
  if (EXT_SYSTEM[ext]) system = EXT_SYSTEM[ext];
  else if (ROM_EXTENSIONS.has(ext)) system = ext;
  else if (LOOSE_EXTENSIONS.has(ext) || !ext) system = detectByHeader(bytes);
  const detected = detectByHeader(bytes);
  // Une ROM SNES n'a pas de signature fixe : on ne la « détecte » pas à la place d'une autre console.
  if (system && detected && system !== detected && !(['gb', 'gbc'].includes(system) && ['gb', 'gbc'].includes(detected))) {
    result.warnings.push(`L'extension indique « ${system} » mais l'en-tête indique « ${detected} » : l'en-tête est retenu.`);
    system = detected;
  }
  if (!system) {
    result.errors.push(
      ext
        ? `Format « .${ext} » non reconnu. Formats acceptés : .nes, .unf, .sfc, .smc, .md, .smd, .gen, .gb, .gbc, .gba, .nds (ou un .zip qui en contient un), et .iso, .cso, .pbp pour la PSP.`
        : 'Format de fichier non reconnu.'
    );
    return result;
  }

  // L'en-tête a le dernier mot pour distinguer GB et GBC.
  if (system === 'gb' || system === 'gbc') {
    const parsed = parseGb(bytes);
    if (parsed.errors.length) {
      result.errors.push(...parsed.errors);
      return result;
    }
    const headerSystem = parsed.isColor ? 'gbc' : 'gb';
    if (headerSystem !== system) {
      result.warnings.push(
        `L'extension indique « ${SYSTEMS[system].label} » mais l'en-tête indique « ${SYSTEMS[headerSystem].label} » : l'en-tête est retenu.`
      );
      system = headerSystem;
    }
    Object.assign(result, {
      title: parsed.title,
      region: parsed.region,
      version: parsed.version,
      headerOk: parsed.headerOk,
      colorOnly: parsed.colorOnly,
    });
    result.warnings.push(...parsed.warnings);
  } else if (system === 'gba') {
    const parsed = parseGba(bytes);
    if (parsed.errors.length) {
      result.errors.push(...parsed.errors);
      return result;
    }
    Object.assign(result, {
      title: parsed.title,
      code: parsed.code,
      region: parsed.region,
      version: parsed.version,
      headerOk: parsed.headerOk,
    });
    result.warnings.push(...parsed.warnings);
  } else if (system === 'nds') {
    const parsed = parseNds(bytes);
    if (parsed.errors.length) {
      result.errors.push(...parsed.errors);
      return result;
    }
    Object.assign(result, {
      title: parsed.title,
      code: parsed.code,
      region: parsed.region,
      version: parsed.version,
      headerOk: parsed.headerOk,
      unitCode: parsed.unitCode,
    });
    result.warnings.push(...parsed.warnings);
  } else if (system === 'nes') {
    const parsed = parseNes(bytes);
    if (parsed.errors.length) {
      result.errors.push(...parsed.errors);
      return result;
    }
    Object.assign(result, {
      title: parsed.title || '',
      format: parsed.format,
      mapper: parsed.mapper,
      mapperName: parsed.mapperName,
      battery: parsed.battery,
      video: parsed.timing,
      headerOk: parsed.headerOk,
    });
    result.warnings.push(...parsed.warnings);
  } else if (system === 'genesis') {
    const parsed = parseGenesis(bytes, ext);
    if (parsed.errors.length) {
      result.errors.push(...parsed.errors);
      return result;
    }
    Object.assign(result, {
      title: stemOf(fileName), // inclure nom des hacks/traductions, pas seulement le titre interne
      cartridgeTitle: parsed.title,
      region: parsed.region,
      video: parsed.video,
      format: parsed.format,
      headerOk: parsed.headerOk,
    });
    result.warnings.push(...parsed.warnings);
  } else if (system === 'snes') {
    const parsed = parseSnes(bytes);
    if (parsed.errors.length) {
      result.errors.push(...parsed.errors);
      return result;
    }
    Object.assign(result, {
      title: parsed.title,
      code: parsed.code || '',
      region: parsed.region,
      version: parsed.version,
      video: parsed.video,
      layout: parsed.layout,
      chip: parsed.chip,
      battery: parsed.battery,
      copierHeader: parsed.copierHeader,
      headerOk: parsed.headerOk,
    });
    result.warnings.push(...parsed.warnings);
  }

  const spec = SYSTEMS[system];
  if (bytes.length > spec.maxBytes) {
    result.errors.push(
      `Fichier trop gros pour ${spec.label} (${Math.round(bytes.length / MiB)} Mio, maximum ${Math.round(spec.maxBytes / MiB)} Mio).`
    );
    return result;
  }

  result.system = system;
  result.ok = true;
  if (!result.title) result.title = stemOf(fileName);
  return result;
}
