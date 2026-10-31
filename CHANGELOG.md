# CHANGELOG — 1.0.2-candidate, 28 octobre 2026

Statut : candidate isolée, pas une version promue. Base exacte : ZIP 1.0.1 reçu,
SHA-256 b18576c4ef4acedb37f9ad51dd799fb87afaf067d40a9a3573f242314084454a.
Mandat et références conservés sans modification dans references/transmission/.

| Changement | Chemins | Motif et avant → après | Tests / risque |
|---|---|---|---|
| Vérificateur indépendant | tools/verify_exports.mjs, tests/revision.test.mjs | Les audits avaient contrôlé des liens déclarés ; recalculer chaque préimage, head, payload et enveloppe | 67 hashes conformes ; altérations, nombres, UTF-8/tailles invalides testés. Intégrité ≠ authenticité ; pas une validation complète de tout schéma d’import |
| Observabilité des injections | src/simulator.mjs, src/controller.mjs, src/ui.mjs, src/interface.html | Mode historique absent → configuration retenue à l’init, paramètres step/audio et détails E_IDENTITY consignés | Trois refus sans lancement reproduits. Plus d’événements : nouvelles séquences et hashes attendus. Configuration déclarative au moment de l’init, pas attestation hostile |
| Récupération PCM | src/controller.mjs | Ancien compteur cumulatif > 0 re-pausing à tort → déclenchement sur nouvelle hausse, cumul conservé | Coupure → reprise normale RUNNING → nouvelle coupure PAUSED ; FULL sans dérive conservé |
| Validation des options | src/simulator.mjs, src/controller.mjs | Booléens coercibles et entrée invalide destructrice → types/options contrôlés avant mutation | Bornes, NaN/Infinity/fractions/chaînes/champs inconnus ; restore resume:'false' refusé. Changement volontaire du contrat des entrées invalides |
| Fraîcheur UI | src/ui.mjs, src/interface.html, src/style.css | Ancienne liste sans avertissement explicite après échec → pending/current/stale ; callbacks obsolètes toujours ignorés | Quatre scénarios DOM contrôlés. Débordement à 360 px découvert puis corrigé par overflow-wrap ; dernière liste confirmée conservée en cas d’échec courant |
| Version du simulateur | src/simulator.mjs, src/storage.mjs, package.json, src/ui.mjs | Ne pas assimiler deux codes différents au même build : nouveau build synthétique 1.0.2-candidate | Ancien snapshot intègre refusé E_VERSION avant mutation ; nouveau snapshot restaurable. Aucune migration implicite, fixture texte et schéma v1 conservés |
| Tests et livraison | tests/, tools/package.py, docs/, evidence/ | Baseline séparée, nouveaux tests, rapport français et matrice terrain, livraison candidate | 59 + 23 JS ; 8 Python ; 23 Chromium + 4 DOM. Les tests de modèle ne prouvent aucune émulation |

Les algorithmes de canonicalisation/hash (src/common.mjs, src/journal.mjs), les
fixtures, le verrou documentaire moteur et l’illustration sont inchangés. Le contrôle
d’identité à la porte de chargement n’était pas défaillant : ses messages et traces
sont enrichis, pas contournés. Aucun élargissement vers une pile N64 réelle.

La liste complète des fichiers modifiés/ajoutés/déplacés et leurs empreintes est
produite dans docs/FICHIERS-MODIFIES.json relativement au ZIP source reçu.
