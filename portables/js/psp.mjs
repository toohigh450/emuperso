// Lecture des jeux PSP (.iso, .cso, .pbp) sans charger le fichier entier en mémoire.
// Le cœur PPSSPP d'EmulatorJS 4.2.3 lit .iso, .cso et .pbp (core.json : elf, iso, cso, prx, pbp) ;
// .chd et .zso ne sont pas dans sa liste : ils sont refusés avec une explication.
// Module pur : la source est une fonction readAt(position, longueur) → Uint8Array, testable avec Node.
import { UNSUPPORTED_FORMATS } from './systems.mjs';

const SECTOR = 2048;
const MiB = 1024 * 1024;
// Un UMD double couche contient 1,8 Go ; au-delà, ce n'est pas un jeu PSP.
export const PSP_MAX_BYTES = 1800 * MiB;
export const PSP_EXTENSIONS = new Set(['iso', 'cso', 'pbp']);

// Lettre de région des identifiants de disque (ULUS-10041, NPEH-00012, UCJS-10001…).
const DISC_REGIONS = { U: 'USA', E: 'Europe', J: 'Japon', K: 'Corée', A: 'Asie', H: 'Hong Kong', C: 'Chine' };

export function regionFromDiscId(discId) {
  return DISC_REGIONS[String(discId || '').charAt(2).toUpperCase()] || 'inconnue';
}

/** « ULUS10041 » ou « ULUS-10041 » → « ULUS-10041 » ; null si ce n'est pas un identifiant PSP. */
export function normalizeDiscId(text) {
  const m = /^([A-Z]{4})-?(\d{5})$/.exec(String(text || '').trim().toUpperCase());
  return m ? `${m[1]}-${m[2]}` : null;
}

function ascii(bytes, start, end) {
  let out = '';
  for (let i = start; i < end && i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 0) break;
    out += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '?';
  }
  return out.trim();
}

const u32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
const u16 = (b, p) => b[p] | (b[p + 1] << 8);

/** Format d'après les premiers octets : 'iso', 'cso', 'pbp', 'chd', 'zso', 'cso2' ou null. */
export function detectPspFormat(head) {
  const tag = ascii(head, 0, 4);
  if (tag === 'CISO') return head[0x14] > 1 ? 'cso2' : 'cso';
  if (tag === 'ZISO') return 'zso';
  if (head.length >= 8 && ascii(head, 0, 8) === 'MComprHD') return 'chd';
  if (head[0] === 0 && ascii(head, 1, 4) === 'PBP') return 'pbp';
  if (head.length >= 0x8006 && ascii(head, 0x8001, 0x8006) === 'CD001') return 'iso';
  return null;
}

/** Lit PARAM.SFO : { TITLE, DISC_ID, DISC_VERSION, CATEGORY… }. */
export function parseSfo(bytes) {
  if (bytes.length < 20 || bytes[0] !== 0 || ascii(bytes, 1, 4) !== 'PSF') return null;
  const keyTable = u32(bytes, 8);
  const dataTable = u32(bytes, 12);
  const count = u32(bytes, 16);
  if (count > 256 || 20 + count * 16 > bytes.length) return null;
  const out = {};
  const utf8 = new TextDecoder('utf-8');
  for (let i = 0; i < count; i++) {
    const e = 20 + i * 16;
    const key = ascii(bytes, keyTable + u16(bytes, e), keyTable + u16(bytes, e) + 64);
    const fmt = u16(bytes, e + 2);
    const len = u32(bytes, e + 4);
    const at = dataTable + u32(bytes, e + 12);
    if (at + len > bytes.length) continue;
    if (fmt === 0x0404) out[key] = u32(bytes, at);
    else out[key] = utf8.decode(bytes.subarray(at, at + len)).replace(/\0+$/, '').trim();
  }
  return out;
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Lecteur de secteurs de 2 048 octets, pour une image ISO ou CSO (version 1). */
export async function openSectors(readAt, format, size) {
  if (format === 'iso') {
    return { totalBytes: size, read: (lba) => readAt(lba * SECTOR, SECTOR) };
  }
  const header = await readAt(0, 0x18);
  const totalBytes = Number(u32(header, 8)) + u32(header, 12) * 2 ** 32;
  const blockSize = u32(header, 16);
  const align = header[0x15];
  if (blockSize !== SECTOR) throw new Error(`CSO à blocs de ${blockSize} octets : non pris en charge par cette lecture.`);
  const blocks = Math.ceil(totalBytes / SECTOR);
  const index = await readAt(0x18, (blocks + 1) * 4);
  const incomplete = 'CSO incomplet (téléchargement inachevé ou fichier tronqué) : attends la fin du téléchargement ou vérifie le fichier.';
  if (index.length < (blocks + 1) * 4) throw new Error(incomplete);
  if ((u32(index, blocks * 4) & 0x7fffffff) * 2 ** align > size) throw new Error(incomplete);
  return {
    totalBytes,
    async read(lba) {
      if (lba >= blocks) throw new Error('Secteur hors de l’image CSO.');
      const a = u32(index, lba * 4);
      const b = u32(index, lba * 4 + 4);
      const start = (a & 0x7fffffff) * 2 ** align;
      const end = (b & 0x7fffffff) * 2 ** align;
      const raw = await readAt(start, end - start);
      if (a & 0x80000000) return raw.subarray(0, SECTOR); // bloc stocké sans compression
      const out = await inflateRaw(raw);
      if (out.length < SECTOR) throw new Error('Bloc CSO illisible.');
      return out.subarray(0, SECTOR);
    },
  };
}

async function readExtent(sectors, lba, length) {
  const out = new Uint8Array(length);
  for (let p = 0, s = lba; p < length; p += SECTOR, s++) {
    const chunk = await sectors.read(s);
    out.set(chunk.subarray(0, Math.min(SECTOR, length - p)), p);
  }
  return out;
}

/** Entrées d'un répertoire ISO 9660 : [{ name, lba, size, dir }]. */
export function parseDirectory(bytes) {
  const out = [];
  let p = 0;
  while (p < bytes.length) {
    const len = bytes[p];
    if (len === 0) { p = (Math.floor(p / SECTOR) + 1) * SECTOR; continue; } // fin de secteur
    if (p + 33 > bytes.length) break;
    const nameLen = bytes[p + 32];
    const raw = ascii(bytes, p + 33, p + 33 + nameLen);
    if (!(nameLen === 1 && (bytes[p + 33] === 0 || bytes[p + 33] === 1))) {
      out.push({ name: raw.replace(/;\d+$/, '').toUpperCase(), lba: u32(bytes, p + 2), size: u32(bytes, p + 10), dir: !!(bytes[p + 25] & 2) });
    }
    p += len;
  }
  return out;
}

const MAX_SMALL_FILE = 256 * 1024;

async function findFile(sectors, root, path) {
  let entry = root;
  for (const part of path.split('/')) {
    if (!entry.dir || entry.size > MAX_SMALL_FILE) return null;
    const list = parseDirectory(await readExtent(sectors, entry.lba, entry.size));
    entry = list.find((e) => e.name === part);
    if (!entry) return null;
  }
  if (entry.dir || entry.size > MAX_SMALL_FILE) return null;
  return readExtent(sectors, entry.lba, entry.size);
}

/**
 * Analyse un jeu PSP. readAt(position, longueur) lit une tranche du fichier.
 * Ne lit que l'en-tête, le répertoire racine, UMD_DATA.BIN et PARAM.SFO (quelques secteurs).
 */
export async function analyzePsp(readAt, size) {
  const info = { system: 'psp', format: null, title: '', discId: null, version: '', region: 'inconnue', headerOk: false, warnings: [], errors: [] };
  if (size === 0) { info.errors.push('Le fichier est vide.'); return info; }
  if (size > PSP_MAX_BYTES) { info.errors.push(`Fichier trop gros pour un jeu PSP (${Math.round(size / MiB)} Mio, un UMD contient au plus 1 800 Mio).`); return info; }
  const head = await readAt(0, Math.min(size, 0x8800));
  const format = detectPspFormat(head);
  info.format = format;
  if (format === 'chd') { info.errors.push(UNSUPPORTED_FORMATS.chd); return info; }
  if (format === 'zso') { info.errors.push(UNSUPPORTED_FORMATS.zso); return info; }
  if (format === 'cso2') { info.errors.push('CSO version 2 (compression LZ4) : non lu par le cœur PSP proposé. Recompresse-le en CSO version 1 avec maxcso (option --format=cso1).'); return info; }
  if (!format) { info.errors.push('Ce fichier n’est pas un jeu PSP reconnu (ni image ISO, ni CSO, ni EBOOT.PBP).'); return info; }

  let sfo = null;
  if (format === 'pbp') {
    const sfoStart = u32(head, 8);
    const sfoEnd = u32(head, 12);
    if (sfoEnd > sfoStart && sfoEnd - sfoStart <= MAX_SMALL_FILE && sfoEnd <= size) sfo = parseSfo(await readAt(sfoStart, sfoEnd - sfoStart));
    info.headerOk = !!sfo;
    if (!sfo) info.warnings.push('EBOOT.PBP sans PARAM.SFO lisible : titre et identifiant inconnus.');
  } else {
    const sectors = await openSectors(readAt, format, size);
    if (format === 'cso' && sectors.totalBytes > PSP_MAX_BYTES) { info.errors.push('L’en-tête CSO annonce une image de plus de 1 800 Mio.'); return info; }
    const pvd = await sectors.read(16);
    if (pvd[0] !== 1 || ascii(pvd, 1, 6) !== 'CD001') { info.errors.push('Image disque illisible : descripteur ISO 9660 absent.'); return info; }
    // L'identifiant système vaut « PSP GAME » sur un UMD ; des images refaites par certains outils portent
    // « HJH VCDROM Extension » (12 jeux de la collection de Karl). Le contenu tranche : PSP_GAME/PARAM.SFO.
    const systemId = ascii(pvd, 8, 40);
    const root = { lba: u32(pvd, 156 + 2), size: u32(pvd, 156 + 10), dir: true };
    const umd = await findFile(sectors, root, 'UMD_DATA.BIN');
    if (umd) info.discId = normalizeDiscId(ascii(umd, 0, 10).split('|')[0]);
    const param = await findFile(sectors, root, 'PSP_GAME/PARAM.SFO');
    if (param) sfo = parseSfo(param);
    if (systemId !== 'PSP GAME') {
      if (!sfo) {
        info.errors.push(`Image disque d’une autre console (« ${systemId || 'inconnue'} », sans PSP_GAME/PARAM.SFO) : seuls les jeux PSP sont acceptés ici.`);
        return info;
      }
      info.warnings.push(`Image refaite (identifiant système « ${systemId} » au lieu de « PSP GAME ») : contenu PSP reconnu.`);
    }
    info.volume = ascii(pvd, 40, 72);
    info.headerOk = !!(info.discId || sfo);
    if (!info.headerOk) info.warnings.push('UMD_DATA.BIN et PARAM.SFO introuvables : identifiant du disque inconnu.');
  }
  if (sfo) {
    info.title = sfo.TITLE || '';
    info.discId = info.discId || normalizeDiscId(sfo.DISC_ID);
    info.version = sfo.DISC_VERSION || sfo.APP_VER || '';
    if (sfo.CATEGORY === 'ME') info.warnings.push('PS1 Classic (catégorie ME) : prise en charge partielle par PPSSPP.');
  }
  info.region = regionFromDiscId(info.discId);
  return info;
}

/** Lecteur pour un File / Blob du navigateur, sans le charger entièrement. */
export function blobReader(blob) {
  return async (position, length) => new Uint8Array(await blob.slice(position, position + length).arrayBuffer());
}

/**
 * Dossiers de sauvegarde PPSSPP d'un jeu dans la carte mémoire virtuelle :
 * PSP/SAVEDATA/<identifiant sans tiret><suffixe>. Le préfixe vient de l'identifiant du disque.
 */
export function saveDataPrefix(discId) {
  const id = normalizeDiscId(discId);
  return id ? id.replace('-', '') : null;
}

export const SAVE_ARCHIVE_LIMITS = { bytes: 64 * MiB, files: 2000 };

/**
 * Contrôle une archive de sauvegardes PSP avant de l'écrire dans la carte mémoire virtuelle :
 * chaque fichier doit être dans un dossier de sauvegarde de CE jeu (nom commençant par prefix),
 * sans chemin absolu ni « .. ». Retourne { ok, error, folders }.
 */
export function checkSaveArchive(files, prefix) {
  if (!prefix) return { ok: false, error: 'Identifiant du disque inconnu : import de sauvegarde PSP impossible sans risque.' };
  if (files.length === 0) return { ok: false, error: 'Archive vide : aucune sauvegarde PSP dedans.' };
  const folders = new Set();
  for (const f of files) {
    const parts = f.name.split('/');
    if (f.name.includes('\\') || parts.some((p) => p === '' || p === '.' || p === '..') || parts.length < 2 || parts.length > 3) {
      return { ok: false, error: `Chemin refusé dans l’archive : « ${f.name} ». Attendu : <dossier de sauvegarde>/<fichier>, comme dans l’export de Portables.` };
    }
    if (!parts[0].toUpperCase().startsWith(prefix)) {
      return { ok: false, error: `« ${parts[0]} » n’est pas une sauvegarde de ce jeu (dossiers attendus : ${prefix}…).` };
    }
    folders.add(parts[0]);
  }
  return { ok: true, folders: [...folders].sort() };
}

/** Fichier de codes lu par ppsspp au démarrage du jeu (carte mémoire : PSP/Cheats/<identifiant>.ini). */
export const PSP_CHEAT_DIR = '/data/saves/PPSSPP/PSP/Cheats';

/**
 * Contenu CWCheat des codes actifs, écrit avant le démarrage : au moment où le moteur annonce le jeu
 * lancé, ppsspp n'a pas encore lu l'identifiant du disque et retro_cheat_set écrirait dans un autre
 * fichier (« ROM-xxxxx.ini », constaté avec Bust-A-Move Ghost). Sans code actif, le fichier est vidé :
 * aucun code d'une partie précédente ne reste actif.
 */
export function pspCheatFile(discId, codes) {
  const id = saveDataPrefix(discId);
  if (!id) return null;
  const lines = [`_S ${id}`];
  codes.forEach((c, i) => {
    lines.push(`_C1 ${String(c.name || `Code ${i + 1}`).replace(/[\r\n]+/g, ' ')}`);
    // Les fichiers libretro mettent plusieurs paires sur une ligne (« _L a b _L c d ») : une paire par ligne ici.
    const values = c.code.match(/0x[0-9a-f]{8}/gi) || [];
    for (let v = 0; v + 1 < values.length; v += 2) lines.push(`_L ${values[v].toUpperCase().replace('0X', '0x')} ${values[v + 1].toUpperCase().replace('0X', '0x')}`);
  });
  return { path: `${PSP_CHEAT_DIR}/${id}.ini`, text: `${lines.join('\n')}\n` };
}

// Réglages de performance PSP (cœur ppsspp). Qualité = réglages d'origine du cœur ; les deux autres
// sautent des images quand le jeu ralentit, et Fluidité allège aussi le rendu (petits défauts graphiques
// possibles). Appliqués au lancement du jeu (options du cœur).
export const PSP_PERFORMANCE = Object.freeze({
  qualite: Object.freeze({ id: 'qualite', label: 'Qualité', description: 'Toutes les images, rendu complet (réglage d’origine).' }),
  equilibre: Object.freeze({ id: 'equilibre', label: 'Équilibré', description: 'Saute jusqu’à 2 images seulement quand le jeu ralentit.' }),
  fluidite: Object.freeze({ id: 'fluidite', label: 'Fluidité', description: 'Saute jusqu’à 3 images quand le jeu ralentit et allège le travail de la carte graphique : petits défauts graphiques possibles.' }),
});
export function pspPerformanceOptions(preset) {
  const base = { ppsspp_frameskip: 'disabled', ppsspp_frameskiptype: 'Number of frames', ppsspp_auto_frameskip: 'disabled',
    ppsspp_skip_buffer_effects: 'disabled', ppsspp_lazy_texture_caching: 'disabled', ppsspp_skip_gpu_readbacks: 'disabled' };
  if (preset === 'equilibre') return { ...base, ppsspp_frameskip: '2', ppsspp_auto_frameskip: 'enabled' };
  // Sans « skip buffer effects » : avec lui, Bust-A-Move sautait des images en continu (15 affichées/s au lieu de 60).
  if (preset === 'fluidite') return { ...base, ppsspp_frameskip: '3', ppsspp_auto_frameskip: 'enabled', ppsspp_lazy_texture_caching: 'enabled', ppsspp_skip_gpu_readbacks: 'enabled' };
  return base;
}
