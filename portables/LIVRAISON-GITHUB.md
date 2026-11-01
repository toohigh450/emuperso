# Livraison GitHub — Portables 0.2.0

Dépôt : https://github.com/toohigh450/emuperso
Branche : `emulateur-portable`
Base : `main`, commit `4936007df68882a5417746e5ef36cfadadf5537e`.

Cette livraison ajoute uniquement le dossier `portables/`. Les fichiers existants de la branche de base restent inchangés. Les branches N64 et PS1 ne sont pas modifiées. Pas de fusion ni de déploiement.

Le contenu reprend la version 0.2.0 corrigée, ses tests et ses documents ; la note de livraison est actualisée pour GitHub. Les trois ZIP du dossier `tests/fixtures/` sont des fixtures synthétiques déjà présentes dans le projet fourni, pas des jeux commerciaux.

Validation déjà exécutée : 67 tests de logique réussis sous Node 24.19.0 ; parcours Chromium réussi avec moteur simulé. Ces résultats ne valident pas les jeux, les cheats, les sauvegardes du vrai moteur ou le lanceur Windows. Voir `ANALYSE-ET-CORRECTIONS.md` et `TESTS-KARL.md`.

Depuis la racine du dépôt : `cd portables`, puis `npm test` (Node >= 22.17).
Démarrage Windows : double-cliquer sur `portables/DEMARRER-PORTABLES.bat` après extraction ou clonage.

SHA-256 de l’archive originale 0.1.0 :
`189077e0b4cf67afcdf5bece16ffa9812a5e0050a46f6fff7a88f0d81bad43d7`

SHA-256 de l’archive corrigée 0.2.0 livrée avant intégration GitHub :
`1f896ebfc2b1ce5261f0fb8f158060a1b9d1de032f3ccd3aed7fcf9651febefb`
