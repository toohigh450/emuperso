// Interface : une fente, un seul jeu actif, saveurs de sauvegarde et de codes visibles et honnêtes.
import { SYSTEMS, DS_CORES, ARCADE_CORES, ARCADE_CORE_ORDER, ROM_EXTENSIONS, LOOSE_EXTENSIONS, analyzeRom, analyzeArcade, analyzeWad, extensionOf, stemOf, engineExtension } from './systems.mjs';
import { parseCheatCode, describeCode, CODE_FORMATS, isPlaceholderCode, pspCodeConflicts, limitActiveCodes } from './codes.mjs';
import { parseRomName } from './romnames.mjs';
import { buildCatalog, filterCatalog, visibleWindow } from './catalog.mjs';
import { isZip, extractFirst, listCandidates, extractAll, buildZip } from './zip.mjs';
import { fingerprint, fingerprintBlob, saveSpaceId, gameKey, ejsGameName, legacyEjsGameName, slug, toHex } from './hash.mjs';
import { Store, IdbAdapter, MemoryAdapter, CHEAT_LIMITS, STATE_SLOTS } from './store.mjs';
import { parseCht, classifyCheatFiles, linkedCheatValid, normalizeName, deviceLabel, inferSystemFromPath, archiveCheatName } from './cheats.mjs';
import { buildPspControls } from './controls.mjs';
import { autoloadCheats } from './cheat-autoload.mjs';
import { log as journal, exportText as journalText } from './journal.mjs';
import { is7z, list7z, extract7z, MAX_7Z_BYTES, LARGE_7Z_BYTES } from './archive7z.mjs';
import { pickVersion, versionLabels } from './version-picker.mjs';
import { PAD_PROFILES, normalizePad, touchLayout } from './input-profiles.mjs';
import { Session } from './session.mjs';
import { createBrowserHost } from './player-host.mjs';
import { migrateLegacySave, LEGACY_SAVE_SYSTEMS } from './save-migration.mjs';

import { memoryPlan, pspMemoryPlan, MAX_INPUT_BYTES, MAX_ROM_BYTES, MiB } from './resources.mjs';
import { analyzePsp, blobReader, PSP_EXTENSIONS, saveDataPrefix, checkSaveArchive, SAVE_ARCHIVE_LIMITS, pspCheatFile, PSP_PERFORMANCE, pspPerformanceOptions, pspSaveNamespace, pspSaveOwnerHint } from './psp.mjs';
import { validateDsBios, MAX_BIOS_ZIP } from './bios.mjs';
import { REMOTE_ENGINE, LOADER_INTEGRITY, ENGINE_VERSION, PSP_ENGINE } from './engine.mjs';

const $ = (id) => document.getElementById(id);

let store;
let storageNote = '';
try {
  if (!window.indexedDB) throw new Error('IndexedDB absent');
  store = new Store(new IdbAdapter());
} catch {
  store = new Store(new MemoryAdapter());
  storageNote = "Stockage local indisponible : l'historique et les copies de sauvegarde ne survivront pas à la fermeture de la page.";
}

const session = new Session(createBrowserHost($('playerMount')), render);
let enginePaths = [];
let engineLocal = false;
let currentGame = null; // détails du jeu affiché dans la fente
let opening = false;
let importingCheats = false;
const panelTickets = { saves: 0, history: 0, cheats: 0, codes: 0, states: 0 };
let settings = { dsCore: 'desmume2015', legacyPositional: false };
let pspMirrorTimer = 0;

// --- Utilitaires d'affichage -------------------------------------------------------
function setStatus(text, kind = '') {
  journal(kind === 'error' ? 'erreur' : 'statut', text);
  const s = $('status');
  s.textContent = text;
  s.dataset.kind = kind;
}
function fmtDate(ms) {
  return new Date(ms).toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' });
}
function fmtSize(n) {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} Mio`;
  if (n >= 1024) return `${Math.round(n / 1024)} Kio`;
  return `${n} o`;
}
function clear(node) {
  node.replaceChildren();
  return node;
}
function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return n;
}
function download(name, bytes) {
  const url = URL.createObjectURL(new Blob([bytes]));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// --- Rendu de la fente ------------------------------------------------------------
function render(snap) {
  const previousGame = currentGame;
  currentGame = snap.game || null;
  if (previousGame !== currentGame) {
    const renderedGame = currentGame;
    clearInterval(pspMirrorTimer);
    // PSP : le moteur ne signale pas les écritures de la carte mémoire ; copie de sécurité toutes les minutes.
    if (currentGame?.system === 'psp') pspMirrorTimer = setInterval(() => mirrorPspSaves(renderedGame), 60000);
    for (const panel of Object.keys(panelTickets)) panelTickets[panel]++;
    for (const id of ['saveMirror', 'history', 'cheatInfo', 'cheatMatches', 'cheatSearchResults', 'codeList', 'stateSlots']) clear($(id));
    Promise.all([refreshSavePanel(), refreshCheatPanel(), refreshCodePanel(), refreshStatePanel(), refreshPadUi(), refreshPerfUi()]).catch(err => {
      if (currentGame === renderedGame) setStatus(`Panneau indisponible : ${err.message}`, 'error');
    });
  }
  const active = snap.state !== 'idle' && snap.game;
  $('slotEmpty').hidden = !!active;
  $('slotGame').hidden = !active;
  $('screenEmpty').hidden = !!active;
  document.body.dataset.state = snap.state;
  if (snap.game) {
    const g = snap.game;
    renderWarnings(g);
    $('gameTitle').textContent = g.title;
    $('gameSystem').textContent = g.systemLabel;
    $('gameRegion').textContent = g.regionText;
    $('gameFile').textContent = g.fileName;
    $('gameHash').textContent = `SHA-256 ${g.hex.slice(0, 16)}…`;
    $('gameHash').title = g.hex;
    $('gameCore').textContent = g.coreLabel;
    $('gameDetails').textContent = g.details || '—';
    $('gameHeader').textContent = g.headerOk ? 'En-tête reconnu' : "En-tête non vérifié (voir les avertissements)";
    const [aw, ah] = SYSTEMS[g.system].aspect.split('/').map((n) => Number(n.trim()));
    const screen = $('screen');
    screen.style.setProperty('--aspect', `${aw} / ${ah}`);
    screen.style.setProperty('--aspect-w', String(aw));
    screen.style.setProperty('--aspect-h', String(ah));
  }
  if (snap.error) setStatus(snap.error, 'error');
  else if (snap.detail) setStatus(snap.detail, snap.state === 'running' ? 'ok' : '');
  else if (!active) setStatus('Aucun jeu actif.');
}

// --- Ouverture d'un jeu -----------------------------------------------------------
async function readGameFile(file) {
  const ext = extensionOf(file.name);
  if (ext === 'rar') throw new Error('Archive .rar non prise en charge : extrais la ROM avec 7-Zip, puis ouvre-la ici. Les .zip et .7z sont acceptés.');
  if (ext === 'torrent') throw new Error('Un .torrent n’est pas une ROM. Ouvre un fichier de jeu complet (.nes, .sfc, .smc, .md, .smd, .gen, .gb, .gbc, .gba, .nds, .zip ou .7z).');
  if (ext === '7z' && file.size > MAX_7Z_BYTES) throw new Error(`Archive .7z de ${Math.round(file.size / MiB)} Mio : trop grosse pour le décompresseur du navigateur (256 Mio au plus). Extrais la version voulue avec 7-Zip dans un dossier séparé, puis ouvre-la ici.`);
  if (ext === '7z' && file.size > LARGE_7Z_BYTES && !confirm(`Grosse archive (${Math.round(file.size / MiB)} Mio) : la lecture peut prendre jusqu’à une minute et demande beaucoup de mémoire. Ferme les autres onglets lourds. Continuer ?`)) throw new Error('Ouverture annulée.');
  if (ext !== '7z' && file.size > MAX_INPUT_BYTES) throw new Error('Fichier trop gros pour cette application (maximum 512 Mio + 16 Mio).');
  const options = { deviceMemory: navigator.deviceMemory, activeBytes: currentGame?.romBytes || 0 };
  let warned = false;
  const checkMemory = async (size, archiveBytes = 0) => {
    let plan;
    try { plan = memoryPlan(size, { ...options, archiveBytes }); }
    catch (err) {
      // Le jeu en cours compte dans l'estimation, mais il est fermé avant le démarrage du nouveau :
      // si sa mémoire seule fait dépasser le budget, on propose de le fermer d'abord.
      let alone = null;
      try { alone = options.activeBytes ? memoryPlan(size, { ...options, archiveBytes, activeBytes: 0 }) : null; } catch { /* trop gros même seul */ }
      if (!alone || !session.hasActiveGame) throw err;
      if (!confirm(`Pour libérer la mémoire, « ${currentGame?.title || 'le jeu en cours'} » doit être fermé avant d’ouvrir ce fichier. Les sauvegardes déjà enregistrées restent conservées ; les progrès non enregistrés seront perdus. Fermer et continuer ?`)) throw new Error('Ouverture annulée.');
      await session.stop();
      currentGame = null;
      options.activeBytes = 0;
      plan = alone;
    }
    if (plan.warn && !warned) {
      if (!confirm(`Plafond ROM : 512 Mio. Estimation : ${Math.ceil(plan.estimated / MiB)} Mio ; budget prudent : ${Math.floor(plan.budget / MiB)} Mio, sans garantie de RAM disponible. Enregistre et exporte tes progrès avant de continuer. Continuer ?`)) throw new Error('Ouverture annulée.');
      warned = true;
    }
  };
  // Pour une archive, c'est la taille de la version choisie qui compte.
  if (ext !== 'zip' && ext !== '7z') await checkMemory(file.size);
  let name = file.name;
  let bytes = new Uint8Array(await file.arrayBuffer());
  let note = '';
  const accept = new Set([...ROM_EXTENSIONS, ...LOOSE_EXTENSIONS]);
  const isRom = (n) => accept.has(extensionOf(n)) && !/(^|\/)__MACOSX\//.test(n);
  // Plusieurs versions : fenêtre de choix (conseillée en premier) avant toute extraction du jeu.
  const choose = async (entries, kind) => {
    if (entries.length === 0) throw new Error(`Aucun jeu reconnu dans cette archive ${kind} (formats : .nes, .sfc, .smc, .md, .smd, .gen, .gb, .gbc, .gba, .nds).`);
    if (entries.length === 1) return entries[0];
    setStatus(`${entries.length} versions dans l’archive : choisis celle à lancer.`);
    const picked = await pickVersion(entries, file.name);
    if (!picked) throw new Error('Ouverture annulée.');
    return entries.find((e) => e.name === picked);
  };
  if (ext === '7z' || is7z(bytes)) {
    setStatus('Lecture du contenu de l’archive 7z…');
    const engineBases = [...enginePaths.map((p) => p.path)];
    // Pendant la lecture, les versions probables (d'origine ou traduites, sans hack ni mauvais dump) sont
    // gardées jusqu'à 64 Mio : le choix conseillé démarre alors sans relire toute l'archive.
    let keptBytes = 0;
    const probable = (n, size) => {
      if (!isRom(n) || size > MAX_ROM_BYTES || keptBytes + size > 64 * MiB) return false;
      const { info: i } = versionLabels(n);
      if (i.hack || i.bad || i.overdump || i.pirate || i.trainer || i.proto || i.beta) return false;
      keptBytes += size;
      return true;
    };
    const scan = await list7z(bytes, engineBases, (pc) => setStatus(`Lecture du contenu de l’archive 7z… ${pc} %`), probable);
    const entries = scan.entries.filter((e) => isRom(e.name));
    const entry = await choose(entries, '7z');
    await checkMemory(entry.size, bytes.length);
    setStatus(`Extraction de « ${entry.name.replace(/^.*[\\/]/, '')} »…`);
    const data = scan.kept[entry.name] || await extract7z(bytes, engineBases, entry.name, { maxBytes: MAX_ROM_BYTES, onProgress: (pc) => setStatus(`Extraction… ${pc} %`) });
    scan.kept = null;
    name = entry.name.replace(/^.*[\\/]/, '');
    bytes = data;
    note = entries.length > 1 ? `Version choisie dans l’archive 7z : ${name}.` : '';
  } else if (ext === 'zip' || isZip(bytes)) {
    const candidates = listCandidates(bytes, accept);
    const entry = await choose(candidates, 'ZIP');
    await checkMemory(entry.size, bytes.length);
    const r = await extractFirst(bytes, accept, { name: entry.name, maxBytes: MAX_ROM_BYTES });
    name = r.name;
    bytes = r.bytes;
    if (candidates.length > 1) note = `Version choisie dans le ZIP : ${name}.`;
  }
  // Nom de l'archive gardé : il porte parfois le titre complet quand celui de la version est tronqué.
  return { name, bytes, note, archive: name !== file.name ? file.name : null };
}

// PSP : le fichier n'est jamais chargé entier par le lanceur. On lit l'en-tête et quelques secteurs
// (identifiant du disque, titre), puis le fichier d'origine est confié tel quel au moteur.
function isPspCandidate(fileName) {
  const ext = extensionOf(fileName);
  return PSP_EXTENSIONS.has(ext) || ext === 'chd' || ext === 'zso';
}

async function readPspFile(file) {
  if (!window.crossOriginIsolated) {
    throw new Error('La PSP demande une page isolée (en-têtes COOP/COEP), que ce serveur n’envoie pas. Ouvre Portables par le site Vercel ou par DEMARRER-PORTABLES.bat.');
  }
  const info = await analyzePsp(blobReader(file), file.size);
  if (info.errors.length) return { analysis: { ...info, ok: false } };
  const plan = pspMemoryPlan(file.size, { deviceMemory: navigator.deviceMemory });
  if (plan.warn && !confirm(`Jeu PSP de ${fmtSize(file.size)}. Le moteur le charge en entier : environ ${Math.ceil(plan.estimated / MiB)} Mio de mémoire estimés, sans garantie. Ferme les autres onglets lourds. Continuer ?`)) {
    throw new Error('Ouverture annulée.');
  }
  const analysis = {
    ...info,
    ok: true,
    fileName: file.name,
    ext: extensionOf(file.name),
    size: file.size,
    title: info.title || stemOf(file.name),
    code: info.discId || '',
  };
  return { rom: { name: file.name, file, bytes: null, size: file.size, note: '' }, analysis };
}

async function resolveCore(system) {
  if (system === 'arcade') return { ejsCore: SYSTEMS.arcade.ejsCore, coreId: SYSTEMS.arcade.coreId, label: ARCADE_CORES.mame2003_plus.label, bios: null };
  if (system !== 'nds') return { ejsCore: SYSTEMS[system].ejsCore, coreId: SYSTEMS[system].coreId, label: coreLabel(system), bios: null };
  // NES et SNES : aucun BIOS (le Famicom Disk System, qui en demande un, est refusé à l'ouverture).
  const spec = DS_CORES[settings.dsCore] || DS_CORES.desmume2015;
  let bios = null;
  if (spec.needsBios) {
    const stored = await store.getBios('nds-bios');
    if (!stored) throw new Error("melonDS demande un ZIP contenant bios7.bin, bios9.bin et firmware.bin. Importe-le dans l'onglet Moteur, ou choisis DeSmuME.");
    await validateDsBios(stored.bytes);
    bios = { name: 'nds-bios.zip', bytes: stored.bytes };
  }
  return { ejsCore: spec.ejsCore, coreId: settings.dsCore, label: spec.label, bios };
}
function coreLabel(system) {
  if (system === 'nes') return 'FCEUmm';
  if (system === 'snes') return 'Snes9x';
  if (system === 'genesis') return 'Genesis Plus GX';
  if (system === 'arcade') return 'MAME 2003-Plus / FBNeo';
  if (system === 'doom') return 'PrBoom';
  if (system === 'psp') return `PPSSPP (${PSP_ENGINE.label}, secours ${ENGINE_VERSION})`;
  return system === 'gba' ? 'mGBA' : system === 'nds' ? (DS_CORES[settings.dsCore] || DS_CORES.desmume2015).label : 'Gambatte';
}

async function cheatsForGame(analysis, key, romName, hex) {
  const files = await store.listCheatFiles(analysis.system);
  const link = await store.getCheatLink(key);
  const chosen = [];
  if (link && link.romSha256 === hex) {
    const f = await store.getCheatFile(analysis.system, link.path);
    if (linkedCheatValid(link, f, hex)) chosen.push(f);
  } else {
    for (const m of classifyCheatFiles(romName, hex, files).identified) {
      const f = await store.getCheatFile(analysis.system, m.path);
      if (f && (!f.identityDeclared || f.romSha256 === hex)) chosen.push(f);
    }
  }
  const all = [];
  for (const f of chosen) {
    const dev = deviceLabel(f.name);
    for (const c of parseCht(f.text)) all.push({ desc: dev ? `[${dev}] ${c.desc}` : c.desc, code: c.code });
  }
  return all;
}

/**
 * Liste des codes du jeu : codes saisis à la main + codes du fichier .cht associé.
 * Un code nouveau arrive toujours désactivé ; l'état choisi par l'utilisateur est conservé par jeu.
 */
async function codesForGame(analysis, key, romName, hex) {
  const fromFiles = await cheatsForGame(analysis, key, romName, hex);
  return store.updateCodes(key, (stored) => {
    const same = (e, c) => e.origin === 'fichier' && e.code === c.code && e.name === c.desc;
    // Les codes d'un fichier dont l'association a été retirée ou modifiée disparaissent avec elle.
    const kept = stored.filter((e) => e.origin !== 'fichier' || fromFiles.some((c) => same(e, c)));
    for (const c of fromFiles) {
      if (!kept.some((e) => same(e, c))) kept.push({ id: newCodeId(), name: c.desc, code: c.code, enabled: false, origin: 'fichier' });
    }
    return kept;
  });
}
function newCodeId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function gameDetails(analysis) {
  const parts = [];
  if (analysis.system === 'nes') {
    parts.push(analysis.format, analysis.mapperName);
    if (analysis.battery) parts.push('pile (sauvegarde)');
  } else if (analysis.system === 'genesis') {
    parts.push(analysis.format);
    if (analysis.cartridgeTitle) parts.push('titre cartouche : ' + analysis.cartridgeTitle);
  } else if (analysis.system === 'psp') {
    parts.push({ iso: 'image ISO', cso: 'image CSO compressée', pbp: 'EBOOT.PBP' }[analysis.format]);
    if (analysis.discId) parts.push(`disque ${analysis.discId}`);
  } else if (analysis.system === 'snes') {
    parts.push(analysis.layout);
    if (analysis.chip) parts.push(`puce ${analysis.chip.toUpperCase()}`);
    if (analysis.battery) parts.push('pile (sauvegarde)');
    if (analysis.copierHeader) parts.push('en-tête de copieur');
  }
  if (analysis.video) parts.push(analysis.video);
  return parts.filter(Boolean).join(', ');
}

async function openFile(file) {
  if (!file || opening) return;
  opening = true;
  $('pickGame').disabled = $('changeGame').disabled = $('closeGame').disabled = true;
  try { await openGame(file); }
  catch (err) { setStatus(`Ouverture impossible : ${err.message || err}`, 'error'); }
  finally {
    opening = false;
    $('pickGame').disabled = $('changeGame').disabled = $('closeGame').disabled = false;
  }
}

// Arcade : console choisie depuis l'accueil ou dans le catalogue ; sinon un .zip sans ROM de console.
function arcadeWanted(file) {
  if (!/\.zip$/i.test(file.name)) return false;
  return new URLSearchParams(location.search).get('console') === 'arcade' || $('catSystem')?.value === 'arcade';
}
async function readArcadeFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { rom: { name: file.name, bytes, note: '' }, analysis: analyzeArcade(file.name, bytes) };
}
// Cœur arcade du jeu : celui qui a déjà marché sur cet appareil, sinon MAME 2003-Plus puis FBNeo.
async function arcadeCore(hex, forced) {
  const id = forced || await store.getSetting(`arcade-core:${hex}`, null) || ARCADE_CORE_ORDER[0];
  const spec = ARCADE_CORES[id] || ARCADE_CORES[ARCADE_CORE_ORDER[0]];
  return { ejsCore: spec.ejsCore, coreId: id, label: spec.label, bios: null };
}
// Verdict du cœur (player.html) : on retient le cœur qui reconnaît le romset, sinon on essaie l'autre.
async function arcadeVerdict(game, file, options, ok) {
  if (game !== currentGame) return;
  if (ok) {
    await store.setSetting(`arcade-core:${game.hex}`, game.coreId);
    setStatus(`${game.title} : romset reconnu par ${ARCADE_CORES[game.coreId].label}.${game.coreId === 'mame2003_plus' ? ' Cheats du jeu : onglet Codes, « Ouvrir les cheats du jeu ».' : ''}`, 'ok');
    return;
  }
  const tried = [...(options.tried || []), game.coreId];
  const next = ARCADE_CORE_ORDER.find((id) => !tried.includes(id));
  if (!next) {
    await store.setSetting(`arcade-core:${game.hex}`, null);
    setStatus(`Ni MAME 2003-Plus ni FBNeo ne reconnaissent « ${game.fileName} » : ce romset vient sans doute d’une autre version de MAME (le moteur web n’a pas de MAME récent). Un pack au format MAME 2003-Plus (0.78) ou FBNeo le ferait marcher.`, 'error');
    return;
  }
  setStatus(`${ARCADE_CORES[game.coreId].label} ne reconnaît pas ce romset : essai avec ${ARCADE_CORES[next].label}…`);
  await openGame(file, { arcadeCore: next, tried, noConfirm: true });
}

async function openGame(file, options = {}) {
  setStatus('Lecture du fichier…');
  let rom, analysis;
  try {
    if (isPspCandidate(file.name)) ({ rom, analysis } = await readPspFile(file));
    else if (arcadeWanted(file)) ({ rom, analysis } = await readArcadeFile(file));
    else if (/[.]wad$/i.test(file.name)) {
      // DOOM : le .wad est confié tel quel à PrBoom, sous son nom d'origine.
      const bytes = new Uint8Array(await file.arrayBuffer());
      rom = { name: file.name, bytes, note: '' };
      analysis = analyzeWad(file.name, bytes);
    }
    else {
      try {
        rom = await readGameFile(file);
        analysis = analyzeRom(rom.name, rom.bytes);
      } catch (err) {
        // Aucune ROM de console dans le .zip : c'est sans doute un romset arcade.
        if (!/\.zip$/i.test(file.name) || !/^Aucun jeu reconnu dans cette archive/.test(err.message || '')) throw err;
        ({ rom, analysis } = await readArcadeFile(file));
      }
    }
  } catch (err) {
    setStatus(err.message || String(err), 'error');
    return;
  }
  if (!analysis.ok) {
    setStatus(analysis.errors.join(' '), 'error');
    return;
  }
  if (session.hasActiveGame && !options.noConfirm) {
    const ok = confirm(
      `Fermer « ${session.current ? session.current.title : 'le jeu en cours'} » et ouvrir « ${analysis.title} » ?\n\n` +
      'Un seul jeu est actif à la fois. Le jeu précédent sera fermé avant le démarrage du nouveau moteur ; il ne pourra pas être repris automatiquement si ce démarrage échoue. Les sauvegardes déjà enregistrées restent conservées. Si tu as des progrès non enregistrés dans le jeu, annule et enregistre-les d\'abord.'
    );
    if (!ok) {
      setStatus('Changement annulé.');
      return;
    }
  }

  let core;
  try {
    setStatus('Calcul de l\'empreinte du jeu…');
    core = await resolveCore(analysis.system);
  } catch (err) {
    setStatus(err.message || String(err), 'error');
    return;
  }
  const fp = rom.bytes ? await fingerprint(rom.bytes)
    : await fingerprintBlob(rom.file, (done, total) => setStatus(`Calcul de l'empreinte du jeu… ${Math.floor(done * 100 / total)} %`));
  if (analysis.system === 'arcade') core = await arcadeCore(fp.hex, options.arcadeCore);
  const key = gameKey(analysis.system, fp.hex);
  const spaceId = saveSpaceId(analysis.system, core.coreId, fp.hex);
  const previous = await store.getGame(key);
  // Conserver les espaces existants sans déplacer ni supprimer les sauvegardes.
  const legacyNaming = !!previous && (previous.engineNamingVersion || 1) === 1;
  const engineTitle = previous?.engineTitle || previous?.title || analysis.title;
  const engineName = legacyNaming
    ? legacyEjsGameName(engineTitle, core.coreId, fp.hex)
    : ejsGameName(analysis.title, core.coreId, fp.hex);
  const codes = await codesForGame(analysis, key, rom.name, fp.hex);
  const spec = SYSTEMS[analysis.system];
  // NES : l'en-tête iNES ne dit pas la région ; on reprend les étiquettes du nom de fichier.
  const named = parseRomName(rom.name);
  const region = analysis.region !== 'inconnue' ? analysis.region : named.regions.length ? `${named.regions.join(', ')} (d'après le nom)` : null;

  const game = {
    key,
    spaceId,
    system: analysis.system,
    systemLabel: spec.label,
    title: analysis.title,
    fileName: rom.name,
    cheatAltName: archiveCheatName(rom.name, rom.archive),
    romStem: stemOf(rom.name),
    hex: fp.hex,
    hashAlgo: fp.algo,
    romBytes: rom.bytes ? rom.bytes.length : rom.size,
    discId: analysis.discId || null,
    headerOk: analysis.headerOk,
    coreId: core.coreId,
    coreLabel: core.label,
    regionText: [region, analysis.code || null, ['nes', 'genesis'].includes(analysis.system) ? null : `version ${analysis.version}`].filter(Boolean).join(', ') || 'inconnue',
    details: gameDetails(analysis),
    warnings: analysis.warnings.concat(rom.note ? [rom.note] : []),
  };

  // Profil positionnel Nintendo : sans objet pour la croix et le rond de la PSP.
  const psp = analysis.system === 'psp';
  // PSP : réglage de performance du jeu (ou de la console), imposé au cœur au démarrage.
  const perf = psp ? await pspPerformanceFor(key) : null;
  const perfOptions = psp ? pspPerformanceOptions(perf.preset) : {};
  // PSP : sans la touche de chargement rapide d'état, qui fige le cœur nightly (voir pspNightlyFragile).
  // La manette est lue par le lanceur (profils EMUPERSO) ; le clavier garde les touches du moteur.
  const defaultControls = psp ? buildPspControls() : null;
  const pad = await padSettingsFor(analysis.system, key);
  const layoutTouch = touchLayout(analysis.system);
  // PSP : le cœur range les sauvegardes sous PSP/SAVEDATA/<identifiant du disque>, identique
  // pour tous les contenus partageant cet identifiant. Le joueur échange les dossiers à
  // chaud (voir pspSwapSaveData) : chaque contenu a sa case « ~id~empreinte » et le
  // canonique reçoit toujours les sauvegardes du jeu en cours — rien n'est supprimé.
  let pspSaveSwap = null;
  if (psp && analysis.discId) {
    const namespace = pspSaveNamespace(analysis.discId, fp.hex);
    const prefix = saveDataPrefix(analysis.discId);
    if (namespace && prefix) {
      const owner = pspSaveOwnerHint(await store.listGames(), analysis.discId);
      pspSaveSwap = { prefix, namespace, hash: fp.hex.slice(0, 8), adoptLegacy: owner === spaceId };
    }
  }
  const engineStem = ejsGameName(analysis.title, core.coreId, fp.hex);
  // Limite du cœur (Mega Drive : 150 lignes) : les codes en trop ne partent pas au moteur.
  const bootCodes = limitActiveCodes(analysis.system, codes.filter((c) => c.enabled && !isPlaceholderCode(analysis.system, c.code)).map((c) => c.code));
  if (bootCodes.dropped) game.warnings.push(codeLimitText(game.systemLabel, bootCodes));
  const boot = {
    // PSP : moteur nightly d'abord (cœur ppsspp plus rapide), puis les sources 4.2.3 en secours.
    enginePaths: psp ? [PSP_ENGINE, ...enginePaths] : enginePaths,
    // Les cœurs se servent aussi de l'extension : transmettre celle détectée,
    // même si le fichier d'origine était .bin, .srl ou mal nommé.
    // Le moteur nomme la sauvegarde de cartouche d'après ce nom de fichier : nom tiré de l'empreinte et
    // du cœur, donc une sauvegarde par jeu, même ROM renommée, jamais partagée entre deux ROM de même nom.
    // PSP : le File d'origine (lu sur le disque) au lieu d'une copie en mémoire.
    // Arcade : MAME et FBNeo reconnaissent le jeu à son nom court (« xxmissio.zip ») ; il ne doit pas changer.
    rom: { name: analysis.system === 'arcade' ? `${analysis.code}.zip` : analysis.system === 'doom' ? `${analysis.code}.wad` : `${engineStem}.${engineExtension(analysis)}`, bytes: rom.bytes, file: rom.file || null },
    // GB/GBC/GBA/DS : les sauvegardes d'avant 0.3.0-alpha.2 portent le nom du fichier ; player.html
    // appelle cette fonction une fois l'ancien moteur fermé et avant de charger le nouveau.
    prepareSaves: LEGACY_SAVE_SYSTEMS.has(analysis.system) ? () => takeOverLegacySave(game, {
      coreId: core.coreId,
      newStem: engineStem,
      oldStems: [stemOf(rom.name), previous?.fileName ? stemOf(previous.fileName) : null],
    }) : null,
    // Seuls les codes que l'utilisateur a activés partent au moteur (voir player.html).
    codes: bootCodes.codes,
    coreOptions: psp ? perfOptions : null,
    // PSP : codes actifs écrits dans le fichier CWCheat du jeu avant son démarrage (voir pspCheatFile).
    pspCheats: psp ? pspCheatFile(analysis.discId, codes.filter((c) => c.enabled && !isPlaceholderCode('psp', c.code))) : null,
    // PSP : plan d'échange des dossiers de sauvegarde par contenu (voir pspSwapSaveData).
    pspSaveSwap,
    bios: core.bios,
    ejs: {
      EJS_core: core.ejsCore,
      EJS_gameName: engineName,
      EJS_gameID: await store.engineNumericId(spaceId),
      EJS_color: '#E0457B',
      EJS_backgroundColor: '#1b1940',
      EJS_alignStartButton: 'center',
      EJS_startButtonName: 'Démarrer',
      // ppsspp n'existe qu'en version à fils d'exécution (SharedArrayBuffer, page isolée).
      EJS_threads: psp,
      // PSP : pas de copie du jeu (des centaines de Mio) dans le cache IndexedDB du moteur.
      // PSP : pas de copie du jeu dans le cache IndexedDB du moteur, ni de bouton « charger un état » du moteur.
      ...(psp ? { EJS_CacheLimit: 0, EJS_Buttons: { loadState: false, quickLoad: false, restart: false } } : {}),
      // Sauvegarde de cartouche écrite toutes les 30 s (5 min par défaut dans le moteur).
      // PSP : les codes CWCheat ne sont lus que si l'option du cœur est active.
      EJS_defaultOptions: { 'save-save-interval': '30', ...(psp ? { ppsspp_cheats: 'enabled', ...perfOptions } : {}) },
      ...(defaultControls ? { EJS_defaultControls: defaultControls } : {}),
      ...(layoutTouch ? { EJS_VirtualGamepadSettings: layoutTouch } : {}),
    },
    pad: { system: analysis.system, settings: pad.settings },
    onPad: (id) => showPadStatus(id),
    // Évènements du moteur (erreurs, refus sans gravité) consignés dans le journal exportable.
    onLog: (kind, message) => journal(kind, message),
    // Arcade : cœur essayé et cheat.dat de MAME 2003-Plus (codes du jeu lancé, menu du cœur).
    arcade: analysis.system === 'arcade' ? { core: core.coreId, cheatUrl: core.coreId === 'mame2003_plus' ? '../cheats-arcade/cheat.dat' : null } : null,
    onArcadeVerdict: analysis.system === 'arcade' ? (ok) => { arcadeVerdict(game, file, options, ok).catch((err) => setStatus(err.message || String(err), 'error')); } : null,
    onSaveUpdate: (e) => mirrorSave(spaceId, e).catch(err => {
      console.error('Copie miroir impossible', err);
      if (currentGame?.spaceId === spaceId) setStatus("La copie de sécurité a échoué. Exporte la sauvegarde actuelle pour la conserver.", 'error');
    }),
    onLifecycle: (event) => {
      store.recordLifecycle(key, event).then(() => refreshHistory()).catch(err => {
        if (currentGame === game) setStatus(`Historique non enregistré : ${err.message}`, 'warn');
      });
    },
  };

  await store.recordGame({
    gameKey: key,
    spaceId,
    system: analysis.system,
    title: analysis.title,
    fileName: rom.name,
    hash: fp.hex,
    discId: analysis.discId || null,
    coreId: core.coreId,
    engineTitle,
    engineNamingVersion: legacyNaming ? 1 : 2,
  });
  // PSP : le dossier de sauvegarde du cœur découle de l'identifiant du disque
  // (PSP/SAVEDATA/<discId>). Deux contenus différents partageant ce même
  // identifiant (dump refait, hack non renuméroté) voient les MÊMES fichiers
  // en jeu — le cœur ne peut pas les distinguer. Les copies miroir et les
  // exports ZIP restent isolés par empreinte ; on avertit honnêtement.
  if (analysis.system === 'psp' && analysis.discId) {
    try {
      const peers = (await store.listGames()).filter((g) => g.system === 'psp' && g.discId === analysis.discId && g.spaceId !== spaceId);
      if (peers.length) {
        game.warnings.push(`Attention : « ${peers[0].title || peers[0].fileName} » partage le même identifiant de disque (${analysis.discId}) avec un contenu différent. En jeu, les deux versions utilisent le même dossier de sauvegarde PSP et peuvent se marcher dessus ; les exports ZIP, eux, restent séparés par empreinte.`);
      }
    } catch { /* liste des jeux indisponible : pas bloquant */ }
  }
  await session.start(game, boot); // Le rendu déclenche les panneaux sans bloquer le prochain changement.
  // Codes du jeu cherchés sur le site et importés désactivés, sans attendre (voir cheat-autoload.mjs).
  autoloadCheats({ store, system: game.system, romName: game.fileName, altName: game.cheatAltName, discId: game.discId }).then(async (r) => {
    if (game !== currentGame || !r.found.length) return;
    await refreshCheatPanel();
    await refreshCodePanel();
    if (r.imported.length) setStatus(`${r.imported.length} fichier(s) de codes trouvé(s) pour ce jeu et chargé(s) automatiquement. Confirme l’association dans l’onglet Codes ; aucun code n’est activé.`, 'ok');
  }).catch((err) => console.error('Codes automatiques indisponibles', err));
}

function renderWarnings(game) {
  const box = clear($('gameWarnings'));
  box.hidden = game.warnings.length === 0;
  for (const w of game.warnings) box.append(h('li', {}, w));
}

// --- Sauvegardes ------------------------------------------------------------------
// Copie (jamais déplacement) de la sauvegarde nommée d'après l'ancien nom de fichier de la ROM.
async function takeOverLegacySave(game, request) {
  try {
    const plan = await migrateLegacySave(request);
    if (plan.action === 'copy') {
      game.warnings.push(`Sauvegarde existante reprise depuis « ${plan.fromStem} » : elle est maintenant liée à l'empreinte de la ROM et suit le jeu même renommé. L'ancienne sauvegarde reste intacte.`);
      if (currentGame === game) renderWarnings(game);
    }
    return plan;
  } catch (err) {
    console.error("Reprise de l'ancienne sauvegarde impossible", err);
    game.warnings.push(`Ancienne sauvegarde non reprise (${err.message || err}) : elle reste intacte et peut être importée depuis l'onglet Sauvegardes.`);
    if (currentGame === game) renderWarnings(game);
    return null;
  }
}

async function mirrorSave(spaceId, e) {
  const data = e && e.save ? new Uint8Array(e.save) : null;
  if (!data || data.length === 0) return;
  const hash = toHex(await crypto.subtle.digest('SHA-256', data));
  const r = await store.mirrorSave(spaceId, data, hash);
  if (r.changed && currentGame && currentGame.spaceId === spaceId) await refreshSavePanel();
}

// --- Sauvegardes PSP : dossiers de la carte mémoire virtuelle, échangés en ZIP -------------------
// Date fixe dans le ZIP : même contenu = mêmes octets, donc pas de copie de sécurité en double.
const ZIP_DATE = new Date(2000, 0, 1);

function pspSaveFiles(game) {
  const control = session.control();
  const prefix = saveDataPrefix(game.discId);
  if (!control || !prefix) return null;
  return control.listSaveData(prefix).sort((a, b) => (a.name < b.name ? -1 : 1));
}

async function mirrorPspSaves(game) {
  if (game !== currentGame) return;
  try {
    const files = pspSaveFiles(game);
    if (files && files.length) await mirrorSave(game.spaceId, { save: buildZip(files, ZIP_DATE) });
  } catch (err) { console.error('Copie de sécurité PSP impossible', err); }
}

async function exportPspSave(game) {
  const files = pspSaveFiles(game);
  if (!files) { setStatus('Lance le jeu avant d’exporter sa sauvegarde (identifiant du disque requis).', 'warn'); return; }
  if (!files.length) { setStatus(`Aucune sauvegarde PSP pour ce jeu (dossiers ${saveDataPrefix(game.discId)}… absents) : enregistre d’abord dans le jeu.`, 'warn'); return; }
  const zip = buildZip(files, ZIP_DATE);
  await mirrorSave(game.spaceId, { save: zip });
  download(`${slug(game.title)}-psp-${game.discId}.zip`, zip);
  setStatus(`Sauvegarde PSP exportée : ${new Set(files.map((f) => f.name.split('/')[0])).size} dossier(s), ${fmtSize(zip.length)}.`, 'ok');
}

async function importPspSave(game, file) {
  const control = session.control();
  const prefix = saveDataPrefix(game.discId);
  if (!/\.zip$/i.test(file.name)) { setStatus('Sauvegarde PSP : choisis le ZIP exporté par Portables (dossiers de la carte mémoire).', 'error'); return; }
  if (file.size > SAVE_ARCHIVE_LIMITS.bytes) { setStatus('Archive trop grosse (64 Mio maximum).', 'error'); return; }
  const files = await extractAll(new Uint8Array(await file.arrayBuffer()), { maxBytes: SAVE_ARCHIVE_LIMITS.bytes, maxFiles: SAVE_ARCHIVE_LIMITS.files });
  const check = checkSaveArchive(files, prefix);
  if (!check.ok) { setStatus(`Import refusé : ${check.error}`, 'error'); return; }
  if (!confirm(`Importer ${check.folders.length} dossier(s) de sauvegarde dans « ${game.title} » (${game.discId}) ?\n${check.folders.join('\n')}\n\nLes fichiers de même nom sont remplacés ; les sauvegardes actuelles sont d’abord copiées dans les copies de sécurité. Le jeu redémarre ensuite, ou tu le rouvres avec le moteur rapide.`)) return;
  if (game !== currentGame || !control) return;
  const current = pspSaveFiles(game);
  if (current && current.length) await mirrorSave(game.spaceId, { save: buildZip(current, ZIP_DATE) });
  const fragile = pspNightlyFragile(game, control);
  await control.writeSaveData(files, !fragile);
  setStatus(`Sauvegarde PSP importée (${check.folders.length} dossier(s)) ; ${fragile ? 'ferme puis rouvre le jeu pour qu’il la lise (pas de redémarrage automatique avec le moteur rapide)' : 'jeu redémarré'}. L’ancienne reste dans les copies de sécurité.`, 'ok');
  await refreshSavePanel();
}

async function refreshSavePanel() {
  const ticket = ++panelTickets.saves;
  const game = currentGame;
  const box = document.createDocumentFragment();
  if (!game) {
    box.append(h('p', { class: 'muted' }, 'Ouvre un jeu pour voir ses sauvegardes.'));
  } else {
    const info = await store.mirrorInfo(game.spaceId);
    if (ticket !== panelTickets.saves || game !== currentGame) return;
    box.append(h('p', {}, `Espace de sauvegarde : ${game.title} (${game.systemLabel}, ${game.coreLabel}).`));
    if (info.length === 0) {
      box.append(h('p', { class: 'muted' }, game.system === 'psp'
        ? "Aucune copie de sécurité pour l'instant. PSP : la carte mémoire du jeu est copiée chaque minute pendant la partie, et à chaque export ou import (ZIP des dossiers de sauvegarde)."
        : "Aucune copie de sécurité pour l'instant. Elle apparaît dès que le moteur détecte un changement de sauvegarde dans le jeu."));
    } else {
      const list = h('ul', { class: 'rows' });
      for (const g of info) {
        list.append(
          h('li', {},
            h('span', {}, `${g.generation === 0 ? 'Dernière' : `Version précédente ${g.generation}`} : ${fmtDate(g.at)}, ${fmtSize(g.size)}`),
            h('button', { class: 'btn small', onclick: async () => {
              const e = await store.getMirrorSave(game.spaceId, g.generation);
              if (e) download(`${slug(game.title)}-${game.coreId}.${game.system === 'psp' ? 'zip' : 'sav'}`, e.bytes);
            } }, 'Exporter')
          )
        );
      }
      box.append(list);
      box.append(
        h('button', { class: 'btn small danger', onclick: async () => {
          if (confirm('Supprimer les copies de sécurité de ce jeu ? La sauvegarde du moteur n\'est pas touchée.')) {
            await store.deleteMirror(game.spaceId);
            await refreshSavePanel();
          }
        } }, 'Supprimer les copies de sécurité')
      );
    }
  }
  if (ticket !== panelTickets.saves || game !== currentGame) return;
  $('saveMirror').replaceChildren(box);
  await refreshHistory();
}

async function refreshHistory() {
  const ticket = ++panelTickets.history;
  const game = currentGame;
  const box = document.createDocumentFragment();
  const games = (await store.listGames()).slice(0, 12);
  if (ticket !== panelTickets.history || game !== currentGame) return;
  if (games.length === 0) {
    box.append(h('p', { class: 'muted' }, 'Aucun jeu ouvert pour le moment.'));
    $('history').replaceChildren(box);
    return;
  }
  const list = h('ul', { class: 'rows' });
  for (const g of games) {
    const stats = `${g.opens || 0} ouverture(s), ${g.readyCount || 0} moteur(s) prêt(s), ${g.historyVersion === 2 ? g.plays || 0 : 0} partie(s) démarrée(s)`;
    const legacy = g.legacyOpens ?? (g.historyVersion === 2 ? 0 : g.plays || 0);
    const state = { opened: 'ROM ouverte', ready: 'moteur prêt', started: 'jeu démarré' }[g.status] || 'ancien historique';
    list.append(h('li', {}, h('span', {}, `${g.title} (${SYSTEMS[g.system] ? SYSTEMS[g.system].label : g.system}), ${fmtDate(g.lastOpened || g.lastPlayed)} — ${state} ; ${stats}${legacy ? ` ; ${legacy} ancienne(s) ouverture(s), démarrage non vérifié` : ''}`)));
  }
  box.append(list);
  $('history').replaceChildren(box);
}

// --- Codes ------------------------------------------------------------------------
async function refreshCheatPanel() {
  const ticket = ++panelTickets.cheats;
  const game = currentGame;
  const valid = () => ticket === panelTickets.cheats && game === currentGame;
  const info = document.createDocumentFragment();
  const total = await store.countCheatFiles();
  info.append(h('p', {}, total === 0 ? 'Aucun fichier de codes importé.' : `${total} fichier(s) de codes importé(s).`));
  const list = document.createDocumentFragment();
  const out = document.createDocumentFragment();
  const publish = () => {
    if (!valid()) return;
    $('cheatInfo').replaceChildren(info);
    $('cheatMatches').replaceChildren(list);
    $('cheatSearchResults').replaceChildren(out);
  };
  if (!valid()) return;
  if (!game || total === 0) { publish(); return; }
  const files = await store.listCheatFiles(game.system);
  let classified = classifyCheatFiles(game.fileName, game.hex, files, { discId: game.discId });
  // Titre tronqué dans l'archive : on cherche aussi avec le titre de l'archive (voir archiveCheatName).
  if (game.cheatAltName && !classified.sameDisc.length && !classified.exact.length && !classified.sameTitle.length) {
    classified = { ...classifyCheatFiles(game.cheatAltName, game.hex, files, { discId: game.discId }), identified: classified.identified };
  }
  const { identified, sameDisc, exact, sameTitle } = classified;
  const link = await store.getCheatLink(game.key);

  if (!valid()) return;
  if (link) {
    list.append(h('p', {}, `Association enregistrée pour cette ROM : ${link.name}. Confirmation limitée à cette ROM et à ce contenu ; s'applique au prochain lancement.`));
    const linked = await store.getCheatFile(game.system, link.path);
    if (!valid()) return;
    if (!linkedCheatValid(link, linked, game.hex)) {
      list.append(h('p', { class: 'warn' }, 'Fichier de codes modifié, absent ou ancienne association : codes bloqués jusqu’à nouvelle confirmation.'));
      if (linked) list.append(h('button', { class: 'btn small', onclick: () => associateCheat(linked) }, 'Confirmer les nouveaux codes'));
    }
    if (!link.romSha256) list.append(h('p', { class: 'warn' }, 'Ancienne association : confirme-la à nouveau pour identifier cette ROM par son empreinte complète.'));
    list.append(h('button', { class: 'btn small', onclick: async () => { await store.setCheatLink(game.key, null); await refreshCheatPanel(); } }, 'Retirer ce choix'));
  }
  const changed = files.filter(f => f.reviewRequired && f.romSha256 === game.hex && !(link?.path === f.path && linkedCheatValid(link, f, game.hex)));
  for (const f of changed) list.append(h('button', { class: 'btn small', onclick: () => associateCheat(f) }, `Vérifier le fichier modifié : ${f.name}`));
  if (identified.length) {
    list.append(h('p', {}, `${identified.length} fichier(s) identifié(s) par SHA-256 complet. Cela vérifie l'association déclarée, pas l'efficacité des codes.`));
    list.append(h('ul', { class: 'rows' }, identified.map((f) => h('li', {}, f.name))));
  }
  if (sameDisc.length) {
    list.append(h('p', { class: 'warn' }, `Même identifiant de disque (${game.discId}) : même jeu et même région ; la révision reste à vérifier. Confirme une fois ; ton choix sera retenu pour cette ROM même renommée.`));
    list.append(h('ul', { class: 'rows' }, sameDisc.map((f) => h('li', {},
      h('span', {}, f.name),
      h('button', { class: 'btn small', onclick: () => associateCheat(f) }, 'Associer à cette ROM')
    ))));
  }
  if (exact.length) {
    list.append(h('p', { class: 'warn' }, 'Même nom : région, révision ou hack à vérifier. Confirme une fois ; ton choix sera retenu pour cette ROM même renommée.'));
    list.append(h('ul', { class: 'rows' }, exact.map((f) => h('li', {},
      h('span', {}, f.name),
      h('button', { class: 'btn small', onclick: () => associateCheat(f) }, 'Associer à cette ROM')
    ))));
  } else if (!identified.length && !sameDisc.length && !sameTitle.length && !link) {
    list.append(h('p', { class: 'muted' }, 'Aucune correspondance. Importe tes codes ou recherche un fichier ci-dessous.'));
  }
  if (sameTitle.length) {
    list.append(h('p', { class: 'warn' }, 'Même titre, autre région ou version : les codes peuvent être incompatibles.'));
    list.append(h('ul', { class: 'rows' }, sameTitle.slice(0, 8).map((f) => h('li', {},
      h('span', {}, f.name),
      h('button', { class: 'btn small', onclick: () => associateCheat(f) }, 'Associer avec avertissement')
    ))));
  }
  // Recherche manuelle
  const q = $('cheatSearch').value.trim().toLowerCase();
  if (q.length >= 2) {
    const hits = files.filter((f) => normalizeName(f.name).includes(q)).slice(0, 20);
    if (hits.length === 0) out.append(h('p', { class: 'muted' }, 'Aucun résultat.'));
    for (const f of hits) {
      out.append(h('div', { class: 'row' }, h('span', {}, f.name), h('button', { class: 'btn small', onclick: async () => {
        await associateCheat(f);
      } }, 'Associer')));
    }
  }
  publish();
}

async function associateCheat(file) {
  const game = currentGame;
  if (!game) return;
  if (file.identityDeclared && file.romSha256 !== game.hex) {
    setStatus("Ce fichier déclare une empreinte différente ou invalide : association refusée.", 'error');
    return;
  }
  if (!confirm(`Associer « ${file.name} » à « ${game.fileName} » ?\nVérifie la région, la révision et les hacks : le nom ne suffit pas à garantir des codes compatibles.\nCe choix sera retenu pour les octets de cette ROM et prendra effet au prochain lancement.`)) return;
  const selected = await store.getCheatFile(game.system, file.path);
  if (!selected) throw new Error('Fichier de codes introuvable.');
  if (game !== currentGame) return;
  if ((selected.identityDeclared && selected.romSha256 !== game.hex) || (file.contentSha256 && selected.contentSha256 !== file.contentSha256)) {
    setStatus('Le fichier a changé pendant la confirmation : vérifie à nouveau son contenu.', 'warn');
    await refreshCheatPanel();
    return;
  }
  const contentSha256 = selected.contentSha256 || (await fingerprint(new TextEncoder().encode(selected.text))).hex;
  if (!selected.contentSha256) await store.importCheatFile(selected);
  await store.setCheatLink(game.key, { path: file.path, name: file.name, romSha256: game.hex, contentSha256 });
  if (game !== currentGame) return;
  $('cheatSearch').value = '';
  await refreshCheatPanel();
}

async function importCheatFiles(fileList) {
  if (importingCheats) return;
  const files = [...fileList].filter((f) => /\.cht$/i.test(f.name));
  if (files.length === 0) {
    setStatus('Aucun fichier .cht dans la sélection.', 'error');
    return;
  }
  let imported = 0;
  let skipped = 0;
  const refused = [];
  const entries = [];
  let batchBytes = 0;
  const systemAtImport = currentGame?.system;
  importingCheats = true;
  for (const id of ['cheatFolderBtn', 'cheatFilesBtn', 'cheatClear']) $(id).disabled = true;
  try {
    for (const f of files) {
      const path = f.webkitRelativePath || f.name;
      const system = inferSystemFromPath(path) || systemAtImport;
      if (!system) { skipped++; refused.push(`${f.name} : console inconnue`); continue; }
      if (f.size > CHEAT_LIMITS.fileBytes || entries.length >= CHEAT_LIMITS.batchFiles || batchBytes + f.size > CHEAT_LIMITS.batchBytes) {
        skipped++; refused.push(`${f.name} : plafond fichier ou lot dépassé`); continue;
      }
      try {
        const text = await f.text();
        if (!parseCht(text).length) throw new Error('aucun code lisible');
        const entry = await store.prepareCheatFile({ system, path, name: f.name, text });
        if (batchBytes + entry.byteSize > CHEAT_LIMITS.batchBytes) throw new Error('plafond du lot dépassé');
        entries.push(entry);
        batchBytes += entry.byteSize;
      } catch (err) { skipped++; refused.push(`${f.name} : ${err.message}`); }
      if ((entries.length + skipped) % 20 === 0) {
        setStatus(`Préparation des codes : ${entries.length + skipped}/${files.length} ; ${skipped} refusé(s)…`);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    await store.commitCheatFiles(entries);
    imported = entries.length;
  } catch (err) {
    setStatus(`Import annulé : ${err.name === 'QuotaExceededError' ? 'quota du navigateur atteint' : err.message}. Les imports existants sont conservés.`, 'error');
    return;
  } finally {
    importingCheats = false;
    for (const id of ['cheatFolderBtn', 'cheatFilesBtn', 'cheatClear']) $(id).disabled = false;
  }
  setStatus(
    `${imported} fichier(s) de codes importé(s)` + (skipped ? `, ${skipped} refusé(s). ${refused.slice(0, 5).join(' ; ')}${refused.length > 5 ? ' ; autres refus dans le rapport.' : ''}` : '.'),
    skipped ? 'warn' : 'ok'
  );
  if (refused.length) download('rapport-import-codes.txt', `${imported} importé(s), ${skipped} refusé(s)\n${refused.join('\n')}`);
  await refreshCheatPanel();
}

// --- Codes du jeu (saisie, activation, suppression) --------------------------------
const SYSTEM_CODE_HELP = {
  nes: 'NES : Game Genie (6 ou 8 lettres), brut 0300:16, brut conditionnel 91D9?AD:A5, Pro Action Rocky (8 chiffres).',
  snes: 'SNES : Game Genie C2AF-3D07, Pro Action Replay 7E0DBE05, brut 7E0DBE:05 ou 7E0DBE=03?05.',
  psp: 'PSP : CWCheat, « _L 0xAAAAAAAA 0xVVVVVVVV » par paire (plusieurs lignes acceptées). Les lignes « _L 0x00000000 0x00000000 » des fichiers sont des titres de section : elles ne s’activent pas.',
};

async function refreshCodePanel() {
  const ticket = ++panelTickets.codes;
  const game = currentGame;
  const box = document.createDocumentFragment();
  if (!game) {
    box.append(h('p', { class: 'muted' }, 'Ouvre un jeu pour gérer ses codes.'));
  } else if (game.system === 'doom') {
    // DOOM : PrBoom ne lit les codes (IDDQD…) qu'au clavier, et seulement si le joueur 1 est un clavier, ce qui
    // couperait la manette et le tactile ; la version web plante si on les lui envoie autrement.
    box.append(h('p', {}, 'Les codes de DOOM (IDDQD, IDKFA…) ne sont pas encore pris en charge dans la version navigateur : PrBoom ne les lit qu’au clavier, ce qui couperait la manette et les commandes tactiles. Ils sont prévus dans une prochaine version.'));
  } else if (game.system === 'arcade') {
    // Arcade : MAME 2003-Plus ignore les codes envoyés de l'extérieur ; il lit cheat.dat (codes du jeu lancé
    // seulement) et les propose dans son propre menu. FBNeo n'a pas de codes ici.
    if (game.coreId === 'mame2003_plus') {
      box.append(h('p', {}, 'Les cheats de ce jeu sont chargés par MAME 2003-Plus (cheat.dat, 4 860 jeux d’arcade) et se règlent dans son menu : « Cheat », puis active les codes voulus avec la croix et A. Manette : clic du stick gauche.'));
      box.append(h('button', { class: 'btn primary', type: 'button', onclick: () => { const c = session.control(); if (c && c.openArcadeMenu) c.openArcadeMenu(); else setStatus('Lance d’abord le jeu.', 'warn'); } }, 'Ouvrir les cheats du jeu'));
      box.append(h('p', { class: 'muted small-text' }, 'Si le jeu n’a pas de codes, le menu affiche « there are no cheats for this game ». B pour revenir, « Return to Game » pour reprendre.'));
    } else {
      box.append(h('p', { class: 'muted' }, 'Ce jeu tourne avec FBNeo : pas de cheats intégrés pour ce cœur ici.'));
    }
  } else {
    const entries = await store.getCodes(game.key);
    if (ticket !== panelTickets.codes || game !== currentGame) return;
    box.append(h('p', { class: 'muted small-text' }, SYSTEM_CODE_HELP[game.system] ||
      `${game.systemLabel} : format non contrôlé par le lanceur ; un code mal formé est ignoré par le moteur.`));
    if (entries.length === 0) box.append(h('p', { class: 'muted' }, 'Aucun code pour ce jeu.'));
    const list = h('ul', { class: 'rows codes' });
    for (const e of entries) {
      const parsed = parseCheatCode(game.system, e.code);
      const id = `code-${e.id}`;
      if (parsed.ok && parsed.placeholder) {
        list.append(h('li', { class: 'code-section' }, h('strong', {}, e.name || 'Section'), h('small', { class: 'muted' }, ' — titre de section, rien à activer')));
        continue;
      }
      list.append(h('li', {},
        h('label', { class: 'choice', for: id },
          h('input', { type: 'checkbox', id, checked: !!e.enabled, onchange: (ev) => toggleCode(game, e.id, ev.target.checked) }),
          h('span', {}, h('strong', {}, e.name || 'Sans nom'), h('br'), h('code', {}, e.code), ' ',
            h('small', { class: parsed.ok ? 'muted' : 'warn' }, parsed.ok ? (parsed.unchecked ? 'format non contrôlé' : describeCode(parsed)) : parsed.error),
            e.origin === 'fichier' ? h('small', { class: 'muted' }, ' — fichier .cht associé') : '')),
        e.origin === 'manuel' ? h('button', { class: 'btn small danger', type: 'button', onclick: () => deleteCode(game, e) }, 'Supprimer') : ''));
    }
    box.append(list);
    const active = entries.filter((e) => e.enabled).length;
    box.append(h('p', { class: active ? 'warn small-text' : 'muted small-text' }, active
      ? `${active} code(s) actif(s). Un code peut modifier la mémoire sauvegardée : exporte ta sauvegarde avant d'enregistrer en jeu avec un code actif.`
      : 'Aucun code actif. Les codes ne sont jamais activés automatiquement.'));
    if (game.system === 'psp') {
      for (const [a, b, address] of pspCodeConflicts(entries.filter((e) => e.enabled))) {
        box.append(h('p', { class: 'warn small-text' }, `Codes en conflit : « ${a} » et « ${b} » écrivent une valeur différente à ${address}. Ce sont sans doute des variantes exclusives : n’en garde qu’un.`));
      }
    }
  }
  if (ticket !== panelTickets.codes || game !== currentGame) return;
  $('codeList').replaceChildren(box);
  $('codeAddForm').hidden = !game || game.system === 'arcade' || game.system === 'doom';
}

async function saveCodes(game, mutate) {
  await store.updateCodes(game.key, mutate);
  if (game === currentGame) {
    const entries = await store.getCodes(game.key);
    if (game === currentGame) applyLiveCodes(entries);
  }
  await refreshCodePanel();
}

function codeLimitText(label, limited) {
  return `${label} : le moteur accepte au plus ${limited.max} lignes de codes actives ; ${limited.dropped} code(s) activé(s) en trop ne sont pas appliqués (au-delà, le jeu planterait). Désactive ceux dont tu n’as pas besoin.`;
}

function applyLiveCodes(entries) {
  const system = currentGame?.system;
  const limited = limitActiveCodes(system, entries.filter((e) => e.enabled && !isPlaceholderCode(system, e.code)).map((e) => e.code));
  const enabled = limited.codes;
  const control = session.control();
  if (!control) { setStatus(limited.dropped ? codeLimitText(currentGame.systemLabel, limited) : 'Codes enregistrés pour ce jeu ; ils seront appliqués au prochain lancement.', limited.dropped ? 'warn' : 'ok'); return; }
  try {
    control.setCodes(enabled);
    if (limited.dropped) setStatus(codeLimitText(currentGame.systemLabel, limited), 'warn');
    else setStatus(`Codes appliqués au moteur : ${enabled.length} actif(s). Un code retiré peut laisser une valeur en mémoire jusqu’au redémarrage du jeu.`, 'ok');
  } catch (err) { setStatus(`Codes non appliqués : ${err.message}`, 'error'); }
}

async function toggleCode(game, id, enabled) {
  await saveCodes(game, (entries) => entries.map((e) => (e.id === id ? { ...e, enabled } : e)));
}

async function deleteCode(game, entry) {
  if (!confirm(`Supprimer le code « ${entry.name || entry.code} » de ce jeu ?`)) return;
  await saveCodes(game, (entries) => entries.filter((e) => e.id !== entry.id));
}

async function addCode() {
  const game = currentGame;
  if (!game) return;
  const name = $('codeName').value.trim();
  const parsed = parseCheatCode(game.system, $('codeValue').value);
  const report = (text, kind) => { $('codeCheck').textContent = text; $('codeCheck').dataset.kind = kind; };
  if (!parsed.ok) { report(parsed.error, 'error'); return; }
  if (parsed.placeholder) { report(parsed.note, 'error'); return; }
  await saveCodes(game, (entries) => {
    if (entries.some((e) => e.code === parsed.code)) throw new Error('Ce code existe déjà pour ce jeu.');
    return [...entries, { id: newCodeId(), name: name || parsed.code, code: parsed.code, enabled: false, origin: 'manuel', format: parsed.format }];
  });
  $('codeName').value = '';
  $('codeValue').value = '';
  report('Code ajouté, désactivé. Coche-le pour l’activer.', 'ok');
}

function checkCodeInput() {
  const game = currentGame;
  const value = $('codeValue').value;
  if (!game || !value.trim()) { $('codeCheck').textContent = ''; return; }
  const parsed = parseCheatCode(game.system, value);
  $('codeCheck').textContent = parsed.ok ? (parsed.unchecked ? 'Format non contrôlé pour cette console.' : describeCode(parsed)) : parsed.error;
  $('codeCheck').dataset.kind = parsed.ok ? 'ok' : 'error';
}

// --- Sauvegarde du jeu : export immédiat et import ----------------------------------
async function exportCurrentSave() {
  const game = currentGame;
  const control = session.control();
  if (!game || !control) { setStatus('Lance le jeu avant d’exporter sa sauvegarde.', 'warn'); return; }
  if (game.system === 'psp') { await exportPspSave(game); return; }
  const bytes = control.getSave();
  if (!bytes || bytes.length === 0) { setStatus('Aucune sauvegarde pour ce jeu (pas de pile, ou rien d’enregistré dans le jeu).', 'warn'); return; }
  download(`${slug(game.title)}-${game.system}-${game.coreId}.sav`, bytes);
  setStatus(`Sauvegarde exportée (${fmtSize(bytes.length)}).`, 'ok');
}

async function importSave(file) {
  const game = currentGame;
  const control = session.control();
  if (!game || !control) { setStatus('Lance le jeu avant d’importer une sauvegarde.', 'warn'); return; }
  if (game.system === 'psp') { await importPspSave(game, file); return; }
  if (file.size > 4 * 1024 * 1024) { setStatus('Fichier de sauvegarde trop gros (4 Mio maximum).', 'error'); return; }
  if (!confirm(`Remplacer la sauvegarde de « ${game.title} » par « ${file.name} » ?\nLa sauvegarde actuelle est d’abord copiée dans les copies de sécurité. Le jeu redémarre ensuite.`)) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (game !== currentGame || control !== session.control()) throw new Error('Le jeu a changé pendant la lecture.');
  const current = control.getSave();
  if (current && current.length) {
    try { await mirrorSave(game.spaceId, { save: current }); }
    catch { throw new Error('Copie de sécurité impossible. Sauvegarde actuelle conservée ; utilise « Exporter maintenant » avant de réessayer.'); }
  }
  if (game !== currentGame || control !== session.control()) throw new Error('Le jeu a changé pendant la copie.');
  control.importSave(bytes);
  setStatus(`Sauvegarde importée (${fmtSize(bytes.length)}) ; jeu redémarré.${current?.length ? ' L’ancienne reste dans les copies de sécurité.' : ''}`, 'ok');
  await refreshSavePanel();
}

// --- États de jeu (save states) ----------------------------------------------------
let stateImportSlot = 1;

async function refreshStatePanel() {
  const ticket = ++panelTickets.states;
  const game = currentGame;
  const box = document.createDocumentFragment();
  if (!game) {
    box.append(h('p', { class: 'muted' }, 'Ouvre un jeu pour utiliser les états.'));
  } else {
    const slots = await store.listStates(game.spaceId);
    if (ticket !== panelTickets.states || game !== currentGame) return;
    const list = h('ul', { class: 'rows' });
    for (const s of slots) {
      list.append(h('li', { class: 'state-row' },
        h('span', {}, `Emplacement ${s.slot} : ${s.at ? `${fmtDate(s.at)}, ${fmtSize(s.size)}` : 'vide'}`),
        h('span', { class: 'actions tight' },
          h('button', { class: 'btn small', type: 'button', onclick: () => saveState(game, s) }, 'Enregistrer'),
          s.at ? h('button', { class: 'btn small', type: 'button', onclick: () => loadState(game, s.slot) }, 'Charger') : '',
          s.at ? h('button', { class: 'btn small', type: 'button', onclick: () => exportState(game, s.slot) }, 'Exporter') : '',
          h('button', { class: 'btn small', type: 'button', onclick: () => { stateImportSlot = s.slot; $('stateImport').click(); } }, 'Importer'),
          s.previousAt ? h('button', { class: 'btn small', type: 'button', onclick: () => loadState(game, s.slot, true) }, 'Charger le précédent') : '')));
    }
    box.append(list);
    if (game.system === 'psp') box.append(h('p', { class: 'warn small-text' }, 'PSP : avec le moteur rapide (nightly), charger un état ou redémarrer fige le jeu ; ces actions sont bloquées. Les sauvegardes du jeu (carte mémoire) fonctionnent.'));
  }
  if (ticket !== panelTickets.states || game !== currentGame) return;
  $('stateSlots').replaceChildren(box);
}

async function saveState(game, slot) {
  const control = session.control();
  if (!control || game !== currentGame) { setStatus('Lance le jeu avant d’enregistrer un état.', 'warn'); return; }
  if (slot.at && !confirm(`Remplacer l’état de l’emplacement ${slot.slot} ? L’ancien reste disponible comme « précédent ».`)) return;
  try {
    const bytes = control.getState();
    await store.putState(game.spaceId, slot.slot, bytes, { title: game.title, system: game.system, coreId: game.coreId });
    setStatus(`État enregistré dans l’emplacement ${slot.slot} (${fmtSize(bytes.length)}).`, 'ok');
  } catch (err) { setStatus(`État non enregistré : ${err.message || err}`, 'error'); }
  await refreshStatePanel();
}

// Cœur ppsspp nightly : charger un état ou redémarrer le jeu le fige, même moteur en pause (essais du
// 2 novembre 2026, Bust-A-Move Ghost). Avec le moteur de secours 4.2.3, les deux fonctionnent.
function pspNightlyFragile(game, control) {
  return game.system === 'psp' && /\/nightly\//.test(control?.enginePath || '');
}

async function loadState(game, slot, previous = false) {
  const control = session.control();
  if (!control || game !== currentGame) { setStatus('Lance le jeu avant de charger un état.', 'warn'); return; }
  if (pspNightlyFragile(game, control)) { setStatus('Chargement d’état bloqué : il fige le moteur PSP rapide (bug du moteur nightly). Utilise les sauvegardes du jeu ; les états restent exportables.', 'warn'); return; }
  const entry = await store.getState(game.spaceId, slot, previous);
  if (!entry) return;
  if (!confirm(`Charger l’état ${previous ? 'précédent de l’emplacement' : 'de l’emplacement'} ${slot} ? La partie en cours non enregistrée sera perdue.`)) return;
  try {
    control.loadState(entry.bytes);
    setStatus(`État ${slot} chargé.`, 'ok');
  } catch (err) { setStatus(`État non chargé : ${err.message || err}`, 'error'); }
}

async function exportState(game, slot) {
  const entry = await store.getState(game.spaceId, slot);
  if (entry) download(`${slug(game.title)}-${game.system}-${game.coreId}-etat${slot}.state`, entry.bytes);
}

async function importState(file) {
  const game = currentGame;
  if (!game) return;
  if (file.size > 64 * 1024 * 1024) { setStatus('Fichier d’état trop gros.', 'error'); return; }
  if (!confirm(`Importer « ${file.name} » dans l’emplacement ${stateImportSlot} de « ${game.title} » ?\nUn état ne fonctionne qu’avec la même ROM et le même cœur (${game.coreLabel}).`)) return;
  await store.putState(game.spaceId, stateImportSlot, new Uint8Array(await file.arrayBuffer()), { title: game.title, imported: file.name });
  setStatus(`État importé dans l’emplacement ${stateImportSlot}.`, 'ok');
  await refreshStatePanel();
}

async function refreshStorageInfo() {
  const node = $('storageInfo');
  if (!navigator.storage || !navigator.storage.estimate) { node.textContent = 'Le navigateur n’indique pas l’espace disponible.'; return; }
  const [estimate, persisted] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted ? navigator.storage.persisted() : false]);
  node.textContent = `Espace utilisé par ce site : ${fmtSize(estimate.usage || 0)} sur ${fmtSize(estimate.quota || 0)} autorisés. ` +
    (persisted ? 'Stockage persistant accordé : le navigateur ne l’effacera pas de lui-même.' : 'Stockage non persistant : le navigateur peut l’effacer s’il manque de place, ou si tu effaces les données du site. Exporte régulièrement.');
  $('persistBtn').hidden = !!persisted || !navigator.storage.persist;
}

// --- Catalogue ---------------------------------------------------------------------
const ROW_HEIGHT = 56;
let catalog = { entries: [], skipped: 0, truncated: false };
let catalogView = [];
let favorites = new Set();

function importCatalog(fileList) {
  const started = performance.now();
  catalog = buildCatalog(fileList);
  $('catalogTools').hidden = catalog.entries.length === 0;
  applyCatalogFilters();
  const ms = Math.round(performance.now() - started);
  setStatus(`${catalog.entries.length} fichier(s) dans le catalogue (${ms} ms)${catalog.skipped ? `, ${catalog.skipped} autre(s) ignoré(s)` : ''}${catalog.truncated ? ' ; liste tronquée à 200 000 entrées' : ''}. Rien n’est lu avant le lancement.`, 'ok');
}

function catalogFilters() {
  return {
    q: $('catSearch').value,
    system: $('catSystem').value,
    region: $('catRegion').value,
    french: $('catFrench').checked,
    kind: $('catKind').value,
    hideBad: $('catHideBad').checked,
    hideDuplicates: $('catHideDup').checked,
    favorites: $('catFav').checked,
    favSet: favorites,
  };
}

function applyCatalogFilters() {
  catalogView = filterCatalog(catalog.entries, catalogFilters());
  $('catSummary').textContent = catalog.entries.length
    ? `${catalogView.length} sur ${catalog.entries.length} affiché(s).`
    : 'Aucun dossier choisi.';
  $('catList').scrollTop = 0;
  $('catSpacer').style.height = `${catalogView.length * ROW_HEIGHT}px`;
  renderCatalogRows();
}

function renderCatalogRows() {
  const list = $('catList');
  const { first, last } = visibleWindow(catalogView.length, list.scrollTop, list.clientHeight || 400, ROW_HEIGHT);
  const rows = $('catRows');
  rows.style.transform = `translateY(${first * ROW_HEIGHT}px)`;
  rows.replaceChildren(...catalogView.slice(first, last).map((e) => {
    const fav = favorites.has(e.favKey);
    return h('li', { class: 'cat-row' },
      h('button', { class: 'star', type: 'button', 'aria-pressed': String(fav), 'aria-label': fav ? 'Retirer des favoris' : 'Ajouter aux favoris', onclick: () => toggleFavorite(e) }, fav ? '★' : '☆'),
      h('button', { class: 'cat-open', type: 'button', onclick: () => openFile(e.file) },
        h('span', { class: 'cat-name' }, e.name),
        h('span', { class: 'cat-meta' }, [
          e.system ? SYSTEMS[e.system].label : 'console à détecter',
          e.label,
          fmtSize(e.size),
          e.variants > 1 ? `${e.variants} variantes` : '',
          e.duplicateOf !== null ? 'doublon' : '',
          e.ext === '7z' ? 'archive 7z' : '',
        ].filter(Boolean).join(' · '))));
  }));
}

async function toggleFavorite(entry) {
  if (favorites.has(entry.favKey)) favorites.delete(entry.favKey); else favorites.add(entry.favKey);
  await store.setSetting('favorites', [...favorites]);
  if ($('catFav').checked) applyCatalogFilters(); else renderCatalogRows();
}

function applyConsoleFromUrl() {
  const wanted = new URLSearchParams(location.search).get('console');
  if (!wanted || !SYSTEMS[wanted]) return;
  $('catSystem').value = wanted;
  document.body.dataset.console = wanted;
  const hint = $('consoleHint');
  hint.hidden = false;
  hint.textContent = `Console choisie depuis l’accueil : ${SYSTEMS[wanted].label}. Les autres consoles restent disponibles ici.`;
  const demo = document.querySelector(`[data-portable-demo="${wanted}"]`);
  if (demo) demo.classList.add('primary');
}

// --- Manette (mandat Controller V2) ----------------------------------------------------
// Réglages par console (« pad:<console> ») et, si demandé, par jeu (« pad:game:<clé> ») ; le réglage
// du jeu l'emporte. Ils ne touchent ni aux sauvegardes ni aux codes.
async function padSettingsFor(system, gameKeyValue) {
  const game = gameKeyValue ? await store.getSetting(`pad:game:${gameKeyValue}`, null) : null;
  if (game) return { settings: normalizePad(game), scope: 'jeu' };
  const consoleSettings = await store.getSetting(`pad:${system}`, null);
  if (consoleSettings) return { settings: normalizePad(consoleSettings), scope: 'console' };
  return { settings: normalizePad(settings.legacyPositional ? { profile: 'authentique' } : {}), scope: 'défaut' };
}

function padUiSystem() {
  return currentGame?.system || $('padSystem').value || 'nes';
}

async function refreshPadUi() {
  const system = padUiSystem();
  $('padSystem').value = system;
  const gameOnly = !!currentGame && currentGame.system === system && (await padSettingsFor(system, currentGame.key)).scope === 'jeu';
  const { settings: cfg } = await padSettingsFor(system, gameOnly ? currentGame.key : null);
  $('padGameOnly').disabled = !currentGame || currentGame.system !== system;
  $('padGameOnly').checked = gameOnly;
  for (const input of document.querySelectorAll('input[name=padProfile]')) input.checked = input.value === cfg.profile;
  $('padDeadzone').value = String(cfg.deadzone);
  $('padDeadzoneOut').textContent = cfg.deadzone.toFixed(2).replace('.', ',');
  $('padHideTouch').checked = cfg.hideTouch;
  $('padTouchSize').value = String(cfg.touchSize);
  $('padTouchSizeOut').textContent = `${Math.round(cfg.touchSize * 100)} %`;
  $('padTouchOpacity').value = String(cfg.touchOpacity);
  $('padTouchOpacityOut').textContent = `${Math.round(cfg.touchOpacity * 100)} %`;
}

async function savePadUi() {
  const system = padUiSystem();
  const checked = document.querySelector('input[name=padProfile]:checked');
  const forGameScope = $('padGameOnly').checked && currentGame && currentGame.system === system;
  const previous = (await padSettingsFor(system, forGameScope ? currentGame.key : null)).settings;
  const cfg = normalizePad({
    touchOffsets: previous.touchOffsets, // positions des boutons gardées quand on change un autre réglage
    profile: checked ? checked.value : undefined,
    deadzone: Number($('padDeadzone').value),
    hideTouch: $('padHideTouch').checked,
    touchSize: Number($('padTouchSize').value),
    touchOpacity: Number($('padTouchOpacity').value),
  });
  const forGame = $('padGameOnly').checked && currentGame && currentGame.system === system;
  if (forGame) await store.setSetting(`pad:game:${currentGame.key}`, cfg);
  else {
    await store.setSetting(`pad:${system}`, cfg);
    if (currentGame && currentGame.system === system) await store.setSetting(`pad:game:${currentGame.key}`, null);
  }
  if (currentGame && currentGame.system === system) {
    const control = session.control();
    if (control && control.setPad) control.setPad(cfg);
  }
  await refreshPadUi();
}

function buildPadUi() {
  const sel = clear($('padSystem'));
  for (const sys of Object.values(SYSTEMS)) sel.append(h('option', { value: sys.id }, sys.label));
  const wanted = new URLSearchParams(location.search).get('console');
  if (wanted && SYSTEMS[wanted]) sel.value = wanted;
  const box = clear($('padProfiles'));
  for (const p of Object.values(PAD_PROFILES)) {
    const id = `pad-${p.id}`;
    box.append(h('label', { class: 'choice', for: id },
      h('input', { type: 'radio', name: 'padProfile', id, value: p.id, onchange: () => savePadUi().catch((err) => setStatus(err.message, 'error')) }),
      h('span', {}, h('strong', {}, p.label), h('br'), h('small', { class: 'muted' }, p.description))));
  }
  sel.addEventListener('change', () => refreshPadUi());
  $('padGameOnly').addEventListener('change', () => savePadUi().catch((err) => setStatus(err.message, 'error')));
  for (const id of ['padDeadzone', 'padTouchSize', 'padTouchOpacity', 'padHideTouch']) {
    $(id).addEventListener('change', () => savePadUi().catch((err) => setStatus(err.message, 'error')));
  }
  $('padReset').addEventListener('click', async () => {
    const system = padUiSystem();
    await store.setSetting(`pad:${system}`, null);
    if (currentGame && currentGame.system === system) await store.setSetting(`pad:game:${currentGame.key}`, null);
    const { settings: cfg } = await padSettingsFor(system, currentGame?.system === system ? currentGame.key : null);
    const control = session.control();
    if (control && control.setPad && currentGame?.system === system) control.setPad(cfg);
    await refreshPadUi();
    setStatus(`Réglages de manette par défaut rétablis pour ${SYSTEMS[system].label}.`, 'ok');
  });
  $('padMove').addEventListener('click', async () => {
    const control = session.control();
    if (!control || !control.editTouch || !currentGame) { setStatus('Ouvre et démarre un jeu sur l’écran tactile pour déplacer ses boutons.', 'warn'); return; }
    setStatus('Glisse les boutons dans la fenêtre du jeu, puis touche « Terminé ».');
    $('screen').scrollIntoView({ block: 'center' });
    try {
      const offsets = await control.editTouch();
      const system = currentGame.system;
      const forGame = $('padGameOnly').checked;
      const base = (await padSettingsFor(system, forGame ? currentGame.key : null)).settings;
      await store.setSetting(forGame ? `pad:game:${currentGame.key}` : `pad:${system}`, normalizePad({ ...base, touchOffsets: offsets }));
      setStatus(`Position des boutons enregistrée pour ${forGame ? 'ce jeu' : SYSTEMS[system].label}.`, 'ok');
    } catch (err) { setStatus(err.message, 'error'); }
  });
  window.addEventListener('gamepadconnected', (e) => showPadStatus(e.gamepad.id));
  window.addEventListener('gamepaddisconnected', () => showPadStatus(null));
}

function showPadStatus(id) {
  $('padStatus').textContent = id
    ? `Manette reconnue : ${id}`
    : 'Aucune manette détectée. Branche-la ou appuie sur un de ses boutons.';
  $('padStatus').dataset.kind = id ? 'ok' : '';
}

// --- Performance PSP ---------------------------------------------------------------------
// « pspPerf » pour toute la console, « pspPerf:<clé du jeu> » pour un seul jeu (prioritaire).
async function pspPerformanceFor(key) {
  const game = key ? await store.getSetting(`pspPerf:${key}`, null) : null;
  if (game && PSP_PERFORMANCE[game]) return { preset: game, scope: 'jeu' };
  const all = await store.getSetting('pspPerf', 'qualite');
  return { preset: PSP_PERFORMANCE[all] ? all : 'qualite', scope: 'console' };
}

async function refreshPerfUi() {
  const game = currentGame?.system === 'psp' ? currentGame : null;
  const { preset, scope } = await pspPerformanceFor(game?.key);
  for (const input of document.querySelectorAll('input[name=pspPerf]')) input.checked = input.value === preset;
  $('pspPerfGame').disabled = !game;
  $('pspPerfGame').checked = scope === 'jeu';
}

async function savePerf() {
  const preset = document.querySelector('input[name=pspPerf]:checked')?.value || 'qualite';
  const game = currentGame?.system === 'psp' ? currentGame : null;
  if (game && $('pspPerfGame').checked) await store.setSetting(`pspPerf:${game.key}`, preset);
  else {
    await store.setSetting('pspPerf', preset);
    if (game) await store.setSetting(`pspPerf:${game.key}`, null);
  }
  setStatus(`Performance PSP « ${PSP_PERFORMANCE[preset].label} » enregistrée${game && $('pspPerfGame').checked ? ' pour ce jeu' : ''} : ferme puis rouvre le jeu pour l’appliquer.`, 'ok');
  await refreshPerfUi();
}

function buildPerfUi() {
  const box = clear($('pspPerf'));
  for (const p of Object.values(PSP_PERFORMANCE)) {
    const id = `pspPerf-${p.id}`;
    box.append(h('label', { class: 'choice', for: id },
      h('input', { type: 'radio', name: 'pspPerf', id, value: p.id, onchange: () => savePerf().catch((err) => setStatus(err.message, 'error')) }),
      h('span', {}, h('strong', {}, p.label), h('br'), h('small', { class: 'muted' }, p.description))));
  }
  $('pspPerfGame').addEventListener('change', () => savePerf().catch((err) => setStatus(err.message, 'error')));
}

// --- Réglages ---------------------------------------------------------------------
async function loadSettings() {
  // Ancien réglage « positionnel » (0.3) : il devient le profil Authentique par défaut.
  settings.legacyPositional = (await store.getSetting('controlProfile', 'defaut')) === 'positionnel';
  settings.dsCore = await store.getSetting('dsCore', 'desmume2015');
  favorites = new Set(await store.getSetting('favorites', []));
  if (!DS_CORES[settings.dsCore]) settings.dsCore = 'desmume2015';
}

function buildSettingsUi() {
  buildPadUi();
  const dc = clear($('dsCores'));
  for (const [id, spec] of Object.entries(DS_CORES)) {
    const rid = `ds-${id}`;
    dc.append(h('label', { class: 'choice', for: rid },
      h('input', { type: 'radio', name: 'ds', id: rid, checked: settings.dsCore === id, onchange: async () => { settings.dsCore = id; await store.setSetting('dsCore', id); } }),
      spec.label));
  }
}

async function refreshEngineInfo() {
  $('engineInfo').textContent = engineLocal
    ? `Moteur local présent, chargeur attendu : EmulatorJS ${ENGINE_VERSION}. Hors ligne seulement si tous les fichiers requis sont installés. Secours : CDN versionné.`
    : `Moteur distant EmulatorJS ${ENGINE_VERSION} (CDN). Ce code tiers accède à la ROM et au stockage du navigateur. Voir LISEZMOI.md pour le mode local.`;
  $('engineInfo').textContent += ` PSP : ${PSP_ENGINE.label} (cœur ppsspp plus rapide, version non figée, sans contrôle d’intégrité), puis ${ENGINE_VERSION} en secours.`;
  const bios = await store.getBios('nds-bios');
  $('biosState').textContent = bios ? `BIOS DS importé (${fmtSize(bios.bytes.length)}).` : 'Aucun BIOS DS importé (inutile avec DeSmuME).';
}

async function detectEngine() {
  enginePaths = [];
  try {
    const r = await fetch('emulatorjs/data/loader.js', { method: 'HEAD', cache: 'no-store' });
    if (r.ok) { engineLocal = true; enginePaths.push({ path: 'emulatorjs/data/', integrity: LOADER_INTEGRITY }); }
  } catch { /* pas de moteur local */ }
  enginePaths.push(REMOTE_ENGINE);
}

// --- Onglets et événements --------------------------------------------------------
function initTabs() {
  const tabs = [...document.querySelectorAll('[role=tab]')];
  const show = (tab) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    }
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => show(t));
    t.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        show(next);
        next.focus();
      }
    });
  });
  show(tabs[0]);
}

function initEvents() {
  // Android : Chrome traduit « accept » en types MIME et grise les extensions inconnues (.nes, .sfc…).
  // Sur écran tactile on laisse tout choisir ; le fichier est de toute façon vérifié après le choix.
  if (window.matchMedia && matchMedia('(pointer: coarse)').matches) {
    for (const id of ['romInput', 'catFiles', 'saveImport', 'stateImport', 'cheatFiles']) $(id).removeAttribute('accept');
    $('catFolderBtn').title = 'Sur Android, le choix d’un dossier peut être indisponible : utilise « Choisir des fichiers » (sélection multiple).';
  }
  const input = $('romInput');
  input.addEventListener('change', () => { openFile(input.files[0]); input.value = ''; });
  $('pickGame').addEventListener('click', () => input.click());
  $('changeGame').addEventListener('click', () => input.click());
  $('cheatFolderBtn').addEventListener('click', () => $('cheatFolder').click());
  $('cheatFilesBtn').addEventListener('click', () => $('cheatFiles').click());
  $('biosBtn').addEventListener('click', () => $('biosInput').click());
  $('closeGame').addEventListener('click', async () => {
    if (confirm('Fermer le jeu en cours ? Les sauvegardes restent conservées. Les progrès non enregistrés dans le jeu seront perdus.')) {
      await session.stop();
      currentGame = null;
      await refreshSavePanel();
      await refreshCheatPanel();
      await refreshCodePanel();
      await refreshStatePanel();
    }
  });
  for (const ev of ['dragenter', 'dragover']) window.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
  for (const ev of ['dragleave', 'drop']) window.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.remove('dragging'); });
  window.addEventListener('drop', (e) => {
    const files = e.dataTransfer ? e.dataTransfer.files : [];
    // Plusieurs fichiers déposés : ils vont au catalogue ; un seul : il est ouvert directement.
    if (files.length > 1) { importCatalog(files); document.getElementById('tabCatalog').click(); }
    else if (files[0]) openFile(files[0]);
  });
  window.addEventListener('unhandledrejection', (event) => { event.preventDefault(); console.error(event.reason); setStatus(`Opération interrompue : ${event.reason?.message || event.reason}`, 'error'); });
  window.addEventListener('error', (event) => journal('erreur page', event.message || String(event.error || '')));
  $('exportLog').addEventListener('click', () => {
    const g = currentGame;
    const text = journalText({ 'Jeu en cours': g ? `${g.title} (${g.systemLabel}, ${g.coreLabel}, ${g.fileName})` : 'aucun', 'Moteur': session.control()?.enginePath || enginePaths.map((p) => p.path).join(' puis ') });
    download(`emuperso-journal-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`, new TextEncoder().encode(text));
    setStatus('Journal exporté : envoie ce fichier pour que le problème soit analysé (il ne contient aucun jeu ni aucune sauvegarde).', 'ok');
  });
  window.addEventListener('beforeunload', (e) => { if (session.hasActiveGame) { e.preventDefault(); e.returnValue = ''; } });

  $('cheatFolder').addEventListener('change', (e) => { importCheatFiles(e.target.files); e.target.value = ''; });
  $('cheatFiles').addEventListener('change', (e) => { importCheatFiles(e.target.files); e.target.value = ''; });
  $('cheatClear').addEventListener('click', async () => {
    if (confirm('Supprimer tous les fichiers de codes importés ? Tes sauvegardes ne sont pas touchées.')) {
      await store.clearCheatFiles();
      await refreshCheatPanel();
    }
  });
  $('cheatSearch').addEventListener('input', () => refreshCheatPanel());
  $('biosInput').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    try {
      if (f) {
        if (f.size > MAX_BIOS_ZIP) throw new Error('ZIP BIOS trop gros (maximum 2 Mio).');
        const bytes = new Uint8Array(await f.arrayBuffer());
        await validateDsBios(bytes);
        await store.setBios('nds-bios', bytes);
        await refreshEngineInfo();
        setStatus('Structure et CRC du BIOS DS vérifiés ; authenticité non attestée.', 'ok');
      }
    } catch (err) { setStatus(`Import BIOS refusé : ${err.message || err}`, 'error'); }
    finally { e.target.value = ''; }
  });
  $('biosClear').addEventListener('click', async () => { await store.deleteBios('nds-bios'); await refreshEngineInfo(); });

  // Codes du jeu
  $('codeValue').addEventListener('input', checkCodeInput);
  $('codeAddForm').addEventListener('submit', (e) => { e.preventDefault(); addCode().catch((err) => setStatus(err.message, 'error')); });
  $('codeRestart').addEventListener('click', () => {
    const control = session.control();
    if (!control) return;
    if (currentGame && pspNightlyFragile(currentGame, control)) { setStatus('Redémarrage bloqué : il fige le moteur PSP rapide (bug du moteur nightly). Ferme le jeu puis rouvre-le.', 'warn'); return; }
    if (confirm('Redémarrer le jeu ? Les progrès non enregistrés seront perdus. Les codes actifs restent actifs.')) control.restart();
  });

  // Sauvegardes et états
  $('saveExport').addEventListener('click', () => exportCurrentSave().catch((err) => setStatus(err.message, 'error')));
  $('saveImportBtn').addEventListener('click', () => $('saveImport').click());
  $('saveImport').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importSave(f).catch((err) => setStatus(`Import refusé : ${err.message}`, 'error')); });
  $('stateImport').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importState(f).catch((err) => setStatus(`Import refusé : ${err.message}`, 'error')); });
  $('persistBtn').addEventListener('click', async () => {
    const ok = await navigator.storage.persist();
    setStatus(ok ? 'Stockage persistant accordé par le navigateur.' : 'Le navigateur a refusé le stockage persistant (Chrome l’accorde souvent après plusieurs visites ou une installation).', ok ? 'ok' : 'warn');
    await refreshStorageInfo();
  });

  // Catalogue
  $('catFolderBtn').addEventListener('click', () => $('catFolder').click());
  $('catFilesBtn').addEventListener('click', () => $('catFiles').click());
  for (const id of ['catFolder', 'catFiles']) {
    $(id).addEventListener('change', (e) => { if (e.target.files.length) importCatalog(e.target.files); e.target.value = ''; });
  }
  let filterTimer;
  $('catSearch').addEventListener('input', () => { clearTimeout(filterTimer); filterTimer = setTimeout(applyCatalogFilters, 120); });
  for (const id of ['catSystem', 'catRegion', 'catFrench', 'catKind', 'catHideBad', 'catHideDup', 'catFav']) $(id).addEventListener('change', applyCatalogFilters);
  let scrollFrame = 0;
  $('catList').addEventListener('scroll', () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; renderCatalogRows(); }); }, { passive: true });
}

async function main() {
  try { await store.a.open(); }
  catch {
    store = new Store(new MemoryAdapter());
    storageNote = "Stockage local indisponible : historique, codes et copies de sécurité temporaires pour cette session. Exporte tes sauvegardes.";
  }
  await loadSettings();
  await store.reserveHistoricalEngineIds();
  await detectEngine();
  initTabs();
  buildSettingsUi();
  initEvents();
  buildPerfUi();
  applyConsoleFromUrl();
  applyCatalogFilters();
  render(session.snapshot());
  if (storageNote) setStatus(storageNote, 'warn');
  await refreshEngineInfo();
  await refreshSavePanel();
  await refreshCheatPanel();
  await refreshCodePanel();
  await refreshStatePanel();
  await refreshStorageInfo().catch(() => {});
  document.body.dataset.ready = 'true'; // lanceur initialisé (utile aux tests sur un réseau lent)
}
main().catch((err) => { console.error(err); setStatus(`Erreur au démarrage : ${err.message || err}`, 'error'); });
