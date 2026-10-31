# Opération N64 Web — livraison 0.3.0 — import ZIP local

**Branche `emulateur-reel` seulement. Aucun remplacement du Lab, aucune fusion main.**

La ROM autonome `homebrew/fallback-open/demo-emuperso-open.z64` démarre réellement
avec EmulatorJS 4.2.3 / mupen64plus_next (build 2.0.2). Vidéo, animation, clavier A/B
et PCM WebAudio ont été testés dans Chromium/Linux. Le test final du Chrome de Karl
reste à faire. Aucun jeu commercial ni sauvegarde originale utilisés.

## Importer une ROM ou un ZIP depuis votre PC — 0.3.0

Après préparation et ouverture du serveur local dans Chrome :

1. Cliquer **Choisir une ROM** et sélectionner un fichier **.z64, .n64, .v64 ou .zip**.
   Un ZIP contenant une seule ROM est extrait automatiquement dans le navigateur.
   Avec plusieurs ROM, choisir une entrée puis **Préparer cette ROM**.
   Les fichiers annexes sûrs sont ignorés ; aucun fichier n’est écrit sur le PC.
2. Vérifier le nom, le format détecté, la taille et les deux SHA-256 affichés.
3. Cliquer **Lancer la ROM choisie**. Après un lancement, recharger la page pour changer
   de ROM ; un seul moteur est créé par page.
4. **Lancer la démo homebrew** reste le test de référence, disponible avant lancement.

Le fichier est lu par File.arrayBuffer dans le navigateur. Dans un ZIP, la ROM choisie
est décompressée en mémoire, vérifiée par CRC-32 puis validée comme une ROM brute.
Elle est transmise au moteur par
URL Blob. Aucun upload, aucun chemin serveur construit à partir du nom du fichier.
Seules les ressources fixes du moteur sont demandées au serveur local. La politique CSP
interdit les connexions externes. Le diagnostic contient des métadonnées (nom, taille,
empreintes), **jamais les octets de la ROM** ; son export est volontaire et local.
Le rechargement exige de sélectionner le fichier à nouveau. Le moteur peut conserver
ses sauvegardes internes dans IndexedDB local ; son nom de jeu est isolé par le SHA du
contenu normalisé et ne reprend pas le nom de fichier utilisateur.

Validation : taille entre 4 Kio et 64 Mio inclus, multiple de quatre octets, signature
80371240 (Z64), 37804012 (V64) ou 40123780 (N64). V64 est inversé par paires, N64 par
mots de quatre ; le moteur reçoit du Z64. Le SHA du fichier source est conservé séparément.
Un nom avec extension incohérente produit un avertissement : la signature est prioritaire.
Ni CRC, ni code exécutable, ni compatibilité, ni droits d’un jeu ne sont démontrés par
cette validation. Les jeux commerciaux ne sont pas déclarés compatibles.

### Limites et garde-fous ZIP

ZIP32 standard, non chiffré, compression Stockage (0) ou Deflate (8), jusqu’à
96 Mio. Maximum 512 entrées, répertoire central 2 Mio, somme des tailles déclarées
256 Mio ; ROM de 4 Kio à 64 Mio, taille multiple de quatre. Une ROM synthétique très
compressible de 64 Mio est réellement testée, sans imposer un ratio arbitraire.

En-têtes local/central et descripteurs doivent correspondre. Tailles, CRC-32,
chemins dangereux, liens, chevauchements et noms dupliqués sont contrôlés.
La sortie Deflate est limitée pendant sa lecture. ZIP64, volumes multiples, mots
de passe, autres compressions, archives imbriquées et auto-extractibles ne sont
pas pris en charge. Aucun script ou fichier annexe n’est exécuté. Les noms historiques
non UTF-8 peuvent être affichés avec des caractères approximatifs.

Une nouvelle sélection ou le lancement de la référence invalide la lecture précédente
et annule sa décompression. Annuler la liste abandonne le ZIP. Après l’échec d’une entrée,
resélectionner le ZIP pour choisir à nouveau. Le diagnostic peut contenir noms et
empreintes d’archive/entrée, jamais leur contenu. Son export reste volontaire.

Deflate utilise `DecompressionStream('deflate-raw')` : Chrome récent requis.
Aucun CDN ni dépendance ZIP externe ajouté. Tests dédiés :
`node tests/zip-rom.test.mjs` et `python3 tests/browser_zip.py`.

**Aucune ROM utilisateur dans Git, les artefacts CI ou les ZIP de livraison.** Les tests
utilisent uniquement notre homebrew MIT convertie dans les trois ordres d’octets et des
fichiers invalides synthétiques. L’archive privée fournie pendant cette tâche n’a pas pu
être transférée (limite outil 32 Mio) : aucun test du jeu qu’elle contient n’est revendiqué.

Rapport courant : **docs/IMPORT-ZIP-0.3.0.html**. Tests de régression :
`node tests/rom-file.test.mjs` (12) ; `python tests/browser_import.py` (9 contrôles
Chromium) ; régression `python tests/browser_real.py` (7 contrôles). Les conversions
sont rehashées dans le FS du cœur réel ; les requêtes HTTP sont observées côté navigateur
et serveur pour vérifier absence d’envoi. Les sélections concurrentes, noms hostiles,
fichiers invalides, export sans contenu ROM et tailles de vues sont testés.

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

**Extraire le ZIP complet, puis double-cliquer `DEMARRER-N64.bat` à sa racine.**
Le fichier `lancer.bat` dans `real-n64` effectue le même lancement.
Ne pas ouvrir le HTML du laboratoire synthétique à la racine.

Le premier lancement prépare automatiquement un **Python portable officiel**
dans `.python/`, puis les 39 fichiers vérifiés du moteur dans `vendor/`.
Le serveur démarre sur `127.0.0.1:8770` et ouvre Chrome après vérification de
son identité. Si Chrome est absent, le navigateur par défaut est utilisé.
Windows 10/11 64 bits et Windows PowerShell 5.1 sont requis. Aucune installation
Python système, commande manuelle, modification du PATH, npm, compte ni droit
administrateur n’est nécessaire au lanceur.

Internet est nécessaire à la première préparation seulement : Python 3.12.10
embedded amd64 (~11 Mo), puis les deux paquets NPM officiels figés. L’archive
Python et chacun de ses fichiers installés sont vérifiés en SHA-256 ; les paquets
moteur sont vérifiés en SHA-256/SHA-512. Les versions et empreintes sont dans
`docs/portable-python-lock.json` et `docs/runtime-lock.json`. Aucun script npm
n’est exécuté, aucune ROM n’est téléchargée. Les composants tiers restent exclus
de Git et du ZIP de sources ; leurs licences sont conservées à l’installation.

1. Attendre l’ouverture de l’interface, puis **Choisir une ROM** ou **Lancer la démo homebrew**.
2. Garder la fenêtre du lanceur ouverte pendant l’utilisation.
3. Cliquer dans le jeu : **X = A**, **S = B**. A déclenche la tonalité.
   « Activer / reprendre l’audio » permet de reprendre un AudioContext suspendu.
4. Exporter le diagnostic, puis arrêter le serveur avec Ctrl+C.

Le batch marque une pause à la fin, y compris en cas d’erreur. Journaux persistants :
`cache/launcher-bootstrap.log` et `cache/launcher.log`. Un port déjà occupé produit
une erreur explicite ; aucun autre service n’est arrêté. Un Python portable altéré
est refusé avant son exécution. Une préparation interrompue peut être relancée.

Le workflow Windows exécute `tests/windows-launcher.ps1 -RequireFresh` dans un chemin
avec espaces, apostrophe et accent. Ses résultats sont publiés dans l’artefact
`n64-lancement-windows-<commit>`, fichier `windows-launcher/results.json`.
Consulter son statut réel dans GitHub Actions ; le double-clic visuel dans Explorer,
le Chrome du PC de Karl et ses ROM restent à valider par Karl.

Sous Linux, avec Python 3.10+ installé : `python3 tools/launcher.py`.
Pour un diagnostic automatisé : `--prepare-only`, `--no-browser`, `--offline`
et `--port` sont disponibles (équivalents PowerShell `-PrepareOnly`, etc.).

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
- Rapport historique du premier démarrage : `docs/RAPPORT.html`. Rapport courant : `docs/IMPORT-ROM-0.2.0.html`. Protocole terrain : `docs/VALIDATION-KARL.md`.

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
