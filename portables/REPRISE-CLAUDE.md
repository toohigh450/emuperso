# Portables 0.2.1-alpha.2 — reprise Claude du travail de Codex

1er novembre 2026, 20 h 20 (Toronto). Point de départ : la session Codex « Reprendre les corrections de l'audit », arrêtée à 20 h 06 parce qu'elle avait atteint sa limite d'utilisation. La branche `emulateur-portable` est au commit `9d09509`, poussé par Codex. Aucun code n'a été modifié dans le dépôt et rien n'a été poussé : PR #1 toujours en brouillon.

## 1. DS avec le vrai moteur

| ROM (ZIP intègre selon `7z t`) | Cœur | Démarrage | Résultat |
|---|---|---|---|
| The Amazing Spider-Man (Europe) | desmume2015 | 4 s | image sur les deux écrans (menu de sauvegarde), contexte audio actif à 48 kHz, fermeture propre |

Capture : `preuves/claude-ds-spiderman.png`. Le son lui-même n'a pas été écouté, car Chrome tournait sans fenêtre.
Codex avait testé Etrian Odyssey : il avait obtenu l'état « running », sans capture analysée.

Castlevania - Dawn of Sorrow a échoué avec « The compressed data was not valid ». La cause est le ZIP, encore incomplet pendant le téléchargement, et non le moteur : `7z t` signale aussi une erreur de données.

## 2. Téléchargement DS

Le téléchargement était en cours à 20 h 18. Sur 3 232 ZIP, 1 376 commençaient encore par des octets vides et des fichiers étaient modifiés à la seconde même. Avant de tester un ZIP DS, vérifie qu'il est complet (100 % dans qBittorrent).

## 3. Cheats individuels

Même méthode et même source que Codex : libretro-database, commit `2fdd069d`, licence CC BY-SA 4.0. Les correspondances se font par titre, région et révision ; aucun code n'est activé et aucun n'est testé en jeu.

| Console | ROMs inventoriées | Fichiers `.cht` | Sans source |
|---|---|---|---|
| Game Boy | 3 491 | 517 | 2 964 |
| Game Boy Color | 2 340 | 337 | 1 994 |
| Game Boy Advance | 2 893 | 634 | 2 259 |
| DS | 3 358 | **1 470** (Codex : 362) | 1 887 |
| **Total** | 12 082 | **2 958** (82 154 codes) | 9 104 |

Seul changement par rapport au script de Codex : quand un ZIP DS n'est pas encore lisible, son nom de fichier (nom No-Intro) remplace la liste de son contenu. Aucune archive n'est donc plus mise de côté. 991 fichiers `.cht` DS viennent de ce rattachement par le nom.

Les jeux sans source sont listés dans `cheats-portables/RECHERCHES-RESTANTES.json` (à la racine du dépôt). Pour 1 133 d'entre eux (hacks et traductions), il faudra des recherches au cas par cas. Aucun code n'a été inventé.

## 4. À faire

- Tester dans Portables un code DS Action Replay et un code GBA, et noter leur effet en jeu.
- Une fois le téléchargement fini, tester 2 ou 3 ZIP DS plus lourds (128 Mio et plus) et noter la mémoire utilisée.
- Importer le dossier DS en deux sélections, car l'application accepte au maximum 1 000 fichiers par import.

## 5. Affichage téléphone (Android)

Avant : sur téléphone, l'écran du jeu (360 × 240) était placé sous les réglages, et la manette tactile recouvrait toute l'image.
Correction (CSS seulement, `css/app.css`) : dès qu'un jeu est ouvert sur un écran de moins de 860 px, le jeu passe au-dessus des réglages. Sur un écran tactile tenu en portrait, la zone de jeu passe au format 3:4, pour que la manette s'affiche sous l'image.

Le format 3:4 a été retenu après mesure. Avec une zone plus haute (78 % de l'écran), le toucher sur « Démarrer » n'était plus pris en compte par le moteur (test Pixel 7 émulé). Avec les formats 1:1 et 3:4, il fonctionne.

| Essai (Chrome 152) | Résultat |
|---|---|
| Android émulé (Pixel 7, tactile) + Pokémon Rouge Feu (GBA) | démarre au toucher ; image en haut, croix/A/B/Start/Select dessous ; L/R mordent un peu sur le bas de l'image |
| Android émulé + The Amazing Spider-Man (DS) | démarre ; l'écran du bas de la DS reste sous la manette (c'est l'écran tactile) |
| Chrome Windows 1440 × 900 + Pokémon Rouge Feu | inchangé : écran 888 × 592, démarre au clic |

Non vérifié : un vrai téléphone Android. À confirmer par Karl sur l'aperçu Vercel.

## 6. Réponse aux audits du commit 67a25ec (Méo et Gemini)

Mesures faites en lisant directement la zone où le moteur dessine l'image (viewport WebGL) et la position des boutons de la manette tactile, avec la vraie ROM.

| Point soulevé | Vérification | Conclusion |
|---|---|---|
| Méo : « Démarrer » au toucher non confirmé | Le bouton répond à un vrai toucher (`touchscreen.tap` aux coordonnées du bouton) sur Pixel 7, Moto G4, Galaxy S8, en portrait et en paysage, et au clic de souris sur Chrome Windows (GBA et DS). | Résolu. **Correction de la section 5** : l'échec à 78 % venait de la méthode de test (`locator.tap` de Playwright), pas du moteur. La même méthode échouait aussi sur Windows avec le CSS d'origine de Codex. |
| Méo : image GBA étirée en 3:4 | Rapport largeur/hauteur de l'image mesuré : 1,500 sur tous les appareils. | Pas d'étirement : le moteur garde le format et ajoute du noir autour. |
| Constat Claude : en 3:4, L et R mordaient sur le bas de l'image | Image 0–242 px, L/R 164–200 px. | Corrigé : la hauteur suit maintenant la largeur (image + 340 px), plafonnée à 85 % de l'écran. Pixel 7 : image 0–243, L/R dès 263. Moto G4 : image 0–208, L/R dès 224. |
| Non couvert par les audits : téléphone en paysage | Avant : écran 335 × 240 dans la mise en page PC ; L et R hors du cadre, manette sur l'image. | Corrigé : une colonne et 94 % de la hauteur visible. Croix à gauche, A/B à droite, image au centre (507 × 338). Select/Start mordent légèrement sur le bas. |
| DS en portrait | Image 363 × 545 ; la manette couvre l'écran du bas. | Accepté : c'est l'écran tactile de la DS, il doit rester touchable. Le paysage est conseillé pour la DS. |
| Gemini : « buffer overflow », « désynchronisation audio/vidéo », « taux de rafraîchissement », tests par émulateur | Aucune de ces notions n'existe dans les commits ; les 78 tests portent sur la logique de l'appli (sessions, stockage, codes), pas sur chaque émulateur. | Audit non vérifiable : il ne cite aucune commande, aucun fichier ni aucune mesure. Son verdict n'est pas retenu comme preuve. |

Chrome Windows (souris, 1440 × 900) : inchangé. Les règles ne visent que les écrans tactiles (`pointer: coarse`).
