# Démo homebrew — provenance et périmètre

Source reprise sans modifier l’original : `demo-n64/main.c`, `Makefile`, `LICENSE`
dans `toohigh450/emuperso`, branche `emulateur-reel`, commit
`1219ecfeb51a43011c050b0113aa01dd5249ed9e`.

La licence explicite de la démo est MIT, copyright Karl (toohigh450), 2026 ; le
texte reçu est conservé dans ce dossier. Le commentaire initial attribue sa rédaction
à Claude et indiquait que la source n’avait pas encore été compilée.

Le SDK libdragon est un projet public `DragonMinded/libdragon`. Sa licence principale
`LICENSE.md` est Unlicense et permet explicitement l’utilisation et la redistribution
de binaires. Cette licence principale ne suffit pas, à elle seule, à identifier toutes
les licences des composants réellement liés (libc/newlib, libgcc, IPL3). Les notices
réellement relevées pendant le build doivent accompagner le rapport avant une
redistribution publique de la ROM.

Le build est limité à une copie autonome dans ce nouveau dossier. Aucun code Conker,
TN-1, Lab 1.0.2-candidate, fichier d’état ou sauvegarde originale n’est utilisé.

## Méthode reproductible

La route réellement exécutée est native Linux x86_64 : paquet officiel de toolchain
libdragon vérifié SHA-256 puis SDK compilé à une révision Git précise, dans le cache
local du chantier. `toolchain-lock.json` contient URL, SHA du paquet et commit SDK.
`setup-toolchain.py` automatise cette préparation sans installation système privilégiée.
Son scénario complet n’a pas été exécuté par le sous-agent ; les commandes réelles de
préparation et compilation sont consignées par Codex dans les preuves du chantier.

`build.sh` utilise `N64_INST` si défini et lance `make all` dans ce dossier uniquement.
L’appel explicite à `all` évite qu’un objectif du fichier inclus `n64.mk` devienne
accidentellement la cible par défaut. La compilation n’a nécessité aucune correction
du C ou du Makefile reçus.

Une route Docker optionnelle reste disponible uniquement avec une image figée par
`@sha256` dans `libdragon-image.txt`, mais elle n’a pas été validée : le registre officiel
a refusé le pull dans l’environnement. Ne pas présenter ce fallback comme testé.

Le build natif réel produit une ROM big-endian `.z64` de 147 456 octets, magie
`80 37 12 40`, SHA-256
`dbcac8bbc7922f21844a298544cb65d26a1b33874be2f9652ebacee4f5c8e727`.
Le fichier `build-info.json` porte les métadonnées réellement relevées par Codex ;
le démarrage navigateur est une étape distincte, non déduite de la compilation.

## Audio de la source reçue

La source demande un échantillonnage nominal à 44 100 Hz et calcule la demi-période
entière `44100/(440*2)=50` échantillons. L’onde carrée obtenue est donc nominalement
441 Hz, non exactement 440 Hz ; le taux audio réellement obtenu dépend aussi de la
configuration SDK/hôte. Le texte de la démo conserve la demande initiale de 440 Hz ;
ce détail ne doit pas être présenté comme une mesure sonore réellement validée.
