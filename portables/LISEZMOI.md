# Portables 0.2.0 — GB, GBC, GBA et Nintendo DS

Ouvre tes propres jeux dans Chrome, un seul à la fois. Aucun jeu, BIOS ou catalogue de cheats n'est fourni. Le moteur EmulatorJS se télécharge sur Internet, sauf installation locale dans `emulatorjs/data`.

## Démarrer sur Windows

Extrais tout le ZIP dans un nouveau dossier, puis double-clique sur `DEMARRER-PORTABLES.bat`. Garde la fenêtre du serveur ouverte. Choisis ton fichier, puis clique sur « Démarrer » dans la zone de jeu.

Formats : `.gb`, `.gbc`, `.gba`, `.nds`, `.zip`. Les variantes `.sgb`, `.srl`, `.bin`, `.rom`, `.dsi` et les fichiers sans extension sont reconnus si leur en-tête est identifiable. Un en-tête reconnu corrige une extension erronée ; le fichier transmis au moteur reçoit l'extension de la console détectée. Dans un ZIP contenant plusieurs jeux, indique le numéro du jeu à ouvrir. Les archives 7z, RAR, ZIP chiffrés, ZIP64 et les archives multi-volumes ne sont pas prises en charge.

## Compatibilité : ce que cela signifie

Ce projet couvre **Game Boy, Game Boy Color, Game Boy Advance et Nintendo DS**. Il ne couvre pas toutes les consoles portables (PSP, PS Vita, 3DS, etc.). Les jeux DSi exclusifs sont refusés ; les jeux DS améliorés DSi sont tentés en mode DS. Les fonctions Super Game Boy ne sont pas garanties.

Aucun émulateur ne garantit toutes les ROMs. Les hacks, homebrews, cartouches à matériel spécial, mauvais dumps et codes de triche peuvent avoir des limites propres aux cœurs. Un en-tête ou un SHA-256 n'est pas une certification de jouabilité. Un en-tête endommagé est signalé sans systématiquement bloquer les homebrews.

Cœurs : Gambatte (GB/GBC), mGBA (GBA), DeSmuME 2015 par défaut (DS), DeSmuME et melonDS au choix. melonDS demande un ZIP contenant `bios7.bin`, `bios9.bin`, `firmware.bin`, issus de ta console. L'import du BIOS n'en valide pas le contenu. Les grosses ROMs DS exigent beaucoup de mémoire : lecture, empreinte complète, extraction et moteur peuvent cumuler plusieurs copies.

## Associer les cheats à chaque ROM

1. Ouvre une ROM, puis l'onglet « Codes ».
2. Importe tes fichiers `.cht` libretro, individuellement ou par dossier. Les dossiers « Nintendo - Game Boy », « Nintendo - Game Boy Color », « Nintendo - Game Boy Advance » et « Nintendo - Nintendo DS » identifient la console ; pour des fichiers isolés, la console du jeu ouvert est utilisée.
3. Les fichiers portant le même nom sont des **suggestions**. Clique sur « Associer à cette ROM » et vérifie la région, la révision et les éventuels hacks.
4. Rouvre le jeu pour charger les codes dans le moteur. Cette association est enregistrée avec le SHA-256 complet de la ROM : elle résiste au renommage. Une ROM modifiée ou d'une autre région a sa propre association.

Une seule association manuelle de fichier est retenue par ROM ; le bouton « Retirer ce choix » permet de la changer. Un nom identique ne prouve jamais que les codes sont compatibles. Les anciens choix de la version 0.1 doivent être confirmés à nouveau.

Pour identifier directement un fichier de codes par les octets du jeu, ajoute dans ton `.cht` :

```ini
# Remplace les 64 chiffres ci-dessous par le SHA-256 COMPLET de ta ROM décompressée.
# Utilise l'empreinte réelle, pas cet exemple.
rom_sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
cheat0_desc = "Description du code"
cheat0_code = "TON_CODE"
```

L'empreinte complète apparaît en survolant celle affichée dans la fente. Sur Windows : `Get-FileHash -Algorithm SHA256 -LiteralPath 'C:\roms\jeu.gba'`. Avec un ZIP, calcule l'empreinte du jeu extrait, pas du ZIP.

Une métadonnée SHA-256 valide correspondant à la ROM permet de charger les codes même si les noms diffèrent ; plusieurs fichiers identifiés par cette empreinte peuvent être chargés. Une empreinte déclarée différente, invalide ou contradictoire exclut le fichier. La déclaration reste celle de l'auteur du fichier : elle ne vérifie pas l'efficacité de ses codes.

Les nouveaux cheats sont proposés désactivés par EmulatorJS. Le moteur peut restaurer une activation mémorisée : vérifie son gestionnaire de codes. Les formats Code Breaker, GameShark et Action Replay dépendent du cœur et de la version du jeu. Aucune conversion universelle ni base automatique pour tous les jeux n'est incluse.

## Sauvegardes et passage de 0.1 à 0.2

Les sauvegardes et états du moteur restent dans ce navigateur, à la même adresse locale et dans le même profil. La page conserve en plus trois copies de sécurité par espace (console + cœur + empreinte). Exporte-les régulièrement depuis l'onglet « Sauvegardes ». Pour restaurer un `.sav`, utilise le gestionnaire du moteur ; les états ne sont pas interchangeables entre cœurs.

Pour les nouveaux jeux, le nom interne du moteur utilise le SHA-256 complet, indépendamment du titre et du nom du fichier. Les jeux déjà enregistrés dans l'historique 0.1 conservent leur ancien nom interne pour retrouver leurs sauvegardes. Aucun ancien fichier de sauvegarde n'est supprimé par la mise à jour.

**Avant la mise à jour, exporte tes sauvegardes depuis la version 0.1**, surtout pour les ROMs DS de plus de 256 Mio : leur ancienne empreinte était un échantillon, leur empreinte complète ouvre désormais un autre espace. Restaure ton export dans le nouveau moteur. Changer de cœur DS ouvre également un autre espace. Garde le ZIP original et l'ancien dossier pendant cette vérification.

Si IndexedDB est bloqué, un avertissement indique que le stockage de la page est temporaire. Cela ne garantit pas que les sauvegardes internes du moteur fonctionneront. Vider les données du navigateur efface le stockage local. Si le lanceur change de port parce qu'il est occupé, le navigateur voit une autre adresse et donc d'autres données : reviens à l'adresse d'origine pour les retrouver.

## Tests

Logique pure : Node 22.17 ou plus récent, puis `npm test` (aucune dépendance).

Parcours navigateur avec moteur simulé : installe Playwright séparément avec `npm install --no-save playwright`, installe son Chromium avec `npx playwright install chromium`, puis `npm run test:browser`. Un Chromium déjà installé peut être indiqué via `CHROMIUM_PATH`. Ces tests utilisent des en-têtes synthétiques et ne valident pas l'émulation réelle.

Voir `ANALYSE-ET-CORRECTIONS.md` pour les résultats et `TESTS-KARL.md` pour les essais réels restants.

## Licences

EmulatorJS et les cœurs ont leurs propres licences. Vérifie-les avant toute redistribution. Aucune base de cheats, ROM commerciale ou BIOS n'a été ajouté.
