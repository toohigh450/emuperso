# Problèmes ouverts et limites — Phase 1A

| ID | Priorité | État / conséquence | Suite admissible |
|---|---|---|---|
| O1 | Bloquant moteur | Aucun moteur N64 compilé/exécuté : volontaire et conforme au mandat. | Nouveau GO explicite avant toute compilation/exécution. |
| O2 | Bloquant redistribution | 19 en-têtes échantillonnés et notices étudiées, pas tous les fichiers liés. | Audit exhaustif de la fermeture effectivement retenue et sources correspondantes avant distribution. |
| O3 | Important | Recette amont mouvante identifiée ; sélection source figée documentaire, overlay non exécuté. | Après autorisation, checkout exact, désactivation des téléchargements/mises à jour et preuve de build. |
| O4 | Important | URL gnulib résolue ; commit distant et exclusion effective du RSP alternatif non vérifiés. | Vérifier provenance si ce composant entre dans le build. |
| O5 | Important | Hashes d’archives SDK/LLVM/Binaryen/ports non vérifiés ; aucun hash binaire moteur disponible. | Dossier toolchain complet avant build revendiqué reproductible. |
| O6 | Bloquant revendication | Sonic, Conker PAL, audio N64 et vrais états non testés. | Aucun diagnostic causal ni compatibilité annoncés ; futur banc et corpus autorisés séparément. |
| O7 | Important | STOP/timeout invalident la génération ; ne tuent pas un moteur non coopératif. | Future isolation/terminaison hôte à concevoir et tester sur autorisation. |
| O8 | Limite volontaire | Données uniquement en RAM ; pas de persistance IndexedDB/OPFS ni migration réelle. | Exports synthétiques possibles ; ne pas utiliser comme outil de sauvegarde de jeu. |
| O9 | À vérifier sur PC | Windows, Edge, Firefox et file:// réel non exécutés ici. | Les résultats Chromium/Linux ne valent pas pour les trois navigateurs. Fallback localhost documenté. |
| O10 | Portée de preuve | SHA-256 et chaîne d’intégrité ne sont pas des signatures ni une authentification. | Source fiable du manifeste ; plan de signature si diffusion publique future. |
| O11 | Analyse incomplète | 309 chemins littéraux candidats ; conditions, wildcards, générés et liens non évalués. | Ne pas appeler cet inventaire « fichiers réellement liés ». |
| O12 | Limite volontaire | Aucun plugin JavaScript tiers autorisé ; factory injectable réservée aux tests de confiance. | Le contrôle de descripteur n’est pas une sandbox hostile. |

Aucun défaut non résolu dans les parcours finaux testés n’est masqué par cette liste. Les limites ci-dessus empêchent des revendications plus larges ; elles ne sont pas présentées comme des tests réussis.

GO : prolonger le laboratoire sans ROM, consolider les contrats et l’inventaire documentaire.
STOP : intégration/compilation/exécution d’un moteur réel tant que Karl n’a pas donné un nouveau GO explicite ; redistribution d’une pile moteur tant que les droits et sources correspondantes ne sont pas établis.

Révision 1.0.1 : risque de rendu obsolète signalé par GPT traité par tickets de fraîcheur.
Test reproduit sous injection contrôlée de réponses inversées ; aucune occurrence naturelle
ni corruption du journal de 1.0.0 démontrée. Six nouveaux contrôles JS et quatre contrôles DOM.
Les réserves O1–O12 restent ouvertes : cette correction UI ne les résout pas.

Candidate 1.0.2 : les réserves O1–O12 restent ouvertes sauf les preuves ciblées
ajoutées dans ce mandat. Q1 est clos pour les deux exports précis par recalcul complet,
pas pour l’authenticité ou tous futurs fichiers. L’attribution historique des trois
E_IDENTITY reste inconnue faute de mode d’injection consigné à l’époque. Le protocole
Windows complet reste incomplet ; les deux JSON n’en sont pas une certification.

Défauts corrigés : re-pause sur ancienne pénurie PCM, coercition des booléens PCM et
resume, destruction d’instance sur fenêtre invalide, fraîcheur de liste ambiguë.
Configuration/commandes d’injection nouvellement tracées. Nouvel identifiant adaptateur :
anciens snapshots refusés strictement ; aucun import UI ni migration.

Les revues internes de sous-agents ne remplacent pas les audits externes GPT/Méo ni
la décision Karl. La candidate n’est ni déployée, ni substituée à la 1.0.1.
