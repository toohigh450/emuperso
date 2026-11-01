# État — version 0.2.0

Le projet a été analysé et corrigé dans une copie de travail. L'archive originale est conservée.

- Identité complète des ROMs, sans échantillonnage.
- Cheats : suggestions par nom, association explicite liée à l'empreinte, métadonnée `.cht` `rom_sha256`.
- Noms internes du moteur basés sur le SHA-256 pour les nouveaux jeux ; conservation du nom historique pour les jeux déjà connus en 0.1.
- Meilleure détection et extension corrigée pour le moteur ; choix dans les ZIP multiples et contrôles de décompression.
- Ouvertures concurrentes empêchées ; erreurs d'ouverture affichées ; démarrage en stockage temporaire si IndexedDB échoue.
- Copies miroir simultanées sérialisées ; correction du contrôle de chemin du serveur Windows.

Validation : 67 tests de logique réussis. Parcours Chromium réussi avec moteur simulé, y compris persistance IndexedDB, association après renommage, ROM modifiée, compatibilité des noms historiques et stockage bloqué.

Restent non validés : exécution de jeux réels, cheats réels, sauvegardes natives du moteur, BIOS, manette, mode hors ligne et lanceur PowerShell/Windows. Aucun résultat de compatibilité universelle n'est revendiqué.

Voir `ANALYSE-ET-CORRECTIONS.md` et `TESTS-KARL.md`.
