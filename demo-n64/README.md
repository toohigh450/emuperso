# Démo N64 homebrew — emuperso

Démo minimale pour tester un vrai moteur N64 (EmulatorJS + mupen64plus_next) dans Chrome.
Code écrit avec **libdragon**. **Aucune ROM commerciale** n'est impliquée.

> ⚠️ **Statut : source NON compilée, NON testée.**
> Rédigée sans chaîne MIPS ni accès réseau. Rien ici n'est déclaré fonctionnel
> avant un test réel (compilation, puis démarrage dans le Chrome de Karl).

## Ce que la démo doit faire
1. Booter sans erreur bloquante.
2. Afficher du texte, un compteur d'images, un fond qui change de couleur et un carré qui rebondit.
3. Lire la manette (port 1) : l'écran indique si **A** et **B** sont pressés (le fond change aussi).
4. Jouer une tonalité de 440 Hz tant que **A** est maintenu.

## Compiler (commandes à vérifier : non exécutées ici)
Option recommandée — outil `libdragon` (nécessite Docker) :
```
npm install -g libdragon
libdragon init        # dans ce dossier ; peut ajouter ses propres fichiers
libdragon make        # produit demo-emuperso.z64
```
Option manuelle : installer la chaîne MIPS et libdragon (doc officielle), définir `N64_INST`, puis `make`.

Après compilation, noter ici : taille de la ROM, version de libdragon utilisée, commande exacte.
- Taille ROM : _à renseigner_
- Version libdragon : _à renseigner_

## Tester
Dans le lab EmulatorJS (cœur `mupen64plus_next`) : charger `demo-emuperso.z64` **en local**.
Critères : la ROM boote, l'écran vit, A/B réagissent, le son sort si A est maintenu.

## Licence
Code publié sous **MIT** (voir `LICENSE`) avec l'accord de Karl du 31 octobre 2026.
À vérifier avant publication de la ROM : la ROM compilée embarque libdragon et sa bibliothèque C
(licences à contrôler). Tant que ce n'est pas tranché : garder la ROM **privée et chargée en local**,
jamais dans le dépôt public.

## Limites connues
- Pas de test, pas de compilation à ce stade.
- Audio : onde carrée simple, volume modeste ; API audio à valider contre la version de libdragon installée.
