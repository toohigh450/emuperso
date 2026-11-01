// Interface : une fente, un seul jeu actif, saveurs de sauvegarde et de codes visibles et honnêtes.
import { SYSTEMS, DS_CORES, ROM_EXTENSIONS, LOOSE_EXTENSIONS, analyzeRom, extensionOf, stemOf } from './systems.mjs';
import { isZip, extractFirst, listCandidates } from './zip.mjs';
import { fingerprint, saveSpaceId, gameKey, numericId, ejsGameName, legacyEjsGameName, slug, toHex } from './hash.mjs';
import { Store, IdbAdapter, MemoryAdapter } from './store.mjs';
import { parseCht, classifyCheatFiles, normalizeName, deviceLabel, inferSystemFromPath, toEjsCheats } from './cheats.mjs';
import { CONTROL_PROFILES, buildDefaultControls } from './controls.mjs';
import { Session } from './session.mjs';
import { createBrowserHost } from './player-host.mjs';

const $ = (id) => document.getElementById(id);
const CDN_PATHS = [
  'https://cdn.emulatorjs.org/stable/data/',
];

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
  currentGame = snap.game || null;
  const active = snap.state !== 'idle' && snap.game;
  $('slotEmpty').hidden = !!active;
  $('slotGame').hidden = !active;
  $('screenEmpty').hidden = !!active;
  document.body.dataset.state = snap.state;
  if (snap.game) {
    const g = snap.game;
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
  if (file.size > 1024 * 1024 * 1024 + 16 * 1024 * 1024) throw new Error('Fichier trop gros pour le chargement en mémoire (maximum 1 Gio + 16 Mio).');
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
    const r = await extractFirst(bytes, accept, { name: selected });
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
    if (f && (!f.identityDeclared || f.romSha256 === hex)) chosen.push(f);
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
      'Un seul jeu est actif à la fois. Les sauvegardes du jeu en cours restent conservées. Si tu as des progrès non enregistrés dans le jeu, annule et enregistre-les d\'abord.'
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
    headerOk: analysis.headerOk,
    coreId: core.coreId,
    coreLabel: core.label,
    regionText: [analysis.region !== 'inconnue' ? analysis.region : null, analysis.code || null, `version ${analysis.version}`].filter(Boolean).join(', '),
    warnings: analysis.warnings.concat(rom.note ? [rom.note] : []),
  };
  currentGame = game;

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
      EJS_gameID: numericId(spaceId),
      EJS_cheats: toEjsCheats(cheats),
      EJS_color: '#E0457B',
      EJS_backgroundColor: '#1b1940',
      EJS_alignStartButton: 'center',
      EJS_startButtonName: 'Démarrer',
      EJS_threads: false,
      ...(defaultControls ? { EJS_defaultControls: defaultControls } : {}),
    },
    onSaveUpdate: (e) => mirrorSave(spaceId, e),
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
  renderWarnings(game);
  const started = await session.start(game, boot);
  if (started) {
    await refreshCheatPanel();
    await refreshSavePanel();
  }
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
    setStatus("La copie de sécurité de la sauvegarde a échoué : la sauvegarde du moteur n'est pas touchée.", 'error');
  }
}

async function refreshSavePanel() {
  const game = currentGame;
  const box = clear($('saveMirror'));
  if (!game) {
    box.append(h('p', { class: 'muted' }, 'Ouvre un jeu pour voir ses sauvegardes.'));
  } else {
    const info = await store.mirrorInfo(game.spaceId);
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
  await refreshHistory();
}

async function refreshHistory() {
  const box = clear($('history'));
  const games = (await store.listGames()).slice(0, 12);
  if (games.length === 0) {
    box.append(h('p', { class: 'muted' }, 'Aucun jeu ouvert pour le moment.'));
    return;
  }
  const list = h('ul', { class: 'rows' });
  for (const g of games) {
    list.append(h('li', {}, h('span', {}, `${g.title} (${SYSTEMS[g.system] ? SYSTEMS[g.system].label : g.system}), ${fmtDate(g.lastPlayed)}`)));
  }
  box.append(list);
}

// --- Codes ------------------------------------------------------------------------
async function refreshCheatPanel() {
  const info = clear($('cheatInfo'));
  const total = await store.countCheatFiles();
  info.append(h('p', {}, total === 0 ? 'Aucun fichier de codes importé.' : `${total} fichier(s) de codes importé(s).`));
  const list = clear($('cheatMatches'));
  clear($('cheatSearchResults'));
  if (!currentGame || total === 0) return;
  const files = await store.listCheatFiles(currentGame.system);
  const { identified, exact, sameTitle } = classifyCheatFiles(currentGame.fileName, currentGame.hex, files);
  const link = await store.getCheatLink(currentGame.key);

  if (link) {
    list.append(h('p', {}, `Association enregistrée pour cette ROM : ${link.name}. S'applique au prochain lancement.`));
    if (!link.romSha256) list.append(h('p', { class: 'warn' }, 'Ancienne association : confirme-la à nouveau pour identifier cette ROM par son empreinte complète.'));
    list.append(h('button', { class: 'btn small', onclick: async () => { await store.setCheatLink(currentGame.key, null); await refreshCheatPanel(); } }, 'Retirer ce choix'));
  }
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
  const out = clear($('cheatSearchResults'));
  if (q.length >= 2) {
    const hits = files.filter((f) => normalizeName(f.name).includes(q)).slice(0, 20);
    if (hits.length === 0) out.append(h('p', { class: 'muted' }, 'Aucun résultat.'));
    for (const f of hits) {
      out.append(h('div', { class: 'row' }, h('span', {}, f.name), h('button', { class: 'btn small', onclick: async () => {
        await associateCheat(f);
      } }, 'Associer')));
    }
  } else out.replaceChildren();
}

async function associateCheat(file) {
  const game = currentGame;
  if (!game) return;
  if (file.identityDeclared && file.romSha256 !== game.hex) {
    setStatus("Ce fichier déclare une empreinte différente ou invalide : association refusée.", 'error');
    return;
  }
  if (!confirm(`Associer « ${file.name} » à « ${game.fileName} » ?\nVérifie la région, la révision et les hacks : le nom ne suffit pas à garantir des codes compatibles.\nCe choix sera retenu pour les octets de cette ROM et prendra effet au prochain lancement.`)) return;
  await store.setCheatLink(game.key, { path: file.path, name: file.name, romSha256: game.hex });
  $('cheatSearch').value = '';
  await refreshCheatPanel();
}

async function importCheatFiles(fileList) {
  const files = [...fileList].filter((f) => /\.cht$/i.test(f.name));
  if (files.length === 0) {
    setStatus('Aucun fichier .cht dans la sélection.', 'error');
    return;
  }
  let imported = 0;
  let skipped = 0;
  for (const f of files) {
    const path = f.webkitRelativePath || f.name;
    const system = inferSystemFromPath(path) || (currentGame ? currentGame.system : null);
    if (!system) { skipped++; continue; }
    const text = await f.text();
    if (!parseCht(text).length) { skipped++; continue; }
    await store.importCheatFile({ system, path, name: f.name, text });
    imported++;
  }
  setStatus(
    `${imported} fichier(s) de codes importé(s)` + (skipped ? `, ${skipped} ignoré(s) (console inconnue ou aucun code lisible).` : '.'),
    skipped ? 'warn' : 'ok'
  );
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
    ? 'Moteur local trouvé dans le dossier emulatorjs (fonctionne hors ligne). Sources de secours : Internet.'
    : "Moteur chargé depuis Internet (cdn.emulatorjs.org). Pour jouer hors ligne, voir LISEZMOI.md.";
  const bios = await store.getBios('nds-bios');
  $('biosState').textContent = bios ? `BIOS DS importé (${fmtSize(bios.bytes.length)}).` : 'Aucun BIOS DS importé (inutile avec DeSmuME).';
}

async function detectEngine() {
  enginePaths = [];
  try {
    const r = await fetch('emulatorjs/data/loader.js', { method: 'HEAD', cache: 'no-store' });
    if (r.ok) { engineLocal = true; enginePaths.push('emulatorjs/data/'); }
  } catch { /* pas de moteur local */ }
  enginePaths.push(...CDN_PATHS);
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
    if (f) {
      await store.setBios('nds-bios', new Uint8Array(await f.arrayBuffer()));
      await refreshEngineInfo();
    }
    e.target.value = '';
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
