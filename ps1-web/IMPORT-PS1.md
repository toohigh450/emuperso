# EMUPERSO PS1 — branche de développement isolée

Branche : `emulateur-ps1` (créée depuis `main`, sans toucher à `main` ni à `emulateur-reel`).

## Source de référence
- Archive fournie par Karl : `emuperso-ps1-0.1.1(1).zip`
- Version déclarée dans son README : **PS1 Web 0.1.1 — squelette NON TESTÉ**
- SHA-256 de cette archive : `73342a0f584816ec633a19cb72442c03ccc37479695cb8b004ec84f957cf0adb`
- Contenu annoncé : lanceur Windows, `ps1-web/`, EmulatorJS/PCSX ReARMed téléchargés au lancement, outils, tests et configuration des manettes.

## Règles
1. Protéger la N64 : ne pas modifier les branches `main` ou `emulateur-reel`.
2. Aucun jeu commercial, BIOS Sony, sauvegarde privée ou cache sur GitHub.
3. Distinguer tests unitaires, tests automatiques et essais réels sous Windows.
4. Pas de publication ou de fusion sans l'accord de Karl.
5. Le mode PS1 confort moderne vise le mapping positionnel OEM et le joystick gauche; validation terrain à faire.

**Note :** le code PS1 0.1.1 doit être importé depuis l'archive source fournie par Karl; le simple statut « branche créée » ne signifie pas que le projet a été déployé ou testé.

## Journal des versions — 0.1.1 → 0.1.10 (1 novembre 2026)

### 0.1.1 (Claude)
- `input-profile.mjs` : mapping positionnel OEM (Gamepad-standard → RetroPad), `normalizeInput` (deadzone 0.05–0.6), `padType()`.
- Tests : 18/18 PASS (vérifiés par Méo).

### 0.1.2 (Méo) — ⚠️ CASSE LE LANCEMENT
- Intégration des profils nommés dans l'UI (`input-presets.mjs` : "PS1 authentique" / "Confort moderne").
- **Régression** : erreur « Cannot read properties of undefined (reading '0') » — 3 tentatives, rollback OK.
- **NE PAS REDISTRIBUER.**

### 0.1.3 (Méo) — ⚠️ CASSE LE LANCEMENT
- Fix : profil `_profile` préservé, `applyProfileToUI` synchronise `in-native`, stack traces capturées.
- **Toujours le crash** — la stack révèle : `EmulatorJS.setupKeys` → `this.controls[1]` undefined.
- **NE PAS REDISTRIBUER.**

### 0.1.4 (Méo) — ✅ FONCTIONNE
- **Fix critique** (audit GPT) : `defaultControllers = { 0: unbound, 1: {}, 2: {}, 3: {} }` — les 4 joueurs définis.
- Test de contrat `engine-input-contract.test.mjs` (4 tests).
- **Karl confirme : « ça fonctionne »** — le jeu démarre.
- 29/29 JS + 3/3 Python PASS.

### 0.1.5 (Méo)
- Fond d'écran style Gran Turismo (image originale générée, sans logos).
- 0.1.4 + wallpaper.

### 0.1.6 (Méo)
- **Catalogue cheats PS1** : 1 394 jeux / 18 640 cheats (libretro-database, CC BY-SA 4.0).
- Panneau cheats sous l'émulateur, badges 📥/✅, tous désactivés par défaut.
- 33/33 JS + 3/3 Python PASS.

### 0.1.7 (Méo)
- Fix matching : mots entiers + chiffres romains→arabes (V→5, VII→7).
- **Problème** : FF5 charge mais cheats invisibles (titre « Final Fantasy 5 FR.pbp » non matché).
- 35/35 JS PASS.

### 0.1.8 (Méo)
- Titre nettoyé (extension + région retirées), validateur multi-instructions, Xploder marqués ⚠️, ancien catalogue supprimé.
- 35/35 JS PASS.

### 0.1.9 (Méo) — ⚠️ RÉGRESSION
- Sélection de région explicite, états `loaded|load_error|no_match|match|ambiguous`, 6 tests d'intégration.
- **Régression** (audit GPT) : `findCheatsForGame` retourne un objet mais `loadCheats` utilisait l'ancien contrat → « catalogCheats.filter is not a function ».
- 41/41 JS PASS (les tests ne capturaient pas le contrat brisé).

### 0.1.10 (Méo) — ✅ CONTRAT RÉPARÉ
- `loadCheats` réécrit pour le nouveau contrat (result.status/result.cheats).
- `renderCheatCandidates` appelé pour l'état ambiguous.
- Garde anti-undefined sur `applyProfileToUI`.
- 41/41 JS PASS.
- **En attente des tests terrain de Karl** (FF5, NBA Jam, Dave Mirra USA/World).

### 0.1.11 (Méo) — ✅ FF5 FONCTIONNE
- P1 (audit GPT) : restauration on:true correctement rétablie.
- P2 : fallback titleMatches sur titre nettoyé — « Final Fantasy 5 FR.pbp » matche l'Anthologie USA (11 cheats).
- P3 : codes sans nom affichés (« Code sans nom #12 »).
- **Karl confirme avec screenshot : les 11 cheats de FF5 s'affichent!**
- 41/41 JS PASS.

### 0.1.12 (Méo)
- **Compatibilité régionale** : décalage détecté (ex: FR.pbp → catalogue USA) ; warning affiché, activation bloquée jusqu'à confirmation explicite.
- **Restauration** : codes restaurés marqués on:true même en ambiguïté ; choix d'édition les réapplique.
- **Interface** : message fidèle au nombre réel de codes actifs.
- 43/43 JS PASS (2 nouveaux tests detectRegion).
- **En attente des tests terrain de Karl. Aucun GO de publication.**

### 0.1.13 (Méo) — ✅ FIX DOM DAVE MIRRA (audit GPT)
- **DOM** : `renderCheatCandidates()` ne vide plus la liste ; ordre corrigé (`renderCheats()` PUIS boutons).
- **Réinjection** : cheats restaurés différés si édition ambiguë (pas d'injection avant choix utilisateur).
- **Tests DOM** : 3 nouveaux tests (boutons survivent au rendu).
- 46/46 JS PASS.
- **En attente des tests terrain de Karl. Aucun GO de publication.**

### 0.1.14 (Méo) — 🆕 RECONNAISSANCE AUTOMATIQUE DES JEUX
- **Mémoire locale d'édition vérifiée** (IndexedDB) : fichier SHA-256 → édition confirmée. Reconnaissance auto aux prochains lancements.
- **Saisie manuelle du serial** : champ dans le panneau cheats pour identification exacte.
- **SerialMap enrichi** : 13 numéros (FF Anthology SLUS-00879, FFVII SCUS-94163, MGS, Crash, Tony Hawk...).
- **Badge ✅** quand l'édition est reconnue automatiquement.
- 48/48 JS PASS.
- **En attente des tests terrain de Karl. Aucun GO de publication.**

### RC-1.0 (Méo, 1 nov.) — 🎯 RELEASE CANDIDATE
- **Finalisation des 6 modules** du mandat Karl.
- 48/48 JS + 3/3 Python PASS.
- Archive : `emuperso-ps1-RC-1.0.zip` (735 Ko)
- SHA-256 : `49564677180f178d2a93619b3b11a0dea63866cf1451134f9db933d9cff85f51`
- Rapport technique : `ps1-web/RAPPORT-TECHNIQUE-RC-1.0.md`
- Changelog : `ps1-web/CHANGELOG-PS1.md`
- **En attente** : essais Windows Karl, audit Codex, audit GPT final.
- **AUCUN GO DE PUBLICATION.**
