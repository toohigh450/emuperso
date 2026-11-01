// SPDX-License-Identifier: MIT
// Version de l'application — mettre à jour à chaque release
const APP_VERSION = 'RC-1.6';
import { prepareDisc } from './disc-file.mjs';
import { SaveStore, makeStateEnvelope } from './save-store.mjs';
import { packStateBundle, unpackStateBundle } from './state-bundle.mjs';
import { SessionController } from './session-controller.mjs';
import { normalizeInput } from './input-profile.mjs';
import { PROFILES, DEFAULT_PROFILE_ID, resolveProfile } from './input-presets.mjs';
import { findCheatsForGame, catalogMeta, loadCatalog } from './cheat-catalog-psx.mjs';
const $ = id => document.getElementById(id), vault = new SaveStore('emuperso-real-saves-v1-ps1'), records = [];
let selected = null, busy = false, meta = null, cheats = [];
const say = (id, text, error = false) => { $(id).textContent = text; $(id).classList.toggle('error', error); };
function event(type, data = {}) { records.push({ utc: new Date().toISOString(), type, data }); if (records.length > 500) records.shift(); $('log').textContent = JSON.stringify(records.slice(-80), null, 1); }
const sessions = new SessionController($('game'), (type, data) => {
  event(type, data);
  if (type === 'state.unguarded.blocked') say('status', 'Utilisez les boutons de sauvegarde de l’application : le chargement direct du moteur est désactivé.');
});
const kv = name => {
  const run = async (mode, make) => {
    const db = await new Promise((ok, ko) => { const r = indexedDB.open(name, 1); r.onupgradeneeded = () => r.result.createObjectStore('games'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
    try { return await new Promise((ok, ko) => { const q = make(db.transaction('games', mode).objectStore('games')); q.onsuccess = () => ok(q.result); q.onerror = () => ko(q.error); }); } finally { db.close(); }
  };
  return { get: key => run('readonly', s => s.get(key)), set: (key, value) => run('readwrite', s => s.put(value, key)) };
};
const cheatDB = kv('emuperso-ps1-cheats-v1'), inputDB = kv('emuperso-ps1-input-v1'), editionDB = kv('emuperso-ps1-editions-v1');
const gameKey = m => m.serial ?? 'sha256:' + m.canonical_sha256;
const lines = code => code.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
const codeValid = code => {
  const l = lines(String(code));
  // Accepte une ou plusieurs instructions "XXXXXXXX YYYY" par ligne
  const pair = '[0-9a-f]{8} [0-9a-f]{4}';
  const multi = new RegExp(`^${pair}( ${pair})*$`, 'i');
  return l.length > 0 && l.length <= 64 && l.every(x => multi.test(x.trim()));
};
const activeCheats = () => cheats.filter(c => c.on).map(({ name, code }) => ({ name, code, enabled: true }));
function controls() {
  const on = !!sessions.current;
  $('choose').disabled = busy; $('launch').disabled = busy || !selected; $('launch').textContent = on ? 'Changer pour ce jeu' : 'Lancer';
  for (const id of ['audio', 'state-save', 'state-load', 'state-previous', 'battery-save', 'cheat-add', 'cheat-off', 'in-apply']) $(id).disabled = busy || !on;
  for (const box of $('cheat-list').querySelectorAll('input')) box.disabled = busy || !on;
}
function show(m) {
  $('sel').textContent = m?.name ?? 'Aucun disque choisi';
  $('d-format').textContent = m ? `${m.detected_format.toUpperCase()} · ${m.size.toLocaleString('fr-FR')} octets` : '—';
  $('d-sha').textContent = m?.canonical_sha256 ?? '—'; $('d-serial').textContent = m ? (m.serial ?? 'non détecté (clé = empreinte du disque)') : '—';
  $('d-notes').textContent = m?.notes.join(' ') || '—';
}
async function operation(task) {
  if (busy) return; busy = true; controls();
  try { await task(); } catch (error) { say('status', error.message ?? String(error), true); event('operation.error', { code: error.code ?? null, message: error.message ?? String(error), stack: error.stack ? String(error.stack).slice(0, 2000) : null }); }
  finally { busy = false; controls(); }
}
/**
 * VERROU RÉGIONAL CENTRALISÉ (audit GPT RC-1.5 P0)
 * Vérifie si un cheat peut être activé/injecté sans confirmation explicite.
 * TOUS les chemins d'activation doivent passer par ici :
 * - toggle() manuel
 * - choix d'édition candidate
 * - restauration de cheats
 * - application après confirmation
 * 
 * @returns {boolean} true si l'activation est autorisée
 */
function isRegionActivationAllowed() {
  // Si pas de décalage détecté, c'est sûr
  if (!window._regionMismatch) return true;
  // Si l'utilisateur a confirmé explicitement, c'est autorisé
  if (window._regionConfirmed === true) return true;
  // Sinon, BLOQUÉ
  return false;
}

/**
 * Calcule l'état régional pour un choix d'édition candidate.
 * @param {string} gameName - nom du fichier disque
 * @param {object} candidate - édition candidate choisie
 * @returns {Promise<{gameRegion, catalogRegions, regionMismatch, regionUncertain, regionSafe}>}
 */
async function computeRegionStateForCandidate(gameName, candidate) {
  const { detectRegion: dr, detectRegions: drs, regionsCompatible: rc } = await import('./cheat-catalog-psx.mjs');
  const gRegion = gameName ? dr(gameName) : null;
  const cRegions = drs(candidate.catalogTitle) || (dr(candidate.catalogTitle) ? [dr(candidate.catalogTitle)] : null);
  const rMismatch = gRegion && cRegions && !rc(gRegion, cRegions);
  const rUncertain = !gRegion && cRegions;
  const rSafe = (!rMismatch && !rUncertain) || window._regionConfirmed === true;
  return { gameRegion: gRegion, catalogRegions: cRegions, regionMismatch: rMismatch, regionUncertain: rUncertain, regionSafe: rSafe, detectRegion: dr };
}

function renderCheats() {
  const list = $('cheat-list'); list.replaceChildren();
  const imported = cheats.filter(c => c.source === 'catalogue' && !c.validated).length;
  const nActive = cheats.filter(c => c.on).length;
  // FIX 1: bouton de confirmation si décalage de région
  if (window._regionMismatch && !window._regionConfirmed) {
    const rm = window._regionMismatch;
    const warn = document.createElement('div');
    warn.style.cssText = 'padding:8px;margin-bottom:8px;border:1px solid #a90;background:#3a2a00;border-radius:6px;';
    // R2: message adapté si région incertaine
    warn.textContent = rm.uncertain
      ? `⚠️ Ces codes viennent de l'édition ${rm.catalogRegion} (${rm.catalogTitle}), mais la région de votre disque est inconnue (nom sans suffixe). Ils peuvent ne pas fonctionner ou corrompre votre partie.`
      : `⚠️ Ces codes viennent de l'édition ${rm.catalogRegion} (${rm.catalogTitle}), votre disque semble être ${rm.gameRegion}. Ils peuvent ne pas fonctionner ou corrompre votre partie.`;
    const btn = document.createElement('button');
    btn.textContent = rm.uncertain
      ? `Je confirme : mon disque est bien l'édition ${rm.catalogRegion}`
      : `Je confirme : activer les codes ${rm.catalogRegion} sur mon disque ${rm.gameRegion}`;
    // P1 (audit GPT RC-1.5) : le bouton "Je confirme" doit aussi appliquer les cheats en attente.
    // Avant : il masquait le panneau sans injecter les pending, qui restaient orphelins.
    btn.onclick = () => operation(async () => {
      window._regionConfirmed = true;
      // Appliquer les cheats marqués 'pending' (en attente de confirmation)
      let appliedCount = 0;
      for (const c of cheats) {
        if (c.pending && !c.incompatible) {
          c.pending = false;
          c.on = true;
          appliedCount++;
        }
      }
      // Aussi appliquer les _pendingCheatRestore s'il y en a
      const pendingRestore = window._pendingCheatRestore || [];
      if (pendingRestore.length > 0) {
        window._pendingCheatRestore = [];
        for (const p of pendingRestore) {
          const existing = cheats.find(c => c.name === p.name && c.code === p.code);
          if (existing && !existing.incompatible && !existing.on) {
            existing.pending = false;
            existing.on = true;
            appliedCount++;
          }
        }
      }
      if (appliedCount > 0 && sessions.current) {
        const toApply = cheats.filter(c => c.on && !c.incompatible).map(c => ({ name: c.name, code: lines(c.code).join('+') }));
        sessions.current.api.setCheats(toApply);
        event('cheats.applied', { count: appliedCount, afterRegionConfirm: true });
        say('cheat-info', `✅ Région confirmée. ${appliedCount} cheat(s) en attente appliqué(s).`, false);
      } else {
        say('cheat-info', 'Région confirmée. Vous pouvez maintenant cocher les codes.', false);
      }
      renderCheats();
    });
    warn.append(document.createElement('br'), btn);
    // B02 (audit GPT RC-1.1) : si des cheats restaurés sont en attente, proposer de les appliquer explicitement
    const pendingCount = (window._pendingCheatRestore || []).length;
    if (pendingCount > 0) {
      const btnRestore = document.createElement('button');
      btnRestore.style.cssText = 'margin-top:8px;background:#7a2a00;border-color:#f90;';
      btnRestore.textContent = `⚠️ Appliquer les ${pendingCount} cheat(s) restauré(s) malgré le décalage de région`;
      btnRestore.onclick = () => operation(async () => {
        // L'utilisateur confirme explicitement : appliquer les pending
        window._regionConfirmed = true;
        const pending = window._pendingCheatRestore || [];
        window._pendingCheatRestore = [];
        let appliedCount = 0;
        for (const p of pending) {
          const existing = cheats.find(c => c.name === p.name && c.code === p.code);
          if (existing && !existing.incompatible) {
            existing.on = true;
            appliedCount++;
          }
        }
        if (appliedCount > 0 && sessions.current) {
          const toApply = cheats.filter(c => c.on && !c.incompatible).map(c => ({ name: c.name, code: lines(c.code).join('+') }));
          sessions.current.api.setCheats(toApply);
          event('cheats.restored', { count: appliedCount, afterExplicitConfirm: true });
          say('cheat-info', `✅ ${appliedCount} cheat(s) restauré(s) appliqué(s) après votre confirmation explicite.`, false);
        } else {
          say('cheat-info', `⚠️ Aucun cheat restauré trouvé dans cette édition.`, true);
        }
        renderCheats();
      });
      warn.append(document.createElement('br'), document.createElement('br'), btnRestore);
    }
    list.append(warn);
  }
  // FIX 3: message fidèle à l'état réel
  const msg = !sessions.current ? 'Aucun jeu chargé. Aucun cheat actif.'
    : cheats.length ? `${cheats.length} code(s) pour ce jeu (${imported} importé(s) non validé(s) 📥).` + (nActive > 0 ? ` ${nActive} ACTIF(s) dans le moteur.` : ' Aucun actif.')
    : 'Aucun code compatible trouvé pour ce jeu. Vous pouvez en ajouter un manuellement ci-dessous.';
  say('cheat-info', msg, nActive > 0);
  cheats.forEach((cheat, index) => {
    const row = document.createElement('label'), box = document.createElement('input'); box.type = 'checkbox'; box.checked = !!cheat.on;
    box.onchange = () => operation(() => toggle(index, box.checked));
    const badge = cheat.source === 'catalogue' ? (cheat.validated ? ' ✅' : ' 📥') : '';
    row.append(box, ` ${cheat.name} (${cheat.source}${badge})`); list.append(row);
  });
  controls();
}

function renderCheatCandidates(candidates) {
  const list = $('cheat-list');
  // NE PAS vider : les codes manuels/restaurés sont déjà affichés par renderCheats()
  candidates.forEach((cand) => {
    const btn = document.createElement('button');
    btn.textContent = `${cand.catalogTitle} (${cand.codes.length} codes)`;
    btn.onclick = () => operation(async () => {
      const pending = window._pendingActiveList || [];
      window._pendingActiveList = null;
      // P0 (audit GPT RC-1.5) : calculer l'état régional pour CHAQUE choix de candidat,
      // même sans cheats en attente. Avant, window._regionMismatch restait null et le
      // toggle manuel permettait l'activation sans confirmation.
      const regionState = await computeRegionStateForCandidate(meta ? meta.name : null, cand);
      const { gameRegion, regionMismatch, regionUncertain, regionSafe, detectRegion } = regionState;
      // Mettre à jour l'état régional global
      if (regionMismatch || regionUncertain) {
        window._regionMismatch = regionUncertain
          ? { gameRegion: 'inconnue', catalogRegion: detectRegion(cand.catalogTitle), catalogTitle: cand.catalogTitle, uncertain: true }
          : { gameRegion, catalogRegion: detectRegion(cand.catalogTitle), catalogTitle: cand.catalogTitle };
        window._regionConfirmed = false;
      } else {
        window._regionMismatch = null;
      }
      // P2 (audit GPT RC-1.5) : ne PAS marquer comme 'user-confirmed' avant vérification régionale.
      // Utiliser 'selected-unverified' jusqu'à confirmation explicite.
      try {
        if (meta && meta.canonical_sha256) {
          await editionDB.set('sha256:' + meta.canonical_sha256, {
            catalogTitle: cand.catalogTitle,
            verifiedAt: new Date().toISOString(),
            source: regionSafe ? 'user-confirmed' : 'selected-unverified',
            gameRegion: gameRegion || 'inconnue',
          });
        }
      } catch (e) { console.warn('Mémorisation édition:', e.message); }
      const known = cand.codes.filter(c => c && typeof c.code === 'string').map((c, idx) => {
        const isXploder = c.source === 'Xploder' || /^\$/.test(String(c.code).trim());
        const valid = codeValid(c.code);
        return {
          name: c.name + (isXploder ? ' \u26a0\ufe0f (Xploder: non support\u00e9)' : (!valid ? ' \u26a0\ufe0f (incompatible)' : '')),
          code: c.code, source: 'catalogue', validated: false,
          incompatible: isXploder || !valid,
          // P0 (audit GPT RC-1.5) : marquer needsRegionConfirm sur CHAQUE cheat du candidat
          // si la région n'est pas sûre. Avant, ce flag était absent et toggle() permettait
          // l'activation manuelle sans confirmation.
          needsRegionConfirm: !regionSafe,
        };
      });
      const mine = ((await cheatDB.get(gameKey(meta)).catch(() => null)) ?? []).filter(c => codeValid(c.code)).map(c => ({ ...c, source: 'manuel' }));
      cheats = [...known, ...mine].map(c => ({ ...c, on: false }));
      for (const a of pending) {
        const existing = cheats.find(c => c.name === a.name && c.code === a.code);
        if (existing) existing.on = true;
        else cheats.push({ name: a.name, code: a.code, source: 'état', on: true });
      }
      // Appliquer les cheats différés qui correspondent à cette édition
      // B02 : vérifier aussi _pendingCheatRestore (nouveau) en plus de _deferredCheatList (ancien)
      // P0 (audit GPT RC-1.4) : le verrou régional s'applique à TOUS les chemins.
      // Avant ce fix, le choix d'une édition USA pour un jeu Europe appelait setCheats()
      // sans vérifier _regionConfirmed. Maintenant on calcule regionSafe comme dans loadCheats().
      const deferred = window._deferredCheatList || [];
      window._deferredCheatList = null;
      const pendingRestore = window._pendingCheatRestore || [];
      window._pendingCheatRestore = [];
      const allDeferred = [...deferred, ...pendingRestore];
      if (allDeferred.length > 0 && sessions.current) {
        // P0: calculer la sécurité régionale pour cette édition choisie
        const { detectRegion: dr, detectRegions: drs, regionsCompatible: rc } = await import('./cheat-catalog-psx.mjs');
        const gRegion = meta ? dr(meta.name) : null;
        const cRegions = drs(cand.catalogTitle) || (dr(cand.catalogTitle) ? [dr(cand.catalogTitle)] : null);
        const rMismatch = gRegion && cRegions && !rc(gRegion, cRegions);
        const rUncertain = !gRegion && cRegions;
        const rSafe = (!rMismatch && !rUncertain) || window._regionConfirmed === true;
        if (!rSafe) {
          // PAS SÛR : remettre en attente, afficher l'avertissement régional
          // P0 (audit GPT RC-1.5) : NE PAS marquer on=true pour les cheats bloqués.
          // Utiliser un état 'pending' distinct pour éviter l'affichage trompeur "ACTIF".
          window._pendingCheatRestore = allDeferred;
          window._regionMismatch = rUncertain
            ? { gameRegion: 'inconnue', catalogRegion: dr(cand.catalogTitle), catalogTitle: cand.catalogTitle, uncertain: true }
            : { gameRegion: gRegion, catalogRegion: dr(cand.catalogTitle), catalogTitle: cand.catalogTitle };
          // Marquer comme 'pending' (en attente), PAS comme 'on' (actif)
          // L'UI affichera "EN ATTENTE" au lieu de "ACTIF"
          for (const p of allDeferred) {
            const existing = cheats.find(c => c.name === p.name && c.code === p.code);
            if (existing && !existing.incompatible) {
              existing.pending = true;  // En attente de confirmation, pas actif
              existing.on = false;      // Explicitement pas actif
            }
          }
          console.warn('P0: édition choisie mais région non confirmée — cheats en attente, setCheats() BLOQUÉ.');
        } else {
          // SÛR : marquer et injecter
          for (const p of allDeferred) {
            const existing = cheats.find(c => c.name === p.name && c.code === p.code);
            if (existing && !existing.incompatible) existing.on = true;
          }
          const toApply = cheats.filter(c => c.on && !c.incompatible).map(c => ({ name: c.name, code: lines(c.code).join('+') }));
          if (toApply.length > 0) {
            sessions.current.api.setCheats(toApply);
            event('cheats.applied', { count: toApply.length, deferred: true, afterEditionChoice: true, regionSafe: true });
          }
        }
      }
      const nActive = cheats.filter(c => c.on).length;
      const nPending = cheats.filter(c => c.pending).length;
      // P0 (audit GPT RC-1.5) : distinguer ACTIF (injecté) vs EN ATTENTE (bloqué)
      let statusMsg = ' Tous désactivés par défaut.';
      if (nActive > 0) {
        statusMsg = ` ${nActive} restauré(s) ACTIF(s).`;
      } else if (nPending > 0) {
        statusMsg = ` ${nPending} en ATTENTE de confirmation régionale (non injectés).`;
      }
      say('cheat-info', `${cheats.length} code(s) — ${cand.catalogTitle}.` + statusMsg, nActive > 0 || nPending > 0);
      renderCheats();
    });
    list.append(btn);
  });
  controls();
}
function applyCheats() { sessions.current.api.setCheats(activeCheats().map(c => ({ name: c.name, code: lines(c.code).join('+') }))); event('cheats.applied', { count: activeCheats().length }); }
async function toggle(index, on) {
  if (on && cheats[index].incompatible) {
    say('save-note', 'Code incompatible : ne peut pas être activé (format non supporté par PCSX ReARMed).', true);
    renderCheats();
    return;
  }
  // P0 (audit GPT RC-1.5) : le verrou régional centralisé s'applique à TOUS les chemins.
  // Avant : seulement si needsRegionConfirm était défini sur le cheat.
  // Maintenant : vérifie l'état régional global, pas juste le flag du cheat.
  if (on && !isRegionActivationAllowed()) {
    say('save-note', '⚠️ Région différente : confirmez ci-dessous que ces codes correspondent à votre disque avant de les activer.', true);
    renderCheats();
    return;
  }
  // Ancien check par cheat (gardé pour compatibilité)
  if (on && cheats[index].needsRegionConfirm && !window._regionConfirmed) {
    say('save-note', '⚠️ Région différente : confirmez ci-dessous que ces codes correspondent à votre disque avant de les activer.', true);
    renderCheats();
    return;
  }
  cheats[index].on = on;
  try { applyCheats(); } catch (error) { cheats[index].on = !on; renderCheats(); throw error; }
  renderCheats(); say('save-note', `Cheats actifs : ${activeCheats().length}. Un cheat peut modifier la partie de façon durable ; désactiver un code n’annule pas toujours ses effets.`);
}
async function loadCheats(m, activeList = []) {
  window._regionConfirmed = false;
  window._regionMismatch = null;
  window._pendingActiveList = null;
  const { detectRegion, detectRegions, regionsCompatible, detectMod } = await import('./cheat-catalog-psx.mjs');
  // PRIORITÉ 0 : mémoire locale du choix d'édition (par empreinte SHA-256 du fichier)
  // Honnêteté (B03) : c'est une mémorisation du choix précédent, PAS une lecture du serial interne.
  let result = null;
  let fromMemory = false;
  try {
    const remembered = await editionDB.get('sha256:' + m.canonical_sha256).catch(() => null);
    if (remembered && remembered.catalogTitle) {
      const catalog = await loadCatalog().catch(() => null);
      const codes = catalog && catalog.byTitle[remembered.catalogTitle];
      if (codes) {
        result = { status: 'match', cheats: codes.map(c => ({ ...c, validated: false })), candidates: [],
                   catalogTitle: remembered.catalogTitle, catalogRegion: detectRegion(remembered.catalogTitle),
                   catalogRegions: detectRegions(remembered.catalogTitle),
                   fromVerifiedMemory: true };
        fromMemory = true;
      }
    }
  } catch (e) { console.warn('Mémoire édition:', e.message); }
  if (!result) {
    result = await findCheatsForGame(m.serial, m.name).catch(err => ({ status: 'load_error', cheats: [], candidates: [], error: err.message }));
  }
  const mine = ((await cheatDB.get(gameKey(m)).catch(() => null)) ?? []).filter(c => codeValid(c.code)).map(c => ({ ...c, source: 'manuel', on: false }));
  if (!result || !['match', 'ambiguous', 'mod_candidate', 'no_match', 'load_error'].includes(result.status)) {
    throw new Error('Réponse du catalogue de cheats invalide');
  }
  // Branche ambiguous : afficher d'abord les codes existants, PUIS ajouter les boutons
  if (result.status === 'ambiguous') {
    cheats = mine;
    for (const a of activeList) {
      const existing = cheats.find(c => c.name === a.name && c.code === a.code);
      if (existing) existing.on = true;
      else cheats.push({ name: a.name, code: a.code, source: 'état', on: true });
    }
    window._pendingActiveList = activeList;
    renderCheats(); // D'ABORD : codes manuels/restaurés
    renderCheatCandidates(result.candidates); // ENSUITE : boutons USA/World (sans effacer)
    const nActive = activeList.length;
    say('cheat-info', nActive > 0
      ? `⚠️ ${nActive} code(s) restauré(s) sont ACTIFS dans le moteur. Choisissez votre édition pour les voir et les gérer.`
      : 'Plusieurs éditions : choisissez celle de votre disque. Aucun code activé.', nActive > 0);
    return; // NE PAS rappeler renderCheats() ici
  }
  // P1 (audit GPT RC-1.3) : mod détecté — proposer les cheats du jeu de base
  // comme CANDIDATS NON VÉRIFIÉS. Jamais auto-activés.
  if (result.status === 'mod_candidate') {
    cheats = mine; // Seulement les codes manuels pour l'instant
    renderCheats();
    const modInfo = result.modInfo || {};
    say('cheat-info', `🎮 Mod détecté : "${modInfo.originalTitle || m.name}". Aucun cheat spécifique trouvé.`, false);
    // Afficher les candidats du jeu de base avec avertissement
    const list = $('cheat-list');
    const warn = document.createElement('div');
    warn.style.cssText = 'padding:10px;margin:8px 0;border:2px solid #f90;background:#2a1a00;border-radius:6px;';
    warn.innerHTML = `⚠️ <strong>Jeu modifié détecté</strong> (base : ${modInfo.baseTitle || 'inconnue'}).<br>` +
      `Les codes ci-dessous viennent du jeu <strong>original non modifié</strong> et sont <strong>NON VÉRIFIÉS</strong> pour ce mod.<br>` +
      `Ils peuvent ne pas fonctionner ou corrompre votre partie. <strong>Jamais activés automatiquement.</strong>`;
    list.append(warn);
    // Boutons pour chaque candidat du jeu de base
    result.candidates.forEach((cand) => {
      const btn = document.createElement('button');
      btn.style.cssText = 'margin:4px;';
      btn.textContent = `Voir les ${cand.codes.length} codes de "${cand.catalogTitle}" (NON VÉRIFIÉS)`;
      btn.onclick = () => operation(async () => {
        // Afficher les codes comme candidats non vérifiés, tous désactivés
        const known = cand.codes.filter(c => c && typeof c.code === 'string').map((c) => ({
          name: (c.name || 'Code sans nom') + ' ⚠️ (NON VÉRIFIÉ pour ce mod)',
          code: c.code, source: 'catalogue', validated: false,
          incompatible: false, on: false,
          needsRegionConfirm: true, // Toujours exiger confirmation pour un mod
          isModCandidate: true,
        }));
        cheats = [...known, ...mine.map(c => ({ ...c, on: false }))];
        window._regionMismatch = { gameRegion: 'mod', catalogRegion: 'original', catalogTitle: cand.catalogTitle, isMod: true };
        window._regionConfirmed = false;
        renderCheats();
        say('cheat-info', `⚠️ ${known.length} code(s) du jeu original affichés comme NON VÉRIFIÉS. Confirmez avant d'activer.`, true);
      });
      list.append(btn);
    });
    return;
  }
  if (result.status === 'load_error') {
    cheats = mine;
    for (const a of activeList) {
      const existing = cheats.find(c => c.name === a.name && c.code === a.code);
      if (existing) existing.on = true;
      else cheats.push({ name: a.name, code: a.code, source: 'état', on: true });
    }
    renderCheats();
    say('cheat-info', `Impossible de charger les cheats : ${result.error || 'erreur inconnue'}`, true);
    return;
  }
  const catalogCheats = Array.isArray(result.cheats) ? result.cheats : [];
  // R1 (audit GPT RC-1.2) : détecter le décalage de région avec ensembles multi-régions
  // Ex: catalogue "(USA, Europe)" + jeu "Europe" → PAS de conflit (Europe ∈ {USA, Europe})
  const gameRegion = detectRegion(m.name);
  const catalogRegion = result.catalogRegion || null;
  const catalogRegions = result.catalogRegions || (catalogRegion ? [catalogRegion] : null);
  // R1: utiliser regionsCompatible pour les catalogues multi-régions
  // R2: si gameRegion est null (inconnu), on ne peut PAS conclure qu'il n'y a pas de conflit
  const regionMismatch = gameRegion && catalogRegions && !regionsCompatible(gameRegion, catalogRegions);
  const regionUncertain = !gameRegion && catalogRegion; // R2: région du disque inconnue
  const known = catalogCheats.filter(c => c && typeof c.code === 'string').map((c, idx) => {
    const displayName = c.name || `Code sans nom #${idx + 1} — non vérifié`;
    const isXploder = c.source === 'Xploder' || /^\$/.test(c.code.trim());
    const valid = codeValid(c.code);
    // BLOCAGE A (audit GPT RC-1.3) : needsRegionConfirm doit inclure regionUncertain.
    // Avant : !!regionMismatch seul → un jeu à région inconnue (ex: "Final Fantasy 5.pbp")
    // permettait l'activation manuelle sans confirmation.
    const needsConfirmation = Boolean(regionMismatch || regionUncertain);
    return {
      name: displayName + (isXploder ? ' ⚠️ (Xploder: non supporté)' : (!valid ? ' ⚠️ (incompatible)' : '') + (regionMismatch ? ` ⚠️ (région ${catalogRegion}, votre disque: ${gameRegion})` : '') + (regionUncertain ? ` ⚠️ (région du disque inconnue)` : '')),
      code: c.code, source: 'catalogue', validated: false,
      incompatible: isXploder || !valid, on: false,
      regionMismatch: !!regionMismatch,
      regionUncertain: !!regionUncertain,
      needsRegionConfirm: needsConfirmation,
    };
  });
  cheats = [...known, ...mine];
  for (const a of activeList) {
    const existing = cheats.find(c => c.name === a.name && c.code === a.code);
    if (existing) existing.on = true;
    else cheats.push({ name: a.name, code: a.code, source: 'état', on: true });
  }
  // FIX 1: si décalage de région, exiger confirmation avant activation
  // R2: si région incertaine, exiger aussi confirmation
  if (regionMismatch) {
    window._regionMismatch = { gameRegion, catalogRegion, catalogTitle: result.catalogTitle };
  } else if (regionUncertain) {
    window._regionMismatch = { gameRegion: 'inconnue', catalogRegion, catalogTitle: result.catalogTitle, uncertain: true };
  } else {
    window._regionMismatch = null;
  }
  renderCheats();
  // B02 (audit GPT RC-1.1) : la mémoire locale ne doit JAMAIS contourner un désaccord de région.
  // Même si fromMemory=true, un regionMismatch non confirmé bloque l'injection.
  // Principe : ne pas faire confiance à la mémoire pour ignorer un conflit USA/Europe/World.
  // R2 (audit GPT RC-1.2) : région INCONNUE ≠ région compatible.
  // Si gameRegion est null (ex: "Final Fantasy 5.pbp" sans suffixe) et que le catalogue
  // a une région, on ne peut PAS conclure à la sécurité — exiger confirmation.
  const regionSafe = (!regionMismatch && !regionUncertain) || window._regionConfirmed === true;
  const identifiedEdition = result.status === 'match';
  const isSafe = identifiedEdition && regionSafe && !result.error;
  const pendingRestore = window._pendingCheatRestore || [];
  window._pendingCheatRestore = [];
  let restoredApplied = false; // Pour sync UI : vrai si on a vraiment injecté
  if (pendingRestore.length > 0 && sessions.current) {
    if (isSafe) {
      // Appliquer : marquer les cheats correspondants comme "on" et les envoyer au moteur
      let appliedCount = 0;
      for (const p of pendingRestore) {
        const existing = cheats.find(c => c.name === p.name && c.code === p.code);
        if (existing && !existing.incompatible) {
          existing.on = true;
          appliedCount++;
        }
      }
      if (appliedCount > 0) {
        const toApply = cheats.filter(c => c.on && !c.incompatible).map(c => ({ name: c.name, code: lines(c.code).join('+') }));
        sessions.current.api.setCheats(toApply);
        event('cheats.restored', { count: appliedCount, safe: true });
        restoredApplied = true; // B02: marquer l'injection réelle pour sync UI
        renderCheats();
        say('cheat-info', `✅ ${appliedCount} cheat(s) restauré(s) et appliqué(s) — édition confirmée (${result.catalogTitle}).`, false);
      } else {
        say('cheat-info', `⚠️ ${pendingRestore.length} cheat(s) restauré(s) non trouvés dans le catalogue de cette édition. Aucune injection.`, true);
      }
    } else {
      // Non sûr : garder en attente, l'utilisateur doit confirmer l'édition
      window._pendingCheatRestore = pendingRestore; // Remettre en attente
      const reason = result.status === 'ambiguous' ? 'édition ambiguë' :
                     result.status === 'no_match' ? 'aucune édition trouvée' :
                     result.status === 'load_error' ? 'catalogue indisponible' :
                     regionMismatch ? `décalage région (${gameRegion} vs ${catalogRegion})` : 'édition non vérifiée';
      say('cheat-info', `⏸️ ${pendingRestore.length} cheat(s) restauré(s) en attente — ${reason}. Choisissez/confirmez l'édition pour les appliquer.`, true);
      console.warn('B02: Restauration différée —', reason);
    }
  }
  // B02: ne pas écraser le message de restauration avec "tous désactivés" si on vient d'injecter
  if (restoredApplied) {
    // Le message de restauration a déjà été affiché ci-dessus, ne pas le masquer
  } else if (result.status === 'no_match') {
    // P1 (audit GPT RC-1.3) : message différencié — éviter "aucun cheat" quand c'est juste non reconnu
    const modCheck = (() => { try { return detectMod(m.name || ''); } catch { return { isMod: false }; } })();
    if (modCheck.isMod) {
      say('cheat-info', `🎮 Mod détecté mais jeu de base introuvable dans le catalogue. Vous pouvez ajouter des codes manuellement ci-dessous.`, false);
    } else {
      say('cheat-info', `🔍 Jeu non reconnu dans le catalogue (${m.name || 'sans nom'}). Ce n'est pas forcément qu'il n'existe pas de cheats — le titre peut différer. Codes manuels conservés.`, false);
    }
  } else if (fromMemory && !regionMismatch) {
    say('cheat-info', `✅ Édition mémorisée reconnue (${result.catalogTitle}). ${cheats.length} code(s), tous désactivés par défaut. Choix précédent sur cet appareil.`, false);
  } else if (fromMemory && regionMismatch) {
    // B02: mémoire + décalage région = avertissement, PAS de "désactivés par défaut" trompeur
    say('cheat-info', `⚠️ Édition mémorisée (${result.catalogTitle}, ${catalogRegion}) mais votre disque semble être ${gameRegion}. Confirmez ci-dessous avant d'activer.`, true);
  } else if (regionMismatch) {
    say('cheat-info', `⚠️ Ces codes proviennent de l'édition ${catalogRegion} (${result.catalogTitle}), votre disque semble être ${gameRegion}. Confirmez ci-dessous avant d'activer.`, true);
  }
}
async function optionalLoad(identity, slot, kind, previous = false) {
  try { return await vault.load(identity, slot, { kind, previous }); } catch (error) { if (error.code === 'E_EMPTY') return null; throw error; }
}
async function saveBattery(force) {
  const current = sessions.current; if (!current) return;
  const bytes = current.api.captureBattery();
  if (!bytes) { if (force) say('save-note', 'Ce jeu n’a pas (encore) produit de carte mémoire ou de sauvegarde native.'); return; }
  await vault.put(current.batteryIdentity, 1, await makeStateEnvelope(bytes, current.batteryIdentity, { kind: 'battery', label: 'Carte mémoire' }));
  event('battery.saved', { bytes: bytes.length }); if (force) say('save-note', 'Carte mémoire enregistrée pour ce jeu.');
}
async function refreshSlots() {
  if (!sessions.current) return;
  const slot = Number($('slot').value), row = (await vault.list(sessions.current.identity, { kind: 'state' })).find(r => r.slot === slot);
  say('slot-info', row ? `Emplacement ${slot} : ${new Date(row.created_utc).toLocaleString('fr-FR')} · révision ${row.revision}${row.cheats.length ? ' · cheats actifs à l’enregistrement' : ''}` : `Emplacement ${slot} : vide pour ce jeu et ce moteur.`);
}
async function launch(prepared, { state = null, battery, cheatList = [], input } = {}) {
  if (sessions.current) await saveBattery(false).catch(error => event('battery.save.failed', { message: error.message }));
  const config = input ?? normalizeInput(await inputDB.get(gameKey(prepared.metadata)).catch(() => null)),
    candidate = await sessions.prepare(prepared, config);
  try {
    const stored = battery === undefined ? await optionalLoad(candidate.batteryIdentity, 1, 'battery') : null;
    say('status', state ? 'Restauration dans une session neuve…' : 'Démarrage du jeu…');
    // B02 (audit GPT RC-1.0) : NE JAMAIS réinjecter de cheats au démarrage.
    // Les cheats restaurés sont conservés en pending et ne seront appliqués
    // via setCheats() qu'APRÈS validation complète de l'édition (série/région/révision)
    // et confirmation explicite de l'utilisateur si nécessaire.
    // Cela évite l'injection de codes d'une mauvaise région/édition dans le moteur.
    if (cheatList.length > 0) {
      window._pendingCheatRestore = cheatList;
      console.warn('B02: ' + cheatList.length + ' cheat(s) restauré(s) mis en attente — aucune injection au démarrage.');
    } else {
      window._pendingCheatRestore = [];
    }
    await sessions.start(candidate, { battery: battery === undefined ? stored?.bytes ?? null : battery, state, cheats: [] });
  } catch (error) { if (candidate.frame.isConnected && sessions.current !== candidate) await sessions.dispose(candidate); throw error; }
  meta = prepared.metadata; selected = null; show(meta); $('current').textContent = meta.name; $('d-engine').textContent = 'Moteur lancé — fonctionnement non validé par un test réel';
  await loadCheats(meta, []); await refreshSlots();
  const savedProfile = (candidate.input && candidate.input._profile) || DEFAULT_PROFILE_ID;
  fillInput(candidate.input); $('in-profile').value = PROFILES[savedProfile] ? savedProfile : DEFAULT_PROFILE_ID; showPad(candidate);
  say('status', 'Session lancée. Vérifiez l’image, le son et la manette ; vous pouvez choisir un autre jeu sans fermer la page.');
}
async function loadState(previous) {
  const current = sessions.current, slot = Number($('slot').value), loaded = await vault.load(current.identity, slot, { kind: 'state', previous });
  const bundle = unpackStateBundle(loaded.bytes), list = loaded.envelope.metadata.cheats ?? [];
  if (list.length && !confirm('Cet état a été enregistré avec des cheats actifs. Le charger rétablira leurs effets. Continuer ?')) return;
  await launch(current.prepared, { state: bundle.state, battery: bundle.battery, cheatList: list, input: current.input });
  event('state.loaded', { slot, previous, payload_sha256: loaded.envelope.payload_sha256 }); say('save-note', 'État restauré dans une session neuve. Vérifiez image, son et commandes.');
}
$('choose').onclick = () => $('disc-file').click();
$('disc-file').onchange = () => operation(async () => {
  const file = $('disc-file').files[0]; $('disc-file').value = ''; if (!file) return;
  selected = null; show(null); say('status', 'Lecture et vérification locales (le fichier ne quitte pas ce PC)…');
  selected = await prepareDisc(file); show(selected.metadata);
  say('status', `Disque prêt : ${selected.metadata.name}. ${sessions.current ? 'Le jeu en cours reste ouvert jusqu’au lancement.' : 'Cliquez sur Lancer.'}`);
});
$('launch').onclick = () => operation(() => launch(selected));
$('audio').onclick = () => operation(async () => { await sessions.current.api.resumeAudio(); });
$('battery-save').onclick = () => operation(() => saveBattery(true));
$('slot').onchange = () => { void refreshSlots().catch(error => say('save-note', error.message, true)); };
$('state-save').onclick = () => operation(async () => {
  const current = sessions.current, slot = Number($('slot').value); await current.api.pause();
  try {
    const bundle = packStateBundle(current.api.captureState(), current.api.captureBattery());
    const saved = await vault.put(current.identity, slot, await makeStateEnvelope(bundle, current.identity, { kind: 'state', label: meta.name.slice(0, 120), cheats: activeCheats() }));
    await saveBattery(false); event('state.saved', { slot, revision: saved.revision });
    say('save-note', `État enregistré dans l’emplacement ${slot}. La version précédente reste récupérable.`); await refreshSlots();
  } finally { await current.api.play(); }
});
$('state-load').onclick = () => operation(() => loadState(false));
$('state-previous').onclick = () => operation(() => loadState(true));
$('cheat-off').onclick = () => operation(async () => { cheats.forEach(c => { c.on = false; }); applyCheats(); renderCheats(); });
$('serial-apply').onclick = () => operation(async () => {
  const input = $('serial-input').value.trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z]{4}-\d{5}$/.test(input)) {
    say('cheat-info', 'Format invalide. Exemple : SLUS-01156', true);
    return;
  }
  const catalog = await loadCatalog().catch(() => null);
  if (!catalog) { say('cheat-info', 'Catalogue indisponible.', true); return; }
  // Chercher par serial direct ou via serialMap
  let catalogTitle = null;
  let codes = catalog.bySerial[input];
  if (codes) {
    // Trouver le titre correspondant
    for (const [title, c] of Object.entries(catalog.byTitle)) {
      if (c === codes) { catalogTitle = title; break; }
    }
  } else if (catalog.serialMap[input] && catalog.byTitle[catalog.serialMap[input]]) {
    catalogTitle = catalog.serialMap[input];
    codes = catalog.byTitle[catalogTitle];
  }
  if (!codes || !catalogTitle) {
    say('cheat-info', `Aucun jeu trouvé pour le numéro ${input} dans le catalogue.`, true);
    return;
  }
  // Mémoriser : serial saisi manuellement = identification exacte par l'utilisateur
  try {
    if (meta && meta.canonical_sha256) {
      await editionDB.set('sha256:' + meta.canonical_sha256, {
        catalogTitle, serial: input,
        verifiedAt: new Date().toISOString(),
        source: 'manual-serial',
      });
    }
  } catch (e) { console.warn('Mémorisation serial:', e.message); }
  // Afficher les cheats
  const { detectRegion, detectRegions, regionsCompatible } = await import('./cheat-catalog-psx.mjs');
  window._regionMismatch = null;
  window._regionConfirmed = true; // Serial = identification exacte, pas besoin de confirmation région
  const known = codes.filter(c => c && typeof c.code === 'string').map((c, idx) => {
    const displayName = c.name || `Code sans nom #${idx + 1} — non vérifié`;
    const isXploder = c.source === 'Xploder' || /^\$/.test(c.code.trim());
    const valid = codeValid(c.code);
    return {
      name: displayName + (isXploder ? ' ⚠️ (Xploder: non supporté)' : (!valid ? ' ⚠️ (incompatible)' : '')),
      code: c.code, source: 'catalogue', validated: false,
      incompatible: isXploder || !valid, on: false,
    };
  });
  const mine = ((await cheatDB.get(gameKey(meta)).catch(() => null)) ?? []).filter(c => codeValid(c.code)).map(c => ({ ...c, source: 'manuel', on: false }));
  cheats = [...known, ...mine];
  renderCheats();
  say('cheat-info', `✅ Jeu identifié : ${catalogTitle} (${input}). ${cheats.length} code(s), tous désactivés. Mémorisé pour la prochaine fois.`, false);
});
$('cheat-add').onclick = () => operation(async () => {
  const name = $('cheat-name').value.trim(), code = lines($('cheat-code').value).join('\n');
  if (!name || name.length > 120) throw new Error('Donnez un nom au code (120 caractères au plus).');
  if (!codeValid(code)) throw new Error('Code invalide : une ligne par instruction, au format « 8001AB00 0001 » (GameShark).');
  await cheatDB.set(gameKey(meta), [...cheats.filter(c => c.source === 'manuel').map(({ name, code }) => ({ name, code })), { name, code }]);
  cheats.push({ name, code, source: 'manuel', on: false }); $('cheat-name').value = ''; $('cheat-code').value = ''; renderCheats(); say('save-note', 'Code ajouté pour ce jeu, désactivé.');
});
$('export').onclick = () => {
  const blob = new Blob([JSON.stringify({ app: 'emuperso-ps1-web ' + APP_VERSION, tested: false, game: meta && { name: meta.name, size: meta.size, serial: meta.serial, sha256: meta.canonical_sha256 }, session: sessions.diagnostic(), events: records }, null, 1)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'EMUPERSO-ps1-diagnostic.json'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 5000);
};
const readInput = () => normalizeInput({ analog: $('in-analog').value, stickToDpad: $('in-dpad').checked, deadzone: Number($('in-dz').value), native: $('in-native').checked });
function applyProfileToUI(id) {
  const preset = PROFILES[id] ?? PROFILES[DEFAULT_PROFILE_ID] ?? Object.values(PROFILES)[0];
  if (!preset) return;
  const cfg = preset.config;
  $('in-analog').value = cfg.analog; $('in-dpad').checked = cfg.stickToDpad;
  $('in-dz').value = String(cfg.deadzone); $('in-dz-out').textContent = cfg.deadzone.toFixed(2).replace('.', ',');
  $('in-native').checked = cfg.native;
  $('in-profile').value = preset.id; event('input.profile', { profile: preset.id, label: preset.label });
}
$('in-profile').onchange = () => applyProfileToUI($('in-profile').value);
function fillInput(cfg) { $('in-analog').value = cfg.analog; $('in-dpad').checked = cfg.stickToDpad; $('in-dz').value = String(cfg.deadzone); $('in-dz-out').textContent = cfg.deadzone.toFixed(2).replace('.', ','); $('in-native').checked = cfg.native; }
function showPad(candidate) {
  const status = candidate.api.inputStatus?.(), cfg = candidate.input;
  say('pad-status', `${status?.mode === 'custom' ? 'Disposition personnalisée active' : status?.mode === 'disabled' ? 'Lecteur de manette désactivé' : 'Commandes natives d’EmulatorJS'} (aucun test réel). ${status?.reason ?? ''}Type émulé demandé : ${cfg.analog === 'off' ? 'numérique' : cfg.analog}. Si la manette n’est pas détectée, appuyez sur un de ses boutons.`, status?.mode === 'disabled');
  event('input.status', { ...status, profile: cfg });
}
$('in-dz').oninput = () => { $('in-dz-out').textContent = Number($('in-dz').value).toFixed(2).replace('.', ','); };
$('in-apply').onclick = () => operation(async () => {
  const cfg = { ...readInput(), _profile: $('in-profile').value }, current = sessions.current;
  if (!confirm('Le jeu va redémarrer avec ces commandes : la carte mémoire est enregistrée, mais la partie en cours non sauvegardée sera perdue. Les états enregistrés avec un autre type de manette restent séparés. Continuer ?')) return;
  await inputDB.set(gameKey(meta), cfg); await launch(current.prepared, { input: cfg });
});
// Ancien catalogue vide supprimé (RC-1.0) — le catalogue PS1 est dans data/psx-catalog.json
show(null); renderCheats();
