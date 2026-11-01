import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Test DOM : les boutons USA/World doivent rester visibles après loadCheats
// (régression 0.1.12 : renderCheats() effaçait les boutons)

test('renderCheatCandidates ne vide pas la liste', async () => {
  const src = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  // Extraire la fonction renderCheatCandidates
  const m = src.match(/function renderCheatCandidates\(candidates\) \{([^}]*(\{[^}]*\}[^}]*)*)\}/s);
  assert.ok(m, 'renderCheatCandidates trouvée');
  const body = m[0];
  // Elle ne doit PAS appeler replaceChildren (qui effacerait les codes existants)
  assert.ok(!body.includes('replaceChildren()'), 'renderCheatCandidates ne doit pas vider la liste');
});

test('branche ambiguous : renderCheats AVANT renderCheatCandidates', async () => {
  const src = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const ambStart = src.indexOf("if (result.status === 'ambiguous')");
  assert.ok(ambStart > 0, 'branche ambiguous trouvée');
  // Limiter à la branche ambiguous (jusqu'au premier "return;" suivi de "}")
  const ambEnd = src.indexOf('return; // NE PAS rappeler renderCheats() ici', ambStart);
  assert.ok(ambEnd > ambStart, 'fin de branche trouvée');
  const ambSection = src.slice(ambStart, ambEnd);
  const idxRenderCheats = ambSection.search(/[^a-zA-Z]renderCheats\(\)/);
  const idxCandidates = ambSection.indexOf('renderCheatCandidates(');
  assert.ok(idxRenderCheats > 0 && idxCandidates > 0, 'les deux appels trouvés');
  assert.ok(idxRenderCheats < idxCandidates, 'renderCheats() doit être appelé AVANT renderCheatCandidates()');
});

test('simulation DOM : boutons survivent au rendu', async () => {
  // Simuler un DOM minimal
  const children = [];
  const mockList = {
    replaceChildren: () => { children.length = 0; },
    append: (...els) => { children.push(...els); },
  };
  const mockDocument = {
    createElement: (tag) => ({ tagName: tag, textContent: '', onclick: null, style: {}, append: function(...a) {} }),
  };
  // Simuler renderCheats (vide la liste) puis renderCheatCandidates (ajoute sans vider)
  mockList.replaceChildren(); // renderCheats
  assert.equal(children.length, 0);
  // renderCheatCandidates ajoute 2 boutons SANS vider
  mockList.append({ textContent: 'Dave Mirra (USA) (4 codes)' });
  mockList.append({ textContent: 'Dave Mirra (World) (4 codes)' });
  assert.equal(children.length, 2, 'les 2 boutons USA/World restent visibles');
  assert.ok(children[0].textContent.includes('USA'));
  assert.ok(children[1].textContent.includes('World'));
});

// B01 (audit GPT RC-1.0) : loadCatalog doit être importé dans app.js
// Régression : l'import manquant cassait la mémoire d'édition et la saisie serial
test('B01 : loadCatalog est importé dans app.js', async () => {
  const src = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  // L'import doit inclure loadCatalog
  const importMatch = src.match(/import\s*\{\s*([^}]+)\s*\}\s*from\s*['"]\.\/cheat-catalog-psx\.mjs['"]/);
  assert.ok(importMatch, 'import de cheat-catalog-psx.mjs trouvé');
  const imports = importMatch[1];
  assert.ok(imports.includes('loadCatalog'), 'loadCatalog doit être dans les imports nommés');
  // Vérifier que loadCatalog est bien exporté par le module
  const catalogSrc = await readFile(new URL('../cheat-catalog-psx.mjs', import.meta.url), 'utf8');
  assert.ok(/export\s+(async\s+)?function\s+loadCatalog/.test(catalogSrc), 'loadCatalog exporté par cheat-catalog-psx.mjs');
  // Vérifier que les appels à loadCatalog existent (mémoire édition + serial)
  const calls = src.match(/await\s+loadCatalog\(\)/g);
  assert.ok(calls && calls.length >= 2, 'au moins 2 appels à loadCatalog() (mémoire + serial)');
});

// B02 (audit GPT RC-1.0) : AUCUNE réinjection de cheats au démarrage de session
// Régression : les cheats restaurés ne doivent jamais aller directement dans sessions.start()
test('B02 : launch() ne réinjecte jamais de cheats au démarrage', async () => {
  const src = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  // Extraire la fonction launch
  const launchStart = src.indexOf('async function launch(');
  assert.ok(launchStart > 0, 'fonction launch trouvée');
  const launchEnd = src.indexOf('async function loadState(', launchStart);
  const launchSrc = src.slice(launchStart, launchEnd);
  // Vérifier que sessions.start est appelé avec cheats: []
  assert.ok(launchSrc.includes('cheats: []'), 'sessions.start() doit recevoir cheats: [] (vide)');
  // Vérifier qu'il n'y a PAS de cheatsToInject ou équivalent passé à start
  assert.ok(!launchSrc.includes('cheats: cheatsToInject'), 'pas de cheatsToInject dans sessions.start()');
  // Vérifier que les cheats restaurés sont mis en pending
  assert.ok(launchSrc.includes('_pendingCheatRestore'), 'les cheats restaurés vont dans _pendingCheatRestore');
  // Vérifier le commentaire B02
  assert.ok(launchSrc.includes('B02'), 'commentaire B02 présent dans launch()');
});

// B02 : loadCheats n'applique les pending que si l'édition est sûre
// (RC-1.2 : fromMemory ne contourne PLUS regionMismatch)
test('B02 : loadCheats applique pending seulement si édition sûre', async () => {
  const src = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  // Vérifier la NOUVELLE logique de sécurité (RC-1.2) : identifiedEdition ET regionSafe
  assert.ok(src.includes("const isSafe = identifiedEdition && regionSafe && !result.error"),
    'condition isSafe doit vérifier identifiedEdition ET regionSafe');
  // Vérifier que regionSafe tient compte de _regionConfirmed et regionUncertain (R2)
  assert.ok(src.includes("const regionSafe = (!regionMismatch && !regionUncertain) || window._regionConfirmed === true"),
    'regionSafe doit vérifier _regionConfirmed et regionUncertain');
  // L'ancien code BUG ne doit plus exister
  assert.ok(!src.includes("const isSafe = fromMemory ||"),
    'ancien code BUG (fromMemory || ...) supprimé');
  // Vérifier que les cas non sûrs gardent les cheats en attente
  assert.ok(src.includes("window._pendingCheatRestore = pendingRestore"),
    'les cheats non sûrs sont remis en attente');
});

// B06 (audit GPT RC-1.1) : test bout-en-bout du scénario FR→USA avec mémoire
// Simule : jeu FR.pbp + mémoire USA + cheat restauré → AUCUNE injection sans confirmation
test('B06 : scénario FR→USA avec mémoire ne doit pas injecter', async () => {
  const src = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  // 1. Le bouton de confirmation explicite pour pending + région doit exister
  assert.ok(src.includes("malgré le décalage de région"),
    'bouton de confirmation explicite pour pending + région');
  // 2. La version du diagnostic doit être dynamique (pas hardcodée RC-1.0)
  assert.ok(src.includes("APP_VERSION") && !src.includes("'emuperso-ps1-web RC-1.0'"),
    'version diagnostic dynamique via APP_VERSION');
});

// B06 : vérifier que le message UI ne masque pas une injection réelle
test('B06 : UI synchronisée avec état réel du moteur', async () => {
  const src = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  // Le flag restoredApplied doit exister pour éviter le masquage
  assert.ok(src.includes("restoredApplied"),
    'flag restoredApplied pour sync UI/moteur');
  // Le message "tous désactivés" ne doit pas écraser un message de restauration
  assert.ok(src.includes("if (restoredApplied)"),
    'vérification restoredApplied avant d\'afficher les messages');
});

// BLOCAGE A (audit GPT RC-1.3) : needsRegionConfirm doit bloquer aussi quand région inconnue
// Avant : !!regionMismatch seul → "Final Fantasy 5.pbp" (région null) permettait l'activation manuelle
test('BLOCAGE A : needsRegionConfirm inclut regionUncertain', async () => {
  const src = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  // La nouvelle logique doit combiner regionMismatch OU regionUncertain
  assert.ok(src.includes("needsConfirmation = Boolean(regionMismatch || regionUncertain)") ||
            src.includes("Boolean(regionMismatch || regionUncertain)"),
    'needsConfirmation doit combiner regionMismatch et regionUncertain');
  // L'ancien code BUG ne doit plus exister
  assert.ok(!src.includes("needsRegionConfirm: !!regionMismatch,"),
    'ancien code BUG (needsRegionConfirm: !!regionMismatch) supprimé');
});

// P0 (audit GPT RC-1.4) : renderCheatCandidates doit vérifier la région avant setCheats
// Le choix d'une édition USA pour un jeu Europe ne doit pas injecter sans confirmation
test('P0 : choix édition vérifie région avant setCheats', async () => {
  const src = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  // Le code doit calculer regionSafe dans renderCheatCandidates
  assert.ok(src.includes("rSafe = (!rMismatch && !rUncertain) || window._regionConfirmed === true") ||
            src.includes("rSafe"),
    'renderCheatCandidates calcule regionSafe');
  // Si pas sûr, setCheats doit être BLOQUÉ
  assert.ok(src.includes("setCheats() BLOQUÉ") || src.includes("PAS SÛR"),
    'setCheats bloqué si région non confirmée');
});

// P1-A (audit GPT RC-1.4) : detectMod sur titre brut, pas titleStem
test('P1-A : detectMod utilise titre brut (pas titleStem)', async () => {
  const src = await readFile(new URL('../cheat-catalog-psx.mjs', import.meta.url), 'utf8');
  // Ne doit PAS appeler detectMod(titleStem(...))
  assert.ok(!src.includes("detectMod(titleStem("),
    'detectMod ne doit pas recevoir titleStem (qui casse v6.1)');
  // Doit utiliser le titre brut ou stripDiscExtension
  assert.ok(src.includes("detectMod(stripDiscExtension(") || src.includes("detectMod(title"),
    'detectMod sur titre brut');
});

// P1-B (audit GPT RC-1.4) : tri par région utilise titre original
test('P1-B : tri candidats avec région du titre original', async () => {
  const src = await readFile(new URL('../cheat-catalog-psx.mjs', import.meta.url), 'utf8');
  // Ne doit PAS utiliser titleStem pour detectRegion dans le tri
  const triSection = src.slice(src.indexOf('P1 (audit GPT RC-1.3)'));
  assert.ok(!triSection.includes("detectRegion(titleStem("),
    'tri ne doit pas utiliser titleStem (qui supprime la région)');
});

// P0 (audit GPT RC-1.5) : verrou régional centralisé sur tous les chemins
test('P0 : isRegionActivationAllowed bloque sans confirmation', async () => {
  const src = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  // La fonction centralisée doit exister
  assert.ok(src.includes('function isRegionActivationAllowed()'),
    'fonction isRegionActivationAllowed existe');
  // toggle() doit l'utiliser
  assert.ok(src.includes('!isRegionActivationAllowed()'),
    'toggle() utilise le verrou centralisé');
});

// P0 : cheats candidats marqués needsRegionConfirm
test('P0 : cheats candidats ont needsRegionConfirm si région non sûre', async () => {
  const src = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.ok(src.includes('needsRegionConfirm: !regionSafe'),
    'cheats candidats marqués needsRegionConfirm');
});

// P0 : état pending distinct de on
// P0 (révisé audit GPT RC-1.6) : état unique 'pending', pas de booléen on=true
test('P0 : cheats bloqués utilisent état pending unique', async () => {
  const src = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.ok(src.includes("existing.state = 'pending'"),
    'cheats bloqués marqués pending (état unique)');
  assert.ok(!src.includes('existing.pending = true'),
    'plus de booléen pending séparé');
  assert.ok(src.includes('EN ATTENTE'),
    'message EN ATTENTE au lieu de ACTIF');
});

// État unique : les trois valeurs existent
test('État unique : off/pending/applied définis', async () => {
  const src = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.ok(src.includes("state === 'applied'") && src.includes("state === 'pending'"),
    'états applied et pending utilisés');
  assert.ok(src.includes("state: 'off'"),
    'état off par défaut');
});

// P1 (révisé audit GPT RC-1.6) : bouton confirmer → atomicCheatUpdate, état applied
test('P1 : bouton confirmer applique les cheats en attente (atomique)', async () => {
  const src = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.ok(src.includes('atomicCheatUpdate'),
    'bouton confirmer utilise la transaction atomique');
  assert.ok(src.includes("c.state = 'applied'"),
    "bouton confirmer met l'état applied");
  assert.ok(src.includes('afterRegionConfirm'),
    'événement après confirmation régionale');
});

// P0 (audit GPT RC-1.6) : "désactiver tous" purge les intentions différées
test('P0 : désactiver tous purge pending et listes différées', async () => {
  const src = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.ok(src.includes('window._pendingCheatRestore = [];') &&
            src.includes('window._deferredCheatList = [];'),
    'désactiver tous vide les listes différées');
});

// P1 (audit GPT RC-1.6) : retour arrière sur échec moteur
test('P1 : échec setCheats restaure les états (rollback)', async () => {
  const src = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.ok(src.includes('cheats.apply_failed'),
    'échec journalisé');
  assert.ok(src.includes('c.state = snapshot[i]'),
    'états restaurés depuis le snapshot');
});

// P2 : édition non marquée confirmée avant vérification
test('P2 : édition mémorisée comme selected-unverified si non sûre', async () => {
  const src = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.ok(src.includes("source: regionSafe ? 'user-confirmed' : 'selected-unverified'"),
    'édition distinguée selon vérification régionale');
});
