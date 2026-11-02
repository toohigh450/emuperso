# Démos libres — Consoles Nintendo

Cette page propose quatre **homebrews** en téléchargement à la demande pour vérifier les quatre cœurs du lecteur web. Ces fichiers ne sont **pas** des ROMs commerciales et ne contiennent aucun BIOS. L'utilisateur peut toujours ouvrir ses fichiers personnels, lesquels ne sont pas envoyés au dépôt ou à Vercel.

Les ROMs des démos ne sont **pas enregistrées dans ce dépôt** : leur récupération s'effectue au clic directement depuis des URL officielles GitHub Raw, épinglées à des commits précis. Avant l'ouverture, le navigateur contrôle la taille et l'empreinte **Git blob SHA-1** (ce contrôle ne prouve pas le fonctionnement du jeu ni son absence de vulnérabilités).

| Console | Démo | Auteur / licence | Source | Taille | Git blob SHA-1 |
| --- | --- | --- | --- | ---: | --- |
| GB | Libbet and the Magic Floor | Damian Yerrick (pinobatch), **Zlib** | https://github.com/pinobatch/libbet ; binaire repris avec attribution de https://github.com/mxmgorin/oxgbc (commit \`7ef5a8aeeb6813dbf80963b96a39bd5220e63fdd\`) | 32768 | \`73ccbad40caa3abf83457fb7145a200438c1194b\` |
| GBC | Geometrix | Antonio Niño Díaz (AntonioND), **GPLv3** | https://github.com/AntonioND/geometrix ; binaire repris avec attribution de https://github.com/mxmgorin/oxgbc (même commit) | 32768 | \`b1d0241fcb28e950b460047e008defdcc217c417\` |
| GBA | @rkanoid, version modernisée | Ben Orozco, **MIT** | https://github.com/benoror/gbadev (commit \`b61cb1e8d6646789c833522a7d3d64adda27581a\`, fichier \`public/roms/@rkanoid MODERN - RECOMPILED.gba\`) | 183248 | \`33951fd6dfaedaad12763ad7fdd8dae418d5d8c3\` |
| DS | Pong-NDS (version compatible) | Chi-Iroh, **MIT** | https://github.com/Chi-Iroh/Pong-NDS (commit `80ff184546cc20cfd1a117f15ed8f4453b4db24b`, fichier `Pong-NDS.nds`) | 2447360 | `fc6583803f7763b0fda4fbfe69041c4a19983fca` |

Les licences originales des auteurs restent applicables aux sources et aux binaires. L'interface Portables ne prétend pas modifier la licence des jeux.

Correction du 2 novembre : l'ancienne sélection au commit `dfabbdde` affichait une image native blanche
avec DeSmuME 2015. L'auteur [documente l'incompatibilité de libnds 2.0 avec les émulateurs](https://github.com/Chi-Iroh/Pong-NDS#libnds-20).
La sélection revient au binaire du 10 juillet 2024 : image native non uniforme vérifiée avec DeSmuME 2015.
Le changement concerne uniquement la démo libre ; aucun cœur ni espace de sauvegarde personnel n'est migré.

## Tests à effectuer sur Chrome Android et Windows

1. Ouvrir chaque démo et vérifier que le moteur démarre et affiche une vraie image de jeu.
2. Vérifier commandes tactiles, son, performance et changement de jeu.
3. Pour GB, GBC, GBA et DS, contrôler toute sauvegarde annoncée après fermeture et rechargement avec une copie de sécurité.
4. Tester le chargement d'une ROM personnelle depuis l'appareil sans la transmettre à un serveur.

**Important :** HTTP 200 ou déploiement Vercel READY ne prouve pas le démarrage effectif des quatre ROMs. Un échec réseau GitHub, CORS ou moteur doit être signalé par la page et n'autorise pas l'ouverture d'un fichier non vérifié.

## NES et SNES (0.3.0) — hébergées avec le site

Contrairement aux quatre démos ci-dessus, les homebrews NES et SNES sont **copiées dans `demos/`** et servies par le site lui-même (pas de dépendance à un serveur tiers, pas de CORS). Le navigateur contrôle la taille et le **SHA-256** avant de passer la ROM au lanceur. Les textes de licence complets sont dans `demos/`.

| Console | Démo | Auteur / licence | Source | Taille | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| NES | openNES Snake 1.0.9 | Sebastian Dine, **zlib** (`demos/LICENSE-openNES-Snake-zlib.txt`) | https://github.com/sebastiandine/openNES-Snake, release `v1.0.9`, fichier `openNES-Snake-1.0.9.nes` | 24592 | `71792a9b4e4db52fb60df4633400301fac8f244f802b88d336b58e079c75acc7` |
| SNES | Neon Breaker (exemple « breakout ») | OpenSNES Contributors et Alekmaul (PVSnesLib), **MIT** (`demos/LICENSE-opensnes-MIT.txt`) | https://github.com/k0b3n4irb/opensnes, release `v0.54.0`, archive `opensnes-examples_v0.54.0.zip`, `examples/bin/breakout.sfc` | 262144 | `ea5c46832f7a1c71c00c1dc2f92b34da19477ca97bd5a993971fa2b6df2a05ec` |
| SNES | Shmup | idem, **MIT** | même archive, `examples/bin/shmup.sfc` | 262144 | `772da03b812a29298969c6cbdb2ce7e268b4adea95ba0c9bfc1f44d98eab0861` |
| SNES (SA-1) | Étoiles | idem, **MIT** | même archive, `examples/bin/sa1_starfield.sfc` | 262144 | `16e47092f08bfa9bdc21b75325852e33a64f1ff85076c595628e6171439c1169` |
| SNES (DSP-1) | Sol | idem, **MIT** | même archive, `examples/bin/dsp1_ground.sfc` | 262144 | `b9eb22c0bbcd5ad0448048377ad893ffd9f90cf4fa7df9646ecc60d2f220c753` |

La licence zlib de Snake et la licence MIT d'OpenSNES autorisent la redistribution à condition de garder leur notice : les deux textes sont publiés à côté des ROMs. Les deux démos « puces » servent à vérifier que Snes9x fait tourner SA-1 et DSP-1 dans Chrome ; ce ne sont pas des jeux complets. L'exemple Super FX d'OpenSNES (`superfx_3d.sfc`) a été écarté : son propre README indique que Snes9x ne détecte pas son GSU (« GSU: NOT DETECTED ») ; le publier aurait affiché une fausse preuve. Aucune autre démo Super FX libre n'a été trouvée.

Vérifié le 2026-11-01 : les cinq ROMs démarrent avec les vrais cœurs FCEUmm et Snes9x dans Chrome Windows (voir TESTS-NES-SNES.md). Non vérifié sur un vrai téléphone Android.
