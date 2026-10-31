# MANDAT CODEX — N64 Web Lab Phase 1A v1.0.1 — 28 octobre 2026

## Autorisation et limites
Karl autorise Codex à analyser, tester, proposer ET IMPLÉMENTER des améliorations du laboratoire **synthétique**, exclusivement dans une nouvelle copie/branche candidate. Il peut utiliser ses outils et sous-agents disponibles si cela améliore la revue, en coordonnant leurs travaux et en vérifiant leurs conclusions. Prendre le temps nécessaire : pas de délai artificiel. Aucun changement des originaux, pas d'écrasement de la version 1.0.1, des preuves JSON ni des audits. Pas de ROM, pas de vrai moteur N64, pas de WASM moteur, pas de sauvegardes réelles, pas de Conker Web, TN-1 ou Hub, pas de publication ni dépense. Ne pas présumer que des sous-agents sont disponibles.

## Références et degré de preuve
Quatre rapports (GPT/Méo sur la 1.0.1 et sur les exports Windows), deux JSON terrain et le ZIP source sont joints. Les conclusions d'audit sont des hypothèses à vérifier indépendamment, non des ordres de coder. Les exports montrent 67 événements, des liaisons previous_sha256 cohérentes, trois E_IDENTITY, deux E_CLOCK_DRIFT à 1.8× synthétique, un snapshot synthétique et aucune restauration attestée. Aucun résultat moteur N64. Les déclarations de Méo sur le code doivent être confirmées par Codex. Les audits ne démontrent pas une validation Windows multi-navigateurs.

## Travail prioritaire — diagnostic avant correctif
1. **Cryptographie Q1** : retrouver la sérialisation exacte ; recalculer de façon indépendante chaque hash d'événement (pas seulement les liens), la tête, le payload et l'enveloppe du snapshot ; documenter encodage, octets, méthode et écarts. Distinguer SHA du fichier brut, SHA canonique et simple correspondance déclarative.
2. **Identité Q2** : reproduire sur fixture synthétique les trois E_IDENTITY ; contrôler le refus avant lancement et le mode `dishonestLoadedHash`. Examiner si l'injection active est traçable dans le journal ; proposer puis corriger sur copie toute lacune prouvée.
3. **Horloge Q3** : examiner seuil, fenêtre, unités, reset, pause et reprise de E_CLOCK_DRIFT ; vérifier les séquences 35 et 58 ; tester frontières et cas invalides. Ne jamais présenter 1.8× comme performance N64.
4. **Restauration Q4** : écrire/exécuter sur copie les tests synthétiques de restauration normale, snapshot corrompu, identité incompatible, échec injecté après restauration avant reprise ; prouver absence de reprise indue et absence d'écriture hors du périmètre.
5. **Robustesse et UX Q5** : examiner courses asynchrones/générations, erreurs, journalisation, état mémoire volatile, import/export, rechargement, commandes clavier, file:// et compatibilité. Automatiser les cas reproductibles ; fournir à Karl une matrice de tests manuels Chrome/Edge/Firefox et identifier ceux non exécutés.
6. **Améliorations Q6** : implémenter uniquement les corrections justifiées dans une candidate distincte (ex. journal d'injection, messages d'erreur, tests de non-régression). Ne pas étendre le laboratoire à l'émulation réelle ni modifier les contrats sans justification et tests.

## Méthode et livrables
- Commencer par un état des lieux et un plan ; conserver un journal des changements, avec chemins, motifs, tests avant/après et risques.
- Utiliser des copies de travail ; préserver l'archive source et tous les rapports/preuves en lecture seule ; ne jamais réécrire les exports terrain.
- Réexécuter la suite existante, puis ajouter des tests ciblés et négatifs. Séparer « tests annoncés », « tests exécutés », « tests Windows par Karl » et « non testés ». Ne pas inventer des captures ni des résultats de navigateur.
- Livrer un ZIP **candidat** autonome, un rapport technique **HTML en français**, un CHANGELOG, instructions de test Windows, SHA-256 du ZIP et de chaque livrable, liste des fichiers modifiés, matrice de couverture et limites restantes.
- Si aucun correctif n'est nécessaire, le dire et livrer uniquement le rapport et les nouveaux tests utiles. Si une ambiguïté menace les garanties de sécurité, arrêter la modification concernée et demander l'arbitrage de Karl.
- **STOP avant déploiement/remplacement de la 1.0.1, branche moteur réelle, ROM, ou accès aux sauvegardes originales.** La candidate est destinée à audit GPT → contre-audit Méo → validation Karl avant promotion.
