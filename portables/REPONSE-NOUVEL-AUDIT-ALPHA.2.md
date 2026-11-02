# Nouvel audit — corrections 0.2.1-alpha.2

Reprise locale le 1er novembre 2026 (America/Toronto), depuis `0afd862e` sur `emulateur-portable`. PR #1 conservée en brouillon.

| Point | Résultat |
| --- | --- |
| B04, panneaux asynchrones | Tickets de génération séparés pour sauvegardes, historique et codes ; construction hors DOM puis publication uniquement pour le jeu et le ticket courants. Invalidation et nettoyage au remplacement, à la fermeture et à l'échec moteur. Les lectures ne bloquent plus le changement suivant. Test Chrome : A lent, B rapide, résolution de A ; historique et codes de B inchangés, aucun miroir de A. Fermeture pendant lecture et panne moteur testées. |
| B03, confirmation des codes | Accord explicite limité aux octets de la ROM et au contenu du fichier. `reviewRequired` reste volontairement vrai pour bloquer le chargement automatique global ; un lien confirmé avec l'empreinte courante autorise cette seule ROM. Le panneau l'explique et retire le bouton de revérification devenu inutile. Retirer le choix ne réactive pas le fichier modifié. Une nouvelle modification pendant la confirmation est refusée. Tests du lien courant, ancien, autre ROM et chargement automatique. |
| B06, historique | Compteurs distincts : ouvertures, moteurs prêts, parties démarrées. `plays` augmente seulement sur le premier `onStart` de l'ouverture. Notifications dupliquées ou anciennes ignorées par la session. Les anciens `plays` deviennent des ouvertures historiques non vérifiées, jamais des parties validées. Écritures d'historique sérialisées. L'avertissement sur les progrès non enregistrés de A reste affiché avant remplacement. |
| B09, import des codes | 2 Mio par fichier ; 1000 fichiers et 32 Mio par lot ; 5000 fichiers et 64 Mio au total (texte UTF-8). Préparation, progression tous les 20 fichiers préparés/refusés, résumé et rapport téléchargeable des refus. La console de repli est capturée au début du lot. Lecture du catalogue une fois par lot, puis transaction unique IndexedDB : quota ou interruption annule aussi les remplacements et préserve tous les imports précédents. Tests du plafond total et d'un abort au milieu d'un lot. |
| B05, mémoire | Plafond théorique et dépendance au budget expliqués dans Moteur ; confirmation d'une grosse ROM affiche estimation et budget. Aucun budget ne garantit la RAM libre. La politique mémoire n'est pas relâchée. |
| B08, BIOS | Mention explicite : structure et CRC seulement ; entrées supplémentaires ignorées, les trois fichiers attendus à la racine restent contrôlés. Aucun BIOS fourni, importé ni ajouté. |
| B10, Windows | `HttpListener` échouait ici avec « opération non prise en charge sur cette plateforme » ; Python était un alias Store inexécutable. Le serveur utilise désormais `TcpListener` sur 127.0.0.1, sans HTTP.sys. Tests du serveur réel avec port occupé, GET, HEAD, MIME, 404, 405 et traversées refusées. Option `-SansNavigateur` pour tester sans ouvrir le profil habituel. Le double-clic et la manette restent à valider manuellement. |
| B11, Vercel | Autorisation explicite du lien de 23 h reçue ; lien créé et route `/portables/` du commit de reprise confirmée HTTP 200 avec le titre Portables. Aucun réglage de protection modifié. Ce contrôle HTTP ne certifie pas l'émulation distante. |

## Essais locaux avec de vrais fichiers

Windows, Node 24.22.1 et Chrome installé ; Playwright installé séparément hors dépôt. Tous les profils navigateur de test sont isolés du profil habituel. Les deux `.sav` présents ont été copiés hors dépôt avant les essais ; leurs empreintes originales sont vérifiées à la fin.

- GB et GBC extraits par 7-Zip dans un dossier privé séparé. Archives originales conservées. Les fichiers 7z et torrent ne sont pas ouverts comme des ROMs par l'application ; messages spécifiques ajoutés.
- Vrai EmulatorJS 4.2.3 et vrais cœurs : GB → GBC → GBA → GB, un seul iframe, état démarré et canvas ; fermeture finale sans iframe. Captures inspectées localement. Cela confirme le démarrage de ces trois fichiers, pas tous les jeux du pack, le son ou la manette.
- GBA / mGBA : sauvegarde existante de 131072 octets chargée par le bouton du gestionnaire du moteur et son sélecteur de fichier ; miroir créé, export par le bouton de la page, fermeture, rechargement de la page, réouverture, puis restauration de l'export par le gestionnaire. Octets et SHA-256 identiques à chaque étape. Parcours exécuté aussi via le vrai serveur PowerShell à `http://127.0.0.1:18765/`. Aucune nouvelle progression sauvegardée dans le jeu n'est revendiquée.
- DS : le ZIP sélectionné n'était pas une archive lisible par 7-Zip, dans un dossier encore en téléchargement. Essai différé ; aucun échec de compatibilité DS n'en est déduit.

Les ROMs, BIOS, sauvegardes, empreintes privées et captures de jeu restent hors dépôt et hors distribution. Aucun catalogue de titres ou de codes n'est publié.

## Encore ouvert

Nouvelle progression et sauvegarde depuis le menu de chaque vrai jeu, restauration GB/GBC/DS, cheats réellement actifs sur la bonne révision, son et commandes/manette physiques, double-clic Windows dans le profil habituel, gros jeux DS complets, mode entièrement hors ligne et licences/intégrité de toutes les sous-ressources du moteur. La version reste alpha ; aucune fusion ni promotion en production.

78 tests de logique, contrôle de syntaxe, parcours Chrome simulé et serveur Windows réussis ; journaux alpha.2 dans `preuves/`.

## Reproduction sans fichiers privés

Depuis `portables/` : `npm ci --ignore-scripts`, `npm run check`, `npm test`, puis `npm run test:browser` (Playwright/Chrome séparés). Sur Windows : `npm run test:windows`. Les tests publics restent synthétiques et ne téléchargent aucune ROM.
