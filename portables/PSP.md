# PSP dans Portables — 0.4.0-alpha.1 (branche feature/psp)

2 novembre 2026. La PSP rejoint le lanceur `portables/` (même fente, mêmes sauvegardes, même panneau de codes).
Aucun jeu, aucun BIOS fourni : la PSP n'en demande pas, PPSSPP émule le système lui-même.

## Moteur

- EmulatorJS 4.2.3, cœur `ppsspp` (`core.json` : elf, iso, cso, prx, pbp ; sauvegarde « false »).
- Ce cœur n'existe qu'en version à fils d'exécution (`ppsspp-thread-wasm.data`) : la page doit être isolée
  (COOP `same-origin` + COEP `require-corp`). Ajouté pour `/portables/` dans `vercel.json`, `serveur.ps1` et
  `tests/server.mjs`. Le CDN EmulatorJS répond `Cross-Origin-Resource-Policy: cross-origin` : les autres
  consoles continuent de charger leur moteur.
- `EJS_CacheLimit: 0` : le moteur ne recopie pas le jeu (des centaines de Mio) dans son cache IndexedDB.

## Formats

| Format | Résultat |
|---|---|
| `.iso`, `.cso` (v1), `.pbp` | acceptés ; identifiant du disque et titre lus dans UMD_DATA.BIN / PARAM.SFO |
| `.chd`, `.zso`, CSO v2 | refusés avec la commande de conversion (chdman, maxcso) : absents du cœur |
| image d'une autre console | refusée (identifiant système ISO différent de « PSP GAME ») |
| CSO en cours de téléchargement | refusé : « CSO incomplet », table des blocs plus longue que le fichier |

Le lanceur ne charge jamais le jeu entier : il lit quelques secteurs, calcule le SHA-256 complet par morceaux
de 8 Mio (`Sha256` dans `hash.mjs`, ~250 Mio/s), puis confie le fichier d'origine au moteur.
Mémoire estimée : 700 Mio + 2 × la taille du jeu ; confirmation au-delà de 700 Mio, refus au-delà du budget.

## Codes (CWCheat)

- Saisie validée : paires `_L 0xAAAAAAAA 0xVVVVVVVV`, plusieurs lignes acceptées.
- Les lignes `_L 0x00000000 0x00000000` des fichiers libretro sont des titres de section : affichées sans case à cocher.
- Codes actifs écrits dans `PSP/Cheats/<identifiant>.ini` **avant** le démarrage du jeu. Constat (Bust-A-Move Ghost) :
  au signal « jeu lancé », ppsspp ne connaît pas encore l'identifiant et écrivait dans `ROM-06101.ini`.
- Avertissement quand deux codes actifs écrivent une valeur différente à la même adresse (variantes exclusives).
- Fichiers `.cht` : `cheats-portables/Sony - PlayStation Portable/`, nommés `<jeu> [<identifiant>].cht`, proposés
  par identifiant de disque et à confirmer une fois. Générés par `node tools/cheats-psp.mjs "<dossier PSP>"`.

## Sauvegardes

- Carte mémoire du moteur : `/data/saves/PPSSPP/PSP/SAVEDATA/<identifiant>…` (IndexedDB, persistante).
- Export : ZIP des dossiers de ce jeu. Import : ZIP refusé s'il contient un autre jeu, un chemin absolu ou « .. » ;
  sauvegarde actuelle copiée avant remplacement, puis redémarrage.
- Copie de sécurité de la carte mémoire du jeu toutes les minutes pendant la partie.
- États : 4 emplacements, environ 40 Mio chacun.

## Essais réels (Chrome, 2 novembre 2026)

| Essai | Résultat |
|---|---|
| Bust-A-Move Ghost (ULES-00233, CSO 19,6 Mio) | image du jeu (écran de carte mémoire), fils actifs, page isolée |
| Code manuel actif puis relance | fichier `ULES00233.ini` écrit avant le démarrage, avec le code |
| Ace Armstrong (NPUZ-00109) + .cht libretro | association proposée par identifiant, 11 codes désactivés, conflit « Level 1 / Level 2 » signalé, fichier `.ini` correct |
| Carte mémoire | écriture, lecture filtrée par identifiant, persistance IndexedDB vérifiées |
| NES, SNES, GB, GBA, DS (démos libres) avec COOP/COEP | démarrent toujours |
| Portail construit (`dist/`) | 9 cartes, `/portables/` avec COOP/COEP |

Non vérifié : effet des codes en jeu ; image d'Ace Armstrong, HAL 21, Vanguard et d'un second lancement de
Bust-A-Move (fenêtre de Claude cachée pendant ces essais : le navigateur ne dessinait plus) ; son ; manette ;
gros jeux (plus de 500 Mio) ; téléphone Android ; `npm run test:browser` et `tools/test-portail.mjs` (Playwright
non installé sur ce PC).
