# Portables 0.2.1 alpha — GB, GBC, GBA et Nintendo DS

Version alpha : exporte tes sauvegardes avant les essais. Ouvre tes propres jeux dans Chrome, un seul à la fois. Aucun jeu, BIOS ou catalogue de cheats n'est fourni. Le moteur EmulatorJS 4.2.3 se télécharge sur Internet, sauf installation locale complète dans `emulatorjs/data`. Le code tiers peut accéder à la ROM et au stockage ; voir `THIRD-PARTY.md`. La page ne programme pas d’envoi des ROMs, mais cela n’est pas une garantie sur le fournisseur distant.

## Démarrer sur Windows

Extrais tout le ZIP dans un nouveau dossier, puis double-clique sur `DEMARRER-PORTABLES.bat`. Garde la fenêtre du serveur ouverte. Choisis ton fichier, puis clique sur « Démarrer » dans la zone de jeu.

Formats : `.gb`, `.gbc`, `.gba`, `.nds`, `.zip`. Les variantes `.sgb`, `.srl`, `.bin`, `.rom`, `.dsi` et les fichiers sans extension sont reconnus si leur en-tête est identifiable. Un en-tête reconnu corrige une extension erronée ; le fichier transmis au moteur reçoit l'extension de la console détectée. Dans un ZIP contenant plusieurs jeux, indique le numéro du jeu à ouvrir. Les archives 7z, RAR, ZIP chiffrés, ZIP64 et les archives multi-volumes ne sont pas prises en charge.

## Compatibilité : ce que cela signifie

Ce projet couvre **Game Boy, Game Boy Color, Game Boy Advance et Nintendo DS**. Il ne couvre pas toutes les consoles portables (PSP, PS Vita, 3DS, etc.). Les jeux DSi exclusifs sont refusés ; les jeux DS améliorés DSi sont tentés en mode DS. Les fonctions Super Game Boy ne sont pas garanties.

Aucun émulateur ne garantit toutes les ROMs. Les hacks, homebrews, cartouches à matériel spécial, mauvais dumps et codes de triche peuvent avoir des limites propres aux cœurs. Un en-tête ou un SHA-256 n'est pas une certification de jouabilité. Un en-tête endommagé est signalé sans systématiquement bloquer les homebrews.

Cœurs : Gambatte (GB/GBC), mGBA (GBA), DeSmuME 2015 par défaut (DS), DeSmuME et melonDS au choix. melonDS demande un ZIP contenant `bios7.bin`, `bios9.bin`, `firmware.bin`, issus de ta console. L’import vérifie la structure ZIP, les trois noms uniques à la racine, les tailles et les CRC. Il ne prouve pas l’authenticité du BIOS. Les anciens BIOS stockés sont contrôlés avant utilisation. Les grosses ROMs DS exigent beaucoup de mémoire. Maximum 512 Mio ; estimation prudente avant lecture/décompression, tenant compte du jeu actif et de l’archive. À partir de 256 Mio, une confirmation affiche l’estimation. Un budget excessif est refusé. Ce contrôle ne mesure pas la RAM libre et ne garantit pas l’absence de manque de mémoire.

## Associer les cheats à chaque ROM

1. Ouvre une ROM, puis l'onglet « Codes ».
2. Importe tes fichiers `.cht` libretro, individuellement ou par dossier. Les dossiers « Nintendo - Game Boy », « Nintendo - Game Boy Color », « Nintendo - Game Boy Advance » et « Nintendo - Nintendo DS » identifient la console ; pour des fichiers isolés, la console du jeu ouvert est utilisée.
3. Les fichiers portant le même nom sont des **suggestions**. Clique sur « Associer à cette ROM » et vérifie la région, la révision et les éventuels hacks.
4. Rouvre le jeu pour charger les codes dans le moteur. Cette association est enregistrée avec le SHA-256 complet de la ROM : elle résiste au renommage. Une ROM modifiée ou d'une autre région a sa propre association.

L’association mémorise aussi le SHA-256 du texte .cht importé. Un réimport modifié au même chemin bloque les codes jusqu’à nouvelle confirmation, y compris pour un fichier déclarant rom_sha256. Les anciennes associations sans empreinte de contenu doivent être confirmées à nouveau.

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

Les sauvegardes et états du moteur restent dans ce navigateur, à la même adresse locale et dans le même profil. La page conserve en plus trois copies de sécurité par espace (console + cœur + empreinte), mises à jour dans une transaction IndexedDB atomique. Cela ne remplace pas un export hors navigateur ni un essai réel de restauration. Exporte-les régulièrement depuis l'onglet « Sauvegardes ». Pour restaurer un `.sav`, utilise le gestionnaire du moteur ; les états ne sont pas interchangeables entre cœurs.

Pour les nouveaux jeux, le nom interne du moteur utilise le SHA-256 complet, indépendamment du titre et du nom du fichier. Les jeux déjà enregistrés dans l'historique 0.1 conservent leur ancien nom interne pour retrouver leurs sauvegardes. Aucun ancien fichier de sauvegarde n'est supprimé par la mise à jour.

**Avant la mise à jour, exporte tes sauvegardes depuis la version 0.1**, surtout pour les ROMs DS de plus de 256 Mio : leur ancienne empreinte était un échantillon, leur empreinte complète ouvre désormais un autre espace. Restaure ton export dans le nouveau moteur. Changer de cœur DS ouvre également un autre espace. Garde le ZIP original et l'ancien dossier pendant cette vérification.

Si IndexedDB est bloqué, un avertissement indique que le stockage de la page est temporaire. Cela ne garantit pas que les sauvegardes internes du moteur fonctionneront. Vider les données du navigateur efface le stockage local. Si le lanceur change de port parce qu'il est occupé, le navigateur voit une autre adresse et donc d'autres données : reviens à l'adresse d'origine pour les retrouver.

## Tests

Logique pure : Node 22.17 ou plus récent, puis `npm test` (aucune dépendance).

Parcours navigateur avec moteur simulé : installe Playwright séparément avec `npm install --no-save playwright`, installe son Chromium avec `npx playwright install chromium`, puis `npm run test:browser`. Un Chromium déjà installé peut être indiqué via `CHROMIUM_PATH`. Ces tests utilisent des en-têtes synthétiques et ne valident pas l'émulation réelle.

La CI exécute syntaxe et logique sous Linux/Windows avec Node 22/24 ; un succès ne teste pas le lanceur Windows ni les jeux. Les résultats locaux sont dans `preuves/`.

Le test `npm run test:engine`, avec `ENGINE_FIXTURE_DIR` pointant sur les trois fichiers de `emulatorjs/engine-lock.json`, vérifie le vrai frontend 4.2.3, sans cœur ni jeu. Les empreintes sont contrôlées avant son exécution.

Voir `REPONSE-AUX-AUDITS-0.2.1.md` pour les résultats et `TESTS-KARL.md` pour les essais réels restants.

## Changement de jeu et aperçu web

La lecture et l’enregistrement du candidat précèdent le remplacement de la session. En cas d’erreur à cette étape, le jeu actif reste cohérent. Dès son remplacement, l’ancienne partie est fermée : si le nouveau moteur échoue ensuite, les progrès non enregistrés de l’ancienne partie ne sont pas récupérés automatiquement.

La PR est en brouillon et main garde le laboratoire N64. Vercel génère des aperçus de branche automatiquement, avec protection SSO observée. Utilise la route `/portables/` d’un aperçu autorisé, pas la racine N64, et vérifie la version affichée. Aucun démarrage réel de jeu sur cette URL n’est certifié ici.

## Licences

EmulatorJS et les cœurs ont leurs propres licences. Vérifie-les avant toute redistribution. Aucune base de cheats, ROM commerciale ou BIOS n'a été ajouté.
