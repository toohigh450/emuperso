# Opération N64 Web — premier prototype réel, v0.1.0

**Branche `emulateur-reel` seulement. Aucun remplacement du Lab, aucune fusion main.**

La ROM autonome `homebrew/fallback-open/demo-emuperso-open.z64` démarre réellement
avec EmulatorJS 4.2.3 / mupen64plus_next (build 2.0.2). Vidéo, animation, clavier A/B
et PCM WebAudio ont été testés dans Chromium/Linux. Le test final du Chrome de Karl
reste à faire. Aucun jeu commercial ni sauvegarde originale utilisés.

## Important : deux résultats distincts

Les sources libdragon de Claude (`demo-n64/`) ont été examinées puis compilées sur
une copie sans correction C/Makefile : ROM 147456 octets, SHA dans
`homebrew/build-info.json`. Cette ROM standard **n’a pas démarré** dans le vieux
cœur distribué testé. Les traces d’échec et les variantes expérimentales restent
séparées : ne pas les présenter comme réussies.

Le succès concerne un **nouveau port autonome du comportement de la démo** : code C
VR4300, vrai framebuffer VI, contrôleur SI et audio AI. Il n’est pas lié au runtime
libdragon. Son démarrage MIT suppose 8 Mio de RAM déjà préparés par l’émulateur,
sans calibration physique. Aucune compatibilité sur console N64 n’est revendiquée.
Ce n’est pas une ROM tierce précompilée téléchargée ni une simulation JavaScript.

## Lancer sur Windows avec Chrome

Python 3.10+ doit être installé (`py -3 --version`). Depuis ce dossier :

1. `py -3 tools/fetch_runtime.py` — première préparation : télécharge deux paquets
   NPM officiels figés, vérifie SHA-256/SHA-512 et installe localement 39 assets.
   Aucun npm, compte, script d’installation NPM ou abonnement requis. Internet
   nécessaire à cette étape seulement ; le moteur binaire n’est pas inclus dans Git.
2. `py -3 tools/fetch_runtime.py --verify-only`.
3. `py -3 tools/serve.py`.
4. Dans **Google Chrome**, ouvrir `http://127.0.0.1:8770/` puis Lancer la démo.
   Ne pas ouvrir le HTML en file:// : le moteur nécessite un serveur local.
5. Cliquer dans le jeu : **X = A**, **S = B**. A déclenche la tonalité.
   « Activer / reprendre l’audio » permet de reprendre un AudioContext suspendu.
6. Exporter le diagnostic, puis arrêter le serveur avec Ctrl+C.

`lancer.bat` vérifie les dépendances déjà préparées puis démarre le serveur.
Les instructions Windows et ce lanceur n’ont pas été exécutés sur le PC de Karl.
Sous Linux : remplacer `py -3` par `python3`.

Après préparation, le lancement ne dépend d’aucun service externe. Le contrôle de
mise à jour CDN du frontend est redirigé vers le fichier de version local figé.
L’origine dédiée localhost:8770 sépare cet essai des autres projets. EmulatorJS
peut utiliser IndexedDB pour ses fichiers internes ; nous ne revendiquons pas un
moteur « RAM seulement ». Aucun import d’état/sauvegarde n’est proposé dans les menus.

## Recompiler

Linux x86_64 ou WSL2, avec Python, git, make, gcc/g++, dpkg-deb :

```
python3 homebrew/setup-toolchain.py --jobs 4
N64_INST="$PWD/cache/toolchain/opt/libdragon" bash homebrew/build.sh
python3 homebrew/fallback-open/build.py
```

Le bootstrap fixe la chaîne officielle par SHA-256 et libdragon par commit.
Il écrit uniquement dans cache/ et homebrew/. Le script natif a remplacé la voie
Docker : le registre GHCR a refusé le pull dans notre environnement. Docker n’est
pas déclaré validé. Les commandes de préparation équivalentes ont été exécutées ;
le bootstrap agrégé complet n’a pas encore été retesté depuis une machine vierge.

La ROM autonome est MIT, sans bibliothèque liée ; seuls les timings VI sont issus
de libdragon sous Unlicense. Sources, linker, bootstrap, carte de liens et licences
sont inclus. Les binaires des variantes SDK échouées ne sont pas publiés dans Git ;
leurs sources et empreintes permettent de les reconstruire.

## Tests et audits

- `python3 tests/browser_real.py` : nécessite Playwright, Pillow, Chromium et
  tesseract. Sept groupes réellement exécutés : cœur/Wasm, image/animation, hash du
  fichier ROM dans le FS émulé, clavier A/B, PCM programmé non nul puis silence,
  stabilité supplémentaire 30 s, aucun service externe au lancement.
- `CHROMIUM_PATH` peut désigner un autre exécutable Chromium compatible.
- `python3 -m unittest discover -s tests -p test_real_tools.py -v` : chemins,
  symlinks, hashes des ROM locales de recherche et préservation des originaux.
  Le test de toutes variantes nécessite leur compilation locale préalable.
- Résultats : `evidence/browser-real-results.json`, captures et journal de console.
- Rapport : `docs/RAPPORT.html`. Protocole terrain : `docs/VALIDATION-KARL.md`.

Les buffers PCM sont ceux réellement ordonnancés par le moteur via WebAudio,
observés sans modifier leurs données. Ce test ne remplace pas l’écoute sur des
haut-parleurs. Manette physique, Chrome Windows de Karl, Edge, Firefox, console
réelle, stabilité longue et autres ROM restent NON TESTABLES / non testés ici.

Le workflow `.github/workflows/real-n64.yml` est limité à emulateur-reel. Aucun job
Pages, déploiement, écriture de branche ou fusion. Son exécution CI doit être lue
séparément des résultats locaux, sans présumer qu’il a réussi.

Suite : audit GPT, contre-audit Méo, test Chrome de Karl. Aucune correction Sonic,
compatibilité Conker ou performance générale N64 revendiquée.

Correction CI : le premier bootstrap vierge refusait à tort le clone sans checkout. Correction et test de non-régression ajoutés ; cinq tests outils passent. Le statut CI final est à lire dans GitHub Actions.
