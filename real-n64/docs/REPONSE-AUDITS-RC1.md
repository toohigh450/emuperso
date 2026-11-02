# Réponse initiale aux audits GPT et Méo — RC1

Date : **1er novembre 2026 (UTC)**. Décideur : **Karl**.

Les deux rapports reçus sont conservés octet pour octet dans
[`audits-recus/rc1/`](audits-recus/rc1/). Le fichier `RECEPTION.json` y distingue
leurs auteurs déclarés, verdicts, méthodes et limites ; `MANIFEST-SHA256.txt`
couvre les deux HTML et ce relevé. Les documents originaux ne sont ni corrigés
ni réécrits. Leurs recommandations sont des éléments d’audit : elles ne créent
pas à elles seules une autorisation de publication ou de modification de projets.

Révision auditée : `65783821250b286f3a3799ea8fcb930908ede342`.
Code testé par la CI RC1 : `aea4eb4538bca032d6dff1dcc33bea1164290018`,
run `41311824619`. Les audits confirment les preuves de cette révision tout en
maintenant le refus de publication. Cette CI ne couvre pas les corrections
ultérieures des constats C01/C02.

## Réponse par constat

| Constat | État initial | Réponse et preuve attendue |
| --- | --- | --- |
| **N64-C01 — changement de variante et cheats fantômes** | **CORRIGÉ ET TESTÉ RC2 — réaudit attendu** | Constat retenu. Le changement de catalogue ne doit pas laisser des codes actifs invisibles dans le cœur. La correction doit conserver une correspondance explicite entre variante affichée, liste active et session. Tester les changements successifs de variante avec un code actif, puis les erreurs de remise à zéro ; aucun succès ne doit être annoncé sur la seule modification du panneau. |
| **N64-C02 — application partielle de cheats** | **CORRIGÉ ET TESTÉ RC2 — réaudit attendu** | Constat retenu. Après une exception de `setCheat`, la liste JavaScript seule ne décrit plus nécessairement le cœur. La correction doit rétablir un état connu ou imposer une session neuve sûre si la récupération échoue. Tester l’échec du deuxième et du troisième code, puis l’échec de `resetCheat`/de la récupération elle-même. Distinguer l’acquittement d’un appel API de la preuve de son effet. |
| **N64-L01 — attestation RAM partielle** | **LIMITE MAINTENUE** | Aucun changement de niveau de garantie. Les ancres RAM vérifient une transition de données sélectionnées, pas tout l’état CPU/RSP/RDP/audio. Le cas déjà équivalent reste distinct d’une restauration prouvée. Un état proche du démarrage peut être refusé légitimement faute de témoins distinctifs ; ce refus ne prouve pas une corruption du fichier. |
| **F6 — sources correspondantes, recettes et licences** | **STOP PUBLICATION MAINTENU** | Les empreintes des paquets ne prouvent pas leurs sources correspondantes. Révisions Mupen/RetroArch, recette effective, extracteurs compilés, notices et qualification de l’intégration restent à établir. Aucun binaire du bundle Web ne doit entrer dans une release, un artefact public ou un hébergement tant que F6 et le GO de Karl ne sont pas levés. |
| **N64-L02 — ZIP finaux non reçus par GPT** | **ARCHIVES RC1 SCELLÉES ; AUDIT EXTERNE À COMPLÉTER** | Les empreintes ci-dessous identifient les trois archives privées déjà construites. Leur vérification locale ne remplace pas la réception et la vérification indépendantes de ces mêmes octets par GPT/Méo. Ne pas remplacer les archives RC1 par une correction sous le même nom. |
| **N64-L03 / Méo P1 — PC de Karl et cause terrain** | **EN ATTENTE** | Le blocage initial sur son PC n’est ni reproduit ni prouvé corrigé. Le protocole privé reste démo MIT d’abord, puis copies de travail autorisées seulement. Aucun résultat CI, code instrumenté ou marqueur RAM ne constitue ce test terrain. Le problème Sonic reste non démontré. |
| **F2 / Méo P1 — ancienne illustration dans l’historique** | **HISTORIQUE CONSERVÉ ; PUBLICATION BLOQUÉE** | La candidate exclut l’ancienne illustration, mais les anciennes révisions restent accessibles. Aucune réécriture d’historique, suppression de preuves ou altération de projets protégés n’est autorisée par cette réponse. La préparation d’une distribution publique indépendante est une décision future distincte, décrite plus bas. |
| **Méo P2 — serveur local et hébergement statique** | **LIMITE MAINTENUE** | L’allowlist locale ne configure pas automatiquement un hébergeur. Les tests du bundle Web local HTTPS ne prouvent pas un déploiement public. Les en-têtes, chemins, fichiers servis et écritures HTTP devront être vérifiés sur l’origine effectivement autorisée. Aucun hébergeur n’est choisi ou déployé ici. |

Les reproductions GPT de C01/C02 exécutent les fonctions réelles extraites du
code avec des objets contrôlés. Elles démontrent leurs branches de contrôle,
mais ne constituent pas une panne spontanée reproduite sur une ROM commerciale
dans Chrome/Mupen. Les tests correctifs doivent conserver cette distinction et
ajouter les observations réelles du cœur possibles avec notre démo MIT.
**Aucun de ces deux constats n’est déclaré clos dans cette réponse initiale.**

## Archives privées RC1 à transmettre pour L02

Ces archives restent inchangées après la réception des audits. Elles contiennent
la RC1 antérieure aux corrections C01/C02, et non la nouvelle candidate corrective.

| Archive | Taille en octets | SHA-256 |
| --- | ---: | --- |
| `EMUPERSO-N64-0.5.0-RC1-WINDOWS-REVUE-PRIVEE.zip` | 2 221 748 | `1e08f870c5b4a2b04ad93a04380159ef02c4bb5091c09bd1171003c583502a0c` |
| `EMUPERSO-N64-0.5.0-RC1-WEB-REVUE-PRIVEE.zip` | 5 777 994 | `2484a6f80c5838db2c27909900bcacb52f3d8927a2e69ed713c062db05dc029e` |
| `EMUPERSO-N64-0.5.0-RC1-SOURCES-AUDIT-PRIVE.zip` | 16 643 942 | `ffd7ab7b7840d1dee8477b8d101e6dd84d45cc80289fa6c5b0becd0791391bab` |

Contrôles locaux déjà exécutés : manifestes exacts et empreintes de toutes les
entrées ; unique ROM distribuée = démo MIT de 6 144 octets, SHA-256
`f18280a16c83721bdd56564701d505f96346784f36168402e5431b12499e2252` ;
aucun runtime/cache/Python/sauvegarde privée dans Windows ou sources ; 39 ressources
runtime et deux fichiers catalogue verrouillés dans le Web privé. Les sources
suivies correspondent octet pour octet à la révision RC1 scellée. Ces contrôles
identifient ce qui peut être audité ; ils ne ferment pas F6 ou L03.

GPT et Méo devront vérifier les ZIP exacts qu’ils recevront : SHA extérieur,
manifestes intégraux, séparation Windows/Web, absence de données personnelles,
démo unique et notices. Les états exportés peuvent contenir des éléments du jeu :
ils restent privés et ne sont pas des pièces à publier avec un diagnostic.

## Référence immuable des preuves RC1

Les **58 fichiers suivis directement dans `real-n64/evidence/`** à la révision
`65783821250b286f3a3799ea8fcb930908ede342` sont conservés dans
`../evidence/rc1-reference/`. Chaque copie provient du blob Git de cette révision,
pas du fichier de travail qu’un banc RC2 pourrait avoir réécrit.
`MANIFEST-REFERENCE.json` indique le chemin original, la copie, la taille et le
SHA-256 de chaque fichier, ainsi que les trois archives RC1 scellées ci-dessus,
leur commit livré, leur commit CI et leurs empreintes vérifiées.

Cette référence ne copie aucun sous-dossier, ROM, sauvegarde originale ou source
applicative. Elle conserve le contexte historique des preuves RC1 ; **elle ne
constitue pas une réussite des tests RC2**. Les nouveaux essais doivent produire
leurs propres preuves et identifier la révision effectivement exécutée. Les
archives RC1 privées restent inchangées.

## Précision sur le périmètre du diff relevé par Méo

L’observation « seul changement […] dans `app.js` […] message d’export reformulé »
est exacte pour la plage **`c8951b5` → `6578382`** : dans ce fichier, le diff
ne modifie que le texte rappelant qu’un état exporté contient la mémoire du jeu
et doit rester privé. Elle ne décrit pas la transition **v0.4.0 → RC1**.

Vérification locale en lecture seule :

```text
git diff c8951b523d68cd3515dce0726eb7c49f108960b1 65783821250b286f3a3799ea8fcb930908ede342 -- real-n64/app.js
git diff 029845b800a61eeee60915363c16c0b218e6e39e c8951b523d68cd3515dce0726eb7c49f108960b1 -- real-n64/app.js real-n64/engine-session.mjs real-n64/session-controller.mjs real-n64/save-store.mjs
```

La seconde plage contient des changements fonctionnels : transactions groupées
`putBatch`, attente de confirmation avant écriture native persistante, chargement
natif courant/précédent, messages d’étape, délais et reprise après erreur,
attestation du chargement et contrôle d’identité de la candidate. Le commit
`c8951b5` ajoute également `native-state.mjs` et le serveur à liste stricte.
L’observation limitée aux commits postérieurs à ce commit ne constitue donc pas
un audit complet de ces correctifs. Les fichiers HTML reçus restent inchangés ;
cette précision est conservée séparément.

## Suite corrective et critères de clôture

La nouvelle candidate devra porter sa propre identité, ses preuves et ses
empreintes. Conserver RC1, ses audits et les preuves de ses limites. Pour C01/C02,
fournir au minimum le diff, les tests ciblés avec pannes injectées explicites,
les vérifications réelles du cœur possibles, la non-régression du coffre et les
conclusions CI terminées sur le code effectivement livré. Les états de constats
ne passent à « corrigé/testé » qu’avec les preuves correspondantes ; une nouvelle
revue GPT/Méo et la validation privée de Karl restent distinctes.

## Option future : distribution publique indépendante

Une fois les corrections et la validation privée examinées, proposer à Karl un
assemblage public neuf et explicitement autorisé, avec uniquement les fichiers
autorisés, l’illustration originale et les composants dont la redistribution est
établie. Cela peut prendre la forme d’un dossier de distribution indépendant ou
d’un nouveau dépôt avec un historique propre, **sans réécrire ni supprimer le
dépôt de travail, les audits, les preuves ou les projets protégés**.

Avant toute création distante ou publication : établir les sources/recettes et
notices F6, vérifier le manifeste final et les droits des actifs, choisir et
tester le contrat d’hébergement, puis obtenir le GO explicite de Karl. Ce plan
n’autorise ni nettoyage d’historique, ni nouveau dépôt distant, ni déploiement,
ni publication de téléchargement. Aucun travail externe de ce type n’a été
effectué dans cette réponse documentaire.

**Conclusion initiale : GO pour les corrections autorisées et leurs vérifications
privées ; STOP publication. C01/C02 corrigés et testés dans la RC2, L01 maintenue, L02 soumis à une nouvelle vérification des archives exactes
examiner sur les ZIP scellés, L03 en attente de Karl, F6 ouvert.**

## Compléments justifiés découverts pendant les régressions

- C03 : les valeurs HTML du sélecteur sont des chaînes, les identifiants du catalogue
  sont numériques. Normalisation canonique explicite, refus des valeurs invalides ;
  le test navigateur exige maintenant USA→Europe→USA après désactivation.
- C04 : l’ancien gestionnaire de fichier d’état ignorait un changement de fichier
  si une sauvegarde native occupait l’application pendant le choix dans Windows.
  Le fichier est maintenant retenu et traité après cette opération (attente bornée
  de30 s), ou refusé explicitement si la partie a changé. Le groupe 7 du Hub maintient
  réellement une capture native en attente, exige l’événement de mise en file puis
  vérifie l’import réel. Les identités, empreintes et contrôles de format restent actifs.
  Le premier essai local a expiré sur l’import sans diagnostic exploitable : son
  ordre exact reste inconnu et est conservé dans rc2-first-hub-attempt.json. Cette
  correction ne démontre pas la cause du blocage de chargement du PC de Karl.

Résultats locaux disponibles avant la nouvelleCI :4 groupes de fautes de cheats,
17 groupes du Hub,9 tests catalogue,10 tests de distribution et13groupes HTTP réussis.
Ils ne remplacent ni la nouvelleCI ni un essai sur le PC de Karl.

## Validation RC2 terminée

CI https://github.com/toohigh450/emuperso/actions/runs/41335193583 :Windows/Linux RÉUSSI, artefacts SHA vérifiés.
C01/C02/C03/C04 sont couverts par les nouveaux scénarios réels.
La revue indépendante GPT/Méo de cette RC2, F6 et le test PC de Karl restent en attente.
