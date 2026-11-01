# Dépendances — EMUPERSO 0.5.0 RC1

**STOP publication :** la présence de licences et d’empreintes ne résout pas les sources correspondantes manquantes du moteur. Voir [l’audit de redistribution](REDISTRIBUTION-RC.md), [sa porte structurée](redistribution-rc.json) et les [licences complètes](licenses/README.md).

La bannière RC est originale ; l’ancien décor Dragon Ball ne fait pas partie des nouvelles distributions. Aucun bundle moteur n’est publié par la préparation de cette RC.

## Inventaire historique vérifié

# Notices et provenance

Les fichiers originaux écrits pour real-n64 et le port homebrew sont MIT (LICENSE).
Les auteurs et licences des composants tiers restent distincts.

- Démo Claude : demo-n64/LICENSE, Karl2026MIT, commit1219ecf.
- TimingsVI et copiesexpérimentalesbootstrap : libdragon e356bf3f…, Unlicense,
  texte homebrew/licenses/LIBDRAGON-UNLICENSE.txt et emulator-boot/LICENSE.
- Frontend EmulatorJS4.2.3 : GPL3+ ; sourceetLICENSErécupérés parinstallateur
  directementdupaquetofficiel, pasintégrésauxsourcespropresduLab.
- Coremupen64plus_next métadonnées2.0.2 : licenseGPL2fournieparl’amont dans
  docs/core-metadata/license.txt ; sourcescorrespondantesexactesnonétablies.
  Vendor/coreexclusduGit etZIP ; téléchargementdirectamontverrouilléSHA.
- SDKNewlib4.4 etexceptionruntimeGCC16.2 : noticesfourniespourétudedesvariantesSDK,
  maisaucunelibNewlib/libgcc/libdragonliée àlaROMautonomepubliée.

Les URLs et SHA-256/SHA-512 de chaque paquet runtime sont dans runtime-lock.json.
Aucun fichier de BIOS ou boot commercial Nintendo n’a été téléchargé ou inclus.

## Python portable du lanceur Windows 0.2.1

CPython 3.12.10 embedded Windows amd64 est téléchargé directement depuis
`https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip`.
Sa taille, son SHA-256 et les SHA-256 de ses 35 fichiers sont dans
`portable-python-lock.json`. La licence officielle complète et les notices des
composants associés sont conservées sans modification dans `.python/LICENSE.txt`.
L’archive officielle est vérifiée avant extraction et tous les fichiers sont
revérifiés avant chaque utilisation. Le lanceur ne modifie ni le code de Python,
ni le PATH système, ni la politique d’exécution PowerShell globale.
Cette dépendance reste exclue de Git et du ZIP de sources (téléchargement utilisateur).

## Catalogue de cheats 0.4.0

Source officielle non modifiée : mupen64plus/mupen64plus-core,
commit dc1411a196b0e35745e9a5661a44e60809fad250, data/mupencheat.txt.
L’en-tête annonce une relicence GPL-2.0+ avec permission de Gent ; la licence
complète doc/gpl-license est téléchargée avec le catalogue, sans modification.
Les deux fichiers sont vérifiés SHA-256, conservés ensemble dans vendor/cheats,
exclus de Git/ZIP. Commit, URLs, tailles, empreintes et comptes dans
cheat-catalog-lock.json. Code d’intégration original MIT ; aucun code commercial
certifié par l’import du catalogue. Les obligations du moteur restent distinctes.
