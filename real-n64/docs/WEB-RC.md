# Livraison Web candidate — préparation sans publication

Ce document décrit l’assemblage et sa validation. Il ne donne pas un GO de publication. Les sources correspondantes du runtime restent à établir (`REDISTRIBUTION-RC.md`) et Karl doit autoriser le déploiement.

## Deux produits distincts

| Produit | Contenu | Démarrage | État de validation attendu |
| --- | --- | --- | --- |
| Windows | Sources, lanceur, verrous, notices et démo MIT ; runtime/Python préparés directement depuis leurs URL officielles | Extraire tout le ZIP puis double-cliquer `DEMARRER-N64.bat` | Tester le lanceur sur Windows et le parcours moteur dans un navigateur ; le PC de Karl reste une validation séparée. |
| Web statique | Seulement les fichiers de la liste d’autorisation publique, les ressources du moteur autorisées et les notices requises | Ouvrir une URL HTTPS après installation par l’hébergeur | Tester d’abord la sortie du packageur avec un serveur statique local, puis l’origine publique réelle uniquement après autorisation. Une exécution localhost n’est pas un test d’adresse publique. |

Le packager doit copier des chemins explicites. Il ne doit jamais copier récursivement `real-n64`, `cache`, `delivery`, `evidence`, `.python`, `.git`, un profil de navigateur ou le dossier de ROM de l’utilisateur. L’ensemble des fichiers servi doit dériver de la même liste d’autorisation que le serveur de la candidate, avec manifestes séparés Web et Windows.

La seule ROM distribuable dans l’assemblage est `homebrew/fallback-open/demo-emuperso-open.z64`, avec sa licence MIT et son empreinte. Tous les autres fichiers sélectionnés par le joueur passent par `File.arrayBuffer()` et des URL Blob ; aucune API d’upload n’est nécessaire.

## Contrat d’hébergement

- HTTPS est requis pour l’origine publique. `localhost` est un contexte sécurisé de test particulier, pas un substitut à cette validation.
- Conserver les chemins relatifs : l’application doit fonctionner à la racine **et sous un préfixe** comme `/emuperso/`, sans requête à `/vendor` ou `/engine.html` à la racine du domaine.
- Types MIME : `.mjs` et `.js` en JavaScript ; `.wasm` en `application/wasm` ; `.data` en binaire ; CSS/JSON/images correctement servis. Le `.data` du moteur contient des binaires et n’est pas une donnée utilisateur.
- Envoyer `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`, `Cross-Origin-Resource-Policy: same-origin` sur les documents et ressources requis. L’assemblage actuel n’active pas les threads ; ne pas annoncer un mode threads sans compilation et tests distincts.
- Garder la CSP : pas de domaines de ROM ou de télémétrie ; connexions limitées à l’origine et aux URL Blob. Les contraintes `unsafe-eval`/Blob du moteur sont à documenter ; elles ne doivent pas être étendues à des domaines arbitraires pour « faire marcher » le site.
- Refuser les écritures HTTP et les fichiers hors de la liste publique, y compris ceux ajoutés par erreur après l’installation. Désactiver l’index de répertoire et les liens symboliques sortants. Un serveur statique générique ne possède pas automatiquement les protections du serveur Python : la sortie à déployer doit être nettoyée avant toute copie.
- Versionner l’ensemble de la livraison. Éviter un mélange entre anciens scripts et nouveaux binaires : fichiers versionnés ou cache `no-store` pour la candidate. Ne pas installer de service worker qui mettrait les ROM ou les sauvegardes dans un cache de ressources publiques.
- Les sauvegardes IndexedDB sont liées à l’origine. `http://127.0.0.1:8770`, une autre adresse/port et le futur domaine HTTPS possèdent des espaces différents. Le transfert se fait par export/import volontaire, après sélection de la même ROM et vérification d’identité ; le site ne peut pas lire le profil du serveur Windows.

Les en-têtes exacts et le routage dépendent de l’hébergeur. Ne pas choisir automatiquement GitHub Pages : l’ajout arbitraire de ces en-têtes n’y est pas une capacité démontrée pour notre installation. Un reverse proxy statique contrôlé, par exemple Nginx/Caddy avec configuration explicite, constitue une cible possible à valider après GO.

## Validation du package Web avant un GO public

1. Générer le répertoire à partir de l’allowlist, vérifier ses SHA-256 et refuser les fichiers sensibles. Placer délibérément une ROM, un ZIP, une sauvegarde et un diagnostic fictifs à côté des ressources : aucun ne doit être copié ni accessible.
2. Servir **la sortie générée**, pas le répertoire source, sous `/` puis `/emuperso/`. Vérifier les requêtes et les types MIME, l’iframe, les licences et le décor original. L’assemblage qui tourne doit utiliser le vrai WASM figé.
3. Rejouer les tests ROM brute/ZIP, clavier/PCM, sessions, sauvegardes et cheats avec la démo MIT, y compris après fermeture de navigateur. Prouver le contenu restauré et le maintien des sauvegardes lors d’un échec.
4. Mesurer les requêtes : aucun POST/PUT, corps HTTP de ROM/sauvegarde, URL contenant le nom de fichier local ou destination externe. Les téléchargements initiaux de ressources installées par un mainteneur restent distincts de l’usage des ROM par le joueur.
5. Répéter depuis une nouvelle origine de test et vérifier que le coffre est indépendant ; une exportation d’état compatible permet une migration volontaire, sans découvrir ni modifier l’autre origine.
6. Faire examiner la sortie exacte et sa liste de licences par GPT/Méo, lever F6, recevoir le GO de Karl, puis déployer et répéter les tests sur **l’URL réellement publique**. Tant que ce GO n’existe pas, ce dernier test reste **NON TESTABLE — publication non autorisée**.

## Arrêts obligatoires

Refuser une publication si la correspondance des sources du moteur ou des extracteurs reste ouverte, si l’illustration distribuée contient des personnages protégés non autorisés, si un fichier privé entre dans l’assemblage, si une restauration réelle échoue, ou si la configuration de l’hébergeur ne respecte pas le contrat. Le retrait d’un fichier du ZIP ne justifie pas de déclarer les autres contrôles réussis.
