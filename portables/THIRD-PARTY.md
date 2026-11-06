# Provenance et droits — 0.2.1 alpha

Aucun moteur, cœur binaire, BIOS matériel, ROM commerciale ou catalogue de codes n'est embarqué par ce correctif. Les petites archives de tests proviennent du projet initial et contiennent des données synthétiques.

## EmulatorJS

- Distribution ciblée : 4.2.3, https://cdn.emulatorjs.org/4.2.3/data/.
- Tag amont : `v4.2.3`, commit `e150dc0491ae747028919fb82d6598954976ede6`.
- Source : https://github.com/EmulatorJS/EmulatorJS/tree/e150dc0491ae747028919fb82d6598954976ede6.
- Le fichier LICENSE de cette révision a été consulté : GNU General Public License, version 3. Voir https://github.com/EmulatorJS/EmulatorJS/blob/e150dc0491ae747028919fb82d6598954976ede6/LICENSE.
- `emulatorjs/engine-lock.json` contient les SHA-256 observés de trois fichiers frontend et l'empreinte attendue de l'archive de release rapportée par GitHub. Cette liste n'est pas un inventaire exhaustif de distribution.

Le code chargé dans l'iframe a accès aux fichiers qu'on lui transmet et, avec l'origine commune, potentiellement au parent et au stockage du navigateur. La page lit les ROMs localement et ne programme pas de téléversement de ROM ; elle ne peut pas garantir le comportement futur d'un fournisseur distant. Le CDN et les autres sous-ressources restent une dépendance de confiance. Le mode local complet est préférable pour réduire cette dépendance, après vérification et essai hors ligne.

## Cœurs

Gambatte, mGBA, DeSmuME, DeSmuME 2015 et melonDS ont chacun des sources et des obligations distinctes. La licence du frontend ne suffit pas à conclure sur les droits de redistribution de leurs binaires. Les révisions exactes de tous les cœurs et leurs notices doivent encore être inventoriées depuis une distribution complète vérifiée avant toute redistribution publique du moteur. Aucun droit universel de redistribution n'est affirmé ici.

## GameCube (expérimental)

- Moteur : Gecko (`ioncodes/gecko`), commit `39e82205a0da154f23fd36b95e64a8029d468618`, **GPL-3.0**, compilé en WebAssembly/WebGPU. Sortie vendored dans `gamecube/` (`web.js`, `web_bg.wasm`, `*.d.ts`) ; source correspondante = amont épinglé + `gamecube/gecko-web-disc.patch` (voir `gamecube/SOURCE.md`). Licence du patch/projet de référence : `gamecube/LICENSE-CubeDeck-GPL-3.0.txt`.
- Démonstration : Swiss r2073 (`demos/swiss_r2073.dol`), homebrew **GPL-3.0**, licence dans `demos/swiss_r2073.LICENSE.txt`, provenance dans `demos/NOTICE.md`.
- Limites : build interprété (pas de JIT), WebGPU requis, sans audio, sans états de sauvegarde, un seul boot par iframe. Les jeux commerciaux ne sont ni fournis ni téléchargés ; l'import reste local.

## Code du projet

Aucune licence générale du code original n'est choisie à la place de Karl. Une décision de licence reste à prendre avant une diffusion publique plus large.

## Outils de test et CI

L'application n'a aucune dépendance npm. Le lockfile fixe cette configuration ; Playwright et Chromium sont utilisés séparément pour les vérifications locales. Le workflow exécute uniquement la syntaxe et les tests de logique ; il ne valide pas l'émulation. Les actions checkout et setup-node sont référencées par commits résolus depuis leurs tags v4 au moment de la correction.

## NES et SNES (0.3.0)

### Cœurs chargés depuis le CDN EmulatorJS 4.2.3 (non redistribués par ce dépôt)

- **FCEUmm** (NES) : `cores/fceumm-wasm.data`, construit le 2025-06-14 (rapport `cores/reports/fceumm.json`). Sources : https://github.com/libretro/libretro-fceumm. Licence : **GPL-2.0**.
- **Snes9x** (SNES) : `cores/snes9x-wasm.data`, construit le 2025-06-14 (rapport `cores/reports/snes9x.json`). Sources : https://github.com/libretro/snes9x. Licence : **licence Snes9x, usage non commercial** (ce n'est pas une licence libre au sens OSI). Toute exploitation commerciale du site est incompatible avec ce cœur.
- Comportement vérifié dans les sources des cœurs (`retro_cheat_set`) : FCEUmm, mGBA et DeSmuME 2015 ignorent l'état « désactivé » d'un code. Le lanceur n'envoie donc au moteur que les codes cochés, après remise à zéro (voir COMPATIBILITE-NES-SNES.md).

### Homebrews de démonstration hébergés dans `demos/`

- openNES Snake 1.0.9 — Sebastian Dine — licence zlib — texte complet : `demos/LICENSE-openNES-Snake-zlib.txt`.
- Exemples OpenSNES v0.54.0 (breakout, shmup, sa1_starfield, dsp1_ground) — OpenSNES Contributors, Alekmaul (PVSnesLib) — licence MIT — texte complet : `demos/LICENSE-opensnes-MIT.txt`.

### ROM d'essai

`tests/test-roms.mjs` fabrique deux petites ROM (NES et SNES) écrites pour ce projet : fond de couleur unie et compteur de démarrages. Elles servent uniquement aux tests et ne sont pas publiées.
