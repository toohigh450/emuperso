// Assemble le site unique EMUPERSO dans dist/ : portail à 10 consoles + applications existantes.
// Précondition (voir vercel.json) : ps1-web/dist et real-n64/dist construits par leurs propres outils,
// qui téléchargent les moteurs verrouillés par SHA-256. Aucune ROM personnelle ni sauvegarde n'est copiée.
//   node tools/build-portail.mjs
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'dist');
// Dossiers jamais publiés tels quels : dépôt, dépendances, sorties, sources remplacées par leur dist.
const SKIP_DIRS = new Set(['.git', '.github', 'node_modules', 'dist', '.vercel', 'ps1-web', 'real-n64', 'portail', 'cache', 'vendor', '__pycache__', '.python', 'roms', 'rom', 'games']);
// Fichiers personnels possibles : refusés même s'ils traînent dans le dossier de construction.
const PRIVATE = /\.(iso|cso|zso|bin|img|chd|pbp|cue|zip|rar|7z|sav|srm|state|mcr|mcd|z64|n64|v64|smc|gba|gbc|gb|nds|smd|gen|mdx|32x|68k)$/i;
// Seules exceptions : les homebrews libres publiés exprès (licences dans portables/demos).
const ALLOWED_ROMS = /^portables[\\/]demos[\\/]opensnes-[a-z0-9-]+\.sfc$|^portables[\\/]demos[\\/]opennes-snake\.nes$/;
// Aussi applicable aux dist des moteurs et au fichier .git des worktrees.
const SENSITIVE = /(?:^|[\\/])(?:\.git|\.aws|\.codex|\.agents|\.ssh|\.env(?:\.[^\\/]*)?|\.npmrc|\.pypirc)(?:[\\/]|$)|\.(?:jks|keystore|p12|pfx|pem|key|apk|aab)$/i;

// Fichiers sous base (chemins relatifs à base), dossiers à sauter décidés par skip(nom, cheminRelatif).
function walk(base, skip = () => false, dir = base, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const rel = relative(base, path);
    if (SENSITIVE.test(rel)) continue;
    if (entry.isSymbolicLink()) throw new Error(`Lien symbolique refusé : ${rel}`);
    if (entry.isDirectory()) {
      if (!skip(entry.name, rel)) walk(base, skip, path, out);
    } else out.push(rel);
  }
  return out;
}
const skipRepo = (name, rel) => SKIP_DIRS.has(name) || rel === join('portables', 'tests');

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
const manifest = {};
const add = (rel, from = join(ROOT, rel)) => {
  const to = join(OUT, rel);
  mkdirSync(join(to, '..'), { recursive: true });
  cpSync(from, to);
  manifest[rel.split(sep).join('/')] = createHash('sha256').update(readFileSync(from)).digest('hex');
};

// Les fichiers Markdown sont publiés pour leurs liens documentaires. Mais .md est
// aussi une extension binaire Mega Drive : bloquer ceux qui ressemblent à des ROMs
// (octets NUL dans l'en-tête) au lieu d'interdire toute la documentation .md.
function isBinaryMegaDriveMd(rel) {
  if (!/\.md$/i.test(rel)) return false;
  const start = readFileSync(join(ROOT, rel)).subarray(0, 512);
  return start.includes(0) || (start.length > 0x104 && start.toString('ascii', 0x100, 0x104) === 'SEGA');
}

let skipped = 0;
for (const rel of walk(ROOT, skipRepo)) {
  if ((PRIVATE.test(rel) && !ALLOWED_ROMS.test(rel)) || isBinaryMegaDriveMd(rel)) { skipped++; continue; }
  if (['.bat', '.ps1'].includes(extname(rel).toLowerCase())) { skipped++; continue; }
  add(rel);
}
// Applications PS1 et N64 : on publie leur dist complet (moteur verrouillé compris), tel que construit.
for (const app of ['ps1-web', 'real-n64']) {
  const built = join(ROOT, app, 'dist');
  if (!existsSync(join(built, 'index.html'))) throw new Error(`${app}/dist absent : lancer d'abord sa construction (voir vercel.json).`);
  for (const rel of walk(built)) add(join(app, rel), join(built, rel));
}
// Catalogue des fichiers de codes (noms seulement) : le lanceur y cherche les codes du jeu ouvert,
// puis ne télécharge que les fichiers correspondants (voir portables/js/cheat-autoload.mjs).
const CHEAT_DIR = join(ROOT, 'cheats-portables');
if (existsSync(CHEAT_DIR)) {
  const catalogue = {};
  for (const folder of readdirSync(CHEAT_DIR, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    catalogue[folder.name] = readdirSync(join(CHEAT_DIR, folder.name)).filter((n) => n.toLowerCase().endsWith('.cht')).sort();
  }
  const rel = join('cheats-portables', 'catalogue.json');
  writeFileSync(join(OUT, rel), JSON.stringify(catalogue));
  manifest[rel.split(sep).join('/')] = createHash('sha256').update(readFileSync(join(OUT, rel))).digest('hex');
}
// Accueil du site : portail/index.html. Le index.html du dépôt (copie protégée du laboratoire N64,
// vérifiée par real-n64/tests/test_real_tools.py) n'est jamais modifié ; le laboratoire reste publié
// sous son nom d'origine, N64-Web-Lab-Phase1A.html.
add('index.html', join(ROOT, 'portail', 'index.html'));
// i18n : chargeur + fichiers de traduction du portail (FR par défaut, EN en option).
for (const f of ['i18n.js', 'i18n/fr.json', 'i18n/en.json']) {
  add(f, join(ROOT, 'portail', f));
}
// Fonds d'écran + logo : une seule direction /bg/ à la racine, servie à tout le site.
for (const f of ['bg/bg-nes.jpg', 'bg/bg-snes.jpg', 'bg/bg-gb.jpg', 'bg/bg-gbc.jpg', 'bg/bg-gba.jpg', 'bg/bg-nds.jpg', 'bg/bg-genesis.jpg', 'bg/bg-n64.jpg', 'bg/bg-ps1.jpg', 'bg/bg-psp.jpg', 'bg/bg-portal.jpg']) {
  add(f, join(ROOT, 'portail', f));
}
add('logo.png', join(ROOT, 'portail', 'logo.png'));
// PWA / APK : manifeste, icones et service worker du portail.
for (const f of ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'sw.js']) {
  add(f, join(ROOT, 'portail', f));
}
writeFileSync(join(OUT, 'PORTAIL-MANIFEST.json'), JSON.stringify({
  projet: 'EMUPERSO — portail unique 10 consoles',
  fichiers: Object.keys(manifest).length,
  ignores: skipped,
  sha256: manifest,
}, null, 1));
console.log(`Portail construit : ${Object.keys(manifest).length} fichiers dans dist/, ${skipped} fichier(s) privé(s) ou de lancement Windows ignoré(s).`);
