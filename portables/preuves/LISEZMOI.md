# Résultats exécutés — 2 novembre 2026

Node 24.19.0 et Chromium préinstallé dans l’environnement de travail.

- `syntaxe.txt` : npm run check.
- `tests-logique.txt` : npm test, 74 réussis, aucun échec.
- `tests-chromium.txt` : parcours de l’application avec moteur simulé et erreurs injectées.
- `frontend-reel.txt` : vrai frontend EmulatorJS 4.2.3 vérifié par SHA-256 ; ready, événement saveSaveFiles avec données synthétiques, puis exit. Aucun cœur ni jeu exécuté.

Les deux scripts Chromium utilisent Playwright, installé séparément. Les trois fichiers frontend externes sont ceux de emulatorjs/engine-lock.json. Ils ne sont pas embarqués. Les logs n’attestent ni la CI distante, ni Windows, ni une ROM réelle, ni une restauration réelle.
