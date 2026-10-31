# Revue ciblée des corrections Q2–Q4 — candidate 1.0.2

Revue interne supplémentaire par sous-agent Codex. **Ce document n’est pas un audit externe GPT ou Méo.** Lecture de `src/controller.mjs`, `src/simulator.mjs`, `src/common.mjs` et `tests/revision.test.mjs`, puis quatre scénarios Node exécutés par stdin sur les modules candidats. Aucun navigateur, moteur, ROM, état original ou réseau utilisé. Aucun code produit/référence modifié par cette revue.

## Résultat global

Aucun défaut nouvellement introduit confirmé dans les corrections examinées. Les quatre scénarios exécutés passent. Ils constituent des vérifications ciblées de laboratoire, pas une réexécution de toute la suite ni une mesure d’émulation.

## 1. Garde PCM — confirmé corrigé

Le contrôleur capture le probe avant le step puis compare `probes.simulated_underruns > before.simulated_underruns`. Le compteur reste historique ; une ancienne pénurie ne suffit plus à redéclencher la pause. Les vérifications de génération dans `call()` protègent la réponse après un appel asynchrone.

Scénario réellement exécuté :

- `advance({produce_pcm:false})` => PAUSED / E_PCM_UNDERRUN, cumul 1.
- `resume(); advance()` normal => RUNNING, cumul toujours 1 ; aucune fausse pause.
- Nouveau `advance({produce_pcm:false})` => PAUSED / E_PCM_UNDERRUN, cumul 2.

La priorité des autres gardes est conservée (boucle, audio, horloge, puis pénurie). La restauration reconstruit le compteur hôte PCM à zéro comme auparavant ; ce compteur n’est pas le payload CPU synthétique sérialisé.

## 2. Validation des entrées avant appel — confirmé

`normalizeStepArguments()` impose un objet simple, les seuls champs reconnus, les millisecondes entières de 1 à 10 000 et des options PCM strictement booléennes. Il est appelé dans le contrôleur avant `call()` et dans l’adaptateur avant sa mutation. Les options normalisées ne contiennent que des valeurs primitives et sont gelées.

Scénario exécuté : `advance({consume_pcm:'false'})` => E_SCHEMA ; RUNNING et génération conservés, probes exactement inchangés ; `command.failed.data.touched_adapter === false`. Ce changement évite l’ancienne invalidation conservative de toute l’instance pour une erreur d’entrée détectable avant appel.

La trace d’une commande invalide existe toujours (`command.accepted`, puis `command.failed`), mais aucun `simulation.step.requested` valide n’est ajouté pour cette entrée. Le contexte de commande reste libéré par `finally`.

## 3. Restauration — consentement de reprise strictement booléen

L’option `resume` doit être un booléen explicite si présente ; les champs inconnus et objets non simples sont refusés avant validation/mutation du snapshot et avant appel de pause/restauration.

Scénario exécuté depuis PAUSED, snapshot synthétique valide : `restoreSnapshot(envelope, {resume:'false'})` => E_SCHEMA ; PAUSED, génération inchangée et zéro boucle. La chaîne `'false'` ne peut plus déclencher une reprise par coercition truthy. Les appels normaux de l’UI utilisent déjà de vrais booléens et ne dépendent pas de cette coercition.

## 4. Configuration et identité — traces cohérentes

L’initialisation consigne `simulation.configuration` après contrôle du descripteur synthétique et avant l’appel d’initialisation. L’événement porte la génération d’adaptateur. Les paramètres normalisés du step et les commandes audio sont consignés dans des événements explicites. Les détails E_IDENTITY incluent hash attendu et hash déclaré par l’adaptateur, sans conclure à une faute d’un moteur réel.

Scénario exécuté avec `dishonestLoadedHash:true` : configuration journalisée avant le refus ; E_IDENTITY avec hash reçu égal à 64 zéros ; aucune identité chargée/lancée ; chaîne SHA-256 vérifiée par l’API du produit. L’événement configuration est à génération 1, l’échec à génération 2 après invalidation : ce décalage est cohérent avec la politique de génération existante.

## Limites à maintenir dans la livraison

- La configuration consignée est un **snapshot à l’initialisation**. Elle ne constitue pas une attestation cryptographique d’un adaptateur hostile, et les factories restent des outils de tests de confiance. Une mutation manuelle d’options après cette étape n’est pas automatiquement reconsignée. Le hook de test `failNext` n’est pas une option de l’UI ; les erreurs injectées déclarent désormais leur méthode dans les détails.
- Les probes incluses dans `guard.paused` sont toujours les probes observées avant l’appel pause ; `simulated_loops:1` dans cet événement ne signifie donc pas que la boucle reste active une fois la pause confirmée.
- Les nouveaux événements changent naturellement les séquences et hashes des **nouveaux** journaux. Aucun journal terrain 1.0.1 ne doit être réécrit pour leur ajouter une injection historique absente.
- `SIM_BUILD` reste `synthetic-adapter/1.0.0` alors que le code du modèle a évolué. La livraison doit justifier la compatibilité du payload inchangé, identifier la version candidate et les SHA de composants, et ne pas présenter le code comme octet-identique à l’adaptateur initial. Aucune compatibilité moteur réel n’en découle.
- La validation d’objets simples vise l’API JSON/fixtures normale ; elle ne fait pas du laboratoire une sandbox pour du JavaScript tiers hostile (getters, proxies, mutation directe d’adaptateur, etc.).

## Empreintes examinées

- `src/controller.mjs` : `a20e6bdbb9bd68a573a60e2dc1ef2eef0f6b1042a7cf6dac9f0f9b6f9ae015ed`
- `src/simulator.mjs` : `735bed12b9c9caad85483005d536540f261c2a06af5220d87024d07d1101edcd`
- `src/common.mjs` : `9248afa0628a1591629019f2857de5e30dee9aa396934c4400e792bd9a87c20c`
- `tests/revision.test.mjs` : `a985f9e18fdea12e9664bfca2834e2f4442e74f57fc7c3ca8bb7f09a69fe37ca`

Ces empreintes décrivent les fichiers lus au moment de la revue ; si des corrections ultérieures les changent, l’agent principal doit les requalifier et rejouer les tests concernés. Aucun résultat Windows ou navigateur n’est certifié ici.

## Addendum — version finale avec build synthétique distinct

La revue précédente décrivait un état intermédiaire conservant `synthetic-adapter/1.0.0`. Cette réserve a été traitée ensuite par l’agent principal : `SIM_BUILD` et les namespaces sont maintenant `synthetic-adapter/1.0.2-candidate`. Aucune migration implicite ni équivalence des builds n’est annoncée. Les empreintes de la section précédente restent celles de l’état intermédiaire, pas celles de la candidate finale.

Deux contrôles Node supplémentaires réellement exécutés après cette modification :

1. Ancien export terrain 1.0.1 (`adapter_build: synthetic-adapter/1.0.0`), enveloppe historiquement valide, essayé dans une session candidate PAL-A LOADED : refus E_VERSION **avant mutation** ; état LOADED, génération et probes identiques à l’avant, aucune écriture système. Ce refus de compatibilité ne nie pas la validité cryptographique historique établie séparément par Q1.
2. Nouveau snapshot créé par la candidate après 1000 ms fictives : enveloppe et namespace portent `synthetic-adapter/1.0.2-candidate`. Après avancement supplémentaire, restauration en RAM avec reprise explicite : RUNNING, compteurs revenus à 1000 ms, PCM purgé à zéro, vitesse réancrée à null et une seule boucle fictive.

Ces deux vérifications passent. Elles ne prouvent aucune migration d’état, aucune émulation ou compatibilité moteur ; le fichier JSON terrain original reste intact.

Empreintes finales examinées pour cet addendum :
- `src/simulator.mjs` : `13bcda048782ad04e8fef1256716f9669acaa2b21d284164d096a85e59055ba5`
- `src/controller.mjs` : `a20e6bdbb9bd68a573a60e2dc1ef2eef0f6b1042a7cf6dac9f0f9b6f9ae015ed`
- `src/storage.mjs` : `64e41d2c67323335868d66efaa30625cf55c4420169d2fea973f03d646b84dae`
- `tests/revision.test.mjs` : `3a2bddb0c938225281669f79914e77ff4349679e634110891421feaf5af88c87`
