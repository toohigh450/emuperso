# Analyse et corrections — Portables 0.2.0

## Conclusion

La 0.1 contenait une base structurée et 56 tests de logique réussis. Elle ne constituait pas une preuve de compatibilité avec tous les jeux. La sélection automatique des cheats reposait sur le nom de fichier, pas sur l'identité réelle du jeu. Cette différence est cruciale pour les régions, révisions, traductions et hacks.

La 0.2 renforce les associations et le chargement. Elle n'ajoute pas de nouvelle console, de moteur d'émulation, de base de cheats ni de ROM commerciale.

## Corrections

- **ROMs** : SHA-256 sur tous les octets, même au-delà de 256 Mio. Deux modifications hors des anciens échantillons ne sont plus confondues.
- **Cheats** : le nom devient une suggestion à confirmer. L'association manuelle conserve le SHA-256 complet, indépendamment du nom. Métadonnée facultative `rom_sha256` pour une correspondance automatique déclarée par l'auteur du .cht ; empreintes différentes ou mal formées exclues. Une empreinte ne prouve pas l'efficacité d'un code.
- **Anciennes associations** : confirmation à renouveler ; suppression des liens lors de la suppression de tous les fichiers de codes. Fichiers sans code lisible ignorés.
- **Espaces du moteur** : les nouveaux jeux utilisent le SHA-256 complet dans leur nom interne, sans dépendance au titre. Les entrées déjà connues dans l'historique conservent leur ancien nom pour retrouver leurs sauvegardes, sans migration destructive.
- **Reconnaissance** : un en-tête identifiable corrige une extension de console erronée. Les extensions alternatives sont proposées dans le sélecteur et acceptées dans les ZIP. L'extension donnée au moteur correspond à la console détectée.
- **ZIP** : choix explicite du jeu dans les archives multiples ; exclusion des métadonnées macOS ; refus des volumes multiples, offsets et répertoires tronqués, taille annoncée excessive et décompression dépassant cette taille. CRC32 toujours contrôlé. Les formats ZIP64, chiffrés, RAR et 7z restent exclus.
- **Ouverture** : sérialisation du parcours de chargement, boutons désactivés durant l'ouverture, erreurs d'empreinte et de stockage affichées. L'échec de chargement d'une nouvelle ROM laisse le jeu précédent intact tant que son remplacement n'a pas commencé.
- **Stockage** : vérification effective de l'ouverture IndexedDB ; repli temporaire accompagné d'un avertissement. Les mises à jour simultanées des miroirs sont sérialisées par jeu ; les rotations ne se chevauchent plus. Elles ne constituent pas une garantie d'atomicité en cas de panne ou de quota pendant plusieurs écritures.
- **Exports** : les boutons d'une liste de sauvegardes capturent le jeu de cette liste, pour éviter de télécharger la sauvegarde d'un autre jeu lors d'un changement.
- **Moteur distant** : retrait du secours `@latest`, qui pouvait mélanger une branche de développement avec une distribution stable. Source locale puis CDN stable. Les binaires ne sont pas embarqués ou verrouillés à une version précise.
- **Windows** : contrôle de chemin avec séparateur final, pour ne pas autoriser un dossier voisin dont le nom commence comme la racine. Le serveur Windows n'a pas été exécuté ici.
- **Documentation** : distinction entre codes nouvellement importés (désactivés) et activations que le moteur peut restaurer ; limites de mémoire, de compatibilité et de mise à jour explicites.

## Vérifications effectuées

- Base 0.1 : **56 tests de logique réussis**, exécutés sous Node 24.19.0.
- Version corrigée : **67 tests de logique réussis**, zéro échec.
- Chromium : parcours d'import GB/GBC/GBA/DS avec moteur simulé ; fichier créé dans l'iframe ; un seul iframe ; suggestions sans chargement automatique par nom ; association confirmée ; renommage ; ROM modifiée ; identification déclarée par SHA-256 ; rechargement du navigateur et persistance IndexedDB ; création d'une copie miroir ; maintien des anciens noms internes ; extension corrigée ; fermeture ; démarrage avec IndexedDB bloqué. Aucune erreur JavaScript non interceptée dans le parcours principal.
- Vérification du code source public EmulatorJS : forme `EJS_cheats`, création des cheats désactivés, restauration possible des activations mémorisées, événement `saveUpdate` et réception d'un objet File. Catalogue des cœurs stable consulté : Gambatte, mGBA, DeSmuME, DeSmuME 2015 et melonDS présents.

Les contrôles du navigateur utilisent **un moteur simulé et des en-têtes synthétiques**. Ils ne prouvent ni le démarrage réel d'une ROM, ni l'effet des codes, ni la persistance des sauvegardes natives d'EmulatorJS. Les fixtures ZIP fournies restent des données synthétiques de test.

Sources consultées :
- https://github.com/EmulatorJS/EmulatorJS/blob/main/data/loader.js
- https://github.com/EmulatorJS/EmulatorJS/blob/main/data/src/emulator.js
- https://github.com/EmulatorJS/EmulatorJS/blob/main/data/src/GameManager.js
- https://cdn.emulatorjs.org/stable/data/cores/cores.json

## Limites et suite

« Toutes les ROMs » ne peut pas être garanti. Le projet se limite aux consoles GB/GBC/GBA/DS. La compatibilité et les formats de cheats dépendent des cœurs et des versions précises des jeux. Aucun catalogue de correspondances universel n'a été fourni ou téléchargé.

Restent à tester sur Windows : le lanceur, l'émulation réelle, les sauvegardes internes et leur restauration, les états, l'effet des cheats, les BIOS DS, la manette et le mode hors ligne. Le ZIP BIOS n'est pas validé à l'import. Le chargement complet et WebCrypto peuvent utiliser beaucoup de mémoire pour les grosses ROMs DS. Les anciens noms de sauvegarde des jeux déjà connus restent limités au format historique ; les nouveaux utilisent l'empreinte complète.

Pour les anciennes ROMs DS > 256 Mio, l'identifiant change : exporter les sauvegardes depuis la 0.1 avant de passer à la 0.2 et les restaurer dans le moteur. Aucun stockage ancien n'est effacé. Les associations manuelles identifient la ROM ; elles ne vérifient pas les changements ultérieurs du contenu du fichier .cht au même chemin.

## Livraison

Original inchangé : `emuperso-portables-0.1.0.zip`.
SHA-256 original : `189077e0b4cf67afcdf5bece16ffa9812a5e0050a46f6fff7a88f0d81bad43d7`.

Livraison initiale corrigée : `emuperso-portables-0.2.0.zip`, avec un fichier SHA-256 séparé. Le travail initial avait été effectué sans dépôt Git local exploitable. À la demande de Karl, cette version est ensuite intégrée dans `portables/` sur la branche GitHub `emulateur-portable` de `toohigh450/emuperso`, avec une PR de revue en brouillon. Aucune fusion, aucun déploiement ni promotion de version officielle.
