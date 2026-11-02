# Démos libres — Portables

Cette page propose quatre **homebrews** en téléchargement à la demande pour vérifier les quatre cœurs du lecteur web. Ces fichiers ne sont **pas** des ROMs commerciales et ne contiennent aucun BIOS. L'utilisateur peut toujours ouvrir ses fichiers personnels, lesquels ne sont pas envoyés au dépôt ou à Vercel.

Les ROMs des démos ne sont **pas enregistrées dans ce dépôt** : leur récupération s'effectue au clic directement depuis des URL officielles GitHub Raw, épinglées à des commits précis. Avant l'ouverture, le navigateur contrôle la taille et l'empreinte **Git blob SHA-1** (ce contrôle ne prouve pas le fonctionnement du jeu ni son absence de vulnérabilités).

| Console | Démo | Auteur / licence | Source | Taille | Git blob SHA-1 |
| --- | --- | --- | --- | ---: | --- |
| GB | Libbet and the Magic Floor | Damian Yerrick (pinobatch), **Zlib** | https://github.com/pinobatch/libbet ; binaire repris avec attribution de https://github.com/mxmgorin/oxgbc (commit \`7ef5a8aeeb6813dbf80963b96a39bd5220e63fdd\`) | 32768 | \`73ccbad40caa3abf83457fb7145a200438c1194b\` |
| GBC | Geometrix | Antonio Niño Díaz (AntonioND), **GPLv3** | https://github.com/AntonioND/geometrix ; binaire repris avec attribution de https://github.com/mxmgorin/oxgbc (même commit) | 32768 | \`b1d0241fcb28e950b460047e008defdcc217c417\` |
| GBA | @rkanoid, version modernisée | Ben Orozco, **MIT** | https://github.com/benoror/gbadev (commit \`b61cb1e8d6646789c833522a7d3d64adda27581a\`, fichier \`public/roms/@rkanoid MODERN - RECOMPILED.gba\`) | 183248 | \`33951fd6dfaedaad12763ad7fdd8dae418d5d8c3\` |
| DS | Pong-NDS | Chi-Iroh, **MIT** | https://github.com/Chi-Iroh/Pong-NDS (commit \`dfabbdde030b9fb2c72af968c98485dcde81855f\`, fichier \`Pong-NDS.nds\`) | 2472960 | \`dda8c65e7f4cd36f0c54cc70fedbdd04032ca203\` |

Les licences originales des auteurs restent applicables aux sources et aux binaires. L'interface Portables ne prétend pas modifier la licence des jeux.

## Tests à effectuer sur Chrome Android et Windows

1. Ouvrir chaque démo et vérifier que le moteur démarre et affiche une vraie image de jeu.
2. Vérifier commandes tactiles, son, performance et changement de jeu.
3. Pour GB, GBC, GBA et DS, contrôler toute sauvegarde annoncée après fermeture et rechargement avec une copie de sécurité.
4. Tester le chargement d'une ROM personnelle depuis l'appareil sans la transmettre à un serveur.

**Important :** HTTP 200 ou déploiement Vercel READY ne prouve pas le démarrage effectif des quatre ROMs. Un échec réseau GitHub, CORS ou moteur doit être signalé par la page et n'autorise pas l'ouverture d'un fichier non vérifié.
