# Rapport final — NES + SNES et portail unique 8 consoles

- Dépôt : https://github.com/toohigh450/emuperso
- Branche : `feature/nes-snes-unified` — https://github.com/toohigh450/emuperso/tree/feature/nes-snes-unified
- Pull Request (à ouvrir en brouillon, voir plus bas) : https://github.com/toohigh450/emuperso/compare/main...feature/nes-snes-unified?expand=1
- Aperçu Vercel public : https://emuperso-git-feature-nes-snes-unified-toohigh450-1311.vercel.app/
- Moteur NES : FCEUmm (GPL-2.0) · Moteur SNES : Snes9x (licence non commerciale), via EmulatorJS 4.2.3 (GPL-3.0)
- Détails : `portables/COMPATIBILITE-NES-SNES.md` (formats, régions, cartes, puces, codes, sauvegardes),
  `portables/TESTS-NES-SNES.md` (résultats), `portables/DEMOS-LIBRES.md` (homebrews et licences),
  `docs/INVENTAIRE-ROMS-NES-SNES.md` (collection), `docs/PORTAIL-8-CONSOLES.md` (architecture, construction).

Ce texte sert aussi de description de la Pull Request.

## Résumé

NES et Super Nintendo rejoignent le portail, et **les 8 consoles sont accessibles depuis une seule page d'accueil** d'un seul site Vercel : NES, SNES, GB, GBC, GBA, DS (application `portables/`), N64 (`real-n64/`) et PS1 (`ps1-web/`).

**Ne pas fusionner sans l'accord de Karl.** Aucune modification de `main`, aucune promotion en production.

Aperçu public (sans compte Vercel) : https://emuperso-git-feature-nes-snes-unified-toohigh450-1311.vercel.app/

## À valider par Karl (changements visibles après fusion)

1. **Page d'accueil de production** : aujourd'hui `emuperso.vercel.app` affiche le laboratoire N64 Phase 1A. Après fusion, l'accueil devient le portail 8 consoles ; le laboratoire reste en ligne, inchangé, à `/N64-Web-Lab-Phase1A.html` (lien en pied de page). Le `index.html` du dépôt n'est **pas** modifié (original protégé par `real-n64/tests/test_real_tools.py`) : c'est la construction qui publie `portail/index.html` comme accueil.
2. **`vercel.json` (nouveau)** : le projet `emuperso` passe de « fichiers servis tels quels » à une construction (téléchargement vérifié SHA-256 des moteurs N64 et PS1, comme sur leurs projets dédiés). Construction Vercel réussie sur cette branche.
3. **Cette branche contient aussi** `emulateur-portable` (PR toohigh450/emuperso#1, brouillon), `alpha/n64-vercel-playable` et `alpha/ps1-vercel-playable`, fusionnées sans conflit (ces branches n'ajoutent que leurs propres dossiers). Les fusionner ici était nécessaire pour réunir les 8 consoles sur un même site.
4. **Correction de comportement GB/GBC/GBA/DS** : voir « Défauts existants corrigés ».

## Ce qui change

- **NES** (FCEUmm) et **SNES** (Snes9x) dans le lanceur Nintendo existant : `.nes`, `.unf`, `.sfc`, `.smc`, `.zip` ; formats incompatibles refusés avec un message clair (`.7z`, `.fds`, patchs…).
- **Démos libres hébergées avec le site**, vérifiées par SHA-256 : Snake (NES, zlib), Neon Breaker et Shmup (SNES, MIT), démos SA-1 et DSP-1 (MIT). Licences complètes dans `portables/demos/`.
- **Codes** : panneau par jeu (ajouter, nommer, cocher, décocher, supprimer), formats Game Genie NES/SNES, Pro Action Replay et bruts **validés avant envoi**, liés à l'empreinte exacte de la ROM, jamais actifs à l'ajout.
- **Sauvegardes** : export/import immédiat, 4 états par jeu (l'état remplacé reste chargeable), écriture immédiate avant changement de jeu / fermeture / arrière-plan, toutes les 30 s sinon.
- **Catalogue** : dossier ou sélection multiple (noms seulement en mémoire, liste virtuelle), filtres console / région / français / originaux-hacks-traductions / doublons, favoris.
- **Android** : sélecteur de fichiers sans filtre sur écran tactile, gestes du navigateur bloqués sur l'écran de jeu.

## Défauts existants corrigés

- **Codes actifs à l'insu de l'utilisateur** : FCEUmm, mGBA et DeSmuME 2015 ignorent l'état « désactivé ». Les codes d'un `.cht` associé (GB/GBA/DS) étaient donc tous actifs au lancement malgré l'affichage. Le lanceur n'envoie plus que les codes cochés (prouvé dans les vrais cœurs NES/SNES).
- **Progression perdue** : la sauvegarde de cartouche n'était écrite que toutes les 5 min ; changer de jeu ou fermer pouvait perdre jusqu'à 5 min. Elle est maintenant écrite avant la destruction du moteur.

## Tests réellement exécutés (Chrome Windows, détails dans `portables/TESTS-NES-SNES.md`)

| Suite | Résultat |
|---|---|
| NES/SNES, vrais cœurs FCEUmm/Snes9x (`npm run test:real`) : ouverture, affichage, Game Genie et codes RAM activés **puis désactivés** (effet mesuré à l'écran), sauvegarde, état, export/import, changement de ROM, **fermeture du navigateur puis reprise**, démos | **43/43** |
| Site complet sur l'**aperçu Vercel public** : 8 consoles, liens, démos réelles GB/GBC/GBA/DS/NES/SNES/N64/PS1 | **56/56** |
| Émulation téléphone Android sur l'aperçu public : manette tactile NES/SNES, portrait/paysage, arrière-plan | **16/16** |
| Reprise des sauvegardes GB/GBA/DS (`npm run test:real-saves`) : ancienne version du lanceur puis nouvelle, sur la même origine ; copie avant démarrage, original intact, jamais d'écrasement, ROM renommée | **16/16** |
| Logique `portables` / Chromium simulé (contrôles d'audit existants compris) | 113/113 · 3/3 groupes |
| Non-régression : racine (labo N64) / PS1 / N64 Node | 82/82 · 185 + Python OK · 80/80 |
| **19 jeux de la collection de Karl** (7 NES, 12 SNES) (lecture seule) : NROM, MMC1, MMC3, MMC5 (PAL 50 i/s) ; LoROM, HiROM, ExHiROM, SA-1, Super FX, Super FX 2, DSP-1, Cx4, S-DD1, PAL, traduction FR | **19/19 démarrent** (Mega Man X2 après correction) ; `.7z` refusé avec message |

Tests Python N64 sur ce PC : 1 échec + 3 erreurs dus à l'environnement Windows (liens symboliques, fichier de construction absent, fins de ligne CRLF) ; ce test a aussi détecté qu'une première version modifiait `index.html`/`README.md` protégés — corrigé, 0/98 originaux modifiés.

**Non testé** : vrai téléphone Android, manettes physiques, audio à l'oreille, clavier dans un jeu. L'émulation téléphone de Chrome n'est pas une validation Android.

## Limites connues

- `.7z` / `.rar` non ouverts dans le navigateur (le jeu de hacks NES en contient 34 127 ROM dans 1 708 archives) : extraire avec 7-Zip.
- Snes9x : licence **non commerciale**.
- GB/GBC/GBA/DS : la sauvegarde du moteur suit maintenant l'empreinte de la ROM, comme NES/SNES (0.3.0-alpha.2). Une sauvegarde existante, nommée d'après l'ancien nom de fichier, est **copiée** au premier lancement ; l'originale n'est ni modifiée ni supprimée, et une sauvegarde déjà présente sous le nouveau nom n'est jamais remplacée. Essai réel : `npm run test:real-saves` (16/16).
- Démo Super FX libre écartée (non détectée par Snes9x d'après son auteur) ; Super FX vérifié avec Star Fox et Yoshi's Island de la collection de Karl.

## Commits

- (ce commit) Sauvegardes GB/GBC/GBA/DS liées à l'empreinte, reprise par copie des anciennes
- 1538a6c TESTS-NES-SNES.md : nombre exact de jeux SNES testés (12, pas 14)
- 32c7604 Tests sur l'aperçu Vercel public : 56/56 site complet, 16/16 émulation téléphone
- 8c43585 Redémarrage fiable après une capture d'état ; indicateur « lanceur prêt »
- 8be46ab Accueil du site = portail 8 consoles, sans toucher aux originaux ; documentation et tests
- 113a699 Originaux N64 protégés restaurés ; corrections Cx4, ExHiROM et libération du moteur
- 157a8c7 Portail unique : accueil 8 consoles et construction Vercel commune
- 28d16de Lanceur Nintendo 0.3.0 : NES et SNES jouables, codes par jeu, états, catalogue, démos libres
- c8aba43 NES/SNES : détection des ROM, codes Game Genie / Action Replay, noms et inventaire
- 04f89ad Intégration : PS1 jouable (alpha/ps1-vercel-playable) dans la branche unifiée
- c0fcaae Intégration : N64 jouable (alpha/n64-vercel-playable) dans la branche unifiée

(Les deux derniers de la liste sont les fusions des branches alpha N64 et PS1 ; leur historique est inclus.)

## Reproduire

Voir `docs/PORTAIL-8-CONSOLES.md` (construction locale, serveur, suites de tests).

## Ouvrir la Pull Request

La PR n'a pas pu être créée automatiquement (pas d'outil GitHub authentifié dans la session). Ouvrir le lien
« Pull Request » ci-dessus, choisir **Create draft pull request**, coller ce rapport comme description.
Ne pas fusionner sans validation de Karl.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

