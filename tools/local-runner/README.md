# Banc autonome EMUPERSO pour Windows

Ce programme Node.js pilote **les applications existantes** d'EMUPERSO dans Chrome, sur un serveur strictement local `127.0.0.1`. Il n'appelle aucune IA, ne crée pas un second portail et ne modifie aucun moteur. Fermer Codex n'arrête pas un lancement indépendant avec `START-BACKGROUND.ps1`.

PSP est volontairement exclue : la campagne de Claude reste indépendante. Un seul jeu à la fois par défaut, au plus 6 Gio pour son arbre de processus. Le banc attend avant de lancer un jeu si la RAM libre est inférieure à 8 Gio ou si la charge CPU globale atteint 90 %. Ces plafonds sont configurables. La mesure de RAM est périodique, pas une réservation matérielle stricte ; un pic entre deux sondages reste possible.

## Installation dans une copie isolée du dépôt

Windows 10, Node.js **22.17 minimum** (24 conseillé), Google Chrome et 7-Zip sont requis. Aucun administrateur, compte IA ou service payant. Ne pas changer de branche dans le dépôt où Claude travaille : utiliser une autre copie.

Depuis la racine de cette copie :

```powershell
cd tools/local-runner
npm ci --ignore-scripts --no-audit --no-fund
LAB.bat init
```

Il n'est pas nécessaire de télécharger un navigateur Playwright : le banc utilise Chrome installé. `PLAYWRIGHT_MODULE` permet aussi de réutiliser un module Playwright déjà présent ; le chemin absolu de son `index.mjs` convient.

Le site assemblé doit exister dans `dist/` **avant** la campagne. Réutiliser la construction EMUPERSO :

```powershell
# Depuis la racine du dépôt ; python doit être Python 3.
python ps1-web/tools/fetch_runtime.py
python ps1-web/tools/build-vercel-alpha.py
python real-n64/tools/fetch_runtime.py
python real-n64/tools/fetch_cheats.py
python real-n64/tools/build-vercel-alpha.py
node tools/build-portail.mjs
```

Ces outils récupèrent uniquement les distributions des moteurs et données du projet déjà verrouillées ; aucun BIOS ou jeu commercial. Si les distributions sont déjà préparées, leur récupération n'est pas nécessaire. Le serveur vérifie chaque fichier servi contre `PORTAIL-MANIFEST.json`. Ne pas reconstruire `dist/` pendant une campagne : finir/arrêter celle-ci d'abord. Les empreintes du manifeste et des ROMs sont consignées par essai.

## Configuration locale

Adapter `config.local.json`, créé à partir de `config.example.json`. Il est ignoré par Git. `roots` accepte des dossiers **ou des fichiers** par console, utiles pour une petite validation. Les chemins relatifs sont résolus depuis le fichier de configuration. `%LOCALAPPDATA%` est développé. Chaque campagne possède son propre `stateDir`, hors collections et hors site servi. Garder ce dossier privé, hors dépôt et hors synchronisation publique.

La configuration fournie vise `E:\roms` et `D:\roms`, avec PS1 sous `D:\roms\roms ps1`. PSP n'est jamais parcourue par cette configuration. Les deux emplacements GBA sont conservés : la déduplication se fait par chemin de fichier et entrée d'archive, pas par nom. Deux versions, régions ou hacks distincts restent des entrées distinctes. Aucune fusion automatique par titre. L'inventaire identifie le chemin, la taille et la date de modification ; le SHA-256 complet est calculé lors de chaque test.

Formats configurés d'après les chargeurs existants :

| Application | Fichiers et traitement |
|---|---|
| NES | `.nes`, `.unf`, `.unif` |
| SNES | `.sfc`, `.smc`, `.swc`, `.fig` |
| GB / GBC | `.gb`, `.sgb` / `.gbc` ; validation d'en-tête laissée au lanceur |
| GBA | `.gba` |
| DS | `.nds`, `.dsi`, `.srl` ; DeSmuME 2015 par défaut, aucun BIOS téléchargé |
| N64 | `.z64`, `.n64`, `.v64` |
| Archives Nintendo | `.zip`, `.7z`, `.rar` listées avec 7-Zip ; chaque ROM compatible extraite seule dans un espace temporaire du banc, sans changer l'archive |
| PS1 | `.iso`, `.bin`, `.img`, `.chd`, `.pbp` ; `.zip`, `.rar`, `.7z` transmises intactes au chargeur existant pour préserver les pistes liées |

Un CUE seul est signalé car le lanceur le refuse. Un BIN isolé n'est pas une validation des disques multipistes. Plusieurs éditions contenues dans **une archive PS1** ne sont pas séparées automatiquement ; une archive représente une entrée de test. Les plafonds et signatures du chargeur EMUPERSO restent applicables. Aucune compatibilité n'est déduite de l'extension.

## Commandes quotidiennes

Depuis `tools/local-runner`, dans un terminal Windows indépendant de Codex :

```powershell
LAB.bat inventory
LAB.bat run --limit 5
LAB.bat status
LAB.bat pause
LAB.bat stop
LAB.bat resume
LAB.bat report
# Ouvrir le rapport (chemin par défaut) :
start "" "%LOCALAPPDATA%\EMUPERSO-lab\campaign\rapport.html"
```

La commande `start` ci-dessus est destinée à `cmd.exe`. En PowerShell : `Start-Process "$env:LOCALAPPDATA\EMUPERSO-lab\campaign\rapport.html"`.

Pour une autre configuration, ajouter `--config "C:\chemin\campagne.json"` à **chaque** commande. Sélection courte : `run --system nes --limit 5` ou `run --match "Mario" --limit 3`. `--id` sélectionne un identifiant du JSON. Sans limite, tous les jeux en attente sont parcourus. `--retry-failed` autorise explicitement un nouvel essai des échecs/timeouts, dans la limite `maxAttempts`. Les anciens résultats restent conservés. Les changements de code n'invalident pas automatiquement les résultats : créer un nouveau `stateDir` pour comparer deux versions.

`pause` laisse le jeu en cours finir puis arrête la session. `stop` interrompt les processus appartenant à cette campagne ; le jeu interrompu sera repris par `resume`. `resume` retire les marqueurs de pause/arrêt puis recharge l'inventaire et l'historique. Les tests terminés ne sont pas rejoués. Une interruption répétée au-delà de `maxAttempts` nécessite d'augmenter cette valeur après examen du journal, afin d'éviter une boucle infinie.

L'inventaire peut être relancé après une interruption ; son cache de listes d'archives est écrit après chaque archive. Une nouvelle lecture reconstruit les entrées sans les dupliquer. Un fichier changé depuis l'inventaire est refusé au test ; refaire l'inventaire pour créer sa nouvelle identité. Un processus possède un verrou exclusif par campagne ; ne pas utiliser deux superviseurs sur le même `stateDir`.

## Exécution sans Codex et après redémarrage

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\START-BACKGROUND.ps1
# Avec un autre fichier :
powershell -NoProfile -ExecutionPolicy Bypass -File .\START-BACKGROUND.ps1 -Config "C:\chemin\campagne.json"
```

Ce lanceur utilise `Start-Process -WindowStyle Hidden`, sans dépendance au chat. Les sorties du lanceur vont dans `%LOCALAPPDATA%\EMUPERSO-lab\launcher-logs`. La file, les captures et les résultats sont dans `stateDir`. Après un redémarrage de Windows, relancer cette même commande ou `LAB.bat resume` : aucun test terminé n'est perdu. **Pas de service ni de tâche de démarrage Windows installés** ; le lancement après redémarrage se fait avec cette commande simple.

Le code compare PID, date de création du processus et jeton de session avant de tuer un arbre. Il n'utilise jamais `taskkill /IM chrome.exe` ou `node.exe`. Les Chrome de Claude, du navigateur personnel et des autres campagnes ne sont pas ciblés. Après un crash du superviseur, les propriétaires enregistrés sont examinés au prochain `resume` ; le worker quitte aussi lorsque son canal vers le superviseur disparaît. Le répertoire temporaire est nettoyé uniquement après vérification de son emplacement dans `stateDir/tmp`.

Le lanceur d'arrière-plan assure aussi l'inventaire initial (ou reprend un inventaire partiel) grâce à `--inventory-first`. Une fois l'inventaire complet, il le réutilise. Le banc alterne les consoles en privilégiant les petits fichiers à l'intérieur de chaque console. Ces choix reprennent les principes du testeur PSP local de Claude (`portables/tools/test-psp-collection.mjs`, examiné en lecture seule) : parcours autonome, résultats privés après chaque jeu, relance et petits fichiers en premier. Son fichier et sa campagne ne sont pas modifiés. Ici, le délai est imposé dans un autre processus que le moteur pour pouvoir fermer un renderer bloqué.

Pour une fenêtre de commande visible, lancer `SUIVI-VISIBLE.bat --config "C:\chemin\campagne.json"` après arrêt/pause de l'ancien superviseur. Cette fenêtre exécute la campagne et affiche chaque début/fin de jeu. Elle peut être réduite ; fermer Codex ne l'arrête pas. La fermer interrompt la session, qui sera reprise par `resume`. Le verrou interdit un deuxième superviseur sur la même campagne. Lors du nettoyage, le banc attend jusqu'à dix secondes que le PID Chrome disparaisse réellement de CIM avant de se mettre en pause : Windows peut encore l'énumérer brièvement pendant sa terminaison.

Les deux lanceurs utilisent maintenant `watchdog.mjs`. Celui-ci relance le testeur après un crash (trois tentatives sans progrès, avec délai), et traite une pause technique de nettoyage avant de reprendre la file. Il ne contourne jamais une pause utilisateur, un arrêt demandé ou un plafond de stockage. Il refuse un second superviseur de la même campagne. La fermeture est retentée uniquement sur les processus dont l'identité a été enregistrée, même si Windows cesse temporairement de fournir leur ligne de commande pendant la terminaison. Chaque action et erreur de fermeture est conservée dans `cleanup.json`. Si les tentatives restent sans effet, le programme s'arrête avec une erreur explicite plutôt que d'accumuler des navigateurs.

La console affiche aussi un signal de vie environ toutes les cinq secondes : console testée, phase, durée, charge CPU et RAM libre. Un chargement ou une fermeture longue se distingue ainsi d'un programme arrêté. Le délai global démarre dès la création du worker ; son interruption utilise le handle de l'enfant créé par le superviseur, sans attendre une nouvelle requête CIM. Le nettoyage du navigateur reste une étape séparée, vérifiée avant le prochain jeu.

## Modes, mesures et classifications

`mode: "short"` : démarrage, deux captures et observation de six secondes (plus chargement et attente initiale). `mode: "deep"` : observation prolongée configurable, signaux Start/A/B/direction envoyés au moteur et troisième capture. **Ce second mode ne prouve ni jouabilité, ni sauvegarde.** Il sert à sélectionner des cas à examiner manuellement.

| Statut | Preuve disponible |
|---|---|
| NON TESTÉ | Aucun résultat terminé, ou essai interrompu à reprendre |
| DÉMARRAGE | Moteur démarré, capture non disponible |
| IMAGE DÉTECTÉE | Capture non uniforme et compteur avançant sans exception JS observée |
| SUSPECT | Capture uniforme, compteur arrêté, incohérent ou très élevé |
| ÉCHEC | Erreur de préparation, exception JS/Wasm, crash ou modification de la source ; consulter la phase |
| BLOQUÉ / TIMEOUT | Délai global imposé par le superviseur ou arrêt bloqué |
| GAMEPLAY VALIDÉ | Réservé à une validation indépendante avec preuve ; jamais produit automatiquement |
| SAUVEGARDE VALIDÉE | Réservé à une restauration réellement vérifiée ; jamais produit automatiquement |

L'indicateur `frameRate` est **le débit du compteur EmulatorJS**, avec durée murale mesurée ; il ne garantit pas des FPS vidéo natifs. Les captures 2D viennent du PNG du moteur ; N64/PS1 utilisent le canvas seul, excluant l'interface HTML. L'analyse exclut les 3 % extérieurs et quantifie les couleurs ; elle ne détecte pas tous les écrans figés ni tous les faux positifs. Un logo, un avertissement BIOS ou un menu peuvent produire une image détectée. Les captures et erreurs demandent un examen humain. L'audio n'est pas écouté/validé par ce banc.

Les profils de navigateur et IndexedDB sont neufs pour chaque jeu ; aucune sauvegarde personnelle n'est lue, importée ou envoyée. Les deux hachages complets du fichier original, taille et date de modification sont comparés avant/après un essai terminé. Lors d'un arrêt forcé, cette vérification peut ne pas finir ; cela reste indiqué, sans déclarer la source vérifiée. L'original est seulement ouvert en lecture par le banc/Chrome.

## Rapports privés et preuves

- `inventory.json` : identités stables, entrées d'archives et avertissements.
- `attempts/<id>-<tentative>-<jeton>/` : job, phases, captures PNG, journal, résultat, identités des processus et vérification de nettoyage.
- `results.json`, `results.csv`, `rapport.html` : vue de la dernière tentative par entrée ; historique non supprimé.
- `events.ndjson` : reprises, arrêts, erreurs et lancement/fin des essais.
- `resources.ndjson` : CPU système, RAM libre, PID et RAM résidente des processus surveillés.
- `campaign.json` : temps actif cumulé et nombre de sessions ; le débit est mesuré, sans estimation théorique de fin.

Le HTML, les images et exports sont consultables sans Internet. Les moteurs Nintendo 2D sont chargés depuis leur distribution publique EmulatorJS 4.2.3 ; les **tests** nécessitent donc une connexion tant que ces moteurs ne sont pas vendored. Le rapport ne nécessite aucune connexion. Les autres requêtes externes sont bloquées ; seuls GET/HEAD vers les fichiers de distribution explicitement autorisés sont acceptés. Aucun téléversement de ROM ou de sauvegarde.

Chaque résultat de jeu est sauvegardé immédiatement dans son dossier de tentative. Les vues globales JSON/CSV/HTML sont régénérées tous les 20 jeux (`reportEveryJobs`), à la fin d'une session et sur commande `report`, pour éviter de réécrire des dizaines de mégaoctets après chaque petite ROM. Le HTML détaille tous les résultats existants et les 100 premières entrées en attente ; l'inventaire complet reste dans le JSON et le CSV.

Les plafonds de données temporaires et de preuves provoquent une pause, sans supprimer d'anciens résultats. Les profils Chrome temporaires générés par Playwright sont fermés avec leur navigateur. Ne pas publier le dossier de campagne : captures, titres, chemins et empreintes sont privés. Le dépôt ne doit contenir que code, documentation et synthèse expurgée. Aucun déploiement Vercel ni fusion automatique ; la branche dédiée désactive son auto-déploiement via `git.deploymentEnabled` dans `vercel.json` ([documentation Vercel](https://vercel.com/docs/project-configuration/git-configuration)).

## Validation et limites

`npm test` vérifie classifications, extraction de métadonnées, refus de chemins dangereux, remplacement atomique, historique/exports et identité des processus (y compris refus d'un PID réutilisé). Ces tests unitaires ne remplacent pas les essais Windows réels. La livraison locale fournit séparément les résultats de démarrage, de reprise et de timeout réellement observés. `diagnostics.hangAfterBoot=true` est uniquement une injection de panne réservée à une campagne de validation isolée ; elle bloque volontairement le renderer après démarrage pour vérifier que le superviseur externe le ferme. `hangSystem` restreint cette panne à une console. `diagnostics.forceCleanupPauseOnce=true` simule une pause technique après la fermeture, une seule fois par campagne, pour vérifier la récupération automatique ; les actions indiquent explicitement qu'il s'agit d'une injection.

Concurrence 1 par défaut. Pour augmenter : créer un **autre stateDir**, prendre une petite sélection, relever débit, CPU, RAM et anomalies en série, puis autoriser explicitement `parallelTrialAccepted: true` avec concurrence 2 pour comparer. Aucune augmentation n'est faite automatiquement. Ne pas effectuer ce test pendant une campagne lourde de Claude. Le contrôle CPU/RAM dépend de CIM/PowerShell ; s'il ne fonctionne pas, le banc attend au lieu de lancer des jeux sans contrôle, et écrit `resource-monitor-error` dans le journal.
