# Compatibilité NES et SNES — 0.3.0 alpha.1

Ce document dit ce que le lanceur accepte, ce qui a été **réellement testé** et ce qui est seulement
**annoncé** par les cœurs. Résultats détaillés : `TESTS-NES-SNES.md`. Aucune compatibilité complète n'est
promise : un jeu précis peut ne pas fonctionner.

## Moteurs

| Console | Cœur | Version | Licence |
|---|---|---|---|
| NES / Famicom | FCEUmm (libretro), via EmulatorJS 4.2.3 | build CDN du 2025-06-14 | GPL-2.0 |
| SNES / Super Famicom | Snes9x (libretro), via EmulatorJS 4.2.3 | build CDN du 2025-06-14 | Snes9x, non commerciale |

Choix : ce sont les cœurs par défaut d'EmulatorJS, le moteur déjà utilisé pour GB/GBC/GBA/DS (même
iframe, mêmes sauvegardes, même manette tactile). Aucun nouveau moteur à maintenir. Nestopia (NES) est
aussi disponible sur le CDN mais n'est pas proposé : un second cœur créerait un second espace de
sauvegarde par jeu sans besoin démontré.

## Formats de fichiers

| Format | Résultat |
|---|---|
| `.nes` (iNES 1.0, NES 2.0) | Accepté. Carte, pile, miroir, PAL/NTSC lus dans l'en-tête. En-têtes « DiskDude! » détectés. |
| `.unf` / `.unif` | Accepté si le bloc `MAPR` (nom de carte) est présent ; transmis en `.unf` au cœur. Non testé avec un vrai jeu UNIF. |
| `.sfc`, `.smc`, `.swc`, `.fig` | Accepté si un en-tête interne SNES est trouvé (LoROM, HiROM, ExHiROM, SA-1). En-tête de copieur de 512 octets détecté et conservé. |
| `.zip` | Accepté (stockage ou deflate, sans chiffrement ni ZIP64). Plusieurs ROM : choix par numéro. |
| `.7z`, `.rar` | **Refusé avec explication** : extraire la ROM avec 7-Zip, sans toucher à l'original. Raison : les archives 7z de la collection contiennent jusqu'à 10 175 variantes compressées ensemble ; les décompresser dans un téléphone demanderait des centaines de Mio. |
| `.fds`, `.qd` | **Refusé** : le Famicom Disk System exige le BIOS commercial `disksys.rom`, non fourni. |
| `.nsf`, `.nsfe`, `.spc` | **Refusé** : fichiers musicaux. |
| `.bs`, `.st` | **Refusé** : Satellaview / Sufami Turbo (BIOS ou prise en charge incomplète). |
| `.ips`, `.bps`, `.ups` | **Refusé** : patch à appliquer d'abord à la ROM. |

Tailles maximales : NES 64 Mio (compilations multi-jeux), SNES 8 Mio + 512 octets.

## Régions

- **NES** : l'en-tête iNES ne contient pas de région. Le lanceur affiche la région lue dans le nom de
  fichier (« d'après le nom »). PAL/NTSC : octet 12 de NES 2.0, ou octet 9 d'iNES (rarement rempli).
  FCEUmm choisit lui-même la région (option « Auto » du cœur). Démarrage PAL rapporté dans
  `TESTS-NES-SNES.md` ; revérifié le 2 novembre sur Super Mario Bros. (Europe), 50 images/s.
- **SNES** : pays lu dans l'en-tête interne (Japon, USA, Europe, France, Allemagne…) et vidéo PAL/NTSC
  déduite. Snes9x choisit PAL/NTSC d'après l'en-tête. Démarrage PAL rapporté sur Pilotwings et
  Super Metroid dans `TESTS-NES-SNES.md` ; pas de nouvelle vérification de ces deux jeux ici.
- Le catalogue filtre USA / Europe / Japon / France et « en français » d'après les étiquettes des noms
  (No-Intro, GoodTools : `(F)`, `(Fr)`, `[T+Fre]`).

## Cartes NES (mappers)

FCEUmm prend en charge plusieurs centaines de cartes (NROM, MMC1, UxROM, CNROM, MMC3, MMC5, AxROM,
MMC2/4, VRC2/4/6/7, Namco 163, FME-7…). Le lanceur affiche le nom des cartes courantes et prévient pour
une carte rare.

**Réellement testé à nouveau** : NROM (mapper 0), ROM d'essai, Snake et Super Mario Bros. (Europe).
Le rapport Windows `TESTS-NES-SNES.md` rapporte également le démarrage de jeux MMC1, MMC3 et MMC5 de la
collection de Karl. Ces essais antérieurs ne constituent pas une validation de parties complètes.

## Puces spéciales SNES

| Puce | Lanceur | Snes9x | Test réel |
|---|---|---|---|
| Super FX (GSU) | accepté, avertissement | annoncée | démarrage de Star Fox et Yoshi's Island rapporté dans TESTS-NES-SNES.md ; pas de nouvelle vérification ici |
| SA-1 | accepté, avertissement | annoncée | **Démarrée** (démo Étoiles) |
| DSP-1 | accepté, avertissement | annoncée | **Démarrée** (démo Sol) |
| S-DD1, Cx4 | accepté, avertissement | annoncées | démarrage de Street Fighter Alpha 2 et Mega Man X2 rapporté dans TESTS-NES-SNES.md ; pas de nouvelle vérification ici |
| DSP-2/3/4, SPC7110, OBC1, S-RTC, ST010/011 | accepté, avertissement | annoncées | non testé |
| ST018 | **refusé** | non prise en charge | — |
| Super Game Boy, Satellaview | **refusé** | non prise en charge | — |
| MSU-1 | — | demande des fichiers audio séparés | non proposé |

« Démarrée » signifie : le cœur exécute la ROM et affiche une image animée dans Chrome Windows. Les
performances sur téléphone ne sont pas mesurées ; Super FX et SA-1 sont les plus lourdes.

## Codes de triche

Panneau **Codes** : ajouter (nom + code), cocher / décocher chaque code, supprimer. Les codes sont
enregistrés par jeu, pour les octets exacts de la ROM (SHA-256) : une autre région, révision ou un hack a
sa propre liste. Un code ajouté est **toujours désactivé** ; rien n'est activé au premier lancement.
L'état coché est restauré au lancement suivant du même jeu.

| Console | Formats acceptés (contrôlés avant envoi) | Testé dans le vrai cœur |
|---|---|---|
| NES | Game Genie 6 lettres | **oui** (activé puis désactivé, effet mesuré à l'écran) |
| NES | Game Genie 8 lettres (avec comparaison) | décodage testé, effet en jeu non testé |
| NES | brut `AAAA:VV` | **oui** (activé puis désactivé) |
| NES | brut `AAAA?CC:VV`, Pro Action Rocky (8 chiffres) | acceptés par FCEUmm, non testés |
| SNES | Game Genie `XXXX-XXXX` | **oui** (activé puis désactivé) |
| SNES | Pro Action Replay `AAAAAAVV` et brut `AAAAAA:VV` | **oui** (activé puis désactivé) |
| SNES | brut `AAAAAA=VV`, `AAAAAA=CC?VV` | acceptés par Snes9x, non testés |
| GB/GBC/GBA/DS | non contrôlés par le lanceur | non testés |

Un code d'une autre console (par exemple un Game Genie SNES sur un jeu NES) est refusé avec un message.

**Correction importante** : FCEUmm, mGBA et DeSmuME 2015 ignorent l'état « désactivé » transmis par le
moteur. Avant 0.3.0, les codes d'un fichier `.cht` associé étaient donnés au moteur au lancement et donc
**tous actifs** sur ces cœurs, malgré l'affichage « désactivés ». Désormais le menu de codes du moteur est
masqué, et le lanceur remet les codes à zéro puis n'envoie que les codes cochés. Vérifié sur NES et SNES.

Effet sur les sauvegardes : un code actif peut modifier la mémoire sauvegardée par le jeu. Le panneau le
rappelle ; exporter la sauvegarde avant d'enregistrer en jeu avec un code actif. Un code retiré peut
laisser une valeur en mémoire jusqu'au redémarrage du jeu (bouton « Redémarrer le jeu »).

## Sauvegardes

- **Sauvegarde de cartouche (pile)** : écrite par le moteur dans IndexedDB toutes les 30 s, et aussi
  immédiatement avant un changement de jeu, une fermeture ou une mise en arrière-plan de la page.
  Nommée d'après l'empreinte de la ROM : une ROM renommée retrouve sa sauvegarde.
- **Copies de sécurité** : 3 versions par jeu, jamais écrasées sans décalage (existant).
- **Exporter maintenant** / **Importer une sauvegarde** (`.sav`, `.srm`) : l'import copie d'abord la
  sauvegarde actuelle dans les copies de sécurité, puis redémarre le jeu. Si la copie échoue,
  le remplacement est refusé et l'export de la sauvegarde actuelle reste possible.
- **États de jeu** : 4 emplacements par jeu ; remplacer un emplacement garde l'état précédent
  (« Charger le précédent »). Export et import de fichiers `.state` (même ROM et même cœur seulement).
- Stockage du navigateur : espace utilisé affiché, demande de stockage persistant proposée. Le
  navigateur peut effacer ces données ; l'export reste la seule protection sûre.

## Contrôles

- Clavier (par défaut) : flèches, Z = A, X = B, A = X, S = Y, Q/E = L/R, Entrée = Start, V = Select.
  Réglage par jeu dans le menu manette du moteur.
- Manettes USB / Bluetooth : API Gamepad de Chrome, via le moteur. **Non testé** avec une vraie manette.
- Téléphone : manette tactile du moteur sous l'image (NES : croix, A, B, Start, Select ; SNES : croix,
  A, B, X, Y, L, R). Gestes du navigateur bloqués sur l'écran de jeu (`touch-action: none`).
  Disposition et taille réglables dans le menu du moteur. **Non testé sur un vrai téléphone Android.**

## Limites connues

- 7z / RAR non ouverts dans le navigateur (voir plus haut).
- Les démarrages PAL, MMC1/MMC3/MMC5, Super FX, Cx4 et S-DD1 sont rapportés dans le compte rendu Windows ;
  la nouvelle validation couvre NROM, les ROM d'essai et les cinq démos NES/SNES. Aucune partie complète validée.
- Manettes physiques et Android réel : non testés (pas de matériel dans cet environnement).
- Snes9x : licence non commerciale.
- GB/GBC/GBA/DS (antérieur, inchangé) : la sauvegarde du moteur suit le nom du fichier ROM.
