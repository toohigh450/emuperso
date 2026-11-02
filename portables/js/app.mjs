// Interface : une fente, un seul jeu actif, saveurs de sauvegarde et de codes visibles et honnêtes.
import { SYSTEMS, DS_CORES, ROM_EXTENSIONS, LOOSE_EXTENSIONS, analyzeRom, extensionOf, stemOf, engineExtension } from './systems.mjs';
import { parseCheatCode, describeCode, CODE_FORMATS } from './codes.mjs';
import { parseRomName } from './romnames.mjs';
import { buildCatalog, filterCatalog, visibleWindow } from './catalog.mjs';
import { isZip, extractFirst, listCandidates } from './zip.mjs';
import { fingerprint, saveSpaceId, gameKey, ejsGameName, legacyEjsGameName, slug, toHex } from './hash.mjs';
import { Store, IdbAdapter, MemoryAdapter, CHEAT_LIMITS, STATE_SLOTS } from './store.mjs';
import { parseCht, classifyCheatFiles, linkedCheatValid, normalizeName, deviceLabel, inferSystemFromPath } from './cheats.mjs';
import { CONTROL_PROFILES, buildDefaultControls } from './controls.mjs';
import { Session } from './session.mjs';
import { createBrowserHost } from './player-host.mjs';

import { memoryPlan, MAX_INPUT_BYTES, MAX_ROM_BYTES, MiB } from './resources.mjs';
import { validateDsBios, MAX_BIOS_ZIP } from './bios.mjs';
import { REMOTE_ENGINE, LOADER_INTEGRITY, ENGINE_VERSION } from './engine.mjs';

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
let settings = { controlProfile: 'defaut', dsCore: 'desmume2015' };

// --- Utilitaires d'affichage -------------------------------------------------------
function setStatus(text, kind = '') {
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
    for (const panel of Object.keys(panelTickets)) panelTickets[panel]++;
    for (const id of ['saveMirror', 'history', 'cheatInfo', 'cheatMatches', 'cheatSearchResults', 'codeList', 'stateSlots']) clear($(id));
    Promise.all([refreshSavePanel(), refreshCheatPanel(), refreshCodePanel(), refreshStatePanel()]).catch(err => {
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
  if (extensionOf(file.name) === '7z') throw new Error('Archive .7z non prise en charge dans le navigateur : extrais la ROM voulue avec 7-Zip dans un dossier séparé (sans toucher à l’original), puis ouvre-la ici. Les .zip sont acceptés.');
  if (extensionOf(file.name) === 'rar') throw new Error('Archive .rar non prise en charge : extrais la ROM avec 7-Zip, puis ouvre-la ici. Les .zip sont acceptés.');
  if (extensionOf(file.name) === 'torrent') throw new Error('Un .torrent n’est pas une ROM. Ouvre un fichier de jeu complet (.nes, .sfc, .smc, .gb, .gbc, .gba, .nds ou .zip).');
  if (file.size > MAX_INPUT_BYTES) throw new Error('Fichier trop gros pour cette application (maximum 512 Mio + 16 Mio).');
  const options = { deviceMemory: navigator.deviceMemory, activeBytes: currentGame?.romBytes || 0 };
  let warned = false;
  const checkMemory = (size, archiveBytes = 0) => {
    const plan = memoryPlan(size, { ...options, archiveBytes });
    if (plan.warn && !warned) {
      if (!confirm(`Plafond ROM : 512 Mio. Estimation : ${Math.ceil(plan.estimated / MiB)} Mio ; budget prudent : ${Math.floor(plan.budget / MiB)} Mio, sans garantie de RAM disponible. Enregistre et exporte tes progrès avant de continuer. Continuer ?`)) throw new Error('Ouverture annulée.');
      warned = true;
    }
  };
  // Pour un ZIP, son contenu sera contrôlé avant décompression.
  if (extensionOf(file.name) !== 'zip') checkMemory(file.size);
  let name = file.name;
  let bytes = new Uint8Array(await file.arrayBuffer());
  let note = '';
  if (extensionOf(name) === 'zip' || isZip(bytes)) {
    const accept = new Set([...ROM_EXTENSIONS, ...LOOSE_EXTENSIONS]);
    const candidates = listCandidates(bytes, accept);
    let selected;
    if (candidates.length > 1) {
      const answer = prompt('Ce ZIP contient plusieurs jeux. Indique le numéro à ouvrir :\n' + candidates.map((c, i) => `${i + 1}. ${c.name}`).join('\n'), '1');
      if (answer === null) throw new Error('Ouverture annulée.');
      const index = Number(answer) - 1;
      if (!Number.isInteger(index) || !candidates[index]) throw new Error('Numéro de jeu invalide.');
      selected = candidates[index].name;
    }
    const candidate = selected ? candidates.find(c => c.name === selected) : candidates[0];
    if (candidate) checkMemory(candidate.size, bytes.length);
    const r = await extractFirst(bytes, accept, { name: selected, maxBytes: MAX_ROM_BYTES });
    name = r.name;
    bytes = r.bytes;
    if (r.otherCandidates > 0) note = `Jeu choisi dans le ZIP : ${name}.`;
  }
  return { name, bytes, note };
}

async function resolveCore(system) {
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
  const stored = await store.getCodes(key);
  const same = (e, c) => e.origin === 'fichier' && e.code === c.code && e.name === c.desc;
  // Les codes d'un fichier dont l'association a été retirée ou modifiée disparaissent avec elle.
  const kept = stored.filter((e) => e.origin !== 'fichier' || fromFiles.some((c) => same(e, c)));
  for (const c of fromFiles) {
    if (!kept.some((e) => same(e, c))) kept.push({ id: newCodeId(), name: c.desc, code: c.code, enabled: false, origin: 'fichier' });
  }
  if (kept.length !== stored.length || kept.some((e, i) => e !== stored[i])) await store.setCodes(key, kept);
  return kept;
}
function newCodeId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function gameDetails(analysis) {
  const parts = [];
  if (analysis.system === 'nes') {
    parts.push(analysis.format, analysis.mapperName);
    if (analysis.battery) parts.push('pile (sauvegarde)');
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

async function openGame(file) {
  setStatus('Lecture du fichier…');
  let rom;
  try {
    rom = await readGameFile(file);
  } catch (err) {
    setStatus(err.message || String(err), 'error');
    return;
  }
  const analysis = analyzeRom(rom.name, rom.bytes);
  if (!analysis.ok) {
    setStatus(analysis.errors.join(' '), 'error');
    return;
  }
  if (session.hasActiveGame) {
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
  const fp = await fingerprint(rom.bytes);
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
    romStem: stemOf(rom.name),
    hex: fp.hex,
    hashAlgo: fp.algo,
    romBytes: rom.bytes.length,
    headerOk: analysis.headerOk,
    coreId: core.coreId,
    coreLabel: core.label,
    regionText: [region, analysis.code || null, analysis.system === 'nes' ? null : `version ${analysis.version}`].filter(Boolean).join(', ') || 'inconnue',
    details: gameDetails(analysis),
    warnings: analysis.warnings.concat(rom.note ? [rom.note] : []),
  };

  const defaultControls = buildDefaultControls(settings.controlProfile);
  const boot = {
    enginePaths,
    // Les cœurs se servent aussi de l'extension : transmettre celle détectée,
    // même si le fichier d'origine était .bin, .srl ou mal nommé.
    // Le moteur nomme la sauvegarde de cartouche d'après ce nom de fichier. NES/SNES : nom tiré de
    // l'empreinte et du cœur, donc une sauvegarde par jeu, même ROM renommée, jamais partagée entre deux
    // ROM de même nom. GB/GBC/GBA/DS gardent l'ancien nommage pour retrouver les sauvegardes existantes.
    rom: { name: `${['nes', 'snes'].includes(analysis.system) ? ejsGameName(analysis.title, core.coreId, fp.hex) : stemOf(rom.name)}.${engineExtension(analysis)}`, bytes: rom.bytes },
    // Seuls les codes que l'utilisateur a activés partent au moteur (voir player.html).
    codes: codes.filter((c) => c.enabled).map((c) => c.code),
    bios: core.bios,
    ejs: {
      EJS_core: core.ejsCore,
      EJS_gameName: engineName,
      EJS_gameID: await store.engineNumericId(spaceId),
      EJS_color: '#E0457B',
      EJS_backgroundColor: '#1b1940',
      EJS_alignStartButton: 'center',
      EJS_startButtonName: 'Démarrer',
      EJS_threads: false,
      // Sauvegarde de cartouche écrite toutes les 30 s (5 min par défaut dans le moteur).
      EJS_defaultOptions: { 'save-save-interval': '30' },
      ...(defaultControls ? { EJS_defaultControls: defaultControls } : {}),
    },
    onSaveUpdate: (e) => mirrorSave(spaceId, e),
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
    coreId: core.coreId,
    engineTitle,
    engineNamingVersion: legacyNaming ? 1 : 2,
  });
  await session.start(game, boot); // Le rendu déclenche les panneaux sans bloquer le prochain changement.
}

function renderWarnings(game) {
  const box = clear($('gameWarnings'));
  box.hidden = game.warnings.length === 0;
  for (const w of game.warnings) box.append(h('li', {}, w));
}

// --- Sauvegardes ------------------------------------------------------------------
async function mirrorSave(spaceId, e) {
  try {
    const data = e && e.save ? new Uint8Array(e.save) : null;
    if (!data || data.length === 0) return;
    const hash = toHex(await crypto.subtle.digest('SHA-256', data));
    const r = await store.mirrorSave(spaceId, data, hash);
    if (r.changed && currentGame && currentGame.spaceId === spaceId) await refreshSavePanel();
  } catch (err) {
    console.error('Copie miroir impossible', err);
    if (currentGame?.spaceId === spaceId) setStatus("La copie de sécurité de la sauvegarde a échoué : la sauvegarde du moteur n'est pas touchée.", 'error');
  }
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
      box.append(h('p', { class: 'muted' }, "Aucune copie de sécurité pour l'instant. Elle apparaît dès que le moteur détecte un changement de sauvegarde dans le jeu."));
    } else {
      const list = h('ul', { class: 'rows' });
      for (const g of info) {
        list.append(
          h('li', {},
            h('span', {}, `${g.generation === 0 ? 'Dernière' : `Version précédente ${g.generation}`} : ${fmtDate(g.at)}, ${fmtSize(g.size)}`),
            h('button', { class: 'btn small', onclick: async () => {
              const e = await store.getMirrorSave(game.spaceId, g.generation);
              if (e) download(`${slug(game.title)}-${game.coreId}.sav`, e.bytes);
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
  const { identified, exact, sameTitle } = classifyCheatFiles(game.fileName, game.hex, files);
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
  if (exact.length) {
    list.append(h('p', { class: 'warn' }, 'Même nom : région, révision ou hack à vérifier. Confirme une fois ; ton choix sera retenu pour cette ROM même renommée.'));
    list.append(h('ul', { class: 'rows' }, exact.map((f) => h('li', {},
      h('span', {}, f.name),
      h('button', { class: 'btn small', onclick: () => associateCheat(f) }, 'Associer à cette ROM')
    ))));
  } else if (!identified.length && !link) {
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
};

async function refreshCodePanel() {
  const ticket = ++panelTickets.codes;
  const game = currentGame;
  const box = document.createDocumentFragment();
  if (!game) {
    box.append(h('p', { class: 'muted' }, 'Ouvre un jeu pour gérer ses codes.'));
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
  }
  if (ticket !== panelTickets.codes || game !== currentGame) return;
  $('codeList').replaceChildren(box);
  $('codeAddForm').hidden = !game;
}

async function saveCodes(game, mutate) {
  const entries = await store.getCodes(game.key);
  const next = mutate(entries.map((e) => ({ ...e })));
  await store.setCodes(game.key, next);
  if (game === currentGame) applyLiveCodes(next);
  await refreshCodePanel();
}

function applyLiveCodes(entries) {
  const enabled = entries.filter((e) => e.enabled).map((e) => e.code);
  const control = session.control();
  if (!control) { setStatus('Codes enregistrés pour ce jeu ; ils seront appliqués au prochain lancement.', 'ok'); return; }
  try {
    control.setCodes(enabled);
    setStatus(`Codes appliqués au moteur : ${enabled.length} actif(s). Un code retiré peut laisser une valeur en mémoire jusqu’au redémarrage du jeu.`, 'ok');
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
  const existing = await store.getCodes(game.key);
  if (existing.some((e) => e.code === parsed.code)) { report('Ce code existe déjà pour ce jeu.', 'error'); return; }
  await saveCodes(game, (entries) => [...entries, { id: newCodeId(), name: name || parsed.code, code: parsed.code, enabled: false, origin: 'manuel', format: parsed.format }]);
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
  const bytes = control.getSave();
  if (!bytes || bytes.length === 0) { setStatus('Aucune sauvegarde pour ce jeu (pas de pile, ou rien d’enregistré dans le jeu).', 'warn'); return; }
  download(`${slug(game.title)}-${game.system}-${game.coreId}.sav`, bytes);
  setStatus(`Sauvegarde exportée (${fmtSize(bytes.length)}).`, 'ok');
}

async function importSave(file) {
  const game = currentGame;
  const control = session.control();
  if (!game || !control) { setStatus('Lance le jeu avant d’importer une sauvegarde.', 'warn'); return; }
  if (file.size > 4 * 1024 * 1024) { setStatus('Fichier de sauvegarde trop gros (4 Mio maximum).', 'error'); return; }
  if (!confirm(`Remplacer la sauvegarde de « ${game.title} » par « ${file.name} » ?\nLa sauvegarde actuelle est d’abord copiée dans les copies de sécurité. Le jeu redémarre ensuite.`)) return;
  const current = control.getSave();
  if (current && current.length) await mirrorSave(game.spaceId, { save: current });
  const bytes = new Uint8Array(await file.arrayBuffer());
  control.importSave(bytes);
  setStatus(`Sauvegarde importée (${fmtSize(bytes.length)}) ; jeu redémarré. L’ancienne reste dans les copies de sécurité.`, 'ok');
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

async function loadState(game, slot, previous = false) {
  const control = session.control();
  if (!control || game !== currentGame) { setStatus('Lance le jeu avant de charger un état.', 'warn'); return; }
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
          e.ext === '7z' ? '7z : à extraire' : '',
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

// --- Réglages ---------------------------------------------------------------------
async function loadSettings() {
  settings.controlProfile = await store.getSetting('controlProfile', 'defaut');
  settings.dsCore = await store.getSetting('dsCore', 'desmume2015');
  favorites = new Set(await store.getSetting('favorites', []));
  if (!CONTROL_PROFILES[settings.controlProfile]) settings.controlProfile = 'defaut';
  if (!DS_CORES[settings.dsCore]) settings.dsCore = 'desmume2015';
}

function buildSettingsUi() {
  const cp = clear($('controlProfiles'));
  for (const p of Object.values(CONTROL_PROFILES)) {
    const id = `cp-${p.id}`;
    cp.append(h('label', { class: 'choice', for: id },
      h('input', { type: 'radio', name: 'cp', id, checked: settings.controlProfile === p.id, onchange: async () => { settings.controlProfile = p.id; await store.setSetting('controlProfile', p.id); } }),
      p.label));
  }
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
}
main().catch((err) => { console.error(err); setStatus(`Erreur au démarrage : ${err.message || err}`, 'error'); });
