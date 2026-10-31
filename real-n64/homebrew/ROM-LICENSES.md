# ROM homebrew — composants et notices de redistribution

La ROM est compilée depuis une source de démo MIT fournie explicitement par Karl,
pas extraite d’un jeu. Le SDK fournit un IPL3 ouvert. Aucun bootcode commercial,
ROM commerciale, clé/session de compte ou sauvegarde originale n’a été téléchargé.

## Éléments réellement observés

- Démo `main.c` : MIT, notice Karl 2026 conservée dans `LICENSE`.
- SDK libdragon : commit `e356bf3f56f7afbf7e5246329562f145965cfdfc`,
  licence racine Unlicense, texte conservé dans `licenses/LIBDRAGON-UNLICENSE.txt`.
  `boot/README.md` explique que `n64tool` inclut son IPL3 ouvert par défaut.
- La carte de liens du build (`build/demo-emuperso.map`) nomme `libdragon.a`,
  `libdragonsys.a`, `libc.a`, `libm.a`, `libstdc++.a`, `libgcc.a` et les objets de
  démarrage GCC. Une directive LOAD nomme une archive passée au linker ; elle ne
  prouve pas que toute cette archive a été incorporée. La section « Archive member
  included to satisfy reference » précise les membres sélectionnés.
- Newlib annoncé par la recette SDK : `4.4.0.20231231`. Le texte de licences
  de la version `newlib-4.4.0` est conservé intégralement dans
  `licenses/NEWLIB-4.4.0-COPYING.txt` (miroir source public, blob Git
  `176b3a4706cc99651d36b1116605747ad0a72a75`). Ce document rassemble les notices
  des nombreux composants de Newlib ; certaines concernent d’autres architectures
  et ne sont pas affirmées comme liées à cette ROM MIPS.
- GCC `16.2.0` : textes `COPYING3` et `COPYING.RUNTIME` de la référence
  `releases/gcc-16.2.0` conservés dans `licenses/GCC-GPLv3.txt` et
  `licenses/GCC-RUNTIME-EXCEPTION.txt`. L’exception 3.1 permet de distribuer le
  code cible combinant la bibliothèque runtime avec des modules indépendants,
  si la compilation est éligible. La démo est compilée avec GCC depuis son code C,
  sans outil propriétaire de transformation intermédiaire.

## Sources consultables

- Démo : https://github.com/toohigh450/emuperso/tree/emulateur-reel/demo-n64
- Libdragon figé : https://github.com/DragonMinded/libdragon/tree/e356bf3f56f7afbf7e5246329562f145965cfdfc
- Recette toolchain au même commit : `tools/build-toolchain.sh` (versions et URLs
  de GCC, Binutils et Newlib).
- Newlib : https://github.com/mirror/newlib-cygwin/blob/newlib-4.4.0/COPYING.NEWLIB
- Runtime GCC : https://github.com/gcc-mirror/gcc/blob/releases/gcc-16.2.0/COPYING.RUNTIME

Les notices de ce dossier doivent accompagner le binaire remis. Ne pas présenter
la totalité du SDK comme incorporée, ni le compilateur GCC lui-même comme un
composant de la ROM. La licence des fichiers compilés et l’exception runtime ne
valident pas une éventuelle pile d’émulation : cette dernière a son propre inventaire.
