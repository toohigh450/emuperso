# Matrice de couverture — candidate 1.0.2

Les statuts concernent la portée indiquée. « Non testé » n’est jamais un succès.
Les assertions internes (200 commandes/100 restaurations, six bornes, etc.) sont
incluses dans les tests, pas ajoutées aux nombres de tests.

| Question / exigence | Statut Codex | Preuves effectivement produites | Limites |
|---|---|---|---|
| Réception, CRC/chemins/manifeste du paquet et ZIP source | RÉUSSI | evidence/transmission-integrity.json ; source b18576c4… | Manifeste de confiance requis, pas signature |
| Réexécution de 1.0.1 | RÉUSSI | baseline-unitaires-1.0.1.txt 59 ; baseline-outils-1.0.1.txt 8 ; baseline-navigateur-1.0.1.txt 21 ; baseline-rendu-journal-1.0.1.txt 4 ; baseline-run.json identifie HTML | Chromium/Linux, pas Windows |
| Q1 hashes réels et octets | RÉUSSI | verification-exports-Q1.json ; revue-independante-Q1.json ; six tests négatifs/positifs dans tests-revision.txt | Authentification et exécution non prouvées ; outil pas validateur complet d’un format d’import |
| Q2 trois E_IDENTITY | RÉUSSI en reproduction synthétique | revue-independante-Q2-Q4.md ; tests-revision.txt ; configuration visible vérifiée au navigateur | L’injection historique n’est pas prouvée par les deux exports seuls |
| Q2 traces d’injection candidate | RÉUSSI | simulation.configuration, simulation.step.requested, simulation.audio.requested ; expected/reported dans command.failed | Snapshot de configuration à l’init, pas attestation d’un adaptateur hostile |
| Q3 seuils/fenêtre/réancrage | RÉUSSI | Six frontières, invalides, réancrage dans tests-revision.txt ; analyse-terrain-Q2-Q3.json séq.35/58 | Modèle fictif, pas horloge de jeu |
| Q3 récupération PCM | RÉUSSI | baseline reproduit et corrigé : tests-revision.txt, tests-navigateur.txt | Compteur cumulatif conservé, nouvelle pénurie seulement ; pas tampon audio réel |
| Q4 normal/corrompu/incompatible/échec hôte/arrêt concurrent | RÉUSSI | tests-unitaires.txt et tests-revision.txt ; revue-corrections-Q2-Q4.md | Snapshots candidats synthétiques ; aucun état de jeu |
| Q4 ancienne version | RÉUSSI — refus attendu | Ancien export intègre → E_VERSION avant mutation, nouveau snapshot candidat restaurable | Pas de migration ; ancien export conservé intact |
| Q5 fraîcheur UI et courses | RÉUSSI | tests-rendu-journal.txt : 4 scénarios DOM pending/current/stale et réponses inversées | Instrumentation en mémoire réservée au test, pas corruption naturelle démontrée |
| Q5 clavier, rechargement, exports, vues 360/390/768/1440 px | RÉUSSI sur Chromium/Linux | tests-navigateur.txt : 23 contrôles, captures réelles | Pas une certification accessibilité complète ou multi-navigateurs |
| Importation de fichiers dans l’UI | NON IMPLÉMENTÉ, volontaire | Aucun input file ; garde-fous des scripts navigateur | Outil CLI Q1 lit seulement deux exports synthétiques ; aucun import ROM/état |
| Original source, audits et JSON préservés | RÉUSSI dans le périmètre haché | preservation-references.json avant livraison | Aucun hash nouveau de Conker/TN-1/Hub prétendu ; projets non ouverts |
| Phase candidate : Node | RÉUSSI — 59 + 23 | tests-unitaires.txt et tests-revision.txt ; huit modules src vérifiés syntaxiquement | 82 tests de laboratoire, aucun test d’émulation |
| Phase candidate : Python | RÉUSSI — 8 | tests-outils.txt | Outillage sur Linux |
| Windows par Karl — version 1.0.1 | PREUVES REÇUES, portée partielle | Deux JSON référencés dans transmission/02_PREUVES ; UA Windows/Chrome déclaré, 67 événements et snapshot | Codex n’a pas opéré ce PC ; origine file:// non exportée ; pas de protocole complet attesté |
| Chrome/Edge/Firefox Windows — candidate 1.0.2 | NON TESTABLE ici | docs/VALIDATION-PC-KARL.md à remplir | Aucun succès prérempli ; aucun essai natif Edge/Firefox exécuté |
| Moteur N64, ROM, vrais états, Conker PAL, Sonic | NON TESTABLE / HORS MANDAT | Aucun moteur ni données originales inclus ou utilisés | Compilation/exécution moteur toujours interdites sans nouveau GO explicite |

Les chiffres des audits GPT/Méo sur 1.0.1 sont leurs déclarations de réexécutions,
non des exécutions Codex de cette candidate. Les sous-agents de Codex sont des
revues internes indépendantes du calcul principal, pas des audits externes GPT/Méo.
