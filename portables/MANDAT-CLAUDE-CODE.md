# Mandat pour Claude Code : intégrer « Portables » (GB / GBC / GBA / DS)

Contexte : projet indépendant, même principe que les émulateurs N64 et PS1, construit dans une conversation mobile.
Dossier fourni : `emuperso-portables` (ZIP livré avec SHA-256).

## À faire
1. Vérifier le SHA-256 du ZIP, puis extraire une copie de travail (garder l'original intact).
2. Lancer `npm test` : 56 tests attendus, tous réussis. Rapporter le résultat réel.
3. Créer une branche dédiée, par exemple `emulateur-portables` (nom à confirmer par Karl), qui ajoute seulement un
   dossier `portables/` avec le contenu du projet. Ouvrir une pull request, **sans la fusionner**.
4. Relire le code (surtout `js/app.mjs`, `player.html`, `serveur.ps1`) et signaler tout bogue probable, sans rien déclarer testé.

## Interdits
- Ne pas toucher à `main`, à la branche N64 (`emulateur-reel`), à la branche PS1 (`emulateur-ps1`) ni à Conker Web.
- Aucune ROM, aucun BIOS, aucune base de codes dans le dépôt. Aucune publication, aucun déploiement, aucune fusion sans le GO explicite de Karl.
- Ne jamais déclarer un test réel réussi s'il n'a pas été exécuté. Décision d'architecture ou risque de perte de données : demander à Karl.

## Livrables
Commit exact, SHA-256 du ZIP, journal des modifications, tests exécutés (réussis/échoués), problèmes ouverts,
points à vérifier par Karl dans Chrome sur Windows (voir `TESTS-KARL.md`).
