# Portables 0.2.1-alpha.2 — reprise Claude du travail de Codex

1er novembre 2026, 20 h 20 (Toronto). Point de départ : la session Codex « Reprendre les corrections de l'audit », arrêtée à 20 h 06 parce qu'elle avait atteint sa limite d'utilisation. La branche `emulateur-portable` est au commit `9d09509`, poussé par Codex. Aucun code n'a été modifié dans le dépôt et rien n'a été poussé : PR #1 toujours en brouillon.

## 1. DS avec le vrai moteur

| ROM (ZIP intègre selon `7z t`) | Cœur | Démarrage | Résultat |
|---|---|---|---|
| The Amazing Spider-Man (Europe) | desmume2015 | 4 s | image sur les deux écrans (menu de sauvegarde), contexte audio actif à 48 kHz, fermeture propre |

Capture : `preuves/claude-ds-spiderman.png`. Le son lui-même n'a pas été écouté, car Chrome tournait sans fenêtre.
Codex avait testé Etrian Odyssey : il avait obtenu l'état « running », sans capture analysée.

Castlevania - Dawn of Sorrow a échoué avec « The compressed data was not valid ». La cause est le ZIP, encore incomplet pendant le téléchargement, et non le moteur : `7z t` signale aussi une erreur de données.

## 2. Téléchargement DS

Le téléchargement était en cours à 20 h 18. Sur 3 232 ZIP, 1 376 commençaient encore par des octets vides et des fichiers étaient modifiés à la seconde même. Avant de tester un ZIP DS, vérifie qu'il est complet (100 % dans qBittorrent).

## 3. Cheats individuels

Même méthode et même source que Codex : libretro-database, commit `2fdd069d`, licence CC BY-SA 4.0. Les correspondances se font par titre, région et révision ; aucun code n'est activé et aucun n'est testé en jeu.

| Console | ROMs inventoriées | Fichiers `.cht` | Sans source |
|---|---|---|---|
| Game Boy | 3 491 | 517 | 2 964 |
| Game Boy Color | 2 340 | 337 | 1 994 |
| Game Boy Advance | 2 893 | 634 | 2 259 |
| DS | 3 358 | **1 470** (Codex : 362) | 1 887 |
| **Total** | 12 082 | **2 958** (82 154 codes) | 9 104 |

Seul changement par rapport au script de Codex : quand un ZIP DS n'est pas encore lisible, son nom de fichier (nom No-Intro) remplace la liste de son contenu. Aucune archive n'est donc plus mise de côté. 991 fichiers `.cht` DS viennent de ce rattachement par le nom.

Les jeux sans source sont listés dans `cheats-portables/RECHERCHES-RESTANTES.json` (à la racine du dépôt). Pour 1 133 d'entre eux (hacks et traductions), il faudra des recherches au cas par cas. Aucun code n'a été inventé.

## 4. À faire

- Tester dans Portables un code DS Action Replay et un code GBA, et noter leur effet en jeu.
- Une fois le téléchargement fini, tester 2 ou 3 ZIP DS plus lourds (128 Mio et plus) et noter la mémoire utilisée.
- Importer le dossier DS en deux sélections, car l'application accepte au maximum 1 000 fichiers par import.
