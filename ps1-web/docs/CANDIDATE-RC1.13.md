# RC-1.13-audit — candidate PS1, publication interdite sans décision de Karl

Base Git : `e17d5d3bd2469b01e96f34e79fed8c9acab12fca`, branche amont `ps1-rc1.12`.
Le premier inventaire visait `ccb508535def6d9ab0bad0abcee4958d44c56701` ; le commit
`e17d5d3` a rétabli trois modules absents pendant ce travail. Les deux bases sont archivées.
La candidate descend du nouveau commit, sans modification de main ni des autres projets.

## Correctifs

- Classification structurée des métadonnées : langues, indications de région et ambiguïtés
  sont séparées. Les sous-tags linguistiques ne donnent jamais la région du disque.
  `FR` isolé est ambigu ; plusieurs régions ne sont plus réduites à la première.
- Tout catalogue reste non vérifié, y compris une correspondance par numéro de série.
  Une restauration, un numéro saisi ou une édition choisie ne réinjecte rien sans accord
  explicite pour la session. L’accord est perdu au changement de session/édition.
  `editionEvidence.authenticated` reste faux : un accord utilisateur n’authentifie pas le disque.
- Restauration des fichiers de tests/harness absents de la livraison depuis RC-1.11,
  avec provenance dans le dossier d’audit ; vérification des imports dans la livraison.
- Rejet natif du contenu détecté avant validation d’une session. Le compteur de frames
  seul pouvait avancer après « Failed to load content ». Un remplacement refusé garde
  la session précédente. La détection couvre les messages natifs observés, pas tous les
  échecs possibles de versions futures du cœur.
- Échec de sauvegarde native : le changement de jeu est annulé avant création d’une
  nouvelle session. Les sauvegardes utilisateur ne sont ni effacées ni migrées.
- Options manette : lecture du format réellement observé `clé|valeur; choix|choix`,
  distinction valeur demandée/listée/rapportée/vérifiée, lecture défensive du menu.
  Le faux réglage `pcsx_rearmed_pad1type` n’est plus envoyé à ce runtime.
- Cœur 4.2.3 verrouillé avec les SHA-256 des cinq fichiers de paquet récupérés ;
  l’installateur vérifie également le SHA-512 npm. Aucun BIOS commercial n’est inclus.

## Reproduction et vérifications

Node 24, Python 3.12 :

```sh
python tools/run_tests.py --output cache/test-results
```

Les assertions JS sont comptées individuellement, dans des processus distincts.
Les fixtures Python restent indépendantes de l’installation effective du runtime.
La CI PS1 dédiée exécute cette commande sur Windows et Linux ; ses résultats doivent
être lus dans les journaux du run correspondant au commit livré, jamais présumés.

Essais navigateur Linux, dépendances de développement : `playwright`, `pycdlib==1.22.0`,
Chromium installé. Les scripts construisent eux-mêmes un programme MIPS et un ISO9660.
Ils utilisent exclusivement un profil navigateur de test dans le dossier de sortie.

```sh
python tools/launcher.py --prepare-only
python tools/browser_real.py --output cache/browser-audit --chromium /usr/bin/chromium
python tools/browser_storage.py --output cache/browser-audit --chromium /usr/bin/chromium
```

Le premier script observe un vrai changement de RAM par cheat, puis vérifie chaque
cas linguistique avant et après accord explicite. Son Gamepad API est synthétique :
le pont vers simulateInput est réel, mais aucune manette physique n’est certifiée.
Le deuxième teste les états natifs, IndexedDB, le redémarrage du processus navigateur,
un échec de remplacement, trois remplacements et l’isolation entre deux ISO synthétiques.
Une carte mémoire vierge de 128 Kio n’établit pas une sauvegarde de progression en jeu.

## Points ouverts

- Le cœur PCSX-ReARMed `092633f8` observé ne fournit pas l’option pad1type.
  Il utilise `retro_set_controller_port_device`; ce runtime n’expose pas cette fonction
  au JavaScript. Le type numérique/analogique/DualShock demeure **non vérifié**.
  Un test Windows avec la Xbox 360 physique de Karl est indispensable.
- Aucun jeu commercial, aucun BIOS commercial, aucune compatibilité universelle testés.
  Les audits GPT/Méo originaux PS1 n’étaient pas présents : seuls leurs résumés du
  changelog, les observations du mandat et les preuves nouvelles sont disponibles.
- CHD/PBP : signatures testées, décompression et lecture réelles non validées.
  CUE multipiste et changement de disque en cours de partie ne sont pas implémentés.
- Limite **900 Mio conservée**. Le descripteur à la borne est accepté ; la borne +1 est
  refusée avant lecture. Un chargement complet de 900 Mio n’est pas validé. Le code
  lit le disque entier, le hache via WebCrypto, puis EmulatorJS le copie dans son
  stockage/heap : le pic mémoire dépasse donc la taille du fichier. Aucun calcul
  disponible ne justifie exactement 900 Mio ni son augmentation. Une évolution
  nécessiterait hachage incrémental et alimentation du FS sans copies intégrales,
  suivis de mesures Windows/Linux avec limites mémoire explicites.
- Le programme synthétique est silencieux. Création/fermeture des AudioContext observée,
  mais ni qualité audio ni stabilité sonore de jeux réels démontrées.
- Nombre d’iframes contrôlé sur une courte séquence ; absence de fuite mémoire à long
  terme et fermeture brutale pendant écriture restent non démontrées.

Les archives, empreintes, journaux Windows/Linux s’ils ont terminé et le rapport HTML
autonome sont livrés séparément. Ils décrivent les preuves exactes et leurs limites.
