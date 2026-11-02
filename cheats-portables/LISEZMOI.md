# Cheats individuels — Portables, NES et SNES

7993 fichiers .cht, 204641 codes issus de sources publiques (portables : 2958 fichiers / 82154 codes ; NES : 2262 fichiers / 44504 codes ; SNES : 2773 fichiers / 77983 codes). Les codes sont désactivés et non testés en jeu. Correspondance par titre, région et révision ; aucun rom_sha256 ajouté sans identifier les octets. Confirme chaque association dans Portables. Les hacks et variantes sans source précise restent dans RECHERCHES-RESTANTES.json.

Source et attribution : contributeurs libretro/libretro-database, https://github.com/libretro/libretro-database, commit 2fdd069d45883449cecf97deddd493492e77ff29. Licence CC BY-SA 4.0 jointe. Adaptations : sélection pour l’inventaire local, regroupement par fichier de ROM, préfixes d’appareil, métadonnées de provenance, activation initiale désactivée. Les fichiers de ce lot restent sous cette licence.

Import : onglet Codes de Portables → Importer un dossier → choisir un sous-dossier de console. Maximum 1000 fichiers / 32 Mio par lot, 5000 fichiers / 64 Mio au total. Si un dossier dépasse ces limites, importer seulement les jeux voulus en plusieurs sélections. Ne pas activer tous les codes ensemble : conserver les consignes de la source, codes maîtres et variantes exclusives.

ROMs, BIOS et sauvegardes ne sont pas inclus. Publié sur la branche emulateur-portable à la demande de Karl, sans chemins locaux ni données de ROM.

Inventaire : 12082 entrées de ROM lues dans les noms/archives, 12062 noms distincts ; 0 archives illisibles à reprendre. 9104 noms sans fichier livré : aucune compatibilité n’est inventée.

## Reprise Claude — 1er novembre 2026, 20 h 20

Les 2 319 ZIP DS que Codex n'avait pas pu lire (téléchargement qBittorrent en cours) sont maintenant rattachés par leur nom de fichier, qui est le nom No-Intro du jeu. 991 fichiers .cht DS viennent de ce rattachement par nom : leur contenu n'a pas été lu, et l'association reste à confirmer dans Portables comme pour les autres.
Le dossier DS contient plus de 1 000 fichiers : l'importer en deux sélections.

## PSP — 2 novembre 2026

Dossier `Sony - PlayStation Portable/` : un fichier par jeu de la collection locale, nommé `<jeu> [<identifiant du disque>].cht`. L'identifiant est lu dans le jeu (UMD_DATA.BIN ou PARAM.SFO) ; Portables propose le fichier pour ce disque, à confirmer une fois (la révision n'est pas garantie). Même source et même commit que ci-dessus, CC BY-SA 4.0. Inventaire : `INDEX-PSP.json` (totaux et fichiers livrés ; la liste des jeux sans source reste sur le PC, hors du dépôt). À relancer quand le téléchargement est fini : `node portables/tools/cheats-psp.mjs "<dossier PSP>"`.
