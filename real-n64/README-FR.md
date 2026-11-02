# EMUPERSO N64 — 0.5.0 RC2

Candidate pour l’audit GPT, le contre-audit Méo et les essais de Karl.
**Cette version n’est pas autorisée à la publication.** Aucun déploiement ni release publique n’est effectué par sa préparation.

## Deux éditions à examiner

- **Windows** : extraire tout le ZIP, puis double-cliquer `DEMARRER-N64.bat`.
  Windows 10/11 64 bits et Chrome sont recommandés. Garder la fenêtre du lanceur ouverte.
  La première préparation utilise Internet pour télécharger et vérifier un Python portable officiel,
  EmulatorJS et le catalogue. Aucun compte, commande CMD, installation Python système ou droit administrateur n’est demandé.
  Après préparation, ces ressources sont locales. Le serveur écoute seulement sur `127.0.0.1:8770`.
- **Web — revue privée** : dossier statique avec les ressources préparées, à examiner avant tout hébergement.
  Une adresse HTTPS et les en-têtes du fichier `_headers` sont prévus. Il n’existe aucune nouvelle URL publique validée.
  Le bundle contenant le moteur reste local : les blocages de redistribution sont détaillés dans
  `docs/REDISTRIBUTION-RC.md`. Les tests HTTPS locaux ne sont pas des tests d’un site déployé.

Le premier lancement affiche une préparation ; les erreurs restent dans la fenêtre.
Journaux : `real-n64/cache/launcher-bootstrap.log` et `launcher.log`.
Dans un ZIP Windows plat, `lancer.bat` effectue également le lancement.

## Choisir et changer de jeu

1. Cliquer **Choisir une ROM**, puis sélectionner `.z64`, `.n64`, `.v64` ou `.zip`.
2. Pour un ZIP contenant plusieurs ROM, choisir l’entrée puis **Préparer cette ROM**.
3. Cliquer **Lancer la ROM choisie** ou **Changer pour cette ROM**.

L’ancien jeu reste disponible pendant la lecture. Avant un changement normal, sa sauvegarde native est conservée.
Le candidat est lancé dans une session distincte ; l’ancienne session est fermée après validation ou reprise en cas d’échec détecté.
La démo homebrew MIT fournie reste un test de référence. Aucun jeu commercial n’est fourni ni déclaré universellement compatible.

La ROM est lue et, si nécessaire, décompressée dans le navigateur. Aucun téléversement, aucun chemin serveur construit à partir du nom local.
ROM : 4 Kio à 64 Mio, signature N64 vérifiée et normalisation Z64. ZIP32 non chiffré : 96 Mio maximum, Stockage ou Deflate ; contrôles de chemins,
CRC et bornes avant lancement. Les garde-fous ne démontrent pas la compatibilité du contenu.

## Sauvegarder puis reprendre

Une **sauvegarde native** contient les données produites par le jeu ; sa reprise passe par le menu du jeu après redémarrage.
Un **save state** contient un état du moteur et la copie native prise au même point.

- Choisir **État 1, 2 ou 3**, puis **Enregistrer l’état**.
- **Charger l’état** vérifie ROM, moteur, configuration, format et SHA-256, puis cherche une restauration réelle de mémoire dans le cœur.
  Un compteur frontend qui avance n’est pas considéré comme une preuve.
- **Récupérer la version précédente** charge la copie antérieure sans remplacer l’état courant conservé.
- **Exporter une copie** et **Importer une copie d’état** utilisent des JSON locaux. L’import vérifie les empreintes et conserve la version précédente ; il ne lance rien.
- **Enregistrer la sauvegarde native maintenant** conserve le natif. L’enregistrement périodique et celui avant changement de jeu restent actifs.
- **Recharger la sauvegarde native** redémarre depuis le natif stocké, sans l’écraser avec la partie en mémoire.
  **Recharger la native précédente** utilise la copie antérieure. La relecture par le cœur est comparée à la copie demandée.

Une copie d’état peut contenir du code ou des images du jeu présents en mémoire, ainsi que votre progression. Traitez les états et natifs exportés comme des fichiers privés ; ne les ajoutez pas aux livraisons publiques. Le diagnostic reste un document distinct, sans ces octets de mémoire.

Les trois emplacements et les types de sauvegarde sont séparés par identité ROM, moteur, configuration et schéma.
Le coffre conserve les données v0.4 compatibles ; aucun effacement ni montée de version de la base n’est nécessaire.
Une origine Web, un port ou un profil Chrome différent possède son propre stockage : utiliser des exports pour transférer des copies.
Aucune sauvegarde personnelle originale n’est utilisée dans les tests livrés.

## Chargement bloqué ou refusé

La mise en pause audio et les opérations IndexedDB ont maintenant des délais bornés.
Les étapes sont affichées ; une erreur laisse les commandes utilisables et explique l’échec.
Un chargement échoué conserve la session précédente et ne doit effectuer aucune écriture dans le coffre.
Le message de réussite distingue une restauration observée d’une mémoire déjà équivalente.

Certains états très proches du démarrage peuvent être refusés faute de différences mémoire stables ; ce refus ne signifie pas que le fichier est corrompu.
Le contrôle de mémoire est adapté au format Mupen 1.9 observé : il ne certifie pas tous les états CPU/RSP/RDP, tous les jeux ni le problème Sonic.
Le symptôme Windows signalé par Karl a guidé les tests, mais les pannes audio et I/O provoquées ne sont pas présentées comme une reproduction de son PC.
En cas d’échec, **Exporter le diagnostic** reste accessible. Il contient des identités et événements, pas la ROM ni les octets des sauvegardes.
Les noms de jeux et de codes peuvent y apparaître ; choisir volontairement de le partager.

Un arrêt brutal, un quota refusé ou l’effacement des données du navigateur peut perdre les dernières modifications non enregistrées.
Conserver des exports des états importants. Une empreinte incohérente est refusée ; la copie précédente reste disponible si elle est valide.

## Cheats et remise à zéro

Le catalogue officiel figé comporte 558 versions et 9 238 codes répertoriés, dont certains sont explicitement non pris en charge.
L’en-tête CRC/région identifie les candidats ; les variantes ambiguës demandent un choix. Aucun code n’est activé automatiquement.
Une correspondance de catalogue ne garantit pas les effets du code sur une ROM particulière.

Avant le premier cheat, un checkpoint RAM+natif est créé dans une transaction distincte des emplacements utilisateur.
**Désactiver tous les cheats** arrête leurs écritures sans prétendre annuler leurs effets déjà inscrits.
**Réinitialiser sans cheats** relance avec une mémoire neuve et conserve le natif.
**Revenir avant les cheats** restaure le checkpoint après confirmation et abandonne la progression depuis ce point.

## Sécurité et licences

Le serveur utilise une liste exacte de ressources publiques. Les ROM privées, ZIP, sauvegardes, diagnostics, tests et outils placés à côté de l’application sont refusés par HTTP.
La seule ROM servie est la démo MIT dont l’empreinte est fixée. Ressources moteur, catalogue et bannière sont également vérifiés.
La bannière est une création abstraite originale, sans personnages Dragon Ball.

Le code d’intégration original est sous MIT. Les autres composants gardent leurs licences propres.
Voir `docs/THIRD-PARTY.md`, `docs/licenses/` et `docs/REDISTRIBUTION-RC.md`.
La provenance exacte des sources correspondant au binaire Mupen/RetroArch et certaines recettes d’extracteurs reste un obstacle à sa redistribution publique.
Une empreinte prouve les octets reçus, pas la complétude des obligations de licence.

Rapport autonome : `docs/RC-0.5.0-RC2.html`. Protocole restauration : `docs/RESTORE-INDEPENDENT-RC.md`.
Tests et preuves : `tests/` et `evidence/`. Manifestes SHA-256 dans chaque livraison.
Le résultat CI décrit son OS et son navigateur ; il ne remplace pas la validation finale du PC de Karl.

## Garde-fous des cheats — RC2

La variante du catalogue reste verrouillée pendant qu’un code est actif. Désactivez
tous les codes avant de choisir une autre variante. Un code actif restauré reste
affiché même si son édition n’est pas identifiée dans le catalogue.

Une erreur du moteur pendant l’application ou la suppression de codes arrête la
session concernée. Sa mémoire incertaine ne peut plus être enregistrée. Le bouton
**Relancer ce jeu sans cheats** crée un moteur neuf depuis la dernière sauvegarde
native conservée ; il ne capture pas la session interrompue. Les sauvegardes restent accessibles après relance, ainsi que le point d’avant
cheats s’il existe dans le coffre. Une sauvegarde native peut
contenir des effets de cheats antérieurs : cette relance ne prétend pas les annuler.

Les commandes natives ne fournissent pas de lecture certifiée de la liste de codes.
La RC2 n’annonce donc aucun rollback natif vérifié après une erreur partielle.
La RC1 et ses archives restent conservées pour comparaison.

## Correctif des états — 2 novembre 2026

La capture attend maintenant une nouvelle trame du moteur au lieu de sérialiser depuis un minuteur du navigateur. Cela corrige les états incohérents observés avec Super Mario 64 PAL. Les commandes de sauvegarde et les contrôles de restauration attendent la capture complète ; un délai dépassé annule l’opération sans remplacer une sauvegarde.

Les sauvegardes natives restent isolées dans un montage MEMFS propre à chaque session. Le moteur peut ainsi démonter ce stockage normalement à la fermeture ; le rechargement de la page ne provoque plus l’erreur de fichier observée dans le code précédent. Le coffre IndexedDB du lanceur reste le stockage durable.

Le binaire du cœur, son empreinte et le format des états sont inchangés. Les anciennes copies sont conservées. Un état déjà incohérent n’est pas reconstruit par ce correctif ; sa restauration peut toujours être refusée et la session précédente est conservée.

Détails et reproduction : [Correctifs des états](docs/CORRECTIFS-ETATS-2026-11-02.md).
