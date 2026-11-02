# EMUPERSO — Homebrew diagnostic PS1 (MIT)

Cette démo est un programme **original**, libre sous licence MIT, sans jeu commercial, BIOS, ressources propriétaires ou contenu personnel.

- **Source :** `demo-ps1.py` (bibliothèque standard Python uniquement).
- **Image créée :** `demo-emuperso-ps1.iso` (ISO 9660 de 131 072 octets).
- **Code PS1 :** PS-X EXE natif à instructions MIPS, exécuté par PCSX ReARMed.
- **Test visuel attendu :** écran rempli de rouge.
- **Ce que ça confirme :** chargement du disque, initialisation CPU/GPU et rendu d'une image par l'émulateur.
- **Ce que ça NE confirme PAS :** contrôleur, son, animations, sauvegardes, cheats, jeux commerciaux ou performances.

Le programme reprend la séquence MIPS originale déjà utilisée dans le scénario de test `tools/browser_real.py` de la candidate RC-1.15.

Pour générer localement :

```sh
python3 homebrew/demo-ps1.py homebrew/demo-emuperso-ps1.iso
```

**Aucune ROM ni sauvegarde de testeur n'est envoyée au serveur.** La démo est chargée depuis le domaine du site, puis préparée par le même chemin `prepareDisc` que les fichiers personnels. Les éventuels états sont isolés par l'empreinte de ce disque.
