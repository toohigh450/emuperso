// Interface : une fente, un seul jeu actif, saveurs de sauvegarde et de codes visibles et honnêtes.
import { SYSTEMS, DS_CORES, ROM_EXTENSIONS, LOOSE_EXTENSIONS, analyzeRom, extensionOf, stemOf } from './systems.mjs';
import { isZip, extractFirst, listCandidates } from './zip.mjs';
import { fingerprint, saveSpaceId, gameKey, ejsGameName, legacyEjsGameName, slug, toHex } from './hash.mjs';
import { Store, IdbAdapter, MemoryAdapter, CHEAT_LIMITS } from './store.mjs';
import { parseCht, classifyCheatFiles, linkedCheatValid, normalizeName, deviceLabel, inferSystemFromPath, toEjsCheats } from './cheats.mjs';
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
const panelTickets = { saves: 0, history: 0, cheats: 0 };
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
    for (const id of ['saveMirror', 'history', 'cheatInfo', 'cheatMatches', 'cheatSearchResults']) clear($(id));
    Promise.all([refreshSavePanel(), refreshCheatPanel()]).catch(err => {
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
  if (extensionOf(file.name) === '7z') throw new Error('Archive .7z non prise en charge : extrais une ROM avec 7-Zip dans un dossier séparé, puis ouvre-la ici.');
  if (extensionOf(file.name) === 'torrent') throw new Error('Un .torrent n’est pas une ROM. Ouvre un fichier de jeu complet (.gb, .gbc, .gba, .nds ou .zip).');
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
  const cheats = await cheatsForGame(analysis, key, rom.name, fp.hex);
  const spec = SYSTEMS[analysis.system];

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
    regionText: [analysis.region !== 'inconnue' ? analysis.region : null, analysis.code || null, `version ${analysis.version}`].filter(Boolean).join(', '),
    warnings: analysis.warnings.concat(rom.note ? [rom.note] : []),
  };

  const defaultControls = buildDefaultControls(settings.controlProfile);
  const boot = {
    enginePaths,
    // Les cœurs se servent aussi de l'extension : transmettre celle détectée,
    // même si le fichier d'origine était .bin, .srl ou mal nommé.
    rom: { name: `${stemOf(rom.name)}.${analysis.system}`, bytes: rom.bytes },
    bios: core.bios,
    ejs: {
      EJS_core: core.ejsCore,
      EJS_gameName: engineName,
      EJS_gameID: await store.engineNumericId(spaceId),
      EJS_cheats: toEjsCheats(cheats),
      EJS_color: '#E0457B',
      EJS_backgroundColor: '#1b1940',
      EJS_alignStartButton: 'center',
      EJS_startButtonName: 'Démarrer',
      EJS_threads: false,
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

// --- Réglages ---------------------------------------------------------------------
async function loadSettings() {
  settings.controlProfile = await store.getSetting('controlProfile', 'defaut');
  settings.dsCore = await store.getSetting('dsCore', 'desmume2015');
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
    }
  });
  for (const ev of ['dragenter', 'dragover']) window.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
  for (const ev of ['dragleave', 'drop']) window.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.remove('dragging'); });
  window.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) openFile(f); });
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
  render(session.snapshot());
  if (storageNote) setStatus(storageNote, 'warn');
  await refreshEngineInfo();
  await refreshSavePanel();
  await refreshCheatPanel();
}
main().catch((err) => { console.error(err); setStatus(`Erreur au démarrage : ${err.message || err}`, 'error'); });
