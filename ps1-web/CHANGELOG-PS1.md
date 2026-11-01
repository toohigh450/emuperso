# CHANGELOG — EMUPERSO PS1

## RC-1.7 (Méo, 1er nov. ~08h30) — Correctifs audit GPT RC-1.6 : machine à états unifiée
**Base** : RC-1.6 + correctifs de l'audit GPT `AUDIT_GPT_EMUPERSO_PS1_RC-1.6_ETATS_CHEATS_53_5dlm.html`

### 🔴 P0 — "Désactiver tous" ne purgeait pas les restaurations en attente
- **Cause** : `pending=true` et `_pendingCheatRestore` survivaient au "cheat-off". Une confirmation régionale ultérieure réactivait des codes neutralisés.
- **Correctif** : le handler purge `cheats` (tous → 'off'), `_pendingCheatRestore`, `_deferredCheatList`, `_pendingActiveList`, puis synchronise le moteur (atomique).

### 🟡 P1 — États incohérents (pending + on simultanés)
- **Cause** : deux booléens `on`/`pending` pouvaient diverger.
- **Correctif** : **état unique par cheat** — `'off'` (désactivé), `'pending'` (en attente, non injecté), `'applied'` (injecté avec succès). Helpers `appliedCheats()`, `pendingCheats()`.

### 🟡 P1 — Interface masquait "EN ATTENTE"
- **Cause** : `renderCheatCandidates()` affichait "EN ATTENTE" puis `renderCheats()` écrasait avec "Aucun actif".
- **Correctif** : **un seul rendu** dans `renderCheats()` — affiche séparément ACTIF(s) et EN ATTENTE, avec l'édition (`_cheatEditionLabel`). Cases : coché = appliqué, ⏳ = en attente.

### 🟡 P1 — Échec moteur sans retour arrière
- **Cause** : `setCheats()` pouvait échouer après mutation des états → "actifs" fantômes.
- **Correctif** : **`atomicCheatUpdate(mutate)`** — snapshot avant, `setCheats()`, rollback complet sur exception + événement `cheats.apply_failed`. L'état 'applied' n'est engagé qu'après succès. `toggle()`, bouton "Je confirme", restauration explicite, choix d'édition et `loadCheats` passent tous par cette transaction.

### Docs
- README-FR.md : "66/66 JS + 8/8 Python" (était "48/48 + 3/3").

**Tests** : 77/77 JS + 8/8 Python PASS — dont 8 nouveaux tests comportementaux `cheat-state-machine.test.mjs` (moteur instrumenté, chemins d'erreur, régression P0 confirmer-après-désactiver).

---

## RC-1.6 (Méo, 1er nov. ~04h30) — Correctifs audit GPT RC-1.5
**Base** : RC-1.5 + correctifs de l'audit GPT `AUDIT_GPT_EMUPERSO_PS1_RC-1.5_REGIONS_RESTAURATION.html`

### 🔴 P0 — Activation manuelle USA→Europe sans confirmation (toggle)
- **Cause** : `renderCheatCandidates()` ne marquait pas les cheats avec `needsRegionConfirm`. `toggle()` vérifiait seulement le flag du cheat, pas l'état régional global.
- **Correctif** : 
  - Nouvelle fonction `isRegionActivationAllowed()` — verrou centralisé pour TOUS les chemins.
  - `toggle()` utilise le verrou centralisé.
  - Chaque cheat candidat reçoit `needsRegionConfirm: !regionSafe`.
  - `computeRegionStateForCandidate()` calcule l'état pour CHAQUE choix, même sans pending.

### 🔴 P0 — Restauration bloquée mais affichée "ACTIF"
- **Cause** : `existing.on = true` était défini avant confirmation, message "ACTIF" trompeur.
- **Correctif** : état `pending` distinct. Les cheats bloqués ont `pending=true, on=false`. Message "EN ATTENTE de confirmation régionale (non injectés)".

### 🟡 P1 — Bouton "Je confirme" faisait disparaître l'application
- **Cause** : le bouton mettait `_regionConfirmed=true` et appelait `renderCheats()`, supprimant le panneau sans injecter les pending.
- **Correctif** : le bouton applique maintenant les cheats `pending` + `_pendingCheatRestore` après confirmation, puis injecte via `setCheats()`.

### 🟡 P2 — Édition mémorisée comme confirmée trop tôt
- **Cause** : `editionDB.set()` avec `source:'user-confirmed'` avant vérification régionale.
- **Correctif** : `source: regionSafe ? 'user-confirmed' : 'selected-unverified'`.

### Docs
- README-FR.md : titre mis à jour RC-1.6.

**Tests** : 66/66 JS + 8/8 Python PASS (5 nouveaux tests comportementaux P0/P1/P2).

---

## RC-1.5 (Méo, 1er nov. ~04h00) — Correctifs audit GPT RC-1.4
**Base** : RC-1.4 + correctifs de l'audit GPT `AUDIT_GPT_EMUPERSO_PS1_RC-1.4_TESTS_TERRAIN_CHEATS.html`

### 🔴 P0 BLOCAGE corrigé — setCheats() après choix d'édition sans confirmation
- **Cause** : `renderCheatCandidates()` appelait `setCheats()` après choix d'une édition USA pour un jeu Europe, sans vérifier `_regionConfirmed`. GPT a reproduit : `{"region_confirmed":false, "api_setCheats_calls":1}`.
- **Correctif** : le choix d'édition calcule maintenant `rSafe = (!rMismatch && !rUncertain) || _regionConfirmed`. Si pas sûr → cheats remis en attente, `setCheats()` BLOQUÉ, avertissement régional affiché.
- **Tests** : nouveau test "P0 : choix édition vérifie région avant setCheats".

### 🟡 P1-A — GT2 Plus Beta v6.1 non reconnu
- **Cause** : `detectMod(titleStem(title))` — `titleStem()` normalise "v6.1" en "v6 1" avant l'analyse.
- **Correctif** : `detectMod(stripDiscExtension(title))` — titre brut, parenthèses et version intactes.

### 🟡 P1-B — Tri régional inopérant
- **Cause** : `detectRegion(titleStem(title))` — `titleStem()` supprime l'étiquette de région → null.
- **Correctif** : `detectRegion(stripDiscExtension(title))` — région préservée pour le tri.

### Notes terrain Karl (RC-1.4)
- FFVII : refus E_SIZE (limite 900 Mio volontaire, ne pas augmenter arbitrairement).
- FFV FR : 11 codes USA, avertissement jaune ✅ attendu.
- Dead or Alive : 14 codes USA, région inconnue, avertissement jaune ✅ attendu.
- Diablo : no_match (absent du catalogue, normal).
- Manette : `pcsx_rearmed_pad1type` introuvable dans le cœur — diagnostic honnête, limitation documentée.

**Tests** : 61/61 JS + 8/8 Python PASS (3 nouveaux tests P0/P1-A/P1-B).

---

## RC-1.4 (Méo, 1er nov. ~03h15) — Correctifs audit GPT RC-1.3
**Base** : RC-1.3 + correctifs de l'audit GPT `AUDIT_GPT_EMUPERSO_PS1_RC-1.3_CATALOGUE_ET_REGIONS.html`

### 🔴 BLOCAGE A corrigé — activation manuelle sans confirmation (région inconnue)
- **Cause** : `needsRegionConfirm: !!regionMismatch` — quand `gameRegion` est null (ex: "Final Fantasy 5.pbp"), `regionMismatch` est faux → l'utilisateur pouvait cocher un cheat sans confirmation.
- **Correctif** : `needsConfirmation = Boolean(regionMismatch || regionUncertain)` — bloque aussi quand la région du disque est inconnue.
- **Test** : nouveau test "BLOCAGE A" dans cheat-dom.test.mjs.

### 🟡 P1 — Catalogue et mods
- **Détection de mods** : nouvelle fonction `detectMod()` — "GT2 Plus (Beta v6.1)" → mod détecté, titre de base "Gran Turismo 2" extrait.
- **Statut `mod_candidate`** : quand aucun match mais mod détecté, propose les cheats du jeu de base comme **CANDIDATS NON VÉRIFIÉS**. Jamais auto-activés, bouton explicite requis.
- **Classement ambiguous par région** : "GT2 (Europe).bin" → candidat Europe en premier (plus de USA par défaut).
- **Messages différenciés** : "Mod détecté mais jeu de base introuvable" vs "Jeu non reconnu dans le catalogue" (évite "aucun cheat" trompeur).

### 🟡 P2 — Étude GameHacking.org
- **Document** : `docs/GAMEHACKING-ORG-ETUDE.md` — pas d'API publique, partenariats possibles via Discord, pas de scraping sans permission. libretro-database reste la base légale.

**Tests** : 58/56 JS + 8/8 Python PASS (3 nouveaux tests : BLOCAGE A, P1 mod, R1/R2).

---

## RC-1.3 (Méo, 1er nov. ~02h45) — Correctifs audit GPT RC-1.2
**Base** : RC-1.2 + correctifs de l'audit GPT `AUDIT_GPT_EMUPERSO_PS1_RC-1.2_BLOCAGE_MOTEUR_MULTI_REGION.html`

### 🔴 P0 BLOQUANT corrigé — serveur bloquait EmulatorJS
- **Cause** : mon durcissement B05 (whitelist par chemins) bloquait `/vendor/` → 403 sur `emulator.js`, 36/36 fichiers du lock refusés. 4 échecs Windows confirmés.
- **Correctif** : `vendor/` servi **fichier par fichier** depuis les clés exactes `files` de `docs/runtime-lock.json`. Chargé à chaque requête (le lock s'enrichit au premier lancement). Anti-traversal, anti-symlink, vérification `is_file()`.
- **Tests** : 5 tests HTTP réels (GET/HEAD) dans `tests/test_serve.py` — vendor du lock → 200, hors lock → 403, dossiers sensibles → 403.

### 🟡 R1 — catalogue multi-région
- **Cause** : `detectRegion("Toy Story 2 (USA, Europe)")` retournait `USA` seul → faux conflit avec disque Europe.
- **Correctif** : nouvelles fonctions `detectRegions()` (retourne tableau) et `regionsCompatible()` (vérifie appartenance). `regionsCompatible('Europe', ['USA','Europe'])` → true.

### 🔴 R2 — région inconnue ≠ compatible
- **Cause** : `"Final Fantasy 5.pbp"` (sans suffixe) → `detectRegion` null → `regionMismatch` faux → `isSafe` vrai → réinjection USA sans preuve.
- **Correctif** : nouveau flag `regionUncertain` quand gameRegion est null mais catalogue a une région. `regionSafe` exige `!regionUncertain` sauf confirmation explicite. UI adaptée ("région de votre disque est inconnue").

### Divers
- `index.html` : RC-1.0 → RC-1.3 (cohérent avec diagnostic).
- `APP_VERSION` : RC-1.2 → RC-1.3.

**Tests** : 56/56 JS + 8/8 Python PASS (2 nouveaux tests R1/R2, 5 tests HTTP).

---

## RC-1.2 (Méo, 1er nov. ~02h30) — Correctifs audit GPT RC-1.1
**Base** : RC-1.1 + correctifs de l'audit GPT `AUDIT_GPT_EMUPERSO_PS1_RC-1.1_MULTI_REGION.html`

### 🔴 B02 RESTANT corrigé (bloquant)
- **Cause** : `const isSafe = fromMemory || (...)` — la mémoire locale contournait le contrôle de région. GPT a reproduit : jeu FR.pbp + mémoire USA + cheat restauré → `setCheats()` appelé sans confirmation.
- **Correctif** : nouvelle logique `regionSafe = !regionMismatch || window._regionConfirmed === true` ; `isSafe = identifiedEdition && regionSafe && !result.error`. La mémoire ne contourne PLUS un désaccord de région.
- **Bouton explicite** : quand région + pending, nouveau bouton "⚠️ Appliquer les X cheat(s) restauré(s) malgré le décalage de région" — confirmation explicite requise.
- **Sync UI/moteur** : flag `restoredApplied` — le message "tous désactivés par défaut" ne masque plus une injection réelle.

### 🟡 B05 renforcé
- Whitelist par **chemins** (pas seulement extensions) : `ALLOWED_DIRS = {assets, data, cheats, docs}`, `BLOCKED_DIRS` étendu (tools, tests, private, personal). Un `.json` dans `/private/` est maintenant bloqué. 17 tests `allowed_path` PASS.

### 🟡 B06 tests
- 2 nouveaux tests : scénario FR→USA avec mémoire (aucune injection), sync UI/moteur.

### Divers
- Version diagnostic dynamique via `APP_VERSION = 'RC-1.2'` (fini le hardcodé RC-1.0).

**Tests** : 54/54 JS + 3/3 Python PASS (2 nouveaux tests).

---

## RC-1.1 (Méo, 1er nov. ~02h00) — Correctifs audit GPT RC-1.0
**Base** : RC-1.0 + 7 correctifs de l'audit GPT `AUDIT_GPT_EMUPERSO_PS1_RC-1.0_MULTI_REGION.html`

### 🔴 BLOQUANT corrigés
- **B01** : `loadCatalog()` était appelé mais jamais importé dans app.js → la mémoire d'édition et la saisie serial ne fonctionnaient pas. **Corrigé** : import ajouté + test de régression.
- **B02** : Les cheats restaurés étaient réinjectés dans le moteur avant validation complète de l'édition (seul le cas "ambiguous" était bloqué). **Corrigé** : AUCUNE injection au démarrage (`cheats: []`), liste pending `_pendingCheatRestore` séparée, application via `setCheats()` SEULEMENT si édition sûre (mémoire OU match sans décalage région). Tests de régression ajoutés.

### 🟡 IMPORTANT corrigés
- **B03** : Badge "édition vérifiée" trompeur (c'était une mémorisation locale, pas une lecture serial). **Corrigé** : libellés honnêtes ("édition mémorisée", "choix précédent sur cet appareil").
- **B04** : `detectRegion()` confondait "NTSC" générique avec Japan (faux — NTSC-U = USA, NTSC-J = Japan). **Corrigé** : NTSC seul → null (ambigu), NTSC-U → USA, NTSC-J → Japan. Test ajouté.
- **B05** : `serve.py` sans liste blanche stricte (roms/, bios/, saves/ accessibles si copiés dans le dossier servi). **Corrigé** : `BLOCKED_DIRS` + `ALLOWED_EXTENSIONS`, 12 tests `allowed_path` PASS.
- **B06** : Tests DOM ne testaient pas vraiment le navigateur. **Partiellement adressé** : 4 nouveaux tests de régression source (B01, B02 x2, B04). Tests navigateur réels (Playwright) restent à faire.
- **B07** : Formats et licences. **Documenté** : formats supportés/non-supportés explicites dans README, attribution CC BY-SA 4.0 du catalogue, vérification GPL EmulatorJS requise avant publication.

**Tests** : 52/52 JS + 3/3 Python PASS (4 nouveaux tests).

---

# CHANGELOG — EMUPERSO PS1 Release Candidate 1.0

**Date** : 1er novembre 2026
**Base** : 0.1.14 + finalisation des 6 modules du mandat Karl

## Versions

### 0.1.0 (Claude, 31 oct.)
- Squelette honnête NON TESTÉ. Architecture N64 adaptée (sessions isolées, sauvegardes par jeu SHA-256).
- `disc-file.mjs` avec validation CHD/PBP et extraction serial ISO/BIN.
- Catalogue cheats vide. Lanceur Windows (Python portable).

### 0.1.1 (Claude, 31 oct.)
- `input-profile.mjs` : mapping positionnel OEM Xbox 360 → PS1, `normalizeInput`, `padType()`.
- 18/18 tests PASS (vérifiés par Méo).

### 0.1.2 (Méo, 31 oct.) — ⚠️ NE PAS REDISTRIBUER
- Profils nommés intégrés ("PS1 authentique" / "Confort moderne").
- **RÉGRESSION** : crash "Cannot read properties of undefined (reading '0')" au lancement.

### 0.1.3 (Méo, 31 oct.) — ⚠️ NE PAS REDISTRIBUER
- Fix profils + stack traces. **Toujours le crash.**
- Cause identifiée : `EmulatorJS.setupKeys()` boucle 4 joueurs, `this.controls[1]` undefined.

### 0.1.4 (Méo, 1 nov.) — ✅ FONCTIONNE
- **Fix critique** (audit GPT) : `defaultControllers = { 0: unbound, 1: {}, 2: {}, 3: {} }`.
- Test de contrat 4 joueurs. **Karl confirme : "ça fonctionne".**
- 29/29 JS + 3/3 Python PASS.

### 0.1.5 (Méo, 1 nov.)
- Fond d'écran style Gran Turismo (image originale, sans logos).

### 0.1.6 (Méo, 1 nov.)
- **Catalogue cheats** : 1 394 jeux / 18 640 codes (libretro-database, CC BY-SA 4.0).
- Panneau sous l'émulateur, badges 📥/✅, tous OFF par défaut.
- 33/33 JS + 3/3 Python PASS.

### 0.1.7 (Méo, 1 nov.)
- Matching par mots entiers + chiffres romains→arabes.
- 35/35 JS PASS.

### 0.1.8 (Méo, 1 nov.)
- Titre nettoyé, validateur multi-instructions, Xploder marqués ⚠️, ancien catalogue supprimé.
- 35/35 JS PASS.

### 0.1.9 (Méo, 1 nov.) — ⚠️ RÉGRESSION
- Sélection région, états explicites, 6 tests d'intégration.
- **RÉGRESSION** (audit GPT) : `findCheatsForGame` retourne objet, `loadCheats` attendait tableau.

### 0.1.10 (Méo, 1 nov.) — ✅ CONTRAT RÉPARÉ
- `loadCheats` réécrit pour le nouveau contrat.
- 41/41 JS PASS. **Audit GPT : GO essais locaux, NO-GO publication.**

### 0.1.11 (Méo, 1 nov.)
- P1 : restauration on:true fidèle. P2 : FF5 → 11 cheats (confirmé terrain ✅). P3 : codes sans nom affichés.
- 41/41 JS PASS.

### 0.1.12 (Méo, 1 nov.)
- Warning région FR→USA + confirmation requise. Restauration fidèle. Message actif précis.
- 43/43 JS PASS.

### 0.1.13 (Méo, 1 nov.)
- **Fix DOM** (audit GPT) : boutons USA/World ne sont plus effacés.
- Anti-réinjection avant choix d'édition. 3 tests DOM.
- 46/46 JS PASS.

### 0.1.14 (Méo, 1 nov.)
- **Reconnaissance automatique** : mémoire locale d'édition vérifiée (SHA-256 → édition).
- Saisie manuelle du serial. SerialMap enrichi (13 numéros).
- 48/48 JS + 3/3 Python PASS.

### RC-1.0 (Méo, 1 nov.) — CANDIDATE
- Finalisation des 6 modules. README mis à jour. Documentation honnête des limites.
- **En attente** : essais Windows de Karl, audit Codex, audit GPT final.
- **Aucun GO de publication.**

## Limites connues (honnêtement documentées)

1. **CHD/PBP** : le numéro de série interne n'est pas lisible sans décompression complète du conteneur. Fallback : mémoire locale → serial manuel → nom de fichier.
2. **Cheats en jeu** : l'application via `manager.setCheat()` suit l'API EmulatorJS, mais la compatibilité réelle de chaque code avec PCSX ReARMed n'est pas prouvée (tests automatisés uniquement).
3. **Manette terrain** : la matrice PAD-01→13 nécessite les essais de Karl avec sa manette Xbox 360.
4. **Vitesse d'émulation** : le limiteur de vitesse (jeu en accéléré) est un chantier séparé, non traité ici.

## Licences

- Code EMUPERSO : MIT (LICENSE)
- Catalogue cheats : CC BY-SA 4.0 (libretro-database, voir data/psx-catalog.json meta)
- EmulatorJS/PCSX ReARMed : téléchargés au lancement depuis leurs sources officielles (non inclus)
