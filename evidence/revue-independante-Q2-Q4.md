# Revue indépendante Q2–Q4 — sous-agent Codex

Périmètre : référence synthétique Phase 1A 1.0.1 reçue dans la transmission du 28 octobre 2026 ; revue et exécution Node locale sur les modules de la copie candidate avant modifications. Aucun moteur, ROM, sauvegarde originale, navigateur ou réseau. Aucun fichier produit ou référence modifié par cette revue ; seul ce relevé est écrit. Ces essais sont distincts du protocole terrain de Karl et des tests annoncés par GPT/Méo.

## Q2 — identité et historique : RÉUSSI avec limite d’attribution

- Lecture du diagnostic terrain : échecs `command.failed` E_IDENTITY aux séquences 8, 15 et 22, générations 2, 4 et 6 ; aucun `identity.loaded` ni `identity.launched_simulated` pour ces générations.
- Reproduction exécutée : un contrôleur avec `adapterFactory: () => new SimulationAdapter({dishonestLoadedHash:true})`, sélection NTSC-A, trois initialise/sélectionne/charge. Trois rejets E_IDENTITY, exactement aux couples `[8,2]`, `[15,4]`, `[22,6]` ; état ERROR, adaptateur détruit, identités chargée/lancée nulles, aucun lancement simulé. La fixture NTSC-A déterministe correspond au hash sélectionné dans le JSON.
- Le contrôle de `load()` intervient avant l’affectation de `loadedHash` : `simulated === true` et égalité du hash confirmé avec la fixture choisie. Le défaut `dishonestLoadedHash` substitue 64 zéros au hash d’acquittement. La protection fonctionne.
- Lacune confirmée par lecture des 67 événements : le mode d’injection actif n’est pas journalisé. Ces JSON seuls ne prouvent donc pas que l’option était activée sur le PC de Karl ; ils sont compatibles avec ce scénario mais ne distinguent pas une injection d’un autre adaptateur défaillant. Ajouter un événement d’armement/configuration dans une future candidate est justifié, sans réécrire le journal terrain historique.

## Q3 — seuil, fenêtre et pauses : RÉUSSI pour le modèle, pas mesure N64

`SimulationAdapter.probe()` calcule `(core.emulated_ms - anchor.emulated_ms) / (virtualWall - anchor.wall_ms)`. Unités : millisecondes fictives, entiers positifs limités à 10 000 par step. La fenêtre est cumulative depuis le dernier `start()`, `resume()` ou `rebuildHost()`, et non automatiquement le dernier step. Pas de temps réel utilisé pour le ratio.

Le contrôleur déclenche E_CLOCK_DRIFT si `speed > 1.05 || speed < 0.95`, bornes incluses dans la plage acceptée. Priorité des gardes : boucles, audio, dérive, sous-remplissage PCM. Une valeur lente à 0,95 pourrait aussi produire un sous-remplissage PCM si consommation activée ; les essais de frontières désactivent volontairement la consommation afin d’isoler le garde d’horloge.

Essais Node réellement exécutés, wall_ms=1000, consume_pcm=false :

| emulated_ms | ratio | résultat |
|---|---|---|
| 949 | 0,949 | PAUSED, E_CLOCK_DRIFT |
| 950 | 0,950 | RUNNING, aucune erreur |
| 951 | 0,951 | RUNNING, aucune erreur |
| 1049 | 1,049 | RUNNING, aucune erreur |
| 1050 | 1,050 | RUNNING, aucune erreur |
| 1051 | 1,051 | PAUSED, E_CLOCK_DRIFT |

Entrées wall_ms `0`, `-1`, `1.5`, `NaN`, `Infinity`, `10001` et chaîne `'1000'` : toutes refusées E_CLOCK ; le contrôleur invalide conservativement l’instance en ERROR parce que l’appel adaptateur a déjà été engagé ; aucune boucle active ni adaptateur conservé. La validation adaptateur précède l’incrément des compteurs.

Essai fenêtre cumulative : step 1000/1000 puis 1100/1000 => ratio 2100/2000=1,05, accepté malgré le dernier delta à 1,1. Pause/reprise => speed=null puis step normal => speed=1. Les compteurs totaux restent conservés lors du réancrage.

### Comparaison des séquences terrain 35 et 58

| séquence | totaux mural/émulé | fenêtre mural/émulé | ratio réellement testé |
|---|---|---|---|
| 35 | 1000 / 1800 ms | 1000 / 1800 ms | 1,8 |
| 58 | 3000 / 4600 ms | 1000 / 1800 ms | 1,8 |

À la séquence 58, 4600/3000 serait une mauvaise reconstruction de la logique : les reprises ont réancré la fenêtre. Le garde est correct pour les deux fenêtres fictives. Les probes incluses dans `guard.paused` sont capturées **avant** l’appel pause, expliquant `simulated_loops:1` dans l’événement ; l’état devient ensuite PAUSED avec zéro boucle. Aucun lancement ni vitesse N64 ne s’en déduit.

### Défaut supplémentaire reproduit : sous-remplissage persistant après reprise

Baseline 1.0.1 : `advance({produce_pcm:false})` met en pause sur E_PCM_UNDERRUN et `simulated_underruns=1` ; `resume()` réancre mais ne remet pas ce compteur à zéro ; `advance()` normal laisse le compteur cumulatif à 1 et le contrôleur repause encore E_PCM_UNDERRUN, même sans nouvelle pénurie. La garde compare `>0` sur un total de session. Reproduit réellement dans Node.

Recommandation minimale : distinguer compteur historique cumulé et nouvelles pénuries depuis la reprise/dernière observation, ou documenter explicitement une remise à zéro de fenêtre. Préférer conserver le compteur historique et comparer une nouvelle hausse afin de ne pas perdre la preuve. Ajouter un test « sous-remplissage → reprise → step normal reste RUNNING », plus un deuxième sous-remplissage effectivement détecté. Cette revue ne modifie pas le produit.

## Q4 — restaurations synthétiques : RÉUSSI

Quatre scénarios supplémentaires réellement exécutés via l’API, sur fixtures locales :

1. Normale : snapshot après une seconde fictive, avancement supplémentaire, restore avec resume=true => RUNNING, PCM purgé à 0, speed=null, une seule boucle, compteurs restaurés.
2. Payload corrompu : incrément d’un compteur sans rehash => E_INTEGRITY avant mutation, état/génération conservés et une boucle RUNNING maintenue.
3. Identité incompatible : hash fixture remplacé par 64 `a`, enveloppe recalculée correctement => E_VERSION avant mutation, RUNNING conservé. Ce test distingue le refus de compatibilité d’un simple échec d’empreinte.
4. Échec injecté `rebuildHost` après mutation et avant reprise : E_ADAPTER, ERROR, génération augmentée, adaptateur supprimé/détruit, zéro boucle et launched_sha256=null. Aucun succès ni reprise annoncé, aucun rollback prétendu.

Les opérations utilisent MemoryStore sans API de fichier ; aucune écriture d’un projet extérieur n’est possible dans ces chemins examinés. Cette propriété n’est pas une preuve de sandbox contre du JavaScript tiers hostile : la factory est un point de test de confiance, comme le décrit le projet.

Aucune restauration n’est attestée par les deux JSON Windows reçus ; les scénarios ci-dessus sont des tests de laboratoire Codex dans Node, pas une reconstitution d’action de Karl ni une validation Windows.

## Sources de code 1.0.1 et limites

Empreintes extraites de l’archive de référence (non modifiée) :
- `src/controller.mjs` : `31483aa950fe2c967fdbf0790cc185ebd445fbaea2c610da278d537ff9346f8c`
- `src/simulator.mjs` : `da014a9fd56654a185a17f288002e165fa120fbd0c89b5f302729091ad59c54c`
- `src/ui.mjs` : `b6bf91bcd948dd06ec19cfcd44b706baa7f5d954abe035e656ff592fb3d8a75a`

Références de preuve : `references/transmission/02_PREUVES/N64Lab-diagnostic-SIMULATION.json`, `N64Lab-SYNTHETIC.lab-snapshot.json`, `src/controller.mjs` (load, advance, restoreSnapshot), `src/simulator.mjs` (step, probe, reanchor, resume). Les scripts Node de revue ont été exécutés via stdin ; leurs assertions s’arrêtent à la première divergence. Les nouveaux tests de non-régression de la candidate sont à fournir et rejouer par l’agent principal avant livraison. Aucun résultat de navigateur n’est certifié par cette revue.
