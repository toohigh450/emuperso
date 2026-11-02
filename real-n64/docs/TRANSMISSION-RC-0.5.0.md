# Transmission à GPT et Méo — EMUPERSO N64 0.5.0 RC1

Date : **1er novembre 2026 (UTC)**. Décideur : **Karl**.

Cette candidate poursuit le prototype indépendant dans `real-n64`, sur la branche
`emulateur-reel`. Elle ne remplace pas le N64 Web Lab et ne modifie pas Conker,
TN-1, les sauvegardes originales ou `main`. **Aucun GO de publication, de fusion
vers `main` ou de redistribution publique du moteur n’est donné par ce document.**

## Révision et état de la vérification

Révision candidate transmise pour la dernière exécution CI :
`aea4eb4538bca032d6dff1dcc33bea1164290018`.
Run : <https://github.com/toohigh450/emuperso/actions/runs/41311824619>.
**RÉUSSI : les deux jobs ont terminé avec succès.** Les artefacts frais ont été
téléchargés, vérifiés par SHA-256 et leurs rapports inspectés : Linux 100 groupes
+ 9 restaurations HTTPS imbriquées ; Windows 36 groupes navigateur + 11 contrôles
du lanceur. Les environnements et limites sont consignés dans
`../evidence/ci-validation-rc.json`. Ces résultats ne sont pas ceux du PC de Karl.

Lors du run `41309478777`, les deux environnements ont terminé leurs autres bancs,
mais `probe_restore_rc.py` a échoué dans l’installation de son injection :
`Page.evaluate` appelait automatiquement la fonction injectée avec l’argument
`null`, incompatible avec son paramètre d’options. La correction installe le helper
dans une fonction immédiatement invoquée, sans appel implicite de la sonde. Les **trois contrôles de cette sonde ont ensuite passé localement**.
Cet incident de banc ne constitue ni une panne démontrée du moteur, ni une réussite
du run interrompu. La dernière CI a rejoué avec succès la sonde et les autres bancs.

Les ZIP remis sont reconstruits après ce rapport. Les manifestes internes
couvrent leurs fichiers et le manifeste de livraison donne les SHA-256 des archives.
Le commit documentaire final diffère du commit testé seulement par les documents,
preuves et manifeste ; le code applicatif est vérifié identique. L’archive
source/audit contient son commit exact dans `SOURCE-AUDIT.json`.

Le run 41310383179 avait également échoué au relevé du coffre dans le parcours
HTTPS après changement de ROM. Son ordre exact n’est pas consigné. La sonde
`probe_autosave_readonly_rc.py` démontre indépendamment une création native
périodique hors commande ; ses trois contrôles passent sans modifier le timer.
Le test prépare désormais le natif avant comparaison, conserve le contrôle
intégral du coffre et consigne les différences éventuelles. Aucun changement
du moteur ni de la restauration du produit pour cette correction de protocole.

## Correctifs et portée

| Sujet | Implémentation à examiner | Limite de la revendication |
| --- | --- | --- |
| Chargement bloqué | Attentes Web Audio et IndexedDB bornées, étapes visibles, gestion du verrou et reprise de la session conservée après échec | La cause exacte du blocage signalé sur le PC de Karl reste inconnue. |
| Confirmation du chargement | Contrôle d’identité de la session candidate, du conteneur natif et de sa lecture complète ; comparaison d’ancres RAM différentielles issues de captures réelles | Le retour natif `0`, la lecture du fichier et un compteur frontend croissant ne prouvent pas à eux seuls la désérialisation. Les ancres ne certifient pas tout l’état CPU/RSP/RDP. |
| États proches du démarrage | Refus explicite si aucun témoin mémoire suffisamment stable et distinct ne permet de confirmer le résultat ; cas déjà équivalent distingué d’une transition prouvée | Un refus peut être légitime sans corruption du fichier. Ne pas contourner le refus pour afficher une réussite. |
| F4 — coffre et natif | État et natif associés dans une transaction, historique current/previous, délais et annulation des écritures encore réversibles ; absence d’écriture native persistante avant confirmation du chargement | Une transaction testée n’est pas une garantie de durabilité matérielle après coupure, quota refusé ou effacement du profil. |
| F1 — ressources HTTP | Liste exacte, refus par défaut, contrôles GET/HEAD communs, fichiers réguliers et sans liens, ressources critiques vérifiées | Le serveur local et un hébergeur statique générique sont deux configurations différentes. Tester la sortie exacte à servir. |
| F2 — illustration | Nouvelle bannière abstraite originale ; illustration avec personnages existants exclue des nouvelles distributions | Le retrait dans la candidate ne supprime pas les anciennes révisions de l’historique Git. |
| Livraisons | ZIP Windows source avec lanceur ; bundle Web complet pour revue privée locale HTTPS ; fichiers et manifestes exacts | Le bundle Web contient des binaires tiers et reste privé tant que F6 est ouvert. |

Le packageur ne télécharge rien : `packaging_network_downloads` vaut `false`.
La première préparation Windows télécharge les dépendances officielles verrouillées :
`first_launch_network_downloads` vaut `true` pour Windows, `false` pour le bundle
Web déjà assemblé. Cette distinction décrit la préparation, pas un envoi de ROM.

## Preuves : réel, injections et inconnues

**Exécuté avec un vrai moteur :** les bancs utilisent le runtime figé
EmulatorJS 4.2.3 / mupen64plus_next et exclusivement notre ROM de diagnostic MIT,
SHA-256 `f18280a16c83721bdd56564701d505f96346784f36168402e5431b12499e2252`.
La restauration se vérifie par mémoire réelle, natif distinctif et progression
dessinée dans les framebuffers. Les essais incluent changement de ROM, fermeture
complète du navigateur, copie précédente et conservation du coffre après erreur.
Consulter les résultats effectifs de chaque banc ; un parcours local Linux ou CI
Windows ne valide pas le Chrome installé sur le PC de Karl.

**Pannes injectées :** suspension Web Audio volontairement pendante, fichier MEMFS
retiré après l’appel réel du chargeur, chargeur volontairement sans effet,
en-tête d’état invalide malgré une enveloppe SHA valide, panne de page candidate,
délais/quota/interruptions du stockage. Ce sont des entrées contrôlées du test,
pas des pannes observées spontanément chez Karl. Les mutations RAM et natives
du banc concernent de nouvelles fixtures ; aucune sauvegarde personnelle n’est
utilisée.

**Tests synthétiques :** parseurs, bornes, enveloppes, conflits du coffre,
packaging et fichiers privés fictifs. Ils vérifient les contrats correspondants,
sans établir à eux seuls la compatibilité d’un jeu.

**Non établi :** cause du blocage terrain, correction Sonic, compatibilité des
jeux commerciaux et de tous leurs cheats, fonctionnement de chaque périphérique
de sauvegarde, performances universelles, absence de bogues et fonctionnement
d’un site public. Aucune ROM commerciale ni sauvegarde originale ne figure dans
les livrables ou les preuves.

## Rejouer et retrouver les preuves

Depuis `real-n64`, avec les dépendances de test déjà préparées :

```text
node tests/native-state.test.mjs
node tests/save-store.test.mjs
node tests/runtime-integrity.test.mjs
python3 -B -X utf8 -m unittest discover -s tests -p test_distribution.py -v
python3 -B -X utf8 -m unittest discover -s tests -p test_server_allowlist.py -v
python3 -X utf8 tests/run_linux_browser_rc.py --self-test
```

Le packageur a passé **10 tests de distribution hors réseau** après clarification
de ses métadonnées. Les commandes suivantes exécutent de vrais navigateurs ; elles
nécessitent le runtime officiel et le navigateur de test préparés. Elles restent
réservées aux fixtures du dépôt, dans des profils temporaires :

```text
python3 tests/probe_restore_rc.py
python3 tests/browser_restore_rc.py
python3 tests/browser_restore_guards_rc.py
python3 tests/probe_ram_identification_rc.py
python3 tests/probe_native_roundtrip.py
python3 tests/browser_hub.py
python3 tests/browser_web_rc.py
python3 -X utf8 tests/run_linux_browser_rc.py --budget-seconds 1080
```

Le dernier lanceur regroupe les bancs Linux et isole leurs sorties fraîches dans
`evidence/linux-browser-rc/`, avec journal d’exécution et résultats par banc.
Les anciennes preuves présentes à côté ne remplacent pas ces sorties. Le workflow
`.github/workflows/real-n64.yml` décrit les commandes Windows effectivement
exécutées et les chemins de ses artefacts. Ne pas compter un rapport absent,
ancien ou incomplet comme un succès.

Références du dossier :

- `RC-0.5.0.html` : rapport fonctionnel, limites et résultats documentés.
- `RESTORE-INDEPENDENT-RC.md` : reproduction v0.4, protocole, format natif observé,
  sources consultées et limites de l’attestation.
- `SAVE-STORE-CONTRACT.md` : identités, transactions et historique.
- `WEB-RC.md` : contrat du bundle statique et vérifications locales HTTPS.
- `REDISTRIBUTION-RC.md`, `redistribution-rc.json`, `licenses/` : provenance,
  notices et blocages F6.
- `../tests/run_linux_browser_rc.py` : liste des bancs, nombres de groupes attendus
  et vérification des preuves fraîches.

Le dossier source/audit final doit joindre les sources et tests propres, les
verrous, les rapports frais, les journaux utiles et les manifestes. En exclure
profils, ROM utilisateur, charges utiles d’états, caches et binaires du runtime
non autorisés à la redistribution. Les captures de nos bancs ne montrent que la
démo MIT. Un export d’état peut contenir des éléments du jeu : il reste privé.

## Points demandés aux audits indépendants

1. **GPT :** examiner le chemin complet de restauration, les identités, le contrôle
   de lecture native, les limites du parseur et de l’attestation RAM, les délais
   et la reprise après erreur. Vérifier qu’aucune équivalence mémoire ni simple
   progression frontend n’est annoncée comme une restauration prouvée.
2. **Méo :** tenter de réfuter ces garanties avec les bancs autorisés : état au
   démarrage, absence de témoins, état valide mais sans effet, lecture incomplète,
   fermeture et erreurs. Examiner les captures et journaux indépendamment des
   libellés RÉUSSI.
3. **Les deux :** vérifier l’atomicité de tout le coffre et de current/previous,
   y compris le natif non encore enregistré lors d’un échec ; la séparation des
   jeux et configurations ; le nettoyage des anciennes sessions et l’audio.
4. **Les deux :** contrôler le ZIP extrait exact, ses empreintes, la présence de
   la seule ROM MIT et l’exclusion des données privées, dépendances inutiles et
   anciens personnages protégés. Distinguer source Windows et bundle Web privé.
5. **Les deux :** examiner F6 sans déduire les sources du cœur de son `gitHead`
   d’emballage ou d’un commit voisin dans le temps. Comparer code testé et livré,
   signaler les inconnues et formuler séparément GO technique et GO publication.

## Protocole Karl — copie privée d’abord

1. Extraire le ZIP Windows dans **un nouveau dossier** et utiliser d’abord la
   démo MIT. Garder le même profil Chrome et la même adresse locale pendant la
   série. Ne copier ni remplacer les originaux Conker/TN-1 ou leurs sauvegardes.
2. Lancer la démo, attendre une progression visible, vérifier clavier/manette et
   audio, puis enregistrer trois moments distincts dans les **états 1, 2 et 3**.
   Charger chacun et comparer le résultat visible. Réenregistrer un emplacement,
   puis essayer **Récupérer la version précédente**. Éviter les points pris au
   tout début pour ce premier essai ; consigner séparément tout refus explicite.
3. Sur une copie de travail privée d’un jeu possédant une progression native,
   produire deux progressions distinguables via les mécanismes du jeu et utiliser
   **Enregistrer la sauvegarde native maintenant**. Comparer ensuite
   **Recharger la sauvegarde native** et **Recharger la native précédente**.
   Ces actions peuvent abandonner la progression en cours : lire les confirmations.
   La démo ne remplace pas ce test de progression native ; ne pas modifier ses
   octets à la main et ne jamais prendre les sauvegardes originales pour essai.
4. Changer de jeu pendant la partie, revenir au premier et vérifier ses emplacements
   et son natif. Fermer complètement Chrome, rouvrir le lanceur et la même origine,
   sélectionner de nouveau la même ROM locale puis vérifier les points conservés.
5. Essayer un fichier manifestement invalide et observer l’erreur sans perte de
   la partie active. Ne pas corrompre une sauvegarde pour tester. En cas de
   blocage, noter l’heure, l’étape affichée et l’action précise, puis utiliser
   **Exporter le diagnostic** si le bouton répond. Ne pas effacer le stockage
   pendant l’enquête. Ne partager aucun export d’état/ROM avec le diagnostic.

Avant de partager un diagnostic, relire ses noms de fichiers et métadonnées.
Conserver les exports de sauvegarde en privé et les copies de travail séparées.
Les résultats terrain doivent préciser version du navigateur, origine locale,
version candidate et résultat observé, sans conclure à tous les jeux à partir
d’un seul essai.

## Décision de sortie

**GO pour l’audit et les vérifications locales autorisées. STOP publication.**
F6 reste ouvert : sources correspondantes exactes Mupen + RetroArch, recette
effective, extracteurs compilés, notices complètes et licence de l’intégration
restent à établir. Aucun bundle Web avec ces binaires ne doit entrer dans un
artefact CI public, une release ou un hébergement public. Les SHA vérifient les
octets, pas la conformité juridique. La levée de F6, les audits et la validation
finale de Karl doivent précéder toute nouvelle décision de publication.
