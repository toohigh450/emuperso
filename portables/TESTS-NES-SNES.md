# Tests NES / SNES et non-régression — 2026-11-01 / 02

Environnement réellement utilisé : Windows 10 (19045), **Google Chrome installé sur le PC de Karl**
piloté par Playwright 1.56.1, en mode sans fenêtre (headless), Node 24.22.1, Python 3.15.
Moteur EmulatorJS 4.2.3 et vrais cœurs FCEUmm / Snes9x téléchargés depuis le CDN officiel.

Légende : **RÉUSSI** testé réellement et fonctionnel · **ÉCHEC** testé, problème constaté ·
**NON TESTÉ** environnement ou matériel indisponible · **LIMITATION** non pris en charge.

Rien n'a été testé sur un vrai téléphone Android ni avec une vraie manette. L'« émulation téléphone » de
Chrome (écran tactile simulé) n'est **pas** une validation Android.

## Plan de validation du mandat (section 15)

| # | Vérification | NES | SNES | Preuve |
|---|---|---|---|---|
| 1 | Ouverture depuis le portail | RÉUSSI | RÉUSSI | `tools/test-portail.mjs` (liens HTTP 200, console présélectionnée) |
| 2 | Démo open source | RÉUSSI (Snake) | RÉUSSI (Neon Breaker, Shmup, SA-1, DSP-1) | `tests/real-nes-snes.mjs`, image animée mesurée |
| 3 | ROM locale compatible | RÉUSSI | RÉUSSI | ROM d'essai + 7 jeux NES et 14 jeux SNES de `E:\roms` (voir plus bas) |
| 4 | Audio | NON TESTÉ à l'oreille | NON TESTÉ à l'oreille | Contexte audio du moteur à l'état « running » (RÉUSSI technique) ; personne n'a écouté |
| 5 | Affichage | RÉUSSI | RÉUSSI | 256×224 (512×224 en haute résolution SNES), couleurs mesurées pixel par pixel |
| 6 | Clavier | NON TESTÉ | NON TESTÉ | Touches par défaut documentées ; aucune frappe réelle simulée dans un jeu |
| 7 | Tactile Android | NON TESTÉ (vrai téléphone) | NON TESTÉ (vrai téléphone) | Émulation Chrome RÉUSSIE : manette tactile visible (NES : croix, A, B, Start, Select ; SNES : croix, A, B, X, Y, L, R), appui A sans erreur |
| 8 | Manettes | NON TESTÉ | NON TESTÉ | Pas de manette dans cet environnement |
| 9 | Sauvegarde normale | RÉUSSI | RÉUSSI | Compteur en mémoire sauvegardée lu, exporté, puis retrouvé |
| 10 | Save state | RÉUSSI | RÉUSSI | Enregistrer → redémarrer (compteur +1) → charger (compteur revenu) |
| 11 | Export / import | RÉUSSI | RÉUSSI | Export `.sav` téléchargé ; import d'une sauvegarde forcée à 0x40 → le jeu lit 0x41 |
| 12 | Cheat activé | RÉUSSI | RÉUSSI | Game Genie (ROM) et code RAM : couleur de l'écran changée dans le vrai cœur |
| 13 | Cheat désactivé | RÉUSSI | RÉUSSI | Couleur d'origine revenue, dans le vrai cœur |
| 14 | Relancement du jeu | RÉUSSI | RÉUSSI | Redémarrage, codes conservés |
| 15 | Changement de ROM | RÉUSSI | RÉUSSI | NES → SNES sans recharger ; sauvegarde NES écrite avant fermeture |
| 16 | Changement de console | RÉUSSI | RÉUSSI | Huit démos lancées et fermées tour à tour, iframe moteur libérée |
| 17 | Rafraîchissement de la page | RÉUSSI | RÉUSSI | Couvert par le point 18 (profil conservé) |
| 18 | Retour après fermeture du navigateur | RÉUSSI | RÉUSSI | Navigateur fermé puis relancé sur le même profil : sauvegarde (compteur 66 attendu = 66), codes et états retrouvés, ROM renommée comprise |
| 19 | Erreurs de console | RÉUSSI | RÉUSSI | Aucune erreur JavaScript de page dans toutes les suites |
| 20 | Non-régression des autres émulateurs | RÉUSSI (voir plus bas) | | |

## Résultats chiffrés

| Suite | Résultat |
|---|---|
| `portables` : `npm test` (logique) | 105/105 |
| `portables` : `npm run test:browser` (Chromium, moteur simulé, contrôles d'audit existants + nouveaux) | 3/3 groupes réussis |
| `portables` : `npm run test:real` (vrais cœurs NES/SNES) | 43/43 |
| `tools/test-portail.mjs` (site assemblé, local) | 56/56 |
| `tools/test-mobile.mjs` (émulation Android) | 16/16 |
| Racine (laboratoire N64) : `npm test` | 82/82 |
| PS1 : `python ps1-web/tools/run_tests.py` | 185 tests Node + Python : tous réussis |
| N64 : `node --test real-n64/tests/*.test.mjs` | 80/80 |
| N64 : tests Python | voir « Non-régression N64 » |

## Codes de triche : comment l'effet a été prouvé

Deux ROM d'essai écrites pour le projet (`tests/test-roms.mjs`) affichent une couleur de fond qui dépend
d'un octet de ROM et d'un octet de RAM. Un Game Genie qui remplace l'octet de ROM, ou un code RAM, change
donc la couleur ; la couleur est relevée dans la capture du cœur.

| Console | Base | Game Genie | Code RAM |
|---|---|---|---|
| NES | bleu (33,56,239) | `ZZAAAO` → vert (74,223,74) puis bleu | `0300:16` → rouge (222,40,0) puis bleu |
| SNES | orange (255,199,57) | `3D6D-0DDD` → bleu (0,56,198) puis orange | `7E0100:03` (Pro Action Replay) → vert (24,199,0) puis orange |

Défaut trouvé et corrigé pendant ces essais : FCEUmm **ignore l'état « désactivé »** d'un code ; décocher
dans le menu du moteur réactivait le code, et un code préchargé était actif dès le lancement. Les sources
de mGBA et DeSmuME 2015 font de même. Le lanceur ne transmet donc plus que les codes cochés.

## Jeux de la collection de Karl (lecture seule)

Fichiers lus par le navigateur depuis `E:\roms`, sans copie ni modification. Démarrage réel, images qui
avancent pendant 8 s, capture non vide. « 50 images/s » = jeu PAL bien reconnu.

| Jeu | Carte / puce | Région, vidéo | Résultat |
|---|---|---|---|
| Super Mario Bros. (Europe) | NROM | PAL, 50 i/s | RÉUSSI |
| The Legend of Zelda (Europe) | MMC1 + pile | PAL, 50 i/s | RÉUSSI |
| Metroid (Europe) | MMC1 | PAL, 50 i/s | RÉUSSI |
| Mega Man 2 (Europe) | MMC1 | PAL, 50 i/s | RÉUSSI |
| Super Mario Bros. 3 (Europe) | MMC3 | PAL, 50 i/s | RÉUSSI |
| Kirby's Adventure (France) | MMC3 + pile | PAL, 50 i/s | RÉUSSI |
| Castlevania III (Europe) | MMC5 | PAL, 50 i/s | RÉUSSI (écran de démarrage peu coloré à 8 s) |
| Super Mario World (U) | LoROM + pile | NTSC, 60 i/s | RÉUSSI |
| Donkey Kong Country (U) | HiROM, haute résolution | NTSC | RÉUSSI |
| Tales of Phantasia (J) | ExHiROM 48 Mbit | NTSC | RÉUSSI (après correction de la détection ExHiROM) |
| Super Mario RPG (U) | SA-1 | NTSC | RÉUSSI |
| Star Fox (U) v1.2 | Super FX | NTSC | RÉUSSI |
| Yoshi's Island (U) | Super FX 2 | NTSC | RÉUSSI |
| Super Mario Kart (U) | DSP-1 | NTSC | RÉUSSI |
| Pilotwings (E) | DSP-1 | PAL, 50 i/s | RÉUSSI |
| Super Metroid (E) | LoROM + pile | PAL, 50 i/s | RÉUSSI |
| Mega Man X2 (U) | Cx4 | NTSC | **ÉCHEC puis corrigé** : refusé à tort (« Super Game Boy »), sous-type Cx4 = $10 ; RÉUSSI après correction |
| Street Fighter Alpha 2 (U) | S-DD1 | NTSC | RÉUSSI |
| Chrono Trigger (U) [T+Fre] | HiROM, traduction française | NTSC | RÉUSSI |
| Metroid.7z (jeu de hacks) | — | — | LIMITATION : refusé avec le message d'extraction |

« Démarre et affiche » ne veut pas dire « entièrement jouable » : aucune partie n'a été jouée.

## Non-régression des autres émulateurs

| Console | Présence portail | Moteur / démo | Erreurs | Remarque |
|---|---|---|---|---|
| GB | RÉUSSI | RÉUSSI (Libbet, Gambatte) | aucune | |
| GBC | RÉUSSI | RÉUSSI (Geometrix) | aucune | |
| GBA | RÉUSSI | RÉUSSI (@rkanoid, mGBA) | aucune | |
| DS | RÉUSSI | RÉUSSI (Pong, DeSmuME 2015) | aucune | |
| N64 | RÉUSSI | RÉUSSI (démo homebrew, « Session lancée ») | aucune | Isolation COOP/COEP active sur l'origine commune |
| PS1 | RÉUSSI | RÉUSSI (homebrew, écran rouge attendu, 7 → 76 images) | aucune | Isolation COOP/COEP active |

Import de ROM, sauvegardes et contrôles de N64 et PS1 : leurs suites existantes passent ; aucun de leurs
fichiers n'est modifié par cette branche (`real-n64/` et `ps1-web/` identiques aux branches alpha).

### Non-régression N64 (tests Python) — à lire

`python -m unittest` dans `real-n64/tests` sur ce PC : 33 tests, 1 échec, 3 erreurs, 5 ignorés.
- 2 erreurs : création de liens symboliques refusée par Windows (privilège manquant) — environnement.
- 1 erreur : `homebrew/demo-emuperso.z64` absent (fichier de construction ignoré par Git) — environnement.
- 1 échec : `test_originals_preserved`. Sur ce PC, Git convertit les fins de ligne (CRLF), ce qui change
  les empreintes de tous les fichiers protégés. **Mais ce test a aussi révélé que la première version de
  cette branche modifiait deux originaux protégés, `index.html` et `README.md`.** Corrigé : les deux sont
  revenus à l'identique (vérifié après normalisation des fins de ligne) ; le portail est publié comme
  accueil du site par la construction, sans toucher au `index.html` du dépôt.

## Déploiement Vercel de prévisualisation

Voir le rapport final (PR) : URL, accès sans compte et résultats des suites relancées sur l'URL publique.

## Reproduire

```
cd portables
npm test
npm install --no-save playwright   # ou PLAYWRIGHT_MODULE vers une installation existante
CHROMIUM_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" npm run test:browser
CHROMIUM_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" npm run test:real
node tools/test-collection.mjs "E:\roms\...\jeu.smc"     # ROM personnelles, lecture seule
```
Portail complet : voir `docs/PORTAIL-8-CONSOLES.md`.
