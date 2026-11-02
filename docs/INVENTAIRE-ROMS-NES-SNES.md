# Inventaire NES/SNES (lecture seule)

Source : dossier local fourni par l'utilisateur. Généré le 2026-11-02 par `tools/inventaire-roms.mjs`.
Les étiquettes viennent des noms de fichiers (GoodTools / No-Intro), pas d'une vérification des octets.

## FULL Super Nintendo -- Famicom (GoodSNES 2.04)[GoodMerged]

- Fichiers (hors images/vidéos) : 11309, 16.54 Gio. Extensions : smc 11309, txt 1.
- Archives : 0 (0 entrées : —) ; 0 archives à plusieurs variantes, jusqu'à 0 entrées dans une seule ; 0 illisibles.
- ROMs : 11309 (snes 11309), 3024 titres distincts, plus grosse 8.0 Mio, 0 noms en double.
- Régions annoncées : Japon 5371, USA 2740, Europe 1180, Allemagne 67, France 51, Espagne 19, Corée 4, Pays-Bas 2, Australie 2, Italie 1, Chine 1, Monde 1.
- Français : 223 (dont 172 traductions [T+Fre]). Traductions : Spa 274, Eng 262, Fre 172, Por 82, Ger 72, Ita 58, Chi 43, Rus 14, Bra 14, Swe 14, Pol 13, Kor 8.
- Originaux 4534, vérifiés [!] 722, hacks 3258, prototypes 1, bêtas/démos 790, mauvais dumps 1150, pirates 23, sans licence 18, domaine public/homebrew 572.

## Hackset-NES-YGG

- Fichiers (hors images/vidéos) : 1710, 0.29 Gio. Extensions : 7z 1708, zip 2, exe 1, txt 1.
- Archives : 1710 (35875 entrées : nes 34127, json 1707, txt 10, (sans) 8, dll 8, png 6) ; 1460 archives à plusieurs variantes, jusqu'à 10175 entrées dans une seule ; 0 illisibles.
- ROMs : 34127 (nes 34127), 3637 titres distincts, plus grosse 4.0 Mio, 8 noms en double.
- Régions annoncées : USA 13657, Monde 11039, Japon 8552, Europe 1025, Asie 273, Corée 74, Espagne 41, Australie 33, Allemagne 23, France 22, Brésil 8, Suède 7.
- Français : 263 (dont 222 traductions [T+Fre]). Traductions : Rus 562, Eng 470, Chi 381, Fre 222, Bra 216, Spa 191, Pol 74, Ita 63, Swe 51, Ger 48, Kor 43, Gre 18.
- Originaux 23460, vérifiés [!] 1778, hacks 6603, prototypes 128, bêtas/démos 210, mauvais dumps 11, pirates 513, sans licence 1049, domaine public/homebrew 60.

## nes

- Fichiers (hors images/vidéos) : 1992, 0.21 Gio. Extensions : png 5834, zip 1992, mp4 1845, jpg 1488, tmp 4, xml 1.
- Archives : 1992 (1993 entrées : nes 1992, sav 1) ; 0 archives à plusieurs variantes, jusqu'à 2 entrées dans une seule ; 0 illisibles.
- ROMs : 1992 (nes 1992), 1975 titres distincts, plus grosse 8.5 Mio, 0 noms en double.
- Régions annoncées : Japon 688, USA 529, Europe 326, Asie 119, Monde 108, France 14, Corée 13, Espagne 12, Chine 10, Australie 8, Brésil 6, Pays-Bas 2.
- Français : 27 (dont 0 traductions [T+Fre]). Traductions : —.
- Originaux 1932, vérifiés [!] 39, hacks 12, prototypes 40, bêtas/démos 4, mauvais dumps 1, pirates 4, sans licence 385, domaine public/homebrew 134.

## Lecture et conséquences pour le lanceur

- Les originaux de `E:\roms` n'ont été ni modifiés, ni déplacés, ni renommés, ni copiés. L'outil lit les
  noms, les tailles et la liste du contenu des archives (7-Zip `l`), rien d'autre. La liste complète
  par fichier reste hors du dépôt (`inventaire-complet.json` dans le dossier temporaire de Karl).
- Le mandat mentionne 11 337 ROM SNES ; 11 309 fichiers `.smc` ont été trouvés dans le dossier GoodSNES
  2.04 (plus un `.txt`). L'écart de 28 n'est pas expliqué par les fichiers présents.
- **SNES (GoodSNES, GoodMerged)** : un dossier par titre, toutes les variantes en `.smc` non compressés
  (3 024 titres). Le catalogue du lanceur lit ces noms directement (« Choisir un dossier »).
- **NES No-Intro (`nes/`)** : 1 992 `.zip` à une ROM chacun, plus images et vidéos d'un front-end
  (`gamelist.xml`). Le catalogue ignore images et vidéos et ouvre les `.zip` directement.
- **Hackset NES** : 1 708 archives `.7z` « GoodMerged » contenant 34 127 ROM (jusqu'à 10 175 variantes
  dans une seule archive). Le navigateur ne les ouvre pas : il faut extraire la variante voulue avec
  7-Zip (dans un autre dossier). Le catalogue les liste avec la mention « 7z : à extraire ».
- Le catalogue ne garde que les noms en mémoire : un dossier de 11 000 ROM n'est jamais chargé en entier.

Régénérer : `node portables/tools/inventaire-roms.mjs "E:\roms\roms nes et snes" <dossier hors dépôt>`.
