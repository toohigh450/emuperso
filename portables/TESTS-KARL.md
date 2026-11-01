# À valider par Karl dans Chrome sur Windows

L'application a été testée dans Chromium avec un moteur simulé et des données synthétiques ; 67 tests de logique passent. Les essais ci-dessous avec le vrai moteur, tes jeux et Windows restent à faire. Note pour chaque ligne : réussi / échoué / non testé.

Avant toute mise à jour, exporte tes sauvegardes depuis l'ancien dossier. Garde-le jusqu'à validation de leur restauration.

## Démarrage
- [ ] Double-clic sur `DEMARRER-PORTABLES.bat` : la fenêtre noire affiche l'adresse, Chrome s'ouvre sur la page.
- [ ] Aucun message d'erreur rouge dans la fenêtre noire.
- [ ] La page s'affiche correctement (clair et sombre).

## Une ROM par console (tes propres fichiers)
- [ ] Un jeu `.gb` : la fente affiche console, version, empreinte. « Démarrer » lance le jeu, son et image.
- [ ] Un jeu `.gbc`.
- [ ] Un jeu `.gba`.
- [ ] Un jeu `.nds` avec DeSmuME 2015 : deux écrans, tactile à la souris.
- [ ] Un jeu dans un `.zip`, puis un ZIP à plusieurs jeux : choisir le bon numéro.
- [ ] Un fichier invalide : erreur ou avertissement d’en-tête ; ne pas confondre ouverture et jeu compatible.

## Un seul jeu à la fois
- [ ] Jeu A lancé, ouvrir le jeu B : la page demande confirmation, A disparaît, B se charge. Un seul son.
- [ ] Changer de console en pleine session (GBA vers DS puis GB) : chaque changement fonctionne.
- [ ] « Fermer le jeu » vide l'écran et coupe le son.

## Sauvegardes (le point critique)
- [ ] Jeu A : sauvegarder dans le jeu, fermer, rouvrir A : la sauvegarde est là.
- [ ] Jeu B (autre fichier) : il ne voit PAS la sauvegarde de A, et inversement.
- [ ] Changer A vers B vers A : rien n'est mélangé ni perdu, aucun bogue au chargement.
- [ ] Après une sauvegarde dans le jeu, l'onglet « Sauvegardes » montre une copie de sécurité.
- [ ] « Exporter » télécharge un fichier; le recharger via le moteur restaure la sauvegarde.
- [ ] États (save state / load state) du moteur : fonctionnent pour chaque console.

## Codes
- [ ] Importer un dossier `.cht` : le compteur monte.
- [ ] ROM au nom identique à un fichier : suggestion dans Codes, puis association confirmée et réouverture du jeu. Les nouveaux codes apparaissent désactivés ; vérifier les activations mémorisées.
- [ ] Un code activé fait bien effet dans le jeu (note la console et le type de code : Code Breaker, GameShark…).
- [ ] ROM d'une autre région : rien n'est chargé tout seul; une association manuelle demande confirmation.

## Manette Xbox 360
- [ ] Profil par défaut : tous les boutons réagissent.
- [ ] Profil positionnel : bouton du bas = B, bouton de droite = A (relancer le jeu après le changement).

## Moteur
- [ ] Sans Internet et sans dossier `emulatorjs/data` : message d'erreur clair au bout de 60 secondes.
- [ ] Avec `emulatorjs/data` en local : fonctionne hors ligne.

## Identité et mise à jour
- [ ] Associer des codes, renommer la ROM sans modifier ses octets : le choix reste retrouvé après réouverture.
- [ ] Une ROM modifiée (hack), autre région ou autre révision ne récupère pas ce choix.
- [ ] Fichier .cht avec rom_sha256 : association automatique seulement pour l’empreinte correspondante.
- [ ] Jeu déjà ouvert en 0.1 : sauvegarde réelle retrouvée avec le même navigateur et la même adresse.
- [ ] Ancienne ROM DS > 256 Mio : exporter depuis 0.1 puis restaurer dans 0.2 (nouvelle empreinte).
