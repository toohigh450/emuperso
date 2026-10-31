# Architecture Phase 1A — implémentation du laboratoire seulement

`interface.html` + `style.css` + `ui.mjs` → `SessionController` → `SimulationAdapter`.

Services indépendants : `Journal`, `MemoryStore`, `ConsentAuthority`, fixtures textuelles, canonisation et SHA-256. Les modules ES sont testables dans Node ; le HTML généré contient leur équivalent sans import réseau. Il n’existe pas d’adaptateur réel ni de chargement Wasm.

## États et opérations

IDLE → INITIALIZING → READY → SELECTED → LOADING → LOADED → RUNNING ↔ PAUSED. SNAPSHOTTING et RESTORING sont transitoires. Les échecs après interaction avec l’adaptateur invalident l’instance vers ERROR ; l’arrêt invalide la génération et donne STOPPED. INITIALIZE permet un nouveau cycle. Une validation refusée avant mutation (ex. snapshot altéré) préserve la session.

Commandes du contrôleur : initialize, select, load, start, pause, resume, advance, changeAudio, saveSnapshot, restoreSnapshot, stop, requestSystemConsent, writeSystem, diagnostic. Une seule opération asynchrone admise ; les concurrentes sont rejetées E_BUSY. STOP reste possible et annule la génération.

Chaque appel d’adaptateur reçoit un AbortSignal, une génération et un request_id. Délais bornés : initialisation/chargement 5 s par défaut, sérialisation/restauration 3 s, commandes simples 2 s. L’UI utilise un seuil de chargement de 70 ms contre 150 ms de retard injecté pour démontrer un timeout réel, pas pour calibrer un moteur. Une réponse obsolète ne peut compléter la commande courante.

Le fournisseur est injectable pour les tests de confiance. Le descripteur doit déclarer simulation, build synthétique attendu, aucun moteur et hash Wasm null. Ce verrou de protocole n’est pas un dispositif de sécurité contre du code tiers malveillant : aucun tel code n’est chargé dans le produit.

## Restauration

1. Schéma exact, limites, SHA-256 du payload et de l’enveloppe.
2. Même fixture, profil, région et build synthétique ; aucune migration implicite.
3. Pause et point sûr fictif ; restauration des compteurs du simulateur.
4. Reconstruction hôte fictive, purge PCM et réancrage.
5. Pause finale par défaut, reprise explicite avec une seule boucle si demandée.
6. Échec après mutation : destruction de l’instance, pas de rollback annoncé.

La sauvegarde système synthétique est hors snapshot. Son namespace inclut profil, fixture et build ; une écriture exige un jeton lié au namespace, hash, révision attendue, génération et expiration. Le jeton est consommé une seule fois. Contrôle de génération juste avant commit après le hash asynchrone : pas d’écriture tardive après STOP.

## Journal et sondes

Événements séquencés avec génération, UTC et horloge monotone hôte ; domaine SIMULATION_ONLY. Chaque hash couvre l’événement et le hash précédent. L’export capture un préfixe cohérent puis attend tous ses hashes : les événements ajoutés pendant l’attente ne créent pas de lignes non hashées dans cet export.

Les métriques simulées ont leur domaine ; les constructions audio, workers, contextes GPU et boucles N64 réels sont absents. La vitesse du modèle utilise un temps mural fictif et un temps émulé fictif. L’heure monotone de l’hôte mesure uniquement l’application de laboratoire. Les compteurs CPU/RSP/RDP ne sont aucune implémentation d’instructions ou de microcodes N64.

## Erreurs principales

E_TRANSITION, E_BUSY, E_NOT_READY, E_IDENTITY, E_ENGINE_NOT_AUTHORIZED, E_INTEGRITY, E_SCHEMA, E_VERSION, E_NAMESPACE, E_CONSENT, E_CONFLICT, E_TIMEOUT, E_STALE_GENERATION, E_AUDIO_BLOCKED, E_PCM_UNDERRUN, E_CLOCK_DRIFT, E_LOOP, E_ADAPTER, E_UNCONFIRMED, E_JOURNAL_FULL, E_JOURNAL_HASHING, E_CRYPTO.

Les garde-fous de simulation aboutissent à une pause et à un événement explicite. Le succès d’une commande step peut donc signifier « défaut détecté et pause effectuée », pas « jeu sain ». L’UI affiche le code et le nouvel état.

## Frontière future

Un vrai moteur exigerait une autorisation distincte, une isolation permettant l’arrêt physique d’un travail non coopératif, une preuve d’identité du contenu effectivement remis au cœur, des sondes internes et des mesures matérielles. Le contrôleur actuel prouve ses contrats sur le simulateur seulement. La présence d’une API Web n’est pas une preuve qu’un futur renderer ou pilote audio fonctionne.

## Révision UI 1.0.1

`src/latest-result.mjs` fournit une barrière de fraîcheur des résultats asynchrones :
`issue()` invalide les tickets précédents et retourne un prédicat lié à un symbole unique ;
`invalidate()` invalide le ticket courant. `src/ui.mjs` vérifie ce prédicat et l’identité du
contrôleur avant chaque mutation du DOM dans les callbacks succès **et** erreur de l’export.
La création d’un laboratoire invalide le ticket. Aucun compteur susceptible de déborder,
aucun changement au journal exporté ou à son intégrité. Une dernière requête échouée laisse
la dernière liste confirmée visible et affiche son erreur ; elle ne ressuscite pas une liste ancienne.
La barrière contrôle l’affichage seulement, pas l’annulation physique du calcul.

## Candidate 1.0.2 — contrats modifiés explicitement

- Identifiant d’application 1.0.2-candidate-phase1a et d’adaptateur
  synthetic-adapter/1.0.2-candidate. namespace et validateSnapshot conservent le
  contrôle strict : les anciens snapshots 1.0.0 sont refusés, pas migrés.
- normalizeStepArguments impose un objet simple, champs connus, entiers 1..10000 ms
  et PCM booléens. Le contrôleur valide avant de toucher l’adaptateur ; l’adaptateur
  valide aussi pour ses appels directs. Entrée invalide : erreur et état stable conservé.
- restoreSnapshot contrôle ses options avant tout hash/restauration : seul resume
  booléen, faux par défaut. La chaîne 'false' n’autorise pas une reprise.
- La garde PCM compare le cumul d’underruns avant/après le step courant ; elle ne
  remet pas le cumul à zéro à la reprise. Une nouvelle hausse entraîne une pause.
- simulation.configuration est un relevé de configuration au moment de l’init, lié
  à la génération ; simulation.step.requested consigne les entrées normalisées et
  simulation.audio.requested l’état demandé. Pas une preuve d’exécution N64.
- command.failed contient details (attendu/reçu ou méthode injectée). Les anciens
  journaux restent vérifiables : algorithme de canonicalisation, schéma et hash inchangés.
- Le statut DOM journal-freshness est pending/current/stale. Les callbacks périmés
  n’affectent ni le statut ni le feedback. createLab efface les lignes de l’instance
  précédente immédiatement. current signifie un préfixe exporté confirmé, pas une
  signature et pas une garantie sur une opération moteur.

Le vérificateur tools/verify_exports.mjs est un outil Node séparé, non livré dans le
bundle navigateur. Il ne charge pas le code produit, utilise node:crypto et une
sérialisation récursive équivalente ECMAScript, et ne modifie jamais ses entrées.
Le schéma de snapshot garde le champ adapter_build, dont la nouvelle valeur rend
la séparation explicite. Aucun mécanisme de migration n’a été ajouté.
