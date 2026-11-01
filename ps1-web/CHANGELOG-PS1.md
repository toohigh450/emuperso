# CHANGELOG — EMUPERSO PS1

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
