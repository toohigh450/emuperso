# Protocole terrain — Karl — RC-1.13-claude.1

Objectif : confirmer sur Windows 10 + Chrome ce que les mesures automatiques ont montré.
Utiliser les originaux en lecture seule ; ne rien convertir ; conserver chaque diagnostic exporté.

## A. Chargement à froid (P0)

1. Redémarrer le PC (vide le cache de fichiers Windows), ouvrir l'émulateur avec le lanceur habituel.
2. Choisir directement `Dragonball GT - Final Bout (USA) [SLUS-00493].chd`.
3. Observer la ligne d'état : elle doit afficher « … x / y Mio · débit Mio/s » et avancer.
4. Noter la durée jusqu'à « Disque prêt ». Exporter le diagnostic (événements `disc.*`).
5. Recommencer avec `DragonBall Z - Ultimate Battle 22 (USA).chd` puis `Crash Bandicoot-PSX-PAL.chd`.

Attendu : progression visible, aucune attente muette ; si le disque cale, le message
« Aucune progression depuis N s » apparaît après 10 s et `disc.stalled` est journalisé.

## B. Remplacement de jeu

1. Lancer `Crash Bandicoot (USA).bin` (image Naughty Dog).
2. Sans fermer, choisir un CHD encore jamais lu depuis le redémarrage.
3. Pendant la lecture : le jeu en cours continue ; essayer « Annuler la lecture » une fois.
4. Rechoisir le CHD, attendre « Disque prêt », cliquer « Changer pour ce jeu ».

Attendu : annulation immédiate, Crash toujours actif, sauvegardes intactes ; puis remplacement normal.

## C. Taille et mémoire

Choisir `Gran Turismo 2 Plus (Beta v6.1) (Simulation Mode).bin` (610 Mio) avec un jeu en cours.
Exporter le diagnostic : relever `js_heap_used_mib` dans `disc.selected` et `disc.ready`.
Ne pas essayer d'augmenter la limite de 900 Mio ; un fichier plus gros doit être refusé avant lecture.

## D. Formats

Pour chaque format disponible (BIN, CHD, PBP ; ISO/IMG si vous en avez) noter séparément :
reconnu (Disque prêt) / lu (pas d'erreur) / fonctionne (image + son + manette dans le jeu).
Un format reconnu n'est pas un format compatible.

## E. Cheats Gran Turismo 2 (P1)

1. Lancer `Gran Turismo 2-PSX-PAL-CD1.chd`, choisir l'édition Europe.
2. Vérifier : 11 lignes, chacune avec Provenance / Format / État ; toutes « rejeté — … » ;
   cases grisées ; message « Aucun de ces codes n'est exécutable par PCSX ReARMed ».
3. Contrôle positif : lancer `Crash Bandicoot (USA).bin`, activer un code GameShark accepté
   (format 80xxxxxx yyyy), confirmer la région, vérifier un effet visible en jeu.

À remettre : diagnostics JSON, durées notées, captures de l'état et de la liste des cheats,
résultat attendu/observé par étape. Aucun GO de publication avant contre-audits GPT et Méo.
