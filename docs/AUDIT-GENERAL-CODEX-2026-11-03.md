# EMUPERSO — audit technique du 3–4 novembre 2026

## Verdict et périmètre réellement couvert

**Audit partiel : aucune compatibilité complète des 11 consoles n'est annoncée.** Les correctifs ci-dessous sont reproductibles et testés. Une seule ROM commerciale a été exécutée et observée durant cette campagne : Super Mario Bros. (Europe), sur NES. Les autres fichiers personnels ont subi des contrôles de format, pas une validation de jeu.

Périmètre : NES, SNES, GB, GBC, GBA, DS, N64, PS1, PSP, Genesis et Arcade. DOOM/PrBoom est effectivement présent dans cette branche et a été inclus. Aucune autre intégration PC n'a été ajoutée ; GameCube n'est pas intégrée.

Base des premiers essais : `480a99ec8a3e556b832e91810f6eb678f0c96d46`, branche `feature/unified-controller-profiles`. Les derniers changements distants ont ensuite été repris sans conflit jusqu'à `27fac4c`. Correctif : `a396bb4`, sur `codex/audit-general-2026-11-03`. Les suites racine, lanceur, N64 JavaScript et la construction ont été rejouées après cette reprise. Le test NES en navigateur précède cette reprise et ne constitue pas un test du commit final.

## Protections appliquées

- Clone indépendant : aucun changement dans les checkouts des autres chats ou de Claude.
- Aucune modification de `main`, aucune fusion dans la branche cible et aucune réassignation du déploiement public.
- ROMs lues uniquement. Extraction Genesis dans un dossier de travail séparé ; aucune extraction par-dessus les originaux.
- Tests de sauvegarde sur une origine locale neuve, distincte du site habituel. Aucune sauvegarde personnelle existante importée ou remplacée.
- Aucun fichier ROM, BIOS ou sauvegarde personnelle ajouté au commit. Les preuves visuelles et résultats locaux restent hors du dépôt publié.
- Configuration CSP, isolation des moteurs et Controller V2 conservées.

## Bogues reproduits et correctifs

| ID | Gravité | Reproduction et impact | Correctif et contre-test |
|---|---|---|---|
| A01 | P1 | L'assembleur copiait un faux `.nes`, `.sfc` ou `.wad` posé dans les sources vers la sortie publique. Les distributions PS1/N64 recopiées contournaient également le filtre de ROMs. Risque de publication accidentelle si un jeu personnel était présent ; aucune fuite réelle n'est affirmée. | Extensions manquantes exclues, filtre appliqué aux deux distributions, reconnaissance des `.md` binaires conservée. Exceptions limitées aux démos intentionnelles. Test avec fichiers factices : échec avant, réussite après ; démos libres, documentation et moteurs conservés. `.gitignore` renforcé en complément. |
| A02 | P2 | Quatre octets `IWAD` ou un répertoire hors du fichier étaient acceptés comme jeu DOOM. Le moteur pouvait recevoir un fichier tronqué ou incohérent. | Vérification de l'en-tête, du nombre d'entrées, des limites du répertoire et de chaque zone de données. Deux tests échouaient avant ; quatre tests DOOM passent après. Le vrai `DOOM2.WAD` local reste accepté par le validateur. Cela ne valide pas son exécution dans PrBoom. |
| A03 | P2 | Choix EN puis FR : une réponse EN tardive pouvait rétablir EN. Une ancienne erreur pouvait aussi annuler un choix EN déjà réussi. | Génération de requête : seules réponse et erreur du dernier choix peuvent modifier la page. Deux tests avec réponses volontairement désordonnées échouaient avant et passent après. |
| A04 | P2 | Requête HTTP avec URL `%E0%A4%A` : arrêt du serveur local du portail avant réponse. | Réponse 400 sans arrêt, refus des méthodes autres que GET/HEAD, types MIME explicites pour manifeste PWA et APK. Test HTTP en processus isolé : échec avant, réussite après, puis requête normale réussie. Le code du serveur Vercel n'est pas concerné. |
| T01 | P3, test | Le test du serveur Windows cherchait un ancien titre de page et s'arrêtait avant ses contrôles HTTP. | Assertion adaptée au titre actuel et au champ ROM. Le test complet passe, y compris port occupé, GET/HEAD, MIME, erreurs et traversées. |
| T02 | P3, test | Le test des ressources CSS PS1 interprétait `/bg/bg-ps1.jpg` comme chemin local au système/app, alors que cette ressource appartient au portail assemblé. | Le test vérifie la véritable source du fond dans `portail/bg/`. Les dix tests Python PS1 passent. Le serveur PS1 autonome ne bénéficie pas automatiquement des fonds du portail : son apparence autonome n'est pas certifiée ici. |

## Résultats automatisés

| Vérification | Résultat final | Portée |
|---|---:|---|
| `node --test tests/*.test.mjs` à la racine | 93 réussis | Laboratoire simulé, tests PWA, assemblage privé, i18n et serveur local. |
| `node portables/tests/run.mjs` depuis `portables/` via `node tests/run.mjs` | 162 réussis | Logique de formats, identités, budgets, stockage, sessions, cheats, profils et DOOM ; aucun matériel réel. |
| `node portables/tools/check-syntax.mjs` depuis `portables/` via `node tools/check-syntax.mjs` | Réussi | Syntaxe des modules et scripts du lecteur. |
| `node tests/windows-server.mjs` depuis `portables/` | Réussi | Vrai serveur PowerShell Windows, sans profil navigateur habituel. |
| `node --test tests/*.test.mjs` depuis `real-n64/` | 91 réussis | Logique N64 et intégrité des dépendances locales verrouillées. |
| `python ps1-web/tools/run_tests.py --output <dossier-de-preuves>` | 190 tests JS et 10 Python réussis | Logiciel et livraison PS1 ; aucun jeu PS1 exécuté. |
| Python N64, découverte `test_*.py` | 33 tests : 23 réussis, 1 échec, 4 erreurs, 5 ignorés | Suite globale non verte, détails ci-dessous. |
| Rejeu ciblé `test_server_allowlist.py` | 13 tests, aucun échec, 3 ignorés | L'erreur réseau Windows observée au premier passage n'a pas été reproduite lors de ce rejeu. |
| Construction PS1/N64 puis portail | Réussie | Runtime PS1 validé à la construction, manifeste N64 vérifié ; assemblage final de 10 833 fichiers avant ajout de ce rapport documentaire. |

Total des quatre suites JavaScript : **536 tests réussis**. Ce nombre ne représente ni 536 jeux ni une campagne de compatibilité.

Les tests de sécurité de l'assembleur utilisent exclusivement de petites fixtures synthétiques. Les changements de traduction sont vérifiés dans un DOM simulé, pas comme validation visuelle Android.

### Suite Python N64 : limites précises

- `test_originals_preserved` échoue dans le checkout Windows sur l'empreinte du `CHANGELOG.md`. Comparaison indépendante : les blobs Git des fichiers de référence correspondent aux empreintes protégées. La conversion des fins de ligne du checkout est en cause ; aucune empreinte attendue n'a été assouplie. Aucun fichier protégé du laboratoire n'est modifié par cette PR.
- `test_rom_header_and_hash` demande des démos compilées supplémentaires absentes du checkout, dont `homebrew/demo-emuperso.z64`. La démo de repli verrouillée, utilisée par la distribution, est présente.
- Deux tests de liens symboliques échouent faute de privilège Windows (`WinError 1314`) ; d'autres tests les ignorent explicitement pour la même raison.
- `test_no_upload_or_mutation_methods` a rencontré `WinError 10053` au premier passage ; sa suite ciblée passe au rejeu. Cela ne permet pas d'affirmer que l'intermittence est résolue sur tous les postes.

## Inventaire des jeux réellement examinés

Les contrôles de format utilisent les modules du projet avec les vrais fichiers locaux. Pour les ZIP, une entrée est extraite en mémoire et validée ; pour Genesis, une version est extraite avec 7-Zip dans le dossier de travail. Les fichiers GB/GBC sont des copies déjà extraites lors d'une campagne précédente. Taille et date de modification des douze fichiers sources sont inchangées après lecture. Ces observations ne prouvent pas la compatibilité complète des jeux.

| Système | Fichier/jeu lu | Format | Exécution observée pendant cet audit |
|---|---|---|---|
| NES | Super Mario Bros. (Europe) | ZIP → NES | Oui : image du jeu capturée. État de 13 Kio enregistré puis message « État 1 chargé ». |
| SNES | Super Mario All-Stars + Super Mario World (U) | SMC | Non. |
| GB | Tetris (Japan) | GB | Non. |
| GBC | Zelda: Link's Awakening DX (France, Rev 1) | GBC | Non. |
| GBA | Mario Kart: Super Circuit (Europe) | GBA | Non. |
| DS | Tetris DS (Europe, multilingue) | ZIP → NDS | Non. |
| N64 | Super Mario 64 (Europe, multilingue) | ZIP → Z64 | Non. |
| PS1 | Crash Bandicoot 2: Cortex Strikes Back (PAL) | CHD | Non ; reconnaissance de signature seulement. |
| PSP | 20Q (Europe) | CSO | Non ; lecture des structures PSP. |
| Genesis | Sonic the Hedgehog (USA/Europe) | 7z → MD | Non. |
| Arcade | 39in1 | ZIP | Non ; reconnaissance du conteneur, pas du romset par MAME/FBNeo. |
| PC rétro | DOOM II | WAD | Non ; structure IWAD vérifiée avec le correctif. |

### Test NES : portée exacte

Le sélecteur natif a fourni la ROM locale au vrai lanceur et au cœur FCEUmm chargé depuis le CDN. L'image de Super Mario Bros. a été observée et capturée. Les commandes d'enregistrement et de chargement d'état ont répondu avec succès. Le contenu exact restauré n'a pas fait l'objet d'une comparaison avant/après déterministe ; la persistance après redémarrage de Chrome n'a pas été testée. Ce jeu n'utilise pas de sauvegarde classique de cartouche dans cet essai.

Les cheats correspondant au nom du jeu ont été importés sous forme de suggestions désactivées. L'association a été engagée, puis l'outil navigateur a cessé de répondre. **Aucun effet réel de cheat n'est validé**, ni sa désactivation en jeu. L'envoi de Start au clavier n'a pas été suivi d'une preuve suffisante pour certifier les commandes.

## Portail public, PWA et APK

Adresse conservée : https://emuperso-git-feature-unified-controller-55789a-toohigh450-1311.vercel.app/

- Accueil, douze entrées de consoles, manifeste et `assetlinks.json` : HTTP 200, sans redirection vers une connexion lors de requêtes sans session authentifiée.
- Accueil : CSP présente, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`. Les en-têtes du projet et les CSP intégrées PS1/N64 ont été examinés ; la configuration Vercel reste inchangée.
- APK public téléchargé pour vérification en mémoire : 2 582 294 octets, SHA-256 `e0b42c20567eb15c133ae2bc36b8491f48c45ded906fd6bc6772b95ea0fce8c5`, identique au fichier local et à l'empreinte affichée.
- `apksigner verify` : signatures v2 et v3 valides. Certificat correspondant à l'empreinte de `assetlinks.json` du dépôt.
- Paquet `com.emuperso.twa`, version `1.0-test`, minSdk 24 et targetSdk 36. L'URL de lancement extraite de l'APK est bien le lien des testeurs ci-dessus.
- Aucun appareil Android connecté ou installation réelle n'a été validé. La signature et les métadonnées ne prouvent pas le fonctionnement de la TWA sur téléphone.
- Service worker : politique de cache bornée au portail et à ses ressources déclarées ; les tests vérifient l'absence d'interception des ROMs, BIOS, sauvegardes et moteurs. Installation PWA et mode hors ligne dans un véritable navigateur non rejoués durant cette campagne.

## Sécurité et dépendances externes

Le filtre de construction est renforcé et les tests négatifs protègent les exceptions de démos. Les dépendances PS1/N64 ont été reprises de caches locaux et vérifiées par les outils verrouillés du projet. Le lanceur dépend toujours du CDN EmulatorJS ; le loader 4.2.3 possède une empreinte, mais ses sous-ressources ne sont pas toutes couvertes par celle-ci. Le moteur PSP nightly reste mutable et sans SRI, comme avant cette PR : risque de reproductibilité restant, non corrigé en remplaçant un moteur sans test de jeu.

Une recherche ciblée de formes de jetons GitHub, clés AWS et clés privées n'a trouvé aucune correspondance dans les sources suivies examinées hors tests. Ce contrôle heuristique ne constitue pas une garantie exhaustive d'absence de secrets, ni un audit de tout l'historique Git.

## Tests non exécutés et suite nécessaire

L'outil de navigateur intégré a subi des délais d'attente après le dialogue de cheats NES ; réinitialisation et nouveaux onglets n'ont pas rétabli les actions. La tentative d'accès à Chrome natif a expiré lors de l'autorisation d'application. Aucun test dépendant de cet accès n'est compté comme réussi. Un banc de chargement local a été préparé hors dépôt mais n'a produit aucune preuve de jeu supplémentaire.

Restent à exécuter : démarrage et session de jeu de chaque console, sauvegarde classique, comparaison déterministe de restauration, fermeture/réouverture de Chrome, isolation A → B → A avec vrais jeux, effets et désactivation des cheats, manette physique V2, débranchement/rebranchement, tactile, plein écran, audio écouté, cadence en jeu, mémoire mesurée, stabilité prolongée, Windows/Chrome natif, Android réel, installation PWA et APK. Un test de conteneur ou un compteur de frames n'en tient pas lieu.

Les annonces historiques de milliers de jeux testés sur le portail ne sont pas reprises comme preuves de cet audit. L'audit ne peut pas être déclaré terminé avant ces vérifications. La PR proposée permet de réviser les correctifs vérifiés séparément de ces validations encore manquantes ; aucune fusion n'est autorisée par le présent rapport.
