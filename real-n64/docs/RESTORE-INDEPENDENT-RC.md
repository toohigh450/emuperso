# Revue indépendante du chargement — préparation RC

Cette revue porte sur la v0.4.0 du dépôt, pas sur le PC Windows de Karl. Le symptôme
terrain reçu est un bouton de chargement qui reste bloqué sans résultat. La cause
exacte sur cet appareil nécessite son diagnostic ; une injection de panne contrôlée
ne suffit pas à l'établir.

## Défauts démontrables dans le code v0.4.0

- `engine-session.mjs::pause` attend `AudioContext.suspend()` sans limite. Un appel
  Web Audio qui reste en attente retient aussi `SessionController.start`, puis le
  verrou `busy` de l'interface. Il manque un délai et une erreur d'étape lisible.
- `loadState` ne possède aucun accusé de désérialisation native : il vérifie l'en-tête,
  appelle le chargeur, puis observe les frames pendant 450 ms. Une boucle qui avance
  ne prouve pas que la mémoire du point enregistré a été restaurée.
- La limite de 90 frames est appliquée à une attente nominale de 450 ms, sans mesurer
  l'intervalle réellement écoulé. Elle n'est pas une mesure de vitesse émulée N64.
- L'identité de la session candidate est recalculée selon WebGL2/legacy, mais elle
  n'est pas comparée explicitement à celle du point chargé avant l'appel natif.
- `startPrepared` écrit la sauvegarde native de l'ancienne session avant de connaître
  le résultat du chargement. Une tentative échouée peut donc déjà modifier la
  sauvegarde native courante ou son historique. Cela doit être distingué d'une
  corruption du save state, dont le coffre reste séparé.

## Source officielle consultée

Ces révisions servent à comprendre le format et les API. Elles ne constituent pas
une preuve de correspondance exacte avec le binaire WASM précompilé figé.

- RetroArch d'EmulatorJS, révision
  `12076775af6db24b7bfb808a3ced3a760adeab63` :
  [retroarch.c](https://github.com/EmulatorJS/RetroArch/blob/12076775af6db24b7bfb808a3ced3a760adeab63/retroarch.c).
  `load_state(path, rv)` appelle `content_load_state(...)` puis retourne simplement
  `rv`. `get_current_frame_count()` retourne un compteur de boucles du frontend
  Emscripten ; ce n'est pas le compteur VI restauré de la console.
- [tasks/task_save.c](https://github.com/EmulatorJS/RetroArch/blob/12076775af6db24b7bfb808a3ced3a760adeab63/tasks/task_save.c) :
  `content_load_state` crée une tâche. `content_load_state_cb` lit son résultat et
  appelle `content_deserialize_state`. Le marqueur `RASTATE` contient des blocs
  alignés, dont `MEM ` et `END ` ; les versions doivent être contrôlées.
- Mupen64Plus d'EmulatorJS, révision
  `4a3925d2861f17719586dffb178c1dd5339d3a68` :
  [savestates.c](https://github.com/EmulatorJS/mupen64plus-libretro-nx/blob/4a3925d2861f17719586dffb178c1dd5339d3a68/mupen64plus-core/src/main/savestates.c).
  L'en-tête `M64+SAVE` de la version 1.9 fait 44 octets. Avant la copie RDRAM,
  le parseur consomme 86 registres de 4 octets et 56 octets de remplissage :
  44 + 344 + 56 = 444 octets dans le bloc du cœur. Avec `MEM ` placé à l'offset 16,
  la RAM commence à 460, ce qui concorde avec la sonde indépendante de notre démo.
- [libretro.c](https://github.com/EmulatorJS/mupen64plus-libretro-nx/blob/4a3925d2861f17719586dffb178c1dd5339d3a68/libretro/libretro.c)
  attend `retro_savestate_complete` dans `retro_unserialize`, puis retourne `true`
  sans consulter `retro_savestate_result`. Même un booléen de désérialisation ne
  dispense donc pas d'observer la mémoire réellement restaurée sur ce chemin.

Le JavaScript compilé local `cache/core-probe/mupen64plus_next_libretro.js` expose
`_load_state` et `_save_state_info`, mais n'expose pas de noms
`retro_unserialize` ou `retro_get_memory_data`. Les sorties `print` / `printErr`
sont capturées au démarrage du Module : changer seulement ces propriétés après le
chargement ne garantit pas leur interception.
Le frontend figé transmet cependant ses deux callbacks vers `console.log` lorsque
le mode debug est actif. Un observateur installé dans l'iframe avant le démarrage
peut enregistrer ces messages sans modifier les fichiers tiers.

Le Module expose aussi `EmscriptenSendCommand` et `EmscriptenReceiveCommandReply`.
Cela ne fournit pas d'accusé de chargement achevé : la commande `LOAD_STATE_SLOT`
répond après la mise en file de la tâche. `READ_CORE_MEMORY` exige une carte mémoire
dont la disponibilité n'est pas démontrée pour le cœur figé ; le source Mupen
consulté n'installe pas `SET_MEMORY_MAPS`. Ces pistes exigent une sonde réelle avant
usage et ne constituent pas une intégration vérifiée.

## Banc de preuve prévu

`tests/probe_restore_rc.py --baseline` charge les adaptateurs de la révision
immuable v0.4.0 `029845b800a61eeee60915363c16c0b218e6e39e` par routage du navigateur,
avec le vrai cœur et exclusivement la ROM MIT du dépôt.

1. Le marqueur RAM passe de `0x1357` au point enregistré à `0x2468`, puis le
   chargement valide doit rétablir `0x1357`.
2. Le vrai chargeur natif est appelé, puis son fichier MEMFS temporaire est retiré
   avant le traitement de la tâche. Le retour natif et le compteur de frames ne
   sont pas simulés. Le banc observe l'erreur native et le contenu RAM réel.
3. L'AudioContext de la session réelle reçoit une méthode `suspend` qui retourne
   volontairement une promesse non résolue. C'est une injection représentant un
   appel Web Audio bloqué, pas une preuve que Windows présente cette panne précise.
   Le banc observe le bouton encore désactivé après 3 secondes sur la baseline.

Sans `--baseline`, les mêmes injections doivent être rejetées ou bornées par la
candidate. Les résultats effectifs sont écrits séparément dans
`evidence/probe-restore-baseline.json` et `evidence/probe-restore-rc.json`.
Ce document décrit le protocole ; il ne transforme pas une exécution non réalisée
en réussite.

## Critère d'attestation recommandé

Le retour `0` et les frames ne suffisent pas. La candidate doit intercepter les
erreurs natives dès l'initialisation et contrôler une transition réelle des données
restaurées. Des témoins différentiels entre RAM attendue et RAM de démarrage peuvent
être comparés à des captures natives fraîches, sans écrire de nonce dans une ROM
utilisateur. Si aucun témoin fiable n'est disponible, le résultat doit rester
« restauration non confirmée » et conserver l'ancienne session ainsi que le coffre.
Les limites de cette attestation et les tests de progression visible restent à
consigner pour les auditeurs.

## Module de lecture et d'attestation ajouté pour la candidate

`native-state.mjs` fournit trois fonctions synchrones :

- `inspectNativeState(bytes)` vérifie le conteneur RASTATE1, au maximum 64 blocs
  bornés et alignés, un unique bloc MEM, un END terminal, le marqueur M64+SAVE,
  sa version 1.9, sa taille observée de 16 793 412 octets et son identité MD5 interne.
  Il retourne une vue RDRAM sans la modifier. Des blocs d'extension imprimables
  restent permis ; les octets de remplissage ne sont pas présumés nuls.
- `makeRestoreWitness(expected, beforeA, beforeB)` exige les mêmes identités
  internes, puis sélectionne au maximum 128 ancres de 32 octets, à raison d'une
  par page de 4 Kio et réparties dans la RAM. Elles doivent être identiques entre
  les deux captures de démarrage et différentes du point attendu. Les octets
  attendus sont copiés et conservés dans une WeakMap privée ; les métadonnées
  du témoin ne contiennent pas ces octets.
- `compareRestoreWitness(witness, observed)` exige au moins 90 % d'ancres entièrement
  identiques au point attendu et au moins une ancre « forte », terme limité ici à
  deux octets ou plus différents du démarrage. Ce seuil prouve une transition de
  données sélectionnées ; il ne certifie pas chaque octet ni l'état CPU/RSP/RDP.

S'il n'existe aucun témoin suffisamment distinct, la création échoue. Une RAM déjà
exactement identique dans les deux captures est traitée à part : la comparaison
suivante contrôle alors les 8 Mio entiers et retourne `equivalent`, avec
`verified: false` et `restored: false`. Ce cas ne doit jamais être présenté comme
une transition de chargement prouvée. Le module ne peut pas vérifier lui-même
que les deux captures de démarrage ont été prises indépendamment à deux instants.

`node tests/native-state.test.mjs` : **8 tests RÉUSSIS**. Les fixtures sont des
conteneurs synthétiques, sans ROM ni sauvegarde originale. Les essais couvrent
également les vues provenant d'un autre realm, les offsets, la limite réelle de
64 Mio, la conservation des témoins après mutation de la source et la distinction
entre équivalence et restauration.
