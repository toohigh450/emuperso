# Validation Windows de la candidate — Karl

**Tous les résultats ci-dessous sont NON EXÉCUTÉS pour 1.0.2-candidate.**
Les deux exports reçus portent sur un ancien parcours synthétique rapporté Windows/Chrome ;
ils ne remplissent pas cette matrice, et leur champ hôte ne prouve pas le mode file://.
Ne jamais remplacer la 1.0.1 : extraire la candidate dans un autre dossier.

Noter date/heure, Windows/version, navigateur/version, mode file:// ou localhost,
empreinte du ZIP et version affichée dans le diagnostic (`1.0.2-candidate-phase1a`,
adaptateur `synthetic-adapter/1.0.2-candidate`). Si WebCrypto est indisponible en
file://, noter NON TESTABLE pour ce mode et utiliser le fallback du README séparément.
Aucune ROM, aucun fichier .sav/.srm/.state, aucun TN-1 ou Conker requis ni autorisé ici.

| Cas | Chrome Windows | Edge Windows | Firefox Windows | Preuve à conserver |
|---|---|---|---|---|
| Ouverture file:// hors ligne | NON EXÉCUTÉ | NON EXÉCUTÉ | NON EXÉCUTÉ | Capture et éventuelle erreur WebCrypto |
| Ouverture localhost si nécessaire | NON EXÉCUTÉ | NON EXÉCUTÉ | NON EXÉCUTÉ | URL locale, version et message |
| Initialiser → sélectionner → charger → lancer | NON EXÉCUTÉ | NON EXÉCUTÉ | NON EXÉCUTÉ | Identités aux trois étapes |
| Avancer normalement, puis dérive → pause → reprise | NON EXÉCUTÉ | NON EXÉCUTÉ | NON EXÉCUTÉ | Diagnostics synthétiques avant/après |
| Couper PCM → pause ; reprendre puis Avancer → reste actif | NON EXÉCUTÉ | NON EXÉCUTÉ | NON EXÉCUTÉ | Compteur cumulatif 1, pas nouvelle pénurie |
| FULL sans dérive | NON EXÉCUTÉ | NON EXÉCUTÉ | NON EXÉCUTÉ | Cadence fictive normale, AI FULL |
| Injection identité au prochain init | NON EXÉCUTÉ | NON EXÉCUTÉ | NON EXÉCUTÉ | Configuration consignée, E_IDENTITY, aucun lancement |
| Snapshot candidat → restaurer pause / reprendre | NON EXÉCUTÉ | NON EXÉCUTÉ | NON EXÉCUTÉ | PCM purgé, vitesse fictive réancrée |
| Copie altérée refusée | NON EXÉCUTÉ | NON EXÉCUTÉ | NON EXÉCUTÉ | E_INTEGRITY, session inchangée |
| Échec après restauration avant reprise | NON EXÉCUTÉ | NON EXÉCUTÉ | NON EXÉCUTÉ | ERROR, aucune boucle/lancement courant |
| Écriture fictive : Annuler, Confirmer, Échap | NON EXÉCUTÉ | NON EXÉCUTÉ | NON EXÉCUTÉ | Révision, une seule écriture autorisée |
| Clavier : Tab, Entrée, Échap | NON EXÉCUTÉ | NON EXÉCUTÉ | NON EXÉCUTÉ | Focus visible, dialogue fermé sans écrire |
| Journal actualisé, vérification et exports JSON | NON EXÉCUTÉ | NON EXÉCUTÉ | NON EXÉCUTÉ | Journal et fichiers téléchargés |
| Laboratoire neuf puis rechargement | NON EXÉCUTÉ | NON EXÉCUTÉ | NON EXÉCUTÉ | IDLE et absence de snapshots persistants |
| Console et réseau | NON EXÉCUTÉ | NON EXÉCUTÉ | NON EXÉCUTÉ | Erreurs éventuelles, aucune ressource externe attendue |

Renseigner RÉUSSI, ÉCHOUÉ ou NON TESTABLE avec preuve, séparément pour chaque
navigateur/mode. Ne pas modifier les anciens exports : produire de nouveaux fichiers.
Pas d’option d’import UI : le refus des anciens builds est couvert par tests API/CLI,
pas une manipulation manuelle d’une sauvegarde. L’échec d’export de journal est
injecté automatiquement dans le test DOM ; ne pas altérer WebCrypto de son navigateur
courant pour le provoquer. Retourner diagnostic et observations à l’audit de Karl.
