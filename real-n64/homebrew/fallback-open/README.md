# Repli diagnostic : démo N64 freestanding ouverte

Cette démo constitue un **port distinct** du comportement de la démo de Claude,
pas une compilation de son C avec libdragon. Les sources originales, la ROM standard
et les variantes SDK restent intactes dans les dossiers voisins.

Le programme contient de vraies instructions VR4300/MIPS, un framebuffer VI 16 bits
320×240, des requêtes SI/PIF de lecture des boutons, et des buffers AI stéréo. Aucune
animation JavaScript ne simule la démo ; le navigateur doit réellement exécuter le
binaire N64 dans son cœur pour afficher le texte et faire progresser le compteur.

La logique prévue est : fond variable, carré qui rebondit, compteur, boutons A/B
et onde carrée sous A. Les fonctions peuvent être compilées sans que leur exécution
réelle soit prouvée : consulter les tests du chantier pour chaque résultat.

## Source et licences

- Logique de démo reprise de la source MIT de Karl/Claude ; adaptations MMIO par Codex.
- Fonte élémentaire 5×7 créée dans ce port, code sous MIT.
- Valeurs de timing VI NTSC reprises de libdragon `src/vi.h`, commit
  `e356bf3f56f7afbf7e5246329562f145965cfdfc`, sous Unlicense ; notice incluse.
- Le linker ne charge aucune bibliothèque runtime, libc, libdragon, libgcc ou libstdc++.
  La carte de liens `build/app.map` ne nomme que `start.o` et `main.o`.
- Le bootstrap est du code MIPS MIT écrit pour ce chantier. Aucun IPL3 Nintendo,
  ROM commerciale ou sauvegarde originale n’a été utilisé.

## Construire

Avec la chaîne GCC figée et extraite dans le cache voisin :

```
N64_INST=<préfixe libdragon-toolchain> python3 build.py
```

Le build peut utiliser le préfixe par défaut `../../cache/toolchain/opt/libdragon`
par rapport à ce dossier. `build-info.json` décrit le résultat exact ; les SHA changent
si les sources changent. Le titre du header est `EMUPERSO OPEN DEMO`.

Le bootstrap suppose 8 MiB de RAM préallouée par l’émulateur, la remet à zéro avec
le CPU puis copie le programme depuis la ROM. Il ne calibre pas physiquement la RDRAM,
ne charge aucun microcode RSP et ne revendique aucune validation sur vraie console N64.

## Limites à vérifier

Les entrées SI et l’audio AI exigent des essais réels. L’audio vise environ 440 Hz au
taux NTSC configuré, sans prétendre mesurer sa fréquence tant que les buffers n’ont pas
été observés. Le contrôleur physique, les navigateurs Windows et le matériel de Karl
restent à tester par Karl. Une compilation, un contexte WebGL ou un callback moteur ne
constituent pas à eux seuls un démarrage de cette ROM.

## Révision double tampon

Après une première preuve de boot et d’animation, la capture a montré des régions
de couleurs incohérentes et un titre partiellement effacé, compatibles avec du dessin
direct dans le tampon affiché. Le port utilise désormais deux surfaces RDRAM distinctes
(physiques 0x100000 et 0x140000), dessine dans la surface arrière puis change VI_ORIGIN.
L’attente du blanking est bornée par Count pour qu’un registre VI non progressif ne
bloque pas la démo. `doublebuffer.patch` et `main-frontbuffer.c` conservent la correction
et la source précédente ; la ROM précédente est `demo-emuperso-open-frontbuffer.z64`.
Cette correction compilée doit encore être vérifiée sur les captures du nouvel essai.
