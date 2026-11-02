# Validation Windows — 2 novembre 2026

Validation locale sur Windows 10, Node 24.22.1, Chrome 156.0.8078.79. Applications issues de `main` à partir de `49c47d9`, assemblées avec les outils EMUPERSO existants. Aucun moteur modifié. Aucun déploiement. La campagne PSP de Claude est restée indépendante.

Cette synthèse est volontairement expurgée : ni collection personnelle, ni nom de jeu commercial, ni chemin personnel, ni capture privée, ni sauvegarde dans Git. Les preuves détaillées JSON/PNG/journaux sont livrées séparément au propriétaire du PC.

| Vérification réelle | Résultat observé |
|---|---|
| Inventaire des huit consoles | 71 509 entrées, y compris variantes d'archives ; ce nombre n'est pas un nombre de jeux testés |
| NES, SNES, GB, GBC, GBA, DS, N64, PS1 | Un échantillon par console : moteur démarré, captures non uniformes et compteur avançant |
| Préservation des fichiers testés | Taille, date de modification et SHA-256 avant/après identiques pour les huit échantillons terminés |
| Crash du superviseur | Processus du superviseur interrompu volontairement après première capture d'une démo NES libre |
| Reprise | Tentative interrompue conservée ; nouvelle tentative terminée dans un nouveau profil |
| Seconde reprise | Aucun essai terminé dupliqué |
| Timeout contrôlé | Boucle infinie injectée dans le renderer de la démo après démarrage ; arrêt par le superviseur externe à 45 secondes configurées |
| Nettoyage du timeout | Worker et navigateur de ce cas absents après arrêt, identité vérifiée par PID et date de création |
| Archive et mode approfondi | Une ROM NES extraite depuis son ZIP, captures avant/après et après signaux de commande ; SHA-256 de l'archive identique avant/après |
| Fermeture après mode approfondi | Fermeture normale de Chrome sans réponse ; repli borné de huit secondes, worker quitté puis arbre Chrome fermé par le superviseur, absence du navigateur confirmée |
| Rapport hors ligne | HTML ouvert par `file:`, deux images chargées, filtrage vérifié, aucun appel HTTP, largeur mobile 390 px sans débordement après correction |
| Logique automatisée | Quatre tests Node, tous réussis : classification prudente, chemins d'archives, historique/exports, remplacement atomique |

Les premiers essais ont révélé des défauts du banc qui restent dans les journaux privés : autorisation réseau trop restrictive, canal IPC gardant un worker ouvert, course pendant le comptage des profils supprimés, lecture GBC `FileReader` échouant sur un chemin Windows et débordement des chemins longs dans le rapport. Corrections : fichiers de distribution explicitement autorisés, déconnexion IPC, comptage tolérant les fichiers disparus, petits fichiers transmis au Chrome **local** en octets et retour à la ligne des chemins. La fermeture de navigateur est bornée à huit secondes, puis le superviseur ferme seulement l'arbre identifié si nécessaire.

## Ce que cette validation ne prouve pas

- Aucun des huit échantillons n'est déclaré jouable sur la seule base des captures.
- Ni progression en jeu, ni écoute audio, ni manette physique, ni téléphone réel validés.
- Aucun test de sauvegarde native ou de save state réalisé par ce banc ; les statuts correspondants ne sont jamais produits automatiquement.
- Aucun fonctionnement parallèle validé ; concurrence 1 conservée.
- Aucun redémarrage physique de Windows effectué : la reprise après crash du superviseur est réelle, la reprise après redémarrage utilise les mêmes fichiers persistants et reste à vérifier avec un vrai redémarrage.
- Les huit essais ne valident pas les 71 509 entrées. Les erreurs de chargeur ou formats refusés restent visibles, avec la phase correspondante.
- Les archives PS1 ne sont pas divisées par édition interne ; CUE seul et pistes multiples demandent un examen humain.
- La surveillance RAM est périodique. Le banc ne réserve pas matériellement la mémoire et attend si la surveillance CIM devient indisponible.

Le banc s'inspire du testeur PSP autonome local de Claude, examiné en lecture seule : résultats privés après chaque essai, reprise et petits fichiers d'abord. Le superviseur séparé, la vérification d'identité des processus, l'inventaire par entrée d'archive et les classifications prudentes répondent au mandat complémentaire hors PSP.

## Renforcement après les pauses réelles de nettoyage

La campagne a révélé des arrêts automatiques après fermeture de Chrome non confirmée. Il ne s'agissait pas de la fin de la file. Les diagnostics conservés montrent notamment des retours `taskkill` en erreur sur des processus en terminaison. Les erreurs de fermeture ne sont plus masquées : revalidation d'identité, repli direct sur le seul PID concerné, attente et nouvelles tentatives sont consignés. Un watchdog indépendant reprend la campagne après crash ou récupération de cette pause technique, sans ignorer les demandes de pause/arrêt.

Validations complémentaires réelles avec les démos libres NES/SNES : crash volontaire du testeur pendant le premier jeu, relance automatique par le watchdog, conservation de la tentative interrompue ; pause de nettoyage injectée une fois puis récupération automatique et passage au second jeu, sans doublon ; pause utilisateur respectée avec un jeu restant ; renderer NES bloqué volontairement puis timeout et démarrage du jeu SNES suivant sans intervention. Le nettoyage des processus du cas bloqué est vérifié. Cinq tests Node passent, dont la protection contre un PID réutilisé. Ces essais ne valident toujours ni gameplay ni sauvegardes.
