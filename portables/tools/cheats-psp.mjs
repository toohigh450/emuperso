// Fichiers de codes PSP pour une collection locale, en LECTURE SEULE.
// node tools/cheats-psp.mjs "D:\roms\roms psp\Pack PSP RecalBox"
// Chaque jeu (.iso, .cso, .pbp) est identifié par l'identifiant de son disque (UMD_DATA.BIN ou
// PARAM.SFO, quelques secteurs lus). Le fichier libretro du même identifiant est copié dans
// cheats-portables/Sony - PlayStation Portable/ sous le nom « <nom du jeu> [<identifiant>].cht » :
// Portables le propose alors pour ce disque, à confirmer une fois (la révision n'est pas garantie).
// Aucun jeu n'est modifié, copié ni déplacé ; aucun code n'est activé ni testé en jeu.
import '../tests/node-compat.mjs';
import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join, extname, basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { analyzePsp, PSP_EXTENSIONS } from '../js/psp.mjs';
import { discIdOfCheatName, parseCht } from '../js/cheats.mjs';

const SOURCE = 'libretro/libretro-database';
const COMMIT = '2fdd069d45883449cecf97deddd493492e77ff29'; // même commit que les autres consoles
const FOLDER = 'cht/Sony - PlayStation Portable/';
const root = process.argv[2];
if (!root || !existsSync(root)) throw new Error('Indique le dossier de la collection PSP.');
const repo = resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const outDir = join(repo, 'cheats-portables', 'Sony - PlayStation Portable');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (PSP_EXTENSIONS.has(extname(e.name).slice(1).toLowerCase())) out.push(p);
  }
  return out;
}

async function identify(path) {
  const h = await open(path, 'r');
  try {
    const { size } = await h.stat();
    const readAt = async (p, n) => {
      const b = Buffer.alloc(n);
      const { bytesRead } = await h.read(b, 0, n, p);
      return new Uint8Array(b.buffer, b.byteOffset, bytesRead);
    };
    return await analyzePsp(readAt, size);
  } catch (err) {
    return { errors: [err.message] };
  } finally { await h.close(); }
}

const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
const tree = await (await fetch(`https://api.github.com/repos/${SOURCE}/git/trees/${COMMIT}?recursive=1`)).json();
if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('Arborescence libretro incomplète : réessaie plus tard.');
const byDisc = new Map();
for (const e of tree.tree) {
  if (e.type !== 'blob' || !e.path.startsWith(FOLDER)) continue;
  const id = discIdOfCheatName(e.path);
  if (id) byDisc.set(id, [...(byDisc.get(id) || []), e.path]);
}

const games = walk(root);
const files = [];
const missing = [];
const unreadable = [];
mkdirSync(outDir, { recursive: true });
for (const path of games) {
  const name = basename(path);
  const info = await identify(path);
  if (info.errors?.length || !info.discId) { unreadable.push({ name, reason: info.errors?.[0] || 'identifiant du disque introuvable' }); continue; }
  const sources = byDisc.get(info.discId) || [];
  if (!sources.length) { missing.push({ name, discId: info.discId, title: info.title }); continue; }
  // Plusieurs fichiers pour un même disque (rare) : le plus fourni est retenu, les autres sont cités.
  const texts = await Promise.all(sources.map(async (src) => ({ src, text: await (await fetch(`https://raw.githubusercontent.com/${SOURCE}/${COMMIT}/${enc(src)}`)).text() })));
  texts.sort((a, b) => parseCht(b.text).length - parseCht(a.text).length);
  const chosen = texts[0];
  const codes = parseCht(chosen.text);
  const output = `${name.replace(/\.[^.]+$/, '')} [${info.discId}].cht`;
  const url = `https://github.com/${SOURCE}/blob/${COMMIT}/${enc(chosen.src)}`;
  const header = [
    `# Recherche locale pour le jeu : ${name} (disque ${info.discId}, « ${info.title} »)`,
    '# Correspondance par identifiant de disque lu dans le jeu ; révision non garantie, octets non identifiés.',
    '# Codes publics non testés en jeu ; confirmation manuelle dans Portables.',
    '# Tous les codes sont désactivés ; les lignes « _L 0x00000000 0x00000000 » sont des titres de section.',
    `# Source : ${SOURCE} ; CC BY-SA 4.0 ; commit ${COMMIT}`,
    `# ${url}`,
    '',
  ].join('\n');
  const body = `${header}\n${chosen.text.replace(/^\uFEFF/, '').replace(/cheat(\d+)_enable\s*=\s*true/gi, 'cheat$1_enable = false')}`;
  writeFileSync(join(outDir, output), body);
  files.push({ system: 'psp', name, discId: info.discId, output: `Sony - PlayStation Portable\\${output}`, codes: codes.length,
    bytes: Buffer.byteLength(body), sources: texts.map((t) => `https://github.com/${SOURCE}/blob/${COMMIT}/${enc(t.src)}`),
    sha256: createHash('sha256').update(body).digest('hex'), status: 'source_recherchee_non_testee' });
}

const summary = { source: `https://github.com/${SOURCE}`, sourceCommit: COMMIT, games: games.length, files: files.length,
  codes: files.reduce((n, f) => n + f.codes, 0), missing: missing.length, unreadable: unreadable.length };
writeFileSync(join(repo, 'cheats-portables', 'INDEX-PSP.json'), `${JSON.stringify({ summary, files, missing, unreadable }, null, 2)}\n`);
console.log(`${summary.games} jeux PSP lus, ${summary.files} fichiers .cht (${summary.codes} codes), ${summary.missing} sans source, ${summary.unreadable} illisibles (téléchargement inachevé ?).`);
