# Livraison GitHub — Portables 0.2.1-alpha.1

Dépôt : https://github.com/toohigh450/emuperso
Branche : `emulateur-portable`
Base : `main`, commit `4936007df68882a5417746e5ef36cfadadf5537e`.

La livraison initiale a ajouté le dossier `portables/`. La correction des audits ajoute aussi le workflow `.github/workflows/portables-tests.yml` ; tous les autres changements restent dans `portables/`. Les fichiers existants de la branche de base restent inchangés. Les branches N64 et PS1 ne sont pas modifiées. Pas de fusion ni de promotion manuelle de production. Vercel crée des aperçus automatiquement lors des mises à jour de branche ; leur existence ne valide pas un jeu.

Le contenu reprend la 0.2.0 puis les corrections détaillées dans `REPONSE-AUX-AUDITS-0.2.1.md`. Les trois ZIP du dossier `tests/fixtures/` sont des fixtures synthétiques déjà présentes dans le projet fourni, pas des jeux commerciaux.

Validation exécutée : 74 tests de logique réussis sous Node 24.19.0 ; parcours Chromium simulé et vrai frontend 4.2.3 réussis, sans cœur ni jeu exécuté. Ces résultats ne valident pas les jeux, les cheats, les sauvegardes du vrai moteur ou le lanceur Windows. Voir `ANALYSE-ET-CORRECTIONS.md` et `TESTS-KARL.md`.

Depuis la racine du dépôt : `cd portables`, puis `npm test` (Node >= 22.17).
Démarrage Windows : double-cliquer sur `portables/DEMARRER-PORTABLES.bat` après extraction ou clonage.

SHA-256 de l’archive originale 0.1.0 :
`189077e0b4cf67afcdf5bece16ffa9812a5e0050a46f6fff7a88f0d81bad43d7`

SHA-256 de l’archive corrigée 0.2.0 livrée avant intégration GitHub :
`1f896ebfc2b1ce5261f0fb8f158060a1b9d1de032f3ccd3aed7fcf9651febefb`
