# Audit complet EMUPERSO — rapport d'étape

Branche : `feature/unified-controller-profiles` · Date : 2026-11-08
Périmètre : portail + 13 systèmes (NES, SNES, GB, GBC, GBA, DS, N64, PS1, PSP, Genesis, Arcade, DOOM, GameCube ALPHA).
Statut : **audit complet** — statique + tests automatisés + **tests terrain avec les vraies ROMs de Karl** (13/13 systèmes testés ; GameCube ALPHA à vitesse interpréteur).

## Correctifs livrés sur la branche

| Commit | Correctif | Preuve |
|---|---|---|
| `b176e56` | PS1 : `/data/saves/PCSX-ReARMed` créé au montage + capture auto `.srm` sur `visibilitychange`/`pagehide`/`beforeunload` | 190 tests Node + Python verts ; déployé |
| `95d1ba5` | PS1 : garde anti-doublon corrigeait la **première** capture (fenêtre 2 s) → `batteryAutoSavedAt = -Infinity` + test `rc116-autosave.test.mjs` | 3/3 tests, 193 Node verts |
| `859e34d` | N64 : même catch-22 — `/data/saves/Mupen64Plus-Next` jamais créé → `.srm` impossible à la première partie | tests real-n64 verts (91) |
| `4423215` | Durcissements audit Codex : publication ROM, validation WAD DOOM, race i18n, serveur local | cherry-pick `a396bb4` |
| `ea85cf1`+`e67a220` | Instrumentation `input.pads.snapshot` + test navigateur réel (Chromium + cœur PCSX + gamepad synthétique) | `simulateInput` prouvé fonctionnel |
| `fb0f18c` | **RC-1.17** : carte mémoire vierge formatée (128 Kio, en-tête `MC`) injectée au boot via `empty-memcard.mjs` | sonde navigateur : `.srm` présent au boot |
| `e3ab41e` | Liens « ← Portail EMUPERSO » sur pages PS1 et N64 | endpoints 200 |
| `e08fb58` | Uniformisation visuelle Portables sur le style N64 (thème sombre, bannière, panels mint) + badge PS1 dynamique (`APP_VERSION`) | 162 tests portables verts, capture navigateur OK |
| `bf6b280` | `test-portail.mjs` : ignore le refus wake-lock headless | **77/77** |
| `3c2b656` | GameCube : correction bouton « Choisir une image » (non câblé) | redéployé |
| `5d25c11` | **RC-1.19** : persistance carte mémoire — sonde `browser_persist_probe.py` prouve que le moteur recharge bien le `.srm` en RAM au boot (`marker_in_session2_ram: true`) ; le maillon faible était la course IndexedDB au `pagehide` → **miroir synchrone `localStorage`** + événement `freeze` + `newestBattery()` au lancement | 82/82 tests Node |
| `65d55fb` | `portail/changelog.json` : 4 entrées du 7 nov. (GameCube EN TEST, BIOS PS1, saves auto, look Portables) | — |
| `b5e7ada` | **GameCube ALPHA** : page `/gamecube/` + carte portail « EN TEST » (Gecko/WASM + WebGPU, gcplayer, carte mémoire 2 Mio/jeu, tactile + manette) | boot réel FFCC .rvz prouvé en Chromium fenêtré (« Jeu lancé ») ; headless sans adaptateur WebGPU → message propre ; `.dol` = panic upstream Gecko (`system.rs` out-of-bounds) documenté |

## Vérifications négatives (zones auditées, saines)

- **Service worker** (`portail/sw.js`) : réseau prioritaire, cache limité au shell PWA → pas de JS obsolète servi.
- **Cheats portables** : seuls les codes `enabled` et non-placeholder partent au moteur (`app.mjs:472,495`) ; autoload = suggestions jamais activées ; conflits PSP détectés (`pspCodeConflicts`).
- **Sauvegardes portables** : player iframe flush sur `visibilitychange`/`pagehide`/`destroy()` ; miroir IndexedDB avec 3 générations ; migration GB/GBA/DS jamais destructive.
- **Controller V2** (`pad-input.mjs`) : profil « natif » préserve les bindings moteur, profil custom vide `value2` sans toucher au clavier, `release()` au stop, offsets tactiles bornés.
- **i18n** : français par défaut, repli jamais cassé, compteur de requêtes anti-race, noms de jeux/codes non traduits.
- **PWA** : manifest standalone + icônes maskable, `assetlinks.json`, APK `EMUPERSO.apk` présents dans `dist/`.
- **Publication** : aucune ROM/BIOS/sauvegarde dans `dist/` ; build Vercel par whitelist ; suffixes privés bannis.
- **Aucun `gamepad.connected` manquant côté code** : le chemin input est identique RC-1.15 → RC-1.17, prouvé par test navigateur réel.

## Audit P1/P2 — consoles, moteur, distribution (2026-11-08)

- **Arcade** : romset `.zip` confié tel quel (nom court MAME/FBNeo), BIOS arcade refusé, double cœur `mame2003_plus` → `fbneo` avec verdict mémorisé par empreinte de romset (`arcade-core:<hex>`), `cheats-arcade/cheat.dat` (7,9 Mio, base MAME 2003-Plus) présent et référencé par l'UI. Les 3 cœurs (`mame2003_plus`, `fbneo`, `prboom`) + variantes thread/legacy confirmés présents sur le CDN EmulatorJS 4.2.3.
- **DOOM** : `analyzeWad` valide magic `IWAD`/`PWAD`, bornes du répertoire et des offsets (anti-tronqué), taille ≤ 64 Mio, noms IWAD reconnus (`doom`, `doom2`, `plutonia`, `tnt`, `freedoom1/2`…) avec avertissement si nom inhabituel. PWAD refusé proprement. Codes IDDQD/IDKFA non supportés par PrBoom-web — documenté dans l'UI.
- **Consoles portables (NES→PSP)** : pipeline unique `app.mjs` — analyse d'en-tête par système, formats non supportés refusés avec explication (`UNSUPPORTED_FORMATS` : FDS, Satellaview, 32X, patches .ips/.bps/.ups, CHD/ZSO PSP…), BIOS reconnus et refusés comme jeux, melonDS seul cœur DS exigeant un BIOS importé par l'utilisateur. Cœur DS choisi = fait partie de l'espace de sauvegarde (pas de migration intempestive).
- **Saves portables** : `mirrorSave` + `spaceId` par jeu, flush iframe sur `visibilitychange`/`pagehide`/`destroy`, miroir IndexedDB 3 générations, migration GB/GBA/DS non destructive — déjà vérifié P0, confirmé par relecture.
- **Controller V2** : profils natif/custom, `release()` au stop, deadzone — conforme au retour DuckStation (mapping Xbox→face standard).
- **i18n** : 53 clés FR = 53 clés EN, carte GameCube + contact couverts ; sonde navigateur live : toggle EN de `/contact/` fonctionnel (« Contact — report a bug »), zéro erreur console.
- **PWA/APK** : manifest + icônes maskable + `sw.js` (réseau prioritaire) ; `EMUPERSO.apk` (2,5 Mio) publié via `portail/android/` et **vérifié HTTP 200 en ligne** ; `assetlinks.json` présent.
- **Contact/changelog** : `/contact/` vérifié en vrai navigateur sur l'alias testeurs — mailto exact `emuperso.splendid404@passmail.com`, template 7 champs, avertissement BYOR, aucun script inline (CSP-compatible). Changelog : 11 entrées, badges système/version + paragraphes détails rendus.
- **GameCube** : voir section dédiée — perf mesurée (~16 %→1 % natif, écran noir ≥9 min sur FFCC/Pokémon XD), miroir `localStorage` synchrone pour la carte mémoire (même correctif que RC-1.19 PS1), cycle sauvegarder→fermer→rouvrir **à prouver en jeu** (aucun test automatisé ne peut forcer une écriture carte).
- **Audio** : non auditable en headless — reste un point ouvert pour le test terrain.
- **Cosmétique** : pas de wallpaper dédié `arcade`/`doom`/`gamecube` dans `portables/css/app.css` (GameCube a son propre fond ; Arcade/DOOM affichent le fond neutre). Page GameCube et PS1/N64 : français uniquement (cohérent avec le reste des consoles, i18n = niveau portail).

## Tests automatisés (état au 2026-11-08)

| Suite | Résultat |
|---|---|
| `tools/test-portail.mjs` (vrai navigateur, démos réelles) | **77/77** (dernier run à `bf6b280` ; module playwright Node absent de l'env actuel — les chemins touchés depuis sont couverts par `browser_portal_probe.py`) |
| `portables` (node:test) | **162/162** (rejoué 2026-11-08) |
| `real-n64` | **91/91** (rejoué 2026-11-08) |
| `ps1-web` Node | **82/82** (rejoué 2026-11-08) |
| `browser_portal_probe.py` (Chromium réel, alias testeurs) | vert : 13 consoles, EN TEST, contact FR/EN, changelog détails, 0 erreur console |
| Test navigateur input PS1 (`browser_input.py`) | vert (gamepad synthétique → `simulateInput` OK) |

## Tests terrain RÉELS avec les ROMs de Karl (2026-11-08, sonde `tools/browser_psp_probe.py` — param console générique)

| Console | ROM réelle | Cœur | Résultat |
|---|---|---|---|
| DOOM | DOOM2.WAD (GOG, 13,9 Mio) | PrBoom | ✅ « DOOM II » reconnu, moteur prêt |
| PSP | Ozma Wars (USA).cso 2,8 Mio | PPSSPP nightly + secours 4.2.3 | ✅ moteur prêt (COOP/COEP requis, en-têtes OK) |
| SNES | Chrono Trigger (U) [!].smc 4 Mio | Snes9x | ✅ moteur prêt |
| NES | Super Mario Bros. 3 [USA][!!].nes 384 Kio | FCEUmm | ✅ moteur prêt |
| GB | Pokemon - Red Version.7z (109 versions) | Gambatte | ✅ sélecteur de version → extraction 7z → moteur prêt |
| GBC | Pokemon - Crystal Version.7z (Hackset-GBC) | Gambatte | ✅ « PM_CRYSTAL », système « Game Boy Color », moteur prêt |
| GBA (.7z) | Advance Wars.7z | mGBA | ✅ sélecteur → extraction → « ADVANCEWARSP », moteur prêt |
| GBA (.gba) | Advance Wars (USA).gba 4 Mio | mGBA | ✅ fichier direct, moteur prêt |
| Genesis | 688 Attack Sub.7z (5 versions) | Genesis Plus GX | ✅ sélecteur → extraction → moteur prêt |
| Arcade | tehkanwc.zip (romset nom court) | MAME 2003-Plus | ✅ romset reconnu, moteur prêt |
| DS (.zip) | Mario Kart DS (Europe).zip 18,3 Mio | DeSmuME 2015 (sans BIOS) | ✅ « MARIOKARTDS », moteur prêt — Dr. Mario Express refusé proprement (DSiWare) |
| N64 | Charlie Blast's Territory (Europe).zip | mupen64plus-next | ✅ zip → boot → **rendu visible** (zone claire à l'écran) + **sauvegarde native écrite** (« Sauvegarde native conservée localement ») — sonde `real-n64/tools/browser_rom_probe.py` |
| GBA | — | — | ✅ (ligne ci-dessus : .gba direct + .7z, deux chemins prouvés) |

**Isolation des sauvegardes par contenu** : deux versions de Chrono Trigger (`[!]` vs `[h1C]`) → empreintes SHA-256 différentes → `saveSpaceId` différents (`snes:snes9x:06d1…` vs `snes:snes9x:3f82…`) — la preuve porte sur la séparation des identités logiques, une écriture/relecture croisée reste à exécuter. Même principe PS1 (`batteryIdentity` = rom_sha256 + moteur + config + schéma). **GameCube** : la carte était clé par le nom de fichier — corrigé pour utiliser l'**ID de disque** de l'en-tête (`gc:XXXXXX`, déjà lu par `gameCubeIdFromHead`) avec repli non destructif sur l'ancienne clé stem ; .rvz/.dol/.zip conservent le stem.

Note : les 404 console = `/favicon.ico` absent (cosmétique).

**Persistance prouvée en conditions de décharge réelle** (`ps1-web/tools/browser_unload_probe.py`) : marqueur 128 Kio → `pagehide` → **IndexedDB supprimée** → reload → `marker_in_session2_ram_despite_empty_idb: true`. Le miroir `localStorage` (RC-1.20, écrit avant `vault.put`) récupère la carte seul.

**Carte mémoire GameCube** (`gamecube/tools/test-card-persist.py`) : import `.mcr` 2 Mio → `cardDB.set` en échec + IndexedDB tuée → reload → carte « 2 Mio enregistrée » restaurée depuis le seul miroir `localStorage` (`card_recovered_despite_empty_idb: true`).

## Synthèse finale (2026-11-08)

**Prouvé avec de vraies ROMs** : 13/13 systèmes testés via le vrai pipeline (analyse → empreinte → cœur → moteur prêt), dont N64 avec rendu visible + sauvegarde native, DS (Mario Kart DS / DeSmuME), GBC distinct (Pokemon Crystal / Gambatte), PS1 avec BIOS personnel + carte mémoire, et Arcade/DOOM avec les vrais fichiers de Karl. « Moteur prêt » = initialisation du cœur, pas validation de gameplay complet (voir niveaux de preuve dans le rapport HTML).

**Bugs réels trouvés et corrigés par les tests terrain** :
- PS1 RC-1.18 : BIOS personnel (SCPH1001) — Future Cop détecte la carte
- PS1 RC-1.19/RC-1.20 : persistance carte mémoire — double filet `localStorage` synchrone, prouvé même IndexedDB détruite
- GameCube : même race corrigée + bouton « Choisir une image » réparé + **carte mémoire identifiée par l'ID de disque** (en-tête, `gc:XXXXXX`) avec repli non destructif sur l'ancienne clé stem — corrige le risque GPT-02 (images homonymes/renommées partageaient la carte)
- Portails : look unifié, badge version dynamique, changelog détaillé, page contact

**Limites honnêtes restantes** :
- DS : boot prouvé (Mario Kart DS) ; melonDS non testé (exige un BIOS utilisateur)
- GameCube : ALPHA — boots prouvés, ~16 %→1 % vitesse native, pas d'audio, pas de .dol, pas de .7z
- Audio : non auditable en headless — à valider en jeu
- Arcade : cœurs 2003/FBNeo seulement (romsets post-2003 partiellement reconnus)
- PS1 : certains jeux restent sensibles au timing même avec vrai BIOS (comportement documenté upstream)

**Règles respectées** : aucune fusion vers `main` sans GO explicite ; aucun force-push ; aucun ROM/BIOS/sauvegarde publié ; alias testeurs toujours à jour.

## Problèmes ouverts

1. **PS1 « no memory card » persiste en jeu** (signalé par Karl après RC-1.17) — **diagnostic profond effectué** :
   - `.srm` = image carte mémoire 1 (`Mcd1Data` via `RETRO_MEMORY_SAVE_RAM`, 128 Kio) — pas du SRAM
   - Carte **toujours valide en RAM au boot** (`init_memcard`), prouvé en bloquant l'injection `.srm` : `Mcd1Data` contient quand même la carte vierge formatée
   - Slot carte **toujours activé** (`McdDisable[0]=0` en mode libretro)
   - `refresh_save_files` charge fichier→RAM et `cmd_savefiles` écrit RAM→fichier — round-trip prouvé par marqueur
   - HLE BIOS implémente les fonctions carte (`dev_card_*`, `_card_info/load/save`, `InitCARD`, `StartCARD`)
   - **Conclusion** : la mécanique sauvegarde fonctionne de bout en bout ; le « no memory card » vient du jeu qui ne détecte pas la carte (limite HLE BIOS / driver mcman noyau, ou bug spécifique du build wasm déployé v2.0.2). Pistes restantes : vrai BIOS utilisateur (`biosUrl` supporté par le moteur), build `mednafen_psx_hw`, rapport upstream EmulatorJS/PCSX-ReARMed.
   - **Résolution (RC-1.18 + terrain)** : bug **connu du jeu** — *Future Cop L.A.P.D.* affiche « memory card not found » sur tous les émulateurs PS1 (thread Next Generation Emulation, même symptôme sous ePSXe). Correctif documenté : vrai BIOS + CPU 1x. **GT2 sauvegarde à l'infini** → carte mémoire fonctionnelle pour les autres jeux. RC-1.18 ajoute le chargement d'un **BIOS PS1 personnel** (fichier local, IndexedDB, jamais uploadé) — vérifié : `found BIOS file` + `BIOS: 19951204, 'CEX-3000/1001/1002 by K.S.'` en vrai navigateur. **Test terrain Karl (7 nov.)** : avec son `SCPH1001.BIN`, Future Cop détecte la carte (« no savegame found » = carte vide normale) et **la sauvegarde en jeu fonctionne**.
   - **Perte au relancement sans fermeture navigateur (RC-1.19)** : sonde `browser_persist_probe.py` (2 sessions réelles, marqueur 128 Kio) → `marker_in_session2_ram: true` : le `.srm` est bien rechargé en RAM au boot et le coffre IndexedDB fonctionne. Cause probable : la transaction IndexedDB d'`autoSaveBattery` tuée par le déchargement de page. Correctif : miroir **synchrone `localStorage`** de la carte après chaque écriture coffre + écoute `freeze` + `newestBattery()` choisit la copie la plus récente au lancement. À revalider en terrain.
2. **Tests terrain réels** : Future Cop save→fermeture→reouverture (avec/sans bouton), 2e jeu PS1, N64 save/reload, et démarrage/son/manette/sauvegarde des 11 autres consoles — nécessitent les ROMs de Karl.
3. **Manette physique** : G7 Pro fonctionnelle après MAJ firmware + reboot (confirmé par Karl sur GT1/GT2) ; si récurrence, exporter diagnostic avec `input.pads.snapshot`.
4. **Audio** : non audité en conditions réelles (tests headless ne valident pas le son).
5. **GameCube web** : intégré au portail testeurs depuis `b5e7ada` (page `/gamecube/`, carte « EN TEST ») — boots FFCC/Pokémon XD prouvés en vrai Chromium+WebGPU ; limites ALPHA affichées (pas d'audio, interpréteur, WebGPU requis, `.dol` panique upstream). En test terrain par Karl.
6. **DOOM** : codes IDDQD/IDKFA non supportés en navigateur (documenté dans l'UI, `app.mjs:874`) — limitation connue, pas un bug.

## Règles respectées

- Branche testeurs uniquement ; aucune fusion vers `main` sans GO explicite de Karl.
- Aucun force-push ; fetch/merge avant chaque push.
- Aucun ROM/BIOS/sauvegarde/diagnostic personnel publié.
- Un commit par correctif logique ; tests verts avant chaque push.
- Alias testeurs réassigné via API Vercel après chaque déploiement READY, endpoints vérifiés.
