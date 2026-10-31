# État des lieux et plan — candidate 1.0.2, non promue

Mandat : references/transmission/00_MANDAT/MANDAT-CODEX.md. Travail seulement sur
copie de l’archive reçue ; les références, exports et versions antérieures restent intacts.

1. Réception : contrôler chemins, CRC, manifeste transmission et identité du ZIP 1.0.1.
2. Baseline : rejouer les 59 tests JS et 8 Python ; les journaux correspondants sont
   séparés des tests après correction. Relever les limites d’exécution navigateur.
3. Q1 : recalcul indépendant de chaque préimage canonique, UTF-8 et SHA-256
   (événements, tête, payload, enveloppe). Livraison d’un outil de vérification en lecture seule.
4. Q2 : reproduire trois refus synthétiques d’identité et montrer l’absence de lancement.
   Lacune avérée : aucune configuration d’injection historique dans les événements.
   Correction candidate : journaliser configuration à l’initialisation et commandes d’injection.
5. Q3 : tester bornes inclusives 0.95/1.05, fenêtre cumulative depuis réancrage, entrées
   invalides. Défaut baseline reproduit : un underrun passé réactive le garde-fou après
   reprise normale. Conserver le compteur cumulatif et déclencher seulement sur nouvelle hausse.
6. Q4 : rejouer restaurations normale/corrompue/incompatible/échec avant reprise,
   changements de génération et invariance des données système ; aucune écriture de jeu.
7. Q5 : rendre explicite la fraîcheur du journal (en cours, actualisé, ancien après échec),
   tester DOM et erreurs obsolètes. Ne pas ajouter d’import de ROM/sauvegarde ou de persistance.
8. Rapports : matrice de couverture et protocole PC séparant déclarations d’audits,
   tests Codex, exports rapportés Windows et scénarios non exécutés.
9. Livraison : ZIP candidat + rapport HTML français + CHANGELOG + fichiers modifiés
   + SHA-256. Arrêt avant promotion/remplacement, branche moteur ou déploiement.

Risque : nouvelles métadonnées ajoutent des événements et changent les empreintes des
nouveaux journaux, sans réécrire les anciens ni changer leur schéma/algorithme canonique.
La configuration observée n’est pas une signature ni une sandbox pour adaptateur hostile.
