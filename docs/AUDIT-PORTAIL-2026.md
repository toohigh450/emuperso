# Audit complet EMUPERSO — rapport d'étape

Branche : `feature/unified-controller-profiles` · Date : 2026-11-07
Périmètre : portail + 12 consoles web (NES, SNES, GB, GBC, GBA, DS, N64, PS1, PSP, Genesis, Arcade, DOOM).
Statut : **en cours** — audit statique + tests automatisés faits ; tests terrain (vraies ROMs) partiels.

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

## Vérifications négatives (zones auditées, saines)

- **Service worker** (`portail/sw.js`) : réseau prioritaire, cache limité au shell PWA → pas de JS obsolète servi.
- **Cheats portables** : seuls les codes `enabled` et non-placeholder partent au moteur (`app.mjs:472,495`) ; autoload = suggestions jamais activées ; conflits PSP détectés (`pspCodeConflicts`).
- **Sauvegardes portables** : player iframe flush sur `visibilitychange`/`pagehide`/`destroy()` ; miroir IndexedDB avec 3 générations ; migration GB/GBA/DS jamais destructive.
- **Controller V2** (`pad-input.mjs`) : profil « natif » préserve les bindings moteur, profil custom vide `value2` sans toucher au clavier, `release()` au stop, offsets tactiles bornés.
- **i18n** : français par défaut, repli jamais cassé, compteur de requêtes anti-race, noms de jeux/codes non traduits.
- **PWA** : manifest standalone + icônes maskable, `assetlinks.json`, APK `EMUPERSO.apk` présents dans `dist/`.
- **Publication** : aucune ROM/BIOS/sauvegarde dans `dist/` ; build Vercel par whitelist ; suffixes privés bannis.
- **Aucun `gamepad.connected` manquant côté code** : le chemin input est identique RC-1.15 → RC-1.17, prouvé par test navigateur réel.

## Tests automatisés (état au 2026-11-07)

| Suite | Résultat |
|---|---|
| `tools/test-portail.mjs` (vrai navigateur, démos réelles) | **77/77** |
| `portables` (node:test) | 162/162 |
| `real-n64` | 91/91 |
| `ps1-web` Node + Python | 193 + Python, tout vert |
| Test navigateur input PS1 (`browser_input.py`) | vert (gamepad synthétique → `simulateInput` OK) |

## Problèmes ouverts

1. **PS1 « no memory card » persiste en jeu** (signalé par Karl après RC-1.17) — **diagnostic profond effectué** :
   - `.srm` = image carte mémoire 1 (`Mcd1Data` via `RETRO_MEMORY_SAVE_RAM`, 128 Kio) — pas du SRAM
   - Carte **toujours valide en RAM au boot** (`init_memcard`), prouvé en bloquant l'injection `.srm` : `Mcd1Data` contient quand même la carte vierge formatée
   - Slot carte **toujours activé** (`McdDisable[0]=0` en mode libretro)
   - `refresh_save_files` charge fichier→RAM et `cmd_savefiles` écrit RAM→fichier — round-trip prouvé par marqueur
   - HLE BIOS implémente les fonctions carte (`dev_card_*`, `_card_info/load/save`, `InitCARD`, `StartCARD`)
   - **Conclusion** : la mécanique sauvegarde fonctionne de bout en bout ; le « no memory card » vient du jeu qui ne détecte pas la carte (limite HLE BIOS / driver mcman noyau, ou bug spécifique du build wasm déployé v2.0.2). Pistes restantes : vrai BIOS utilisateur (`biosUrl` supporté par le moteur), build `mednafen_psx_hw`, rapport upstream EmulatorJS/PCSX-ReARMed.
   - **Résolution partielle (RC-1.18)** : bug **connu du jeu** — *Future Cop L.A.P.D.* affiche « memory card not found » sur tous les émulateurs PS1 (thread Next Generation Emulation, même symptôme sous ePSXe). Correctif documenté : vrai BIOS + CPU 1x. **GT2 sauvegarde à l'infini** → carte mémoire fonctionnelle pour les autres jeux. RC-1.18 ajoute le chargement d'un **BIOS PS1 personnel** (fichier local, IndexedDB, jamais uploadé) — vérifié : `found BIOS file` + `BIOS: 19951204, 'CEX-3000/1001/1002 by K.S.'` en vrai navigateur. Reste à valider en jeu réel avec le BIOS de Karl.
2. **Tests terrain réels** : Future Cop save→fermeture→reouverture (avec/sans bouton), 2e jeu PS1, N64 save/reload, et démarrage/son/manette/sauvegarde des 11 autres consoles — nécessitent les ROMs de Karl.
3. **Manette physique** : G7 Pro fonctionnelle après MAJ firmware + reboot (confirmé par Karl sur GT1/GT2) ; si récurrence, exporter diagnostic avec `input.pads.snapshot`.
4. **Audio** : non audité en conditions réelles (tests headless ne valident pas le son).
5. **GameCube web** : sur `feature/gamecube-web`, non fusionnée — absente du portail testeurs.
6. **DOOM** : codes IDDQD/IDKFA non supportés en navigateur (documenté dans l'UI, `app.mjs:874`) — limitation connue, pas un bug.

## Règles respectées

- Branche testeurs uniquement ; aucune fusion vers `main` sans GO explicite de Karl.
- Aucun force-push ; fetch/merge avant chaque push.
- Aucun ROM/BIOS/sauvegarde/diagnostic personnel publié.
- Un commit par correctif logique ; tests verts avant chaque push.
- Alias testeurs réassigné via API Vercel après chaque déploiement READY, endpoints vérifiés.
