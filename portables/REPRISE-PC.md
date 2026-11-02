# Reprise locale sur le PC de Karl

**Reprise effectuée le 1er novembre 2026, heure de Toronto :** correctifs et essais alpha.2 dans `REPONSE-NOUVEL-AUDIT-ALPHA.2.md`. Les sections suivantes conservent le point de transmission original ; les mentions « reste à implémenter » décrivent cet état antérieur.

Point préparé le **1er novembre 2026, heure de Toronto**, à la demande de Karl de poursuivre depuis son ordinateur pour accéder à ses ROMs.

## Dépôt et état courant

- Dépôt : https://github.com/toohigh450/emuperso
- Branche : `emulateur-portable` ; PR #1 en brouillon.
- Dernier correctif applicatif avant cette transmission : `5e955395e1cecbde14365061e03f1bf6f2c93e99`, version `0.2.1-alpha.1`.
- 74 tests de logique réussis ; CI Ubuntu/Windows × Node 22/24 verte à ce commit. Les tests Windows de CI n'exécutent pas le lanceur ni la manette.
- Parcours Chromium avec moteur simulé et préparation du vrai frontend EmulatorJS 4.2.3 réussis. Aucun cœur ni jeu réel exécuté pendant ces validations.
- La présente transmission ajoute le nouvel audit et les consignes de reprise ; les nouveaux correctifs de cet audit restent à implémenter.

Le poste cloud de la conversation précédente ne voit pas les disques de Karl. Ouvrir **ce dépôt dans une session locale de Codex**, puis indiquer explicitement le dossier des ROMs à cette session. Un chemin Windows écrit dans la conversation cloud ne rend pas le disque accessible au cloud.

## Premier démarrage local

1. Récupérer la branche `emulateur-portable`, ouvrir son dossier dans Codex sur le PC et vérifier la branche et les éventuelles modifications locales avant de travailler.
2. Lire ce fichier, `ETAT.md`, `REPONSE-AUX-AUDITS-0.2.1.md`, puis le nouvel audit archivé : `audits/recus/AUDIT-GPT-EMULATEUR-PORTABLE-0.2.1-ALPHA-2026-11-01.html`.
3. Demander à Karl le chemin du dossier de ROMs s'il n'est pas déjà fourni dans la session locale. Limiter les lectures à ce dossier choisi. Exporter les sauvegardes existantes avant les essais, garder l'ancien dossier et noter l'adresse/port utilisés.
4. Depuis `portables/`, exécuter `npm ci --ignore-scripts`, `npm run check`, `npm test` avec Node >= 22.17. Le double-clic sur `DEMARRER-PORTABLES.bat` sert ensuite à essayer le vrai navigateur Windows.

## Nouvel audit : travaux à poursuivre

### B04 — priorité : rendus asynchrones

`refreshSavePanel` efface la zone puis attend `mirrorInfo` sans vérifier l'identité après cette attente. `refreshHistory` et certains tronçons Codes ont aussi des mutations différées. Ajouter des tickets de génération par panneau et une vérification du jeu avant chaque publication de résultat. Préparer le résultat hors DOM, publier seulement si le ticket est toujours courant. Ajouter un test DOM avec A lent, B rapide, puis résolution tardive de A ; vérifier que sauvegardes, historique et codes affichent toujours B. Nettoyer également les panneaux lors d'un échec moteur ou d'une fermeture.

### B03 — confirmation des cheats : fixer la sémantique

Le drapeau `reviewRequired` reste vrai après une confirmation manuelle. Le lien dont l'empreinte de contenu est à jour fonctionne, mais le fichier reste exclu du chargement automatique par `rom_sha256`. Définir si l'accord porte seulement sur cette ROM ou globalement sur le contenu du fichier. Pour préserver le principe des associations par ROM, une confirmation locale explicite et un libellé clair sont une option cohérente ; ne pas réactiver silencieusement des associations différentes. Tester la sémantique retenue et son affichage.

### B06 — historique : distinguer ouverture, prêt et jeu démarré

`recordGame` incrémente actuellement `plays` avant la création de l'iframe. Séparer les compteurs/statuts « ROM ouverte », « moteur prêt », « jeu démarré ». Incrémenter les vraies parties sur `onStart`, une seule fois par ouverture. Ignorer les événements tardifs d'une ancienne session. Conserver les compteurs historiques comme tels, sans les réinterpréter comme des parties réellement validées. Maintenir l'avertissement : une fois A fermé, une panne de B ne restaure pas les progrès non enregistrés de A.

### B09 — plafonds des imports de cheats

Prévoir des limites explicites par fichier, par lot et au total, avec retour sur les fichiers importés/refusés et les erreurs de quota. Préserver tous les imports existants en cas d'échec. Éviter une relecture complète de toute la base pour chaque fichier, et rendre la progression lisible sur les gros dossiers. Les fichiers sont locaux et doivent rester traités comme des données.

### B05 / B08 — précisions utiles

- La limite théorique de 512 Mio dépend du budget : `memoryPlan(512 Mio)` refuse si la mémoire est inconnue ou déclarée à 2/4 Gio, accepte dans le cas 8 Gio sans ancien jeu actif. Afficher clairement plafond, estimation et budget ; aucun budget ne garantit la RAM libre.
- Les contrôles BIOS sont structurels, pas une preuve d'authenticité. Préciser les extras autorisés ou imposer une liste stricte. Ne pas importer de BIOS au dépôt.

## ROMs : ce que révèle le torrent fourni

Les métadonnées donnent **2 100 fichiers** : **2 096 archives .7z**, 2 ZIP, 1 EXE et 1 TXT, pour 840 358 142 octets au total. Elles ne donnent pas la liste interne des ROMs. Les chiffres 2 094 jeux / 5 837 ROMs du nom du torrent restent non vérifiés.

La 0.2.1 ouvre les ROMs GB/GBC/GBA/DS et les ZIP pris en charge ; elle ne lit pas directement les 7z. Sur le PC, utiliser 7-Zip pour extraire un fichier `.gb` ou `.gbc` dans un dossier séparé, puis ouvrir ce fichier. L'installateur EXE n'est pas nécessaire à Portables. Un `.torrent` n'est pas une ROM. Les métadonnées n'ont provoqué aucun téléchargement ni connexion aux trackers. Le torrent, ses adresses et la liste complète des titres restent hors dépôt ; l'inventaire agrégé est dans `audits/INVENTAIRE-PACK-GB-GBC.json`.

Prévoir des messages clairs pour `.7z` et `.torrent`. Une intégration 7z directe serait un nouveau travail (bibliothèque, intégrité, limites, licences et choix de ROM) : ne pas annoncer cette prise en charge avant implémentation et essais.

## Essais réels rendus possibles sur le PC

Suivre `TESTS-KARL.md` : commencer par un GB et un GBC choisis par Karl, puis GBA et DS si ses fichiers sont disponibles. Vérifier image/son/commandes, fermeture, A → B → A, sauvegarde native, redémarrage navigateur, miroir, export et restauration. Tester un cheat réel sur sa région/révision exacte, puis vérifier l'absence de contamination entre jeux. Tester ensuite le lanceur, les ports occupés et la manette physique. Documenter les résultats exacts et les échecs ; ne pas confondre démarrage du frontend et émulation fonctionnelle.

## Accès Vercel et limites de livraison

Le connecteur cloud a encore refusé la lecture de l'aperçu protégé : son action créerait/réutiliserait un lien de partage de 23 h, et la revue automatique a jugé l'autorisation générale insuffisante pour cette divulgation spécifique. Aucun lien n'a été créé par les actions refusées et la protection reste intacte. Le contrôle via ce connecteur reste bloqué. Un essai manuel par Karl dans sa session déjà autorisée peut être consigné sans modifier les protections.

Ne pas ajouter de ROM, BIOS, sauvegarde originale ou catalogue complet de codes au dépôt. Garder la PR en brouillon. Ne pas fusionner, promouvoir en production ou modifier N64/PS1. Le dépôt génère des aperçus Vercel automatiquement aux mises à jour de branche. Les sous-ressources du moteur et les licences complètes restent des sujets ouverts.

## Message à coller à Codex sur le PC

> Continue le travail sur la branche emulateur-portable. Lis portables/REPRISE-PC.md et le nouvel audit 0.2.1 alpha. Mes ROMs sont dans : [indiquer le chemin local]. Corrige les points confirmés, teste localement avec mes jeux en conservant les sauvegardes et mets à jour la PR #1 en brouillon. Ne mets aucune ROM, BIOS ou sauvegarde originale sur GitHub ; ne fusionne pas.
