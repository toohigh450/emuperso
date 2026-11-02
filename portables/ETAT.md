# Portables 0.2.1-alpha.1 — état du 2 novembre 2026

## Fait

- Réponse aux audits GPT et Méo, rapports originaux et empreintes conservés dans `audits/recus/`.
- Cohérence de session après erreur d'historique ; rotation des trois miroirs dans une transaction IndexedDB ; identifiants numériques persistants avec résolution des collisions.
- Contrôle du contenu des .cht associés ; nouvelle confirmation après réimport modifié.
- Repli du moteur dans une iframe neuve après erreur ou délai ; budget mémoire et contrôle structurel/CRC des BIOS DS.
- Source EmulatorJS 4.2.3 versionnée, intégrité du chargeur, manifeste frontend, notices de provenance.
- Relais de `saveSaveFiles` et `exit` manquants dans le chargeur stable 4.2.3.
- 74 tests de logique, parcours Chromium simulé et test du vrai frontend 4.2.3 réussis. Détails dans `preuves/`.
- Workflow de tests de logique Linux/Windows, Node 22/24 ajouté. Il ne valide ni le lanceur ni la manette.

## En cours

- Revue de la 0.2.1 alpha dans la PR #1 de `emulateur-portable`.
- La validation avec de vrais jeux, sauvegardes, cheats et BIOS reste à faire sur les machines de Karl.

## Bloqué

- Vérification authentifiée de l'aperçu Vercel : la revue automatique a refusé l'action qui créerait/réutiliserait un lien temporaire de partage. La protection SSO n'a pas été modifiée.
- Pas de session Windows ni manette physique dans cet environnement ; pas de vraies ROMs ou sauvegardes fournies pour les essais.
- Intégrité de toutes les sous-ressources du moteur et licences des cœurs non finalisées. La version ne devient pas stable ou publiable par ces seuls tests.

## Prochain pas

1. Relire `REPONSE-AUX-AUDITS-0.2.1.md` et les résultats de CI rattachés au commit.
2. Exporter les sauvegardes existantes et suivre `TESTS-KARL.md` avec le vrai moteur.
3. Vérifier la route `/portables/` de l'aperçu avec un accès autorisé ; ne pas utiliser le laboratoire N64 à la racine comme preuve Portables.
4. Corriger tout défaut reproduit, puis laisser Karl décider de la suite. Pas de fusion ni de promotion de production effectuée.
