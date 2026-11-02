# Réponse aux audits Portables 0.2.0 — 0.2.1-alpha.1

Date : 2 novembre 2026. Branche : `emulateur-portable`, PR #1 en brouillon. Référence auditée : `8f611553ee42bfad0abbeb20ba01d472b6a6ca51`.

## Résultat et portée

74 tests de logique passent (67 avant ces corrections), le parcours Chromium avec moteur simulé passe, et un essai supplémentaire avec le **vrai frontend EmulatorJS 4.2.3** confirme sa préparation et le raccordement des événements. Aucun cœur ni jeu réel n'a été exécuté. La version reste alpha, pas stable. Les essais Windows, manette, jeux, cheats actifs et restaurations réelles restent ouverts.

Les rapports originaux fournis par Karl sont conservés sans modification dans `audits/recus/`, avec leurs SHA-256. L'ancien audit documentaire est conservé aussi. Les résultats exécutés figurent dans `preuves/` ; les tests restent dans `tests/`.

## Traitement du rapport technique GPT

| Point | Traitement | Preuve et limite |
| --- | --- | --- |
| P01 — émulation réelle | **Ouvert** | Nouveau test du vrai frontend, sans cœur démarré. Aucune vraie ROM autorisée ni session Windows fournie ; la matrice terrain reste à exécuter. |
| P02 — moteur distant | **Partiellement traité** | Remplacement du chemin mobile `stable/` par `4.2.3/`, SRI du chargeur, manifeste des trois fichiers frontend téléchargés et outils de vérification. Les sous-ressources et binaires des cœurs ne sont pas contrôlés en intégrité à l'exécution. Confiance dans le CDN toujours nécessaire ; moteur local complet et licences restent à examiner. |
| P03 — échec de l'historique A → B | **Corrigé et testé** | Suppression de l'assignation anticipée de `currentGame`. Le rendu de la session fournit le jeu courant ; avertissements publiés avec cette session. Injection d'un échec d'écriture de l'historique dans Chromium : A, son iframe et son association de codes restent cohérents. |
| P04 — rotation du miroir | **Corrigé et testé pour IndexedDB** | Lecture des trois générations et rotation dans une seule transaction `readwrite`. Interruption après chacune des écritures 1, 2 et 3 : les trois anciennes générations restent identiques ; l'écriture suivante réussit. La restauration d'une vraie sauvegarde dans chaque cœur reste ouverte. |
| P05 — collisions numériques | **Corrigé et testé** | Registre persistant dans `settings`, réservation des identifiants de l'historique avant ouverture d'un nouveau jeu et sondage en cas de collision. Réservation transactionnelle entre connexions IDB ; cas de collision et retour en début de plage testés. Les noms internes complets restent utilisés. |
| P06 — .cht modifié au même chemin | **Corrigé et testé** | SHA-256 du texte importé enregistré dans le fichier et le lien. Changement de contenu : ancien choix refusé, avertissement, nouvelle confirmation nécessaire. Les fichiers identifiés par `rom_sha256` mais réimportés avec un autre contenu sont aussi exclus du chargement automatique. |
| P07 — source HTTP 200 sans ready | **Corrigé et testé** | Une tentative et sa minuterie par iframe. Si le chargeur échoue ou ne devient pas prêt, suppression complète de l'iframe puis essai de la source suivante. Test d'une source 200 muette puis d'une source saine, sans contamination des variables et sans perte des octets à réessayer. Un moteur déjà prêt n'est pas redémarré automatiquement après une erreur de jeu. |
| P08 — grosses ROMs DS | **Partiellement traité** | Maximum 512 Mio par ROM, budget prudent avant lecture et avant décompression, estimation incluant l'archive et le jeu actif, confirmation dès 256 Mio. Tests de politique 256/512/1024 Mio sans allocation de ces ROMs. Ce budget n'est pas une mesure de RAM libre ; les vrais chargements 256/512 Mio restent à éprouver. |
| P09 — ZIP BIOS melonDS | **Corrigé et testé structurellement** | Taille d'archive limitée à 2 Mio ; trois noms exacts et uniques à la racine ; tailles BIOS7/BIOS9/firmware ; extraction et CRC de chacun. Validation à l'import et à l'ouverture des anciens BIOS stockés. Aucun BIOS réel fourni ; authenticité non attestée. |
| P10 — route Vercel | **Partiellement vérifié, accès protégé bloqué** | Métadonnées : aperçu READY lié au commit audité, protection SSO active. Requête anonyme : redirection vers une connexion Vercel. La tentative de lecture authentifiée via le connecteur a été refusée par la revue automatique car elle créerait/réutiliserait un lien temporaire de partage donnant accès à un déploiement protégé. Aucun lien n'a été créé par cette action refusée. Route fonctionnelle et démarrage réel non certifiés. Aucun réglage de protection modifié. |
| P11 — Windows / Xbox | **Partiellement traité** | Batch : vérification qu'un Python 3 s'exécute réellement, sortie explicite après le secours, CRLF conservés. Windows, PowerShell, ports occupés, Edge et manette restent non exécutés. |
| P12 — distribution et CI | **Partiellement traité** | Lockfile sans dépendance d'application, manifeste frontend, référence d'archive amont, notices de provenance et CI Linux/Windows avec Node 22/24. Les actions sont figées sur des commits. La CI distante ne sera déclarée réussie qu'après lecture de ses résultats. Aucune licence du code original n'est inventée ; les droits de redistribution des cœurs restent à vérifier. |

## Défaut supplémentaire découvert : événement du moteur stable

La distribution réellement servie par `stable/` au moment du contrôle correspond au chargeur 4.2.3. Ce chargeur **ne relie pas `EJS_onSaveUpdate` et ne relie pas `EJS_onExit`**. Le code de développement consulté lors de la 0.2 avait ces raccordements, mais cela ne prouvait pas leur présence dans la distribution utilisée.

La 0.2.1 branche donc `saveSaveFiles`, émis par le gestionnaire de sauvegarde 4.2.3, au miroir ; elle branche aussi `exit`. Pour un moteur disposant du mécanisme natif `enableSaveUpdateEvent`, le relais ancien n'est pas doublé. L'essai du vrai frontend utilise les trois fichiers vérifiés, son vrai système d'événements et des données de sauvegarde synthétiques. Le résultat confirme ce raccordement, pas la production ou la restauration d'une sauvegarde en jeu.

Les activations de cheats de 4.2.3 sont indexées par l'identifiant numérique, le cœur et `gameName` dans les réglages par jeu. Cela ne remplace pas le scénario terrain A → B → A : il est maintenant explicite dans `TESTS-KARL.md`.

## Audit documentaire et contre-audit Méo

- Mandat remis à jour : branche au singulier, versions et nombres de tests distingués, état exécuté et prochaines vérifications.
- `ETAT.md` rétablit Fait / En cours / Bloqué / Prochain pas.
- L'affirmation Méo « échec de chargement → ancien jeu intact » n'est valable **que jusqu'au remplacement de la session**. Si le nouveau moteur échoue après fermeture de l'ancien, l'ancienne partie est déjà fermée. La confirmation le dit désormais clairement. Aucun moteur double ni restauration automatique de progrès non enregistrés n'est revendiqué.
- Le moteur peut mémoriser les activations de codes : la version ne promet pas de tout désactiver à chaque démarrage.
- L'intégration GitHub produit des aperçus Vercel automatiques : la description ne prétend plus « aucun déploiement ». Aucun déploiement manuel, fusion ou promotion de production n'est effectué.

## Reproduction

Depuis `portables/` :

- `npm ci --ignore-scripts`, `npm run check`, `npm test` (Node >= 22.17).
- `npm run test:browser` avec Playwright et Chromium installés séparément. Dans l'environnement d'exécution, leurs chemins préinstallés ont été fournis via `PLAYWRIGHT_MODULE` et `CHROMIUM_PATH`.
- `npm run test:engine` avec `ENGINE_FIXTURE_DIR` contenant `loader.js`, `emulator.min.js`, `emulator.min.css` de 4.2.3. Le test vérifie les trois SHA-256 avant de les servir au navigateur. Ces fichiers de moteur restent hors dépôt ; aucune vraie ROM n'est nécessaire pour ce test de frontend.
- `node tools/verify-engine.mjs --frontend chemin/data` vérifie les trois fichiers. `--archive chemin/4.2.3.7z` vérifie l'empreinte annoncée par GitHub pour l'archive complète. L'archive de 303 Mo n'a pas été téléchargée pendant ce travail ; son empreinte de référence vient de l'API de release.

Seul le workflow `.github/workflows/portables-tests.yml` est ajouté hors de `portables/` pour répondre au point CI. Aucun fichier N64 ou PS1 existant n'est modifié. La PR reste en brouillon et la décision de fusion reste à Karl.
