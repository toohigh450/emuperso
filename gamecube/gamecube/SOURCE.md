# Source correspondante — Gecko GameCube web

Les fichiers de ce dossier sont un artefact compilé, pas une réécriture :

- Moteur amont : `ioncodes/gecko`, commit épinglé `39e82205a0da154f23fd36b95e64a8029d468618`, licence GPL-3.0.
- Correctif de construction : `gecko-web-disc.patch` (depuis `yerry262/gamecube-web`, licence GPL-3.0 ; copie dans `LICENSE-CubeDeck-GPL-3.0.txt`). Il ajoute le boot ISO/ZIP/RVZ par `image::load_dvd` + `GameCube::with_ipl_hle`, la mémoire carte slot A de 2 Mio adossée à un stockage mémoire WASM, `set_pad_state`, `get_perf`, `memcard_version` et `get_memcard`.
- Sortie `wasm-pack --target web` : `web.js`, `web_bg.wasm`, `web.d.ts`, `web_bg.wasm.d.ts`.
- `web_bg.wasm` n'est pas modifié à la main dans le code : après la sortie `wasm-pack`, `raise-memory-max.mjs` relève le plafond de la mémoire linéaire de 512 Mio à 65536 pages (4 Gio). Le build épinglé plafonne à 512 Mio, ce qui refuse toute image disque GameCube dès la copie vers WASM (`unreachable` dans `passArray8ToWasm0`). Reconstruction : appliquer `gecko-web-disc.patch` au commit épinglé, `wasm-pack build crates/web --target web --out-dir pkg --release`, puis `node raise-memory-max.mjs pkg/web_bg.wasm web_bg.wasm 65536`.
- Démonstration : `../demos/swiss_r2073.dol` (Swiss, homebrew GPL-3.0, voir `../demos/swiss_r2073.LICENSE.txt` et `../demos/NOTICE.md`).

Limites connues du build web Gecko : interpréteur uniquement (pas de JIT Cranelift dans le navigateur), WebGPU requis, aucun audio, pas d'états de sauvegarde, un seul boot par iframe (pas de redémarrage à chaud). Le plafond mémoire relevé ne garantit pas la vitesse : les images disque observées démarraient autour de 16–23 % de la vitesse native sur la machine de test.

Mesures terrain (2026-11-07, test automatisé Chromium+WebGPU) : FFCC `.zip/.rvz` boote (« Jeu lancé »), ~10 i/s ≈ 16 % du natif pendant ~5 min, puis dégradation vers ~1 % — écran toujours noir après 9 min. Pokémon XD `.zip/.rvz` (~985 Mo) idem : moteur actif, aucune image visible en 10 min. Conclusion honnête : l'émulation tourne réellement mais les intros de jeux commerciaux mettent un temps très long à cette vitesse ; l'ALPHA prouve le boot, pas encore le jeu.
