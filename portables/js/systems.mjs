// Reconnaissance des consoles et lecture des en-têtes de ROM (GB, GBC, GBA, DS).
// Module pur : aucune dépendance au navigateur, testable avec Node.

const KiB = 1024;
const MiB = 1024 * KiB;

export const SYSTEMS = {
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
};

// Cœurs DS proposés (le cœur choisi fait partie de l'espace de sauvegarde du jeu).
export const DS_CORES = {
  desmume2015: { ejsCore: 'desmume2015', label: 'DeSmuME 2015 (sans BIOS)', needsBios: false },
  desmume: { ejsCore: 'desmume', label: 'DeSmuME (sans BIOS)', needsBios: false },
  melonds: { ejsCore: 'melonds', label: 'melonDS (BIOS requis)', needsBios: true },
};

export const ROM_EXTENSIONS = new Set(['gb', 'gbc', 'gba', 'nds']);
// Extensions d'origine douteuse acceptées seulement si l'en-tête est reconnu.
export const LOOSE_EXTENSIONS = new Set(['bin', 'rom', 'sgb', 'dsi', 'srl']);

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

// --- Détection ------------------------------------------------------------------
function detectByHeader(bytes) {
  if (startsWithAt(bytes, 0xc0, GBA_LOGO) && bytes.length >= 0x200) return 'nds';
  if (startsWithAt(bytes, 0x04, GBA_LOGO) && bytes.length >= 0xc0) return 'gba';
  if (startsWithAt(bytes, 0x104, GB_LOGO)) return bytes[0x143] === 0x80 || bytes[0x143] === 0xc0 ? 'gbc' : 'gb';
  return null;
}

/**
 * Analyse un fichier de jeu. Ne modifie jamais les octets.
 * @param {string} fileName nom du fichier (ou de l'entrée ZIP)
 * @param {Uint8Array} bytes contenu brut
 */
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

  let system = null;
  if (ROM_EXTENSIONS.has(ext)) system = ext;
  else if (LOOSE_EXTENSIONS.has(ext) || !ext) system = detectByHeader(bytes);
  const detected = detectByHeader(bytes);
  if (system && detected && system !== detected && !(['gb', 'gbc'].includes(system) && ['gb', 'gbc'].includes(detected))) {
    result.warnings.push(`L'extension indique « ${system} » mais l'en-tête indique « ${detected} » : l'en-tête est retenu.`);
    system = detected;
  }
  if (!system) {
    result.errors.push(
      ext
        ? `Format « .${ext} » non reconnu. Formats acceptés : .gb, .gbc, .gba, .nds (ou un .zip qui en contient un).`
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
