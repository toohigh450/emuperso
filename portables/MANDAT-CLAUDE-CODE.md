# Mandat Portables — suivi après audits

Le mandat initial de la 0.1 a été exécuté puis étendu par les demandes de Karl : analyser/améliorer, créer `emulateur-portable`, y déposer le travail, puis traiter les audits GPT et Méo.

## Références

- Dépôt : `toohigh450/emuperso` ; branche réelle : **`emulateur-portable`** (singulier).
- PR #1 : brouillon, aucune fusion autorisée.
- Version fournie 0.1 : 56 tests de logique ; version auditée 0.2.0 : 67 ; correctif actuel 0.2.1-alpha.1 : **74 tests réussis**.
- Les parcours Chromium, simulés ou limités au vrai frontend, ne prouvent pas l'exécution de jeux réels.

## Périmètre des corrections

Application, outils, tests, audits et preuves sous `portables/`. Exception nécessaire pour l'automatisation demandée par l'audit : `.github/workflows/portables-tests.yml`. Aucun fichier existant N64, PS1 ou Conker n'est modifié. Pas de ROM commerciale, de BIOS matériel ni de base de codes ajouté.

## Règles de livraison

- Original 0.1 et livraisons précédentes conservés ; rapports reçus archivés sans modification.
- Résultats exécutés séparés des vérifications statiques et des essais terrain encore ouverts.
- Pas de fusion, de version stable ni de promotion en production sans décision de Karl.
- Le dépôt est relié à Vercel : une mise à jour de branche peut déclencher un aperçu automatiquement. Aucun déploiement manuel n'est lancé ici.

## À suivre

Voir `ETAT.md`, `REPONSE-AUX-AUDITS-0.2.1.md` et `TESTS-KARL.md`. Les essais réels et l'accès protégé à l'aperçu restent nécessaires avant d'annoncer une version fiable.
