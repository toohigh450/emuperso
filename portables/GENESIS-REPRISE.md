# EMUPERSO — reprise du chantier Sega Genesis / Mega Drive

Statut : intégration en **branche d'essais** `feature/genesis`, **non validée en jeu**.
Aucune modification volontaire de `main` ou de la production.
La PSP reste dans son chantier distinct. Sega 32X n'est pas incluse.

## Réception de Méo

- Console `genesis`, cœur EmulatorJS `segaMD` / Genesis Plus GX.
- Extensions `.md`, `.smd`, `.gen` et indice de console par chemin.
- Alias de cheats `Sega - Mega Drive - Genesis` et catalogue de 2 094 fichiers .cht annoncés.
- Correspondance cheat par titre/région : **à confirmer par l'utilisateur pour chaque ROM**, jamais considérer comme garantie.

## Correctifs GPT

- Le routeur reconnaît l'en-tête `SEGA` des ROMs Genesis brutes à l'offset `0x100`, y compris pour `.bin` ambigu, sans écrire dans la ROM. Une signature absente reste un **avertissement** pour les extensions connues, pas une fausse confirmation.
- Le moteur reçoit une vraie extension `.md`, `.smd` ou `.gen` et non `.genesis`. Une ROM `.bin` reconnue est transmise en `.md`.
- Les variantes patchées et traductions conservent le titre du fichier. Le titre interne de la cartouche est affiché séparément.
- Le coeur est identifié comme **Genesis Plus GX** plutôt que Gambatte.
- Plafond de lecture Genesis : 16 Mio, destiné à accepter davantage de hacks ; **ce plafond n'est pas une garantie de compatibilité**.
- Les fichiers `.32x` sont refusés avec explication. Genesis Plus GX n'émule pas la 32X : une éventuelle phase 32X demanderait un cœur distinct.
- Le sélecteur de console et les entrées `.md / .smd / .gen` sont visibles dans le lanceur. Le portail de cette branche comporte **neuf consoles**, PSP exclue car elle est encore en Preview sur `feature/psp`.
- La construction Vercel exclut les extensions binaires Genesis, les répertoires de ROMs usuels et les `.md` contenant des octets NUL ; les fichiers Markdown normaux restent accessibles.
- Tests synthétiques ajoutés à `portables/tests/genesis.test.mjs` et à la suite existante.

## Ce qui RESTE à tester

1. Vérifier `npm ci --ignore-scripts && npm run check && npm test` depuis `portables/` (CI Ubuntu / Windows).
2. Sur la Preview Vercel, choisir la carte **Genesis / Mega Drive**, puis ouvrir un homebrew autorisé. Aucun homebrew Genesis n'a encore été intégré.
3. Sur le PC de Karl, importer **une seule ROM personnelle** `.md`, `.gen` ou `.smd` et contrôler : image, son, commandes, redémarrage, 10 minutes de stabilité.
4. Répéter avec une ROM `.bin` à en-tête SEGA et une archive `.zip` contenant plusieurs versions ; le navigateur doit proposer la variante et ne pas tout extraire.
5. Vérifier les états et sauvegardes par empreinte ; exporter une sauvegarde avant les essais de cheats.
6. Importer un petit nombre de `.cht` correspondant à la ROM, confirmer l'association, activer **un seul code**, vérifier le résultat. Le catalogue présent sur GitHub **n'est pas encore automatiquement monté** dans l'interface du navigateur.
7. Tester manette Xbox sur Chrome Windows, puis commandes tactiles et manette Bluetooth sur Android dans le cadre du mandat Controller V2. Aucun de ces tests physiques n'a encore été effectué par GPT.
8. Retenir les fichiers `.7z` du HackSet pour une étape distincte : l'application les liste, mais **ne les décompresse pas** dans Chrome. Extraire localement une version précise avant de l'importer.
9. Vérifier l'attribution/licence des dépendances, dont le cœur Genesis Plus GX (licence non commerciale), avant toute revendication de redistribution libre.

## Protection du projet

- N'inclure aucune ROM commerciale, BIOS, sauvegarde privée ou archive HackSet dans GitHub/Vercel.
- Jamais d'activation automatique des cheats ni d'association forcée par simple nom.
- Ne pas déclarer « compatible », « jouable » ou « 60 FPS » à partir d'un seul test de démarrage.
- Pas de fusion de cette branche ni de modification de la production sans l'accord de Karl.

Références techniques : https://emulatorjs.org/docs4devs/cores/ et https://docs.libretro.com/library/genesis_plus_gx/
