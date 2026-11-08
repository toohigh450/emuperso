// SPDX-License-Identifier: MIT
// Contrôleur de cheats EMUPERSO PS1 (RC-1.9) — extrait de app.js.
//
// Objectif : toute la logique d'état des cheats vit ici, sans DOM ni variable
// globale, pour que les tests exécutent le VRAI code (et plus une réplique).
//
// Règle fondamentale : l'état affiché reflète TOUJOURS l'état réel du moteur.
//  - un cheat n'est 'applied' qu'après un setCheats() réussi ;
//  - tout échec restaure l'état JS puis resynchronise le moteur ; si la
//    resynchronisation échoue aussi, l'état est déclaré INCERTAIN (engineSync
//    = 'unknown') et toute nouvelle activation est refusée jusqu'à résolution ;
//  - une confirmation régionale ne vaut que pour l'édition affichée ;
//  - changer de jeu ou d'édition repart d'un état vide AVANT tout appel asynchrone ;
//  - les opérations sont sérialisées (file d'attente) et les opérations d'une
//    session périmée sont abandonnées (changements rapides, sessions multiples).

export const CHEAT_STATE = Object.freeze({ OFF: 'off', PENDING: 'pending', APPLIED: 'applied' });
const ALL_REJECTED = 'Aucun de ces codes n’est exécutable par PCSX ReARMed (formats non pris en charge, raison indiquée sur chaque ligne).';
const STALE = Object.freeze({ ok: false, stale: true });

// --- Utilitaires de codes (déplacés depuis app.js) ---
export const lines = code => String(code).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
// P1 cheats (mandat RC-1.13) : un code n'est accepté que s'il est EXÉCUTABLE tel quel par
// PCSX ReARMed, pas seulement bien formé. Source : libpcsxcore/cheat.h et ApplyCheats()
// de libretro/pcsx_rearmed. AddCheat() lit chaque instruction en « %x %x » et range la
// valeur dans un uint16_t (une valeur 32 bits est tronquée sans message) ; ApplyCheats()
// ignore sans erreur tout type absent de cette liste — le reste du code s'appliquerait
// alors seul, sans ses conditions.
export const PCSX_TYPES = new Set(['30', '80', '10', '11', '1F', '20', '21', '50', 'C2',
  'D0', 'D1', 'D2', 'D3', 'D4', 'E0', 'E1', 'E2', 'E3']);
const DATA_NEXT = new Set(['50', 'C2']);   // slide / copie : l'instruction suivante est une donnée
const shorten = s => (s.length > 60 ? s.slice(0, 57) + '…' : s);
/** Verdict d'un code : { ok, format, reason } — reason est null si le code est accepté. */
export function codeSupport(code, source = null) {
  const raw = String(code ?? '').trim();
  if (source === 'Xploder' || /^\$/.test(raw)) return { ok: false, format: 'Xploder', reason: 'Code Xploder (chiffré) : PCSX ReARMed ne lit que les codes en clair au format GameShark.' };
  const l = lines(raw);
  const label = source && source !== 'Unknown' ? source : 'GameShark';
  if (!l.length) return { ok: false, format: label, reason: 'Code vide.' };
  if (l.length > 64) return { ok: false, format: label, reason: `Code de ${l.length} lignes : 64 au plus.` };
  const pairs = [];
  for (const line of l) {
    const tokens = line.split(/\s+/);
    for (let i = 0; i < tokens.length; i += 2) {
      const [addr, value = ''] = [tokens[i], tokens[i + 1]];
      if (/^[0-9a-f]{8}$/i.test(addr) && /^[0-9a-f]{8}$/i.test(value)) {
        return { ok: false, format: source === 'DuckStation' ? 'DuckStation (étendu)' : 'étendu 32 bits',
          reason: `Valeur 32 bits « ${addr} ${value} » : PCSX ReARMed ne garde que 16 bits et la tronquerait.` };
      }
      if (!/^[0-9a-f]{8}$/i.test(addr) || !/^[0-9a-f]{4}$/i.test(value)) {
        return { ok: false, format: label, reason: `Instruction non conforme au format « XXXXXXXX YYYY » : « ${shorten(line)} ».` };
      }
      pairs.push(addr.slice(0, 2).toUpperCase());
    }
  }
  const unknown = new Set();
  for (let i = 0; i < pairs.length; i++) {
    if (!PCSX_TYPES.has(pairs[i])) unknown.add(pairs[i]);
    else if (DATA_NEXT.has(pairs[i])) {
      if (i + 1 >= pairs.length) return { ok: false, format: label, reason: 'Instruction composée incomplète : donnée suivante absente.' };
      if (pairs[i] === '50' && !['30', '80'].includes(pairs[i + 1])) return {
        ok: false, format: label, reason: 'Slide 50 incompatible : l’instruction suivante doit être une écriture 30 ou 80 ; le cœur ignorerait ce bloc.' };
      i++;
    }
  }
  if (unknown.size) {
    const list = [...unknown].join(', ');
    return { ok: false, format: source === 'DuckStation' ? 'DuckStation (étendu)' : label,
      reason: `Type${unknown.size > 1 ? 's' : ''} d’instruction ${list} non géré${unknown.size > 1 ? 's' : ''} par PCSX ReARMed : ${unknown.size > 1 ? 'ils seraient ignorés' : 'il serait ignoré'} sans erreur et le reste du code s’appliquerait seul.` };
  }
  return { ok: true, format: label, reason: null };
}
export const codeValid = code => codeSupport(code).ok;
export const encodeCode = code => lines(code).join('+');
export const gameKey = m => m.serial ?? 'sha256:' + m.canonical_sha256;
const stripDecor = name => String(name ?? '').replace(/\s*⚠️.*$/u, '').trim();

/** Normalise un numéro de série saisi : « sles 01881 » → null ; « SLUS-01156 » valide. */
export function normalizeSerial(raw) {
  const input = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
  return /^[A-Z]{4}-\d{5}$/.test(input) ? input : null;
}
/** Région déduite du préfixe d'un numéro de série (null si préfixe inconnu). */
export function serialRegion(serial) {
  const prefix = String(serial ?? '').slice(0, 4).toUpperCase();
  if (['SLUS', 'SCUS'].includes(prefix)) return 'USA';
  if (['SLES', 'SCES', 'SCED', 'SLED'].includes(prefix)) return 'Europe';
  if (['SLPS', 'SLPM', 'SCPS', 'SCPM'].includes(prefix)) return 'Japan';
  return null;
}

export class CheatEngineError extends Error {
  constructor(message, { resynced, cause } = {}) {
    super(message); this.name = 'CheatEngineError'; this.resynced = !!resynced; this.cause = cause;
  }
}

/**
 * @param {object} deps
 * @param {() => ({setCheats:(list:{name:string,code:string}[])=>any}|null)} deps.getEngine
 * @param {{find:Function, load:Function}} deps.catalog  find(serial,title) → résultat ; load() → catalogue
 * @param {{detectRegion:Function, detectRegions:Function, regionsCompatible:Function, detectMod?:Function}} deps.regions
 * @param {{cheats:{get:Function,set:Function}, editions:{get:Function,set:Function}}} deps.stores
 * @param {(type:string, data?:object)=>void} [deps.emit]
 */
export function createCheatController({ getEngine, catalog, regions, stores, emit = () => {} }) {
  let gen = 0;
  let meta = null;
  let cheats = [];
  let region = { mismatch: null, confirmed: false };
  let pendingRestore = [];
  let candidates = [];
  let candidateKind = null;      // null | 'edition' | 'mod'
  let chosen = null;             // index du candidat choisi
  let modInfo = null;
  let editionLabel = null;
  let engineSync = 'ok';         // 'ok' | 'unknown'
  let message = null;            // dernier message d'opération {text, warn}
  let note = { text: '', warn: false };
  const listeners = new Set();

  const notify = () => { for (const fn of listeners) { try { fn(); } catch { /* une vue défaillante ne doit pas casser l'état */ } } };
  const setMessage = (text, warn = false) => { message = { text, warn }; };
  const setNote = (text, warn = false) => { note = { text, warn }; };
  const applied = () => cheats.filter(c => c.state === CHEAT_STATE.APPLIED);
  const pending = () => cheats.filter(c => c.state === CHEAT_STATE.PENDING);
  const encodedApplied = () => applied().map(c => ({ name: c.name, code: encodeCode(c.code) }));
  const regionAllows = () => !region.mismatch || region.confirmed === true;

  // --- File d'opérations : sérialisation + abandon des opérations périmées ---
  let tail = Promise.resolve();
  function enqueue(op) {
    const g = gen;
    const run = tail.then(() => (g !== gen ? STALE : op(g)));
    tail = run.catch(() => {});
    return run;
  }

  // --- Instantané / restauration (retour arrière complet) ---
  const snapshot = () => ({
    cheats, states: cheats.map(c => c.state), region: { ...region }, pendingRestore: [...pendingRestore],
    editionLabel, chosen,
  });
  function restoreSnapshot(s) {
    cheats = s.cheats; cheats.forEach((c, i) => { c.state = s.states[i]; });
    region = { ...s.region }; pendingRestore = [...s.pendingRestore]; editionLabel = s.editionLabel; chosen = s.chosen;
  }

  /**
   * Transaction : mutate() propose le nouvel état ; le moteur reçoit la liste 'applied'.
   * Succès → engagé. Échec → état JS restauré, moteur resynchronisé ; si la
   * resynchronisation échoue aussi → engineSync = 'unknown' (état incertain déclaré).
   */
  async function commit(mutate) {
    const g0 = gen;
    const snap = snapshot();
    mutate();
    const list = encodedApplied();
    const engine = getEngine();
    if (!engine) {
      if (list.length) { restoreSnapshot(snap); throw new CheatEngineError('Aucune session de jeu : impossible d’activer un cheat.'); }
      return 0;
    }
    try {
      await engine.setCheats(list);
      if (g0 === gen) engineSync = 'ok';
      emit('cheats.applied', { count: list.length });
      return list.length;
    } catch (error) {
      // La session a changé pendant l'appel : ne jamais écraser l'état de la nouvelle session.
      if (g0 !== gen) throw new CheatEngineError(String((error && error.message) || error), { resynced: true, cause: error });
      restoreSnapshot(snap);
      const back = encodedApplied();
      let resynced = false;
      try {
        await engine.setCheats(back);
        engineSync = 'ok'; resynced = true;
        emit('cheats.resynced', { count: back.length });
      } catch (error2) {
        engineSync = 'unknown';
        emit('cheats.resync_failed', { message: String((error2 && error2.message) || error2) });
        try { await engine.quarantineCheats?.(); }
        catch (quarantineError) { emit('cheats.quarantine_failed', { message: String(quarantineError?.message || quarantineError) }); }
      }
      emit('cheats.apply_failed', { message: String((error && error.message) || error) });
      throw new CheatEngineError(String((error && error.message) || error), { resynced, cause: error });
    }
  }
  const engineFailureText = (error, fallback) =>
    error && error.resynced === false
      ? '⚠️ La mise à jour et la resynchronisation ont échoué : moteur INCERTAIN. Les captures sont bloquées ; recréez une session saine.'
      : fallback;

  // --- Évaluation régionale (une seule fonction pour tous les chemins) ---
  function assessCatalogRegion(catalogTitle) {
    const gameRegion = serialRegion(meta?.serial) || regions.detectRegion(meta?.name);
    const catRegions = regions.detectRegions(catalogTitle);
    const catalogRegion = regions.detectRegion(catalogTitle);
    // A name/catalogue match never confirms the disc edition, even with equal regions.
    return { needs: true, mismatch: { gameRegion: gameRegion || 'inconnue',
      catalogRegion: catalogRegion || 'inconnue', catalogTitle,
      uncertain: !gameRegion || !catalogRegion, unverifiedEdition: true,
      compatibleHint: !!(gameRegion && catRegions && regions.regionsCompatible(gameRegion, catRegions)) } };
  }
  const setRegion = mismatch => { region = { mismatch: mismatch ?? null, confirmed: false }; };

  function decorate(c, { regionMismatch = null, regionUncertain = false, catalogRegion = null, gameRegion = null } = {}) {
    const support = codeSupport(c.code, c.source);
    const xploder = support.format === 'Xploder';
    return {
      name: c.name, code: c.code, source: 'catalogue', origin: c.source ?? null, format: support.format, reason: support.reason,
      validated: false, incompatible: !support.ok, state: CHEAT_STATE.OFF,
      display: (c.name || '') + (xploder ? ' ⚠️ (Xploder: non supporté)' : (!support.ok ? ' ⚠️ (incompatible)' : '')
        + (regionMismatch ? ` ⚠️ (région ${catalogRegion}, votre disque: ${gameRegion})` : '')
        + (regionUncertain ? ' ⚠️ (région du disque inconnue)' : '')),
    };
  }
  // Un code manuel devenu non exécutable (règle plus stricte) reste affiché et conservé,
  // marqué incompatible avec sa raison, au lieu de disparaître du stockage.
  async function loadMine() {
    const stored = (await stores.cheats.get(gameKey(meta)).catch(() => null)) ?? [];
    return stored.filter(c => c && typeof c.code === 'string').map(c => {
      const support = codeSupport(c.code);
      return { name: c.name, code: c.code, source: 'manuel', origin: 'saisie manuelle', format: support.format, reason: support.reason,
        incompatible: !support.ok, state: CHEAT_STATE.OFF, display: c.name + (support.ok ? '' : ' ⚠️ (incompatible)') };
    });
  }
  const restoreMatches = (p, c) => encodeCode(p.code) === encodeCode(c.code)
    && (p.name === c.name || p.name === c.display || stripDecor(p.name) === c.name);
  function markRestores(list, state) {
    let count = 0;
    for (const p of list) {
      const existing = cheats.find(c => restoreMatches(p, c));
      if (existing && !existing.incompatible && existing.state !== state) { existing.state = state; count++; }
    }
    return count;
  }

  // ---------------------------------------------------------------------------
  // Session : repart d'un état VIDE avant tout appel asynchrone (R3).
  // ---------------------------------------------------------------------------
  function startSession(newMeta, restoreList = []) {
    gen++;
    meta = newMeta;
    cheats = []; region = { mismatch: { gameRegion: 'inconnue', catalogRegion: 'manuel', catalogTitle: 'code manuel', uncertain: true, manual: true }, confirmed: false }; candidates = []; candidateKind = null; chosen = null;
    modInfo = null; editionLabel = null; engineSync = 'ok'; message = null; setNote('');
    pendingRestore = (restoreList ?? []).filter(p => p && typeof p.code === 'string').map(p => ({ name: p.name, code: p.code }));
    setMessage('Chargement des cheats…'); notify();
    return enqueue(g => loadForGame(g));
  }
  /** Fin de session (aucun jeu) : plus rien d'actif nulle part. */
  function endSession() {
    gen++; meta = null; cheats = []; region = { mismatch: null, confirmed: false }; candidates = []; candidateKind = null;
    chosen = null; pendingRestore = []; modInfo = null; editionLabel = null; engineSync = 'ok'; message = null; setNote(''); notify();
  }

  async function loadForGame(g) {
    const m = meta;
    let result = null, fromMemory = false;
    if (m.canonical_sha256) {
      try {
        const remembered = await stores.editions.get('sha256:' + m.canonical_sha256).catch(() => null);
        if (g !== gen) return STALE;
        if (remembered && remembered.catalogTitle) {
          const full = await catalog.load().catch(() => null);
          if (g !== gen) return STALE;
          const codes = full && full.byTitle && full.byTitle[remembered.catalogTitle];
          if (codes) {
            result = { status: 'match', cheats: codes.map(c => ({ ...c, validated: false })), candidates: [],
              catalogTitle: remembered.catalogTitle, catalogRegion: regions.detectRegion(remembered.catalogTitle),
              catalogRegions: regions.detectRegions(remembered.catalogTitle) };
            fromMemory = true;
          }
        }
      } catch { /* la mémoire d'édition est facultative */ }
    }
    if (!result) {
      result = await Promise.resolve().then(() => catalog.find(m.serial, m.name))
        .catch(err => ({ status: 'load_error', cheats: [], candidates: [], error: err.message }));
      if (g !== gen) return STALE;
    }
    const mine = await loadMine();
    if (g !== gen) return STALE;
    if (!result || !['match', 'ambiguous', 'mod_candidate', 'no_match', 'load_error'].includes(result.status)) {
      result = { status: 'load_error', cheats: [], candidates: [], error: 'Réponse du catalogue de cheats invalide' };
    }
    const waiting = pendingRestore.length;

    if (result.status === 'ambiguous') {
      cheats = mine; candidates = result.candidates; candidateKind = 'edition';
      setMessage(waiting
        ? `Plusieurs éditions : choisissez celle de votre disque. ${waiting} cheat(s) restauré(s) attendent ce choix ; aucun code n’est injecté.`
        : 'Plusieurs éditions : choisissez celle de votre disque. Aucun code activé.');
      notify(); return { ok: true, status: result.status };
    }
    if (result.status === 'mod_candidate') {
      cheats = mine; candidates = result.candidates; candidateKind = 'mod'; modInfo = result.modInfo || {};
      setMessage(`🎮 Mod détecté : « ${modInfo.originalTitle || m.name} ». Aucun cheat spécifique trouvé.`);
      notify(); return { ok: true, status: result.status };
    }
    if (result.status === 'load_error') {
      cheats = mine;
      setMessage(`Impossible de charger les cheats : ${result.error || 'erreur inconnue'}`, true);
      notify(); return { ok: true, status: result.status };
    }
    if (result.status === 'no_match') {
      cheats = mine;
      const mod = (() => { try { return regions.detectMod ? regions.detectMod(m.name || '') : { isMod: false }; } catch { return { isMod: false }; } })();
      setMessage(mod.isMod
        ? '🎮 Mod détecté mais jeu de base introuvable dans le catalogue. Vous pouvez ajouter des codes manuellement ci-dessous.'
        : `🔍 Jeu non reconnu dans le catalogue (${m.name || 'sans nom'}). Ce n'est pas forcément qu'il n'existe pas de cheats — le titre peut différer. Codes manuels conservés.`);
      notify(); return { ok: true, status: result.status };
    }

    // status === 'match'
    // Even a serial is indicative: modified/revised discs can retain it.
    const info = assessCatalogRegion(result.catalogTitle ?? 'catalogue non vérifié');
    const catalogRegion = result.catalogRegion || null;
    const gameRegion = regions.detectRegion(m.name);
    const known = (Array.isArray(result.cheats) ? result.cheats : []).filter(c => c && typeof c.code === 'string').map((c, i) =>
      decorate({ ...c, name: c.name || `Code sans nom #${i + 1} — non vérifié` }, {
        regionMismatch: info.needs && !info.mismatch?.uncertain, regionUncertain: !!info.mismatch?.uncertain, catalogRegion, gameRegion }));
    cheats = [...known, ...mine];
    setRegion(info.mismatch);
    editionLabel = null;
    if (pendingRestore.length && getEngine()) {
      if (!info.needs) {
        let count = 0;
        try {
          await commit(() => { count = markRestores(pendingRestore, CHEAT_STATE.APPLIED); });
          if (g !== gen) return STALE;
          if (count > 0) {
            emit('cheats.restored', { count, safe: true });
            editionLabel = result.catalogTitle ?? null; pendingRestore = [];
            setMessage(`✅ ${count} cheat(s) restauré(s) et appliqué(s) — correspondance par numéro de série indicatif (${result.catalogTitle ?? m.serial}).`);
          } else {
            setMessage(`⚠️ ${pendingRestore.length} cheat(s) restauré(s) non trouvés dans le catalogue de cette édition. Aucune injection.`, true);
            pendingRestore = [];
          }
        } catch (error) {
          if (g !== gen) return STALE;
          setMessage(engineFailureText(error, '⚠️ Le moteur a refusé la restauration : cheats remis en attente.'), true);
        }
        notify(); return { ok: true, status: result.status };
      }
      markRestores(pendingRestore, CHEAT_STATE.PENDING);
      setMessage(`⏸️ ${pendingRestore.length} cheat(s) restauré(s) en attente — ${info.mismatch.uncertain ? 'région du disque inconnue' : `décalage région (${gameRegion} vs ${catalogRegion})`}. Confirmez l'édition pour les appliquer.`, true);
      notify(); return { ok: true, status: result.status };
    }
    if (info.needs) {
      setMessage(fromMemory
        ? `⚠️ Édition mémorisée (${result.catalogTitle}, ${catalogRegion}) : confirmez ci-dessous que votre disque correspond avant d'activer.`
        : `⚠️ Ces codes proviennent de l'édition ${catalogRegion ? `${catalogRegion} (${result.catalogTitle})` : `« ${result.catalogTitle} »`}. Confirmez ci-dessous avant d'activer.`, true);
    } else if (fromMemory) {
      setMessage(`✅ Édition mémorisée reconnue (${result.catalogTitle}). ${cheats.length} code(s), tous désactivés par défaut. Choix précédent sur cet appareil.`);
    } else {
      message = null;
    }
    notify(); return { ok: true, status: result.status };
  }

  // ---------------------------------------------------------------------------
  // Bascule d'un cheat
  // ---------------------------------------------------------------------------
  const durable = () => `Cheats actifs : ${applied().length}. Un cheat peut modifier la partie de façon durable ; désactiver un code n’annule pas toujours ses effets.`;
  function toggle(index, on) {
    return enqueue(async g => {
      const cheat = cheats[index];
      if (!cheat) return { ok: false, reason: 'unknown-cheat' };
      if (on && cheat.incompatible) {
        setNote('Code incompatible : ne peut pas être activé (format non supporté par PCSX ReARMed).', true); notify();
        return { ok: false, reason: 'incompatible' };
      }
      if (!on) {
        try { await commit(() => { cheat.state = CHEAT_STATE.OFF; }); }
        catch (error) {
          if (g !== gen) return STALE;
          setNote(engineFailureText(error, '⚠️ Le moteur a refusé la mise à jour : état restauré.'), true); notify();
          return { ok: false, reason: 'engine', resynced: error.resynced };
        }
        if (g !== gen) return STALE;
        setNote(durable()); notify(); return { ok: true };
      }
      if (engineSync === 'unknown') {
        setNote('⚠️ L’état du moteur est incertain : activation refusée. Utilisez « Resynchroniser » ou « Désactiver tous ».', true); notify();
        return { ok: false, reason: 'engine-unknown' };
      }
      if (!regionAllows()) {
        cheat.state = CHEAT_STATE.PENDING;   // aucun appel moteur
        setNote('⚠️ Région différente : confirmez ci-dessous que ces codes correspondent à votre disque avant de les activer.', true); notify();
        return { ok: false, reason: 'region' };
      }
      try { await commit(() => { cheat.state = CHEAT_STATE.APPLIED; }); }
      catch (error) {
        if (g !== gen) return STALE;
        setNote(engineFailureText(error, "⚠️ Le moteur a refusé l'application : le cheat reste désactivé."), true); notify();
        return { ok: false, reason: 'engine', resynced: error.resynced };
      }
      if (g !== gen) return STALE;
      setNote(durable()); notify(); return { ok: true };
    });
  }

  // ---------------------------------------------------------------------------
  // Confirmation régionale : applique TOUT ce qui attend, en une transaction.
  // ---------------------------------------------------------------------------
  function confirmRegion() {
    return enqueue(async g => {
      if (!region.mismatch) { setMessage('Aucune confirmation nécessaire.'); notify(); return { ok: true, applied: 0 }; }
      if (engineSync === 'unknown') {
        setMessage('⚠️ L’état du moteur est incertain : utilisez « Resynchroniser » ou « Désactiver tous » avant de confirmer.', true); notify();
        return { ok: false, reason: 'engine-unknown' };
      }
      const toApply = cheats.some(c => c.state === CHEAT_STATE.PENDING) || pendingRestore.length > 0;
      if (!toApply) {
        region = { ...region, confirmed: true };
        setMessage('Accord explicite enregistré pour cette session. Vous pouvez maintenant cocher les codes.'); notify();
        return { ok: true, applied: 0 };
      }
      let count = 0;
      try {
        await commit(() => {
          region = { ...region, confirmed: true };
          for (const c of cheats) { if (c.state === CHEAT_STATE.PENDING && !c.incompatible) { c.state = CHEAT_STATE.APPLIED; count++; } }
          count += markRestores(pendingRestore, CHEAT_STATE.APPLIED);
          pendingRestore = [];
        });
      } catch (error) {
        if (g !== gen) return STALE;
        // Le retour arrière a rouvert la confirmation (confirmed=false, restes en attente).
        setMessage(engineFailureText(error, '⚠️ Le moteur a refusé l’application : les cheats restent en attente. Confirmez à nouveau pour réessayer.'), true); notify();
        return { ok: false, reason: 'engine', resynced: error.resynced };
      }
      if (g !== gen) return STALE;
      emit('cheats.restored', { count, afterRegionConfirm: true });
      setMessage(count > 0 ? `✅ Accord explicite pour cette session. ${count} cheat(s) en attente appliqué(s).` : 'Accord explicite enregistré pour cette session. Vous pouvez maintenant cocher les codes.');
      notify(); return { ok: true, applied: count };
    });
  }

  // ---------------------------------------------------------------------------
  // Choix d'une édition parmi plusieurs candidats (modifiable : R4).
  // ---------------------------------------------------------------------------
  function chooseCandidate(index) {
    return enqueue(async g => {
      const cand = candidates[index];
      if (!cand) return { ok: false, reason: 'unknown-candidate' };
      const isMod = candidateKind === 'mod';
      const info = isMod
        ? { needs: true, mismatch: { gameRegion: 'mod', catalogRegion: 'original', catalogTitle: cand.catalogTitle, isMod: true } }
        : assessCatalogRegion(cand.catalogTitle);
      const mine = await loadMine();
      if (g !== gen) return STALE;
      const gameRegion = regions.detectRegion(meta?.name);
      const known = (cand.codes || []).filter(c => c && typeof c.code === 'string').map(c => {
        const d = decorate(c, { regionUncertain: false });
        if (isMod) { d.display += ' ⚠️ (NON VÉRIFIÉ pour ce mod)'; d.isModCandidate = true; }
        return d;
      });
      let count = 0;
      try {
        await commit(() => {
          cheats = [...known, ...mine]; chosen = index; editionLabel = cand.catalogTitle; setRegion(info.mismatch);
          if (pendingRestore.length) {
            if (!info.needs) { count = markRestores(pendingRestore, CHEAT_STATE.APPLIED); pendingRestore = []; }
            else markRestores(pendingRestore, CHEAT_STATE.PENDING);
          }
        });
      } catch (error) {
        if (g !== gen) return STALE;
        setMessage(engineFailureText(error, '⚠️ Le moteur a refusé le changement d’édition : liste précédente conservée.'), true); notify();
        return { ok: false, reason: 'engine', resynced: error.resynced };
      }
      if (g !== gen) return STALE;
      if (!isMod && meta?.canonical_sha256) {
        try {
          await stores.editions.set('sha256:' + meta.canonical_sha256, {
            catalogTitle: cand.catalogTitle, verifiedAt: new Date().toISOString(),
            source: 'selected-unverified', gameRegion: gameRegion || 'inconnue' });
        } catch (e) { emit('edition.memory.failed', { message: e.message }); }
      }
      setMessage(isMod
        ? `⚠️ ${known.length} code(s) du jeu original affichés comme NON VÉRIFIÉS. Confirmez avant d'activer.`
        : info.needs
          ? `⚠️ Édition « ${cand.catalogTitle} » choisie : région à confirmer avant toute activation. ${cheats.length} code(s), tous désactivés.`
          : `Édition « ${cand.catalogTitle} » choisie. ${cheats.length} code(s), tous désactivés par défaut.${count ? ` ${count} cheat(s) restauré(s) appliqué(s).` : ''}`, info.needs);
      notify(); return { ok: true, applied: count };
    });
  }

  // ---------------------------------------------------------------------------
  // Saisie manuelle d'un numéro de série (R0, R1, R2).
  // ---------------------------------------------------------------------------
  function applySerial(raw) {
    return enqueue(async g => {
      const input = normalizeSerial(raw);
      if (!input) { setMessage('Format invalide. Exemple : SLUS-01156', true); notify(); return { ok: false, reason: 'format' }; }
      const full = await Promise.resolve().then(() => catalog.load()).catch(() => null);
      if (g !== gen) return STALE;
      if (!full) { setMessage('Catalogue indisponible.', true); notify(); return { ok: false, reason: 'catalog' }; }
      // R0 : retrouver le titre par la table de correspondance (l'ancienne comparaison
      // d'identité de tableaux échouait toujours après JSON.parse).
      const catalogTitle = full.serialMap?.[input] ?? null;
      const codes = full.bySerial?.[input] ?? (catalogTitle ? full.byTitle?.[catalogTitle] : null);
      if (!codes) { setMessage(`Aucun jeu trouvé pour le numéro ${input} dans le catalogue.`, true); notify(); return { ok: false, reason: 'not-found' }; }
      // A typed or scanned serial is a catalogue hint, not edition authentication.
      const detected = meta?.serial ?? null;
      let info;
      if (detected && detected === input) info = assessCatalogRegion(catalogTitle || input);
      else if (detected) {
        info = { needs: true, mismatch: { gameRegion: serialRegion(detected) || 'inconnue', catalogRegion: serialRegion(input) || regions.detectRegion(catalogTitle || ''),
          catalogTitle: catalogTitle || input, serialDiffers: true, typedSerial: input, detectedSerial: detected } };
      } else if (catalogTitle) info = assessCatalogRegion(catalogTitle);
      else info = { needs: true, mismatch: { gameRegion: 'inconnue', catalogRegion: serialRegion(input), catalogTitle: input, uncertain: true } };
      const mine = await loadMine();
      if (g !== gen) return STALE;
      const gameRegion = regions.detectRegion(meta?.name);
      const known = codes.filter(c => c && typeof c.code === 'string').map((c, i) =>
        decorate({ ...c, name: c.name || `Code sans nom #${i + 1} — non vérifié` }));
      try {
        await commit(() => {   // vide aussi le moteur : l'ancienne liste n'existe plus
          cheats = [...known, ...mine]; chosen = null; editionLabel = catalogTitle || input; setRegion(info.mismatch);
        });
      } catch (error) {
        if (g !== gen) return STALE;
        setMessage(engineFailureText(error, '⚠️ Le moteur a refusé le changement : liste précédente restaurée.'), true); notify();
        return { ok: false, reason: 'engine', resynced: error.resynced };
      }
      if (g !== gen) return STALE;
      if (meta?.canonical_sha256) {
        try {
          await stores.editions.set('sha256:' + meta.canonical_sha256, {
            catalogTitle: catalogTitle || input, serial: input, verifiedAt: new Date().toISOString(),
            source: info.needs ? 'selected-unverified' : 'manual-serial', gameRegion: gameRegion || 'inconnue' });
        } catch (e) { emit('edition.memory.failed', { message: e.message }); }
      }
      setMessage(info.needs
        ? `⚠️ Numéro ${input} (${catalogTitle || 'titre inconnu'}) : confirmation requise avant toute activation. ${cheats.length} code(s), tous désactivés.`
        : `✅ Jeu identifié : ${catalogTitle || input} (${input}). ${cheats.length} code(s), tous désactivés.`, info.needs);
      notify(); return { ok: true, title: catalogTitle, needsConfirmation: info.needs };
    });
  }

  // ---------------------------------------------------------------------------
  // Désactiver tous / resynchroniser / ajouter un code manuel
  // ---------------------------------------------------------------------------
  function disableAll() {
    return enqueue(async g => {
      try {
        await commit(() => { cheats.forEach(c => { c.state = CHEAT_STATE.OFF; }); pendingRestore = []; });
      } catch (error) {
        if (g !== gen) return STALE;
        setMessage(engineFailureText(error, '⚠️ Le moteur a refusé la désactivation : états et listes restaurés.'), true); notify();
        return { ok: false, reason: 'engine', resynced: error.resynced };
      }
      if (g !== gen) return STALE;
      setMessage('Tous les cheats désactivés, y compris les restaurations en attente.'); notify();
      return { ok: true };
    });
  }
  function resync() {
    return enqueue(async g => {
      try { await commit(() => {}); }
      catch (error) {
        if (g !== gen) return STALE;
        setMessage(engineFailureText(error, '⚠️ Resynchronisation refusée par le moteur.'), true); notify();
        return { ok: false, reason: 'engine', resynced: error.resynced };
      }
      if (g !== gen) return STALE;
      setMessage('Moteur resynchronisé avec la liste affichée.'); notify();
      return { ok: true };
    });
  }
  function addManual(name, code) {
    return enqueue(async g => {
      const n = String(name ?? '').trim(), c = lines(code ?? '').join('\n');
      if (!n || n.length > 120) throw new Error('Donnez un nom au code (120 caractères au plus).');
      const support = codeSupport(c);
      if (!support.ok) throw new Error(`Code refusé : ${support.reason} Format attendu : une instruction « 8001AB00 0001 » par ligne (GameShark).`);
      if (!meta) throw new Error('Aucun jeu chargé : impossible d’ajouter un code.');
      await stores.cheats.set(gameKey(meta), [...cheats.filter(x => x.source === 'manuel').map(({ name: nm, code: cd }) => ({ name: nm, code: cd })), { name: n, code: c }]);
      if (g !== gen) return STALE;
      cheats.push({ name: n, code: c, source: 'manuel', origin: 'saisie manuelle', format: support.format, reason: null, state: CHEAT_STATE.OFF });
      setNote('Code ajouté pour ce jeu, désactivé.'); notify();
      return { ok: true };
    });
  }

  // ---------------------------------------------------------------------------
  // Vue (instantané immuable pour l'interface)
  // ---------------------------------------------------------------------------
  function regionPanel() {
    const rm = region.mismatch;
    if (!rm || region.confirmed) return null;
    const restoreCount = pendingRestore.length;
    let text, confirmLabel;
    if (rm.manual) {
      text = '⚠️ Région et édition non vérifiées. Vos codes manuels restent désactivés avant votre accord explicite pour cette session.';
      confirmLabel = 'Je confirme : appliquer mes codes manuels à cette session';
    } else if (rm.isMod) {
      text = `⚠️ Jeu modifié détecté : ces codes viennent du jeu original « ${rm.catalogTitle} » et ne sont PAS vérifiés pour ce mod. Ils peuvent ne pas fonctionner ou corrompre votre partie.`;
      confirmLabel = 'Je confirme : appliquer les codes du jeu original à ce mod';
    } else if (rm.serialDiffers) {
      text = `⚠️ Le numéro saisi (${rm.typedSerial}) ne correspond pas au numéro lu sur votre disque (${rm.detectedSerial}). Ces codes ne sont donc pas vérifiés pour votre disque et peuvent corrompre votre partie.`;
      confirmLabel = `Je confirme : appliquer les codes de ${rm.typedSerial} à mon disque`;
    } else if (rm.unverifiedEdition) {
      text = `⚠️ Correspondance de catalogue non vérifiée : ${rm.catalogTitle}. Région indicative du disque : ${rm.gameRegion} ; catalogue : ${rm.catalogRegion}. Le nom ne prouve pas l’édition. Aucun code injecté sans votre accord explicite.`;
      confirmLabel = 'Je confirme : appliquer ces codes non vérifiés à cette session';
    } else if (rm.uncertain) {
      text = `⚠️ Ces codes viennent de l'édition ${rm.catalogRegion} (${rm.catalogTitle}), mais la région de votre disque est inconnue (nom sans suffixe). Ils peuvent ne pas fonctionner ou corrompre votre partie.`;
      confirmLabel = `Je confirme : mon disque est bien l'édition ${rm.catalogRegion}`;
    } else {
      text = `⚠️ Ces codes viennent de l'édition ${rm.catalogRegion} (${rm.catalogTitle}), votre disque semble être ${rm.gameRegion}. Ils peuvent ne pas fonctionner ou corrompre votre partie.`;
      confirmLabel = `Je confirme : activer les codes ${rm.catalogRegion} sur mon disque ${rm.gameRegion}`;
    }
    if (restoreCount > 0) confirmLabel += ` (applique aussi ${restoreCount} cheat(s) restauré(s))`;
    return { text, confirmLabel, restoreCount, ...rm };
  }
  function summary() {
    if (!meta || !getEngine()) return { text: 'Aucun jeu chargé. Aucun cheat actif.', warn: false };
    if (!cheats.length) return { text: 'Aucun code compatible trouvé pour ce jeu. Vous pouvez en ajouter un manuellement ci-dessous.', warn: false };
    const imported = cheats.filter(c => c.source === 'catalogue' && !c.validated).length;
    const rejected = cheats.filter(c => c.incompatible).length;
    const parts = [`${cheats.length} code(s) pour ce jeu${editionLabel ? ` — ${editionLabel}` : ''} (${imported} importé(s) non validé(s) 📥).`];
    if (rejected === cheats.length) parts.push(ALL_REJECTED);
    else if (rejected) parts.push(`${rejected} rejeté(s) : format non pris en charge par PCSX ReARMed.`);
    if (applied().length) parts.push(`${applied().length} ACTIF(s) dans le moteur.`);
    if (pending().length) parts.push(`${pending().length} EN ATTENTE de confirmation (non injectés).`);
    if (!applied().length && !pending().length) parts.push('Aucun actif.');
    return { text: parts.join(' '), warn: applied().length > 0 || pending().length > 0 };
  }
  function view() {
    const sum = summary();
    // Le constat « aucun code exécutable » reste visible même sous un message d'opération.
    const allRejected = cheats.length > 0 && cheats.every(c => c.incompatible);
    const info = message ? { ...message, text: message.text + (allRejected ? ' ' + ALL_REJECTED : '') } : sum;
    return {
      hasSession: !!(meta && getEngine()), gameName: meta?.name ?? null,
      cheats: cheats.map((c, index) => ({ index, name: c.name, display: c.display ?? c.name, code: c.code, source: c.source, state: c.state,
        validated: !!c.validated, incompatible: !!c.incompatible, origin: c.origin ?? null, format: c.format ?? null, reason: c.reason ?? null })),
      edition: editionLabel ?? (region.mismatch && !region.mismatch.manual ? region.mismatch.catalogTitle : null),
      applied: applied().length, pending: pending().length, summary: sum, info, note: { ...note },
      engineSync, region: regionPanel(), pendingRestore: pendingRestore.length,
      editionEvidence: { status: region.confirmed ? 'user-acknowledged-for-session' : 'unverified', authenticated: false, serial: meta?.serial ?? null },
      candidates: candidates.map((cand, index) => ({ index, title: cand.catalogTitle, count: (cand.codes || []).length, chosen: chosen === index })),
      candidateKind, modInfo, editionLabel,
    };
  }

  return {
    startSession, endSession, toggle, confirmRegion, chooseCandidate, applySerial, disableAll, resync, addManual,
    view, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    /** Liste {name, code, enabled} pour l'enregistrement d'un état de jeu. */
    activeCheats: () => applied().map(({ name, code }) => ({ name, code, enabled: true })),
    get generation() { return gen; },
  };
}
