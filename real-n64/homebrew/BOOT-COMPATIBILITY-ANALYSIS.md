# Analyse du premier échec de boot réel — 31 octobre 2026

Périmètre : lecture des journaux et du code public, aucune ROM modifiée dans cette analyse.
Le build MIT/libdragon natif a produit la ROM dbc...e727 ; compiler n’a pas démontré
que le couple cœur/boot libdragon l’exécute correctement.

## Constats de l’essai

`../evidence/probe-legacy.txt` relève : cœur réel Mupen64Plus-Next, ROM .z64 reconnue,
8 MiB configurés, interpréteur avec cache, puis :

- `IPL3 detected 64 MB of RDRAM != 8 MB` ;
- échec malloc d’un bloc d’interpréteur ;
- erreur Wasm `table index is out of bounds`, sans progression vidéo attestée.

Le callback de lancement et la création des contextes audio/WebGL ne sont donc pas
une preuve de boot de la démo.

## Le message « 64 MB » ne prouve pas la RAM réellement détectée par libdragon

Le code `rdram.c` du fork EmulatorJS, référence documentaire
`4a3925d2861f17719586dffb178c1dd5339d3a68`, lit le registre CPU numéro 20 (`$s4`)
lors d’une écriture broadcast de MODE. Cette convention supposée est celle du
boot Nintendo historique. Le IPL3 libdragon ne promet pas de conserver sa taille
RAM dans ce registre. Ce warning peut donc être du bruit, sans établir un problème
64 MiB dans la ROM. Ce n’est pas une cause démontrée de l’échec observé.

## Problèmes de modèle RDRAM plausibles et précis

Une contribution publique tierce, non validée dans ce chantier,
`atyr647/Pak` commit `1f498e8a113acd3dc6942496cabed1c34d2e0c7b`, fichier
`tools/mupen/rdram-libdragon-compat.patch`, documente deux corrections pour
mupen64plus-core 2.5.9 et un IPL3 libdragon :

1. `idfield_value()` récupère des bits d’identifiant par `>>16` au lieu de `>>8`
   dans le mot byte-swappé, empêchant de retrouver certains IDs élevés que libdragon
   utilise pendant le probing ;
2. la corruption temporaire des lectures pendant calibration current-control se
   termine à tort sur tout MODE broadcast, alors que libdragon active les modules
   avant la calibration. Le patch se fonde sur le vrai bit MANUAL/AUTO du MODE.

Les deux motifs sont présents dans la référence de source EmulatorJS inspectée.
Cela ne prouve pas encore que le binaire téléchargé correspond exactement à cette
révision, ni que ce patch suffit pour le boot dans le Web. Conserver cette séparation.

L’échec cached-interpreter se produit dans `cached_interp_init_block()` après
`malloc(get_block_memsize(b))`. Le chemin source lu journalise puis retourne sans
bloc d’instructions valide ; une continuation ultérieure peut expliquer un trap,
mais la pile Wasm actuelle ne donne pas une symbolisation permettant de l’affirmer.
Passer au pure interpreter est un test discriminant raisonnable pour écarter cette
allocation de cache, sans garantir la correction du modèle RDRAM sous-jacent.

## Choix possibles, à tester séparément

- Préférer un binaire de cœur plus récent avec provenance figée et modèle RDRAM corrigé,
  si disponible et compatible avec l’interface choisie.
- Compiler un cœur corrigé après revue du patch et de sa licence, puis exécuter la même ROM.
- À défaut, un IPL3 expérimental open source ciblé sur l’état RAM 8 MiB préparé par
  cet émulateur pourrait éviter la calibration RDRAM non compatible. Ce serait une
  ROM réellement exécutée, mais un bootstrap spécifique émulateur, à identifier
  distinctement et à ne pas déclarer compatible matériel N64 général. Aucune telle
  modification n’a été appliquée par cette analyse.

Ne pas remplacer le boot par du code commercial. Ne pas annoncer que le warning
64 MiB est la cause, ni que le fallback pure interpreter répare le jeu sans résultat.

## Références

- https://github.com/EmulatorJS/mupen64plus-libretro-nx/blob/4a3925d2861f17719586dffb178c1dd5339d3a68/mupen64plus-core/src/device/rdram/rdram.c
- https://github.com/libretro/mupen64plus-libretro-nx/blob/15bada85906593376e8fd697f1b0b3af3a20f512/mupen64plus-core/src/device/r4300/cached_interp.c
- https://github.com/atyr647/Pak/blob/1f498e8a113acd3dc6942496cabed1c34d2e0c7b/tools/mupen/rdram-libdragon-compat.patch
- SDK boot local figé : `../cache/libdragon/boot/ipl3.c`, `rdram.c`, `README.md`.
