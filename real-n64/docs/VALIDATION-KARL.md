# Validation réelle de Karl — suivi à compléter

Retour reçu le 31 octobre 2026, après livraison 0.2.1 : « sa marche meme la manette aussi ».
Le fonctionnement global et la manette sont donc **confirmés par Karl pour son essai**.
ROM, modèle de manette, versions Windows/Chrome, son et durée non précisés ; aucun
résultat de compatibilité d’un jeu particulier n’en est déduit. La matrice détaillée
ci-dessous reste à renseigner ; Codex ne l’a pas exécutée sur son PC.

Utiliser le ZIP ou le checkout de `emulateur-reel`, jamais modifier main.
Exécuter les instructions README dans real-n64 et ouvrir localhost:8770 avec Chrome.
Noter Windows/version, Chrome/version, modèle de manette et SHA de la ROM.

| Vérification | Résultat Karl | Preuve à joindre |
|---|---|---|
| Préparation du runtime et serveur local | NON EXÉCUTÉ | Messages et commande |
| Texte DEMO et compteur qui progresse | NON EXÉCUTÉ | Capture puis capture espacée |
| Carré animé et fond changeant | NON EXÉCUTÉ | Observation/vidéo |
| X/A et S/B, puis relâchement | NON EXÉCUTÉ | Texte PRESSE/RELACHE et couleur |
| A tenu : son entendu, puis silence | NON EXÉCUTÉ | Observation, sortie audio choisie |
| Manette physique, configuration et A/B | NON EXÉCUTÉ | Modèle, mapping, réponse |
| Essai continu 10 minutes | NON EXÉCUTÉ | Erreurs, compteur, audio, diagnostic |
| Console et diagnostic exporté | NON EXÉCUTÉ | JSON et messages |
| Relancement sans Internet après préparation | NON EXÉCUTÉ | Observation |

La démo MIT reste la référence reproductible. Les éventuelles ROM personnelles
restent exclusivement locales ; aucune ROM privée dans GitHub ou les rapports.
Ne pas importer de sauvegarde originale ni modifier Conker ou TN-1.
Les variantes libdragon standard sont des recherches échouées, pas la ROM validée.
Le test porte sur le port autonome ; aucune compatibilité console physique prouvée.

## Import local 0.2.0 — à réaliser sur le PC, NON EXÉCUTÉ par Codex

- Choisir un fichier extrait .z64/.v64/.n64 ; vérifier format, taille et deux hashes.
- Lancer la ROM choisie et relever image, commandes, audio et erreurs éventuelles.
- Recharger pour revenir à la démo de référence.
- Dans Réseau : aucun POST/PUT et aucun corps de requête contenant la ROM attendu.
- Le jeu fourni en ZIP pendant cette tâche n’a pas été testé ici (limite de transfert).
- Ne transmettre aucune ROM privée dans GitHub ou les rapports publics ; un diagnostic
  peut révéler son nom et ses empreintes, à partager uniquement volontairement.

## Import ZIP 0.3.0 — à vérifier sur le PC de Karl

- Choisir un ZIP non chiffré contenant une ROM ; extraction automatique puis lancement.
- Avec plusieurs ROM, choisir une entrée et cliquer Préparer cette ROM avant lancement.
- Vérifier que CRC, format détecté, nom et empreintes sont affichés / consignés.
- Confirmer image, manette et audio ; conserver la démo comme comparaison.
- Aucun essai de ZIP personnel n’a été réalisé par Codex. Les tests automatisés
  utilisent seulement notre démo MIT et des données synthétiques, dont 64 Mio de remplissage.
