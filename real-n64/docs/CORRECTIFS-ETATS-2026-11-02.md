# États N64 : capture synchronisée et fermeture du stockage

Correctif du 2 novembre 2026, sur le runtime EmulatorJS 4.2.3 verrouillé existant. Le cœur Wasm et les fichiers vendor ne sont pas modifiés.

## Problème et correction

Une capture synchrone depuis un appel navigateur peut survenir pendant une suspension Asyncify du cœur. Les états ainsi produits pouvaient être relus puis provoquer une erreur mémoire dans le chemin audio de Super Mario 64 PAL.

`frame-capture.mjs` fournit maintenant le callback `postMainLoop` au runtime **avant son initialisation**. Chaque demande attend aussi que le compteur natif change. Les captures concurrentes sont sérialisées, l’audio est réactivé pour laisser terminer la trame, puis la pause antérieure est rétablie. Un délai de quatre secondes refuse une capture sans trame terminée. Les appelants attendent la Promise avant de construire une enveloppe ou une preuve RAM.

La capture de vérification attend la lecture intégrale du fichier ; l’observation complète de RAM et les témoins utilisent le même instantané, sans sérialisation supplémentaire depuis le callback de lecture FS.

La vérification existante reste obligatoire : identité ROM/cœur/configuration, lecture intégrale du fichier natif, témoins différentiels de RAM et progression du moteur. L’observation complète de RAM après lecture est désormais nommée `first_safe_frame_memory` : elle peut suivre une trame d’émulation et ne prétend pas être une observation immédiate.

Le dossier `/data/saves` est réellement monté en **MEMFS par session**. L’ancienne substitution omettait le montage alors que la fermeture native appelait toujours `FS.unmount` ; cela produisait `ErrnoError` (errno 28) au rechargement, également reproduit sur le code d’origine. La durabilité reste assurée uniquement par le coffre du lanceur, sans activer le stockage partagé IDBFS du moteur.

## Vérifications Windows / Chrome

- Super Mario 64 (Europe) : enregistrement, restauration, deuxième restauration et restauration après rechargement du document. Lecture native intégrale, témoins RAM confirmés, compteurs en progression, images du cœur et aucune erreur JavaScript.
- Mario Kart 64 (Europe) : mêmes trois restaurations réussies, dont le rechargement, sans erreur JavaScript.
- Les ROM personnelles sont lues localement, sans modification ni publication. Ce sont des parcours courts dans les menus/intro, pas une partie complète.
- Sept tests de l’ordonnanceur : frontière native, concurrence, absence de progression, délai, échec de lecture/reprise, fermeture et installation du callback avant initialisation.
- Les attentes des bancs existants utilisent les numéros de séquence des événements : le journal produit est borné à 600 lignes, donc compter ses événements ne permet pas de reconnaître sûrement une nouvelle opération.

Validation complémentaire : 87/87 tests Node, 9/9 contrôles réels de restauration (chiffres réellement dessinés et RAM du homebrew), 4/4 garde-fous réels (lecture sans application, audio bloqué, stockage après commit). Liste publique : 13 tests, dont 3 ignorés sous Windows ; distribution : 10 tests, dont 2 ignorés sous Windows. Aucun échec dans ces suites. Les preuves fraîches Windows sont conservées avec la livraison locale et ne remplacent pas les anciennes preuves Linux du dépôt.

## Reproduction

Depuis la racine, construire la distribution :

```powershell
python real-n64/tools/build-vercel-alpha.py
node tools/build-portail.mjs
node --test real-n64/tests/*.test.mjs
node real-n64/tests/state-frame-browser.mjs "chemin/local/jeu.zip"
```

Définir `CHROMIUM_PATH` si nécessaire et installer Playwright dans `portables`. Sans argument ROM, le banc utilise le homebrew MIT du projet. `TEST_URL` permet de tester un déploiement et `EVIDENCE_DIR` de conserver les captures et les preuves JSON. Les bancs Python existants `browser_restore_rc.py` et `browser_restore_guards_rc.py` contrôlent aussi les refus et les sauvegardes avec le homebrew du projet.

## Limites

Un état déjà incohérent n’est pas réparé. Les copies existantes ne sont pas écrasées et un échec de restauration conserve la session précédente. Aucune compatibilité universelle des jeux, écoute audio, manette ou téléphone physique n’est revendiquée. Les formats, empreintes du runtime et clés de sauvegardes restent inchangés.
