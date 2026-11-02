# EMUPERSO N64 0.5.0 RC2 — transmission à GPT et Méo

Date : 1er novembre 2026. Décideur : Karl. Branche : `emulateur-reel`.

La RC1 livrée au commit `65783821250b286f3a3799ea8fcb930908ede342`, ses trois ZIP,
les deux audits reçus et 58 preuves de référence sont conservés avec SHA-256.
Leur réussite ne vaut pas validation de cette RC2.

## Correctifs soumis à vérification

- **C01** : variante verrouillée tant qu’un code est actif, avec garde dans le
  gestionnaire d’événement. Les codes actifs d’un état restauré restent visibles
  même si leur édition n’est pas identifiée dans le catalogue.
- **C02** : demande entièrement validée avant tout reset. Une exception native
  rend le contexte définitivement inutilisable ; captures/reprise sont refusées,
  le contrôleur retire la session avant toute attente et conserve le coffre.
  **Relancer ce jeu sans cheats** est une action explicite créant un moteur neuf
  depuis le natif déjà conservé. Aucun rollback natif n’est prétendu vérifié.
- **C03** : identifiants HTML textuels normalisés vers les entiers du catalogue ;
  choix de variantes après désactivation réellement testé.
- **C04** : un fichier d’état choisi pendant une écriture native reste en attente
  bornée (30 s), puis est importé ; un changement de session le refuse explicitement.
  Le groupe 7 du Hub maintient un vrai digest de sauvegarde en attente pendant le
  choix du fichier. Son résultat n’identifie pas la cause du blocage de Karl.

## État de la validation

**RÉUSSI — CI RC2 et artefacts frais vérifiés** : https://github.com/toohigh450/emuperso/actions/runs/41335193583.
Code testé : `4f10811f05a75aa44910bfe5e0a178e008de17bc`. Windows : 40 groupes navigateur et 11 lanceur ;
Linux : 104 groupes et 9 restaurations HTTPS imbriquées. Voir
`../evidence/ci-validation-rc2.json` pour les SHA, versions et preuves.
Le commit final ajoute seulement documents/preuves/manifeste ; son SHA exact
est consigné dans SOURCE-AUDIT.json du ZIP sources.
Les trois ZIP RC2 sont reconstruits après ce scellage et vérifiés par manifestes.
Aucune publication ni validation sur le PC de Karl n’est déduite de ces réussites.

Les 4 groupes nouveaux utilisent le véritable cœur et exclusivement notre démo MIT.
Le catalogue USA/Europe est une fixture synthétique pour le même en-tête, sans ROM
commerciale et sans preuve de compatibilité régionale. Des fautes sont injectées
dans les vrais appels natifs ; les writers RAM effectifs, le coffre entier et
l’arrêt du contexte sont observés. La quarantaine est laissée plus de 16 s pour
couvrir une échéance d’autosauvegarde. Une relance neuve doit laisser les sentinelles
RAM intactes, sans anciens writers.

## Vérifications demandées aux auditeurs

1. Vérifier C01 sur USA→Europe→USA avec code actif, puis après désactivation, et
   le cas d’un état contenant un code actif sans édition identifiée.
2. Vérifier C02 aux deuxième/troisième ajouts et pendant le reset, y compris un
   cleanup défaillant. Ne pas confondre la liste UI avec une lecture certifiée du
   cœur. Contrôler l’ancienne génération, la quarantaine et les writes RAM réels.
3. Contrôler l’absence de capture persistante depuis un contexte empoisonné.
   Au premier enable, un checkpoint sain est créé avant l’appel natif : la
   comparaison du coffre doit partir de ce point sain, pas masquer cette écriture.
4. Vérifier les trois ZIP RC2 exacts, leurs SHA extérieurs et tous leurs manifestes.
   Les archives CI sont des preuves séparées. Windows/source n’embarquent pas le
   runtime, Web le conserve pour revue privée ; seule la démo MIT est fournie.
5. Comparer le commit applicatif testé au commit documentaire final. Tous les
   changements fonctionnels doivent être couverts par une nouvelle CI.

## Limites et décisions

La cause du blocage de chargement sur le PC de Karl reste inconnue. L’attestation
RAM demeure partielle et certains états proches du démarrage sont refusés.
Le point d’avant cheats reste accessible seulement s’il existe dans le coffre.
Une relance sans codes actifs ne retire pas les effets déjà présents dans une
sauvegarde native. Aucun test de jeu commercial, matériel de Karl, Sonic ou site
public n’est déclaré réussi.

F6 reste ouvert : sources/recettes exactes, extracteurs, notices et assemblage.
Le décor retiré reste dans l’historique protégé ; aucune réécriture destructive
de Git n’est autorisée par ces audits. Une future distribution propre doit être
décidée séparément par Karl, avec provenance et licences complètes.

**GO pour audits et essais privés ; STOP publication, release et fusion vers main.**
