# Validation réelle de Karl — NON EXÉCUTÉE

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

Ne pas charger de ROM commerciale, de vraie sauvegarde, de Conker ou TN-1.
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
