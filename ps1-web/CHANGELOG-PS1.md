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
