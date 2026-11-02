// Inventaire en LECTURE SEULE d'une collection NES/SNES locale.
// node tools/inventaire-roms.mjs "E:\roms\roms nes et snes" [dossier-de-sortie]
// Ne modifie, ne déplace et ne copie aucune ROM. Le contenu des archives est seulement listé (7-Zip).
// La liste complète reste dans le dossier de sortie (hors dépôt par défaut) : seuls les totaux sont publiables.
import { readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { parseRomName, variantKey } from '../js/romnames.mjs';

const root = process.argv[2];
if (!root || !existsSync(root)) throw new Error('Indique le dossier de la collection à inventorier.');
const outDir = resolve(process.argv[3] || join(tmpdir(), 'emuperso-inventaire'));
if (outDir.startsWith(resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')))) {
  throw new Error('Le dossier de sortie ne doit pas être dans le dépôt : la liste des fichiers est privée.');
}
mkdirSync(outDir, { recursive: true });
const SEVEN_ZIP = process.env.SEVEN_ZIP || 'C:\\Program Files\\7-Zip\\7z.exe';
const ROM_EXT = { nes: 'nes', unf: 'nes', unif: 'nes', fds: 'nes', sfc: 'snes', smc: 'snes', swc: 'snes', fig: 'snes' };
const MEDIA = new Set(['png', 'jpg', 'jpeg', 'mp4', 'tmp', 'xml', 'exe', 'txt', 'json', 'dll', 'html']);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

function listArchive(path) {
  if (!existsSync(SEVEN_ZIP)) return { error: '7-Zip absent : contenu des archives non listé.' };
  try {
    const text = execFileSync(SEVEN_ZIP, ['l', '-slt', '-ba', path], { encoding: 'utf8', maxBuffer: 256 << 20 });
    const entries = [];
    let name = null;
    for (const line of text.split(/\r?\n/)) {
      const m = /^(Path|Size) = (.*)$/.exec(line);
      if (!m) continue;
      if (m[1] === 'Path') name = m[2];
      else { entries.push({ name, size: Number(m[2]) }); name = null; }
    }
    return { entries };
  } catch (err) { return { error: String(err.message).slice(0, 200) }; }
}

const stats = new Map();
const rows = [];
const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
function stat(collection) {
  if (!stats.has(collection)) stats.set(collection, {
    files: 0, bytes: 0, exts: {}, archives: 0, archiveEntries: 0, innerExts: {}, multiVariantArchives: 0, maxEntries: 0,
    biggestRom: 0, archiveErrors: 0, roms: 0, systems: {}, regions: {}, french: 0, frenchTranslations: 0, translations: {},
    hacks: 0, protos: 0, betas: 0, badDumps: 0, pirates: 0, verified: 0, originals: 0, unlicensed: 0, homebrew: 0,
    titles: new Set(), duplicateNames: 0, seen: new Set(),
  });
  return stats.get(collection);
}
function countRom(s, name, size, collection, archive) {
  const ext = extname(name).slice(1).toLowerCase();
  if (!ROM_EXT[ext]) return;
  const info = parseRomName(basename(name));
  s.roms++;
  bump(s.systems, ROM_EXT[ext]);
  s.biggestRom = Math.max(s.biggestRom, size);
  const key = basename(name).toLowerCase();
  if (s.seen.has(key)) s.duplicateNames++; else s.seen.add(key);
  s.titles.add(variantKey(info.title));
  for (const r of info.regions) bump(s.regions, r);
  if (info.french) s.french++;
  if (info.frenchTranslation) s.frenchTranslations++;
  if (info.translation) bump(s.translations, info.translation);
  if (info.hack) s.hacks++;
  if (info.proto) s.protos++;
  if (info.beta) s.betas++;
  if (info.bad) s.badDumps++;
  if (info.pirate) s.pirates++;
  if (info.verified) s.verified++;
  if (info.original) s.originals++;
  if (info.unlicensed) s.unlicensed++;
  if (info.homebrew) s.homebrew++;
  rows.push({ collection, archive, name, size, system: ROM_EXT[ext], ...info });
}

const files = walk(root);
let done = 0;
for (const file of files) {
  const ext = extname(file).slice(1).toLowerCase();
  const rel = file.slice(root.length).replace(/^[\\/]+/, '').replace(/\\/g, '/');
  const collection = rel.split('/')[0];
  const s = stat(collection);
  if (MEDIA.has(ext)) { bump(s.exts, ext); continue; }
  const size = statSync(file).size;
  s.files++; s.bytes += size; bump(s.exts, ext);
  if (ext === '7z' || ext === 'zip') {
    s.archives++;
    const r = listArchive(file);
    if (r.error) { s.archiveErrors++; continue; }
    s.archiveEntries += r.entries.length;
    s.maxEntries = Math.max(s.maxEntries, r.entries.length);
    if (r.entries.filter((e) => ROM_EXT[extname(e.name).slice(1).toLowerCase()]).length > 1) s.multiVariantArchives++;
    for (const e of r.entries) { bump(s.innerExts, extname(e.name).slice(1).toLowerCase() || '(sans)'); countRom(s, e.name, e.size, collection, rel); }
  } else countRom(s, rel, size, collection, null);
  if (++done % 1000 === 0) process.stderr.write(`${done} fichiers…\n`);
}

const top = (o, n = 12) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v}`).join(', ') || '—';
let md = `# Inventaire NES/SNES (lecture seule)\n\nSource : dossier local fourni par l'utilisateur. Généré le ${new Date().toISOString().slice(0, 10)} par \`tools/inventaire-roms.mjs\`.\nLes étiquettes viennent des noms de fichiers (GoodTools / No-Intro), pas d'une vérification des octets.\n`;
for (const [name, s] of stats) {
  md += `\n## ${name}\n\n` +
    `- Fichiers (hors images/vidéos) : ${s.files}, ${(s.bytes / 2 ** 30).toFixed(2)} Gio. Extensions : ${top(s.exts)}.\n` +
    `- Archives : ${s.archives} (${s.archiveEntries} entrées : ${top(s.innerExts, 6)}) ; ${s.multiVariantArchives} archives à plusieurs variantes, jusqu'à ${s.maxEntries} entrées dans une seule ; ${s.archiveErrors} illisibles.\n` +
    `- ROMs : ${s.roms} (${top(s.systems)}), ${s.titles.size} titres distincts, plus grosse ${(s.biggestRom / 2 ** 20).toFixed(1)} Mio, ${s.duplicateNames} noms en double.\n` +
    `- Régions annoncées : ${top(s.regions)}.\n` +
    `- Français : ${s.french} (dont ${s.frenchTranslations} traductions [T+Fre]). Traductions : ${top(s.translations)}.\n` +
    `- Originaux ${s.originals}, vérifiés [!] ${s.verified}, hacks ${s.hacks}, prototypes ${s.protos}, bêtas/démos ${s.betas}, mauvais dumps ${s.badDumps}, pirates ${s.pirates}, sans licence ${s.unlicensed}, domaine public/homebrew ${s.homebrew}.\n`;
}
writeFileSync(join(outDir, 'INVENTAIRE.md'), md);
writeFileSync(join(outDir, 'inventaire-complet.json'), JSON.stringify(rows));
console.log(md);
console.error(`Liste complète (privée) : ${join(outDir, 'inventaire-complet.json')}`);
