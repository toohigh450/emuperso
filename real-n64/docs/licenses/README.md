# Textes de licence consultés

Ces copies textuelles ne constituent pas une déclaration de conformité complète du runtime. Les points bloquants figurent dans REDISTRIBUTION-RC.md. Aucun binaire tiers ajouté.

- EmulatorJS-4.2.3-GPL-3.0.txt : LICENSE du paquet officiel figé ; identique en octets au fichier existant vendor/LICENSE.EmulatorJS.txt.
- Mupen64Plus-container-GPL-2.0.txt : texte fourni par le conteneur du cœur, déjà conservé dans docs/core-metadata ; il ne recense pas tous les modules liés.
- Socket.IO-4.8.1-MIT.txt : source officielle au commit `8d5528aa2abc530f9e35f53935083894cec38c99`, packages/socket.io-client/LICENSE.
- nipplejs-MIT.txt : source officielle tag `v0.10.2` ; la source exacte de compilation du bundle EJS reste à établir.
- UnRAR-license.txt : licence spécifique à la source du dépôt indiqué par EJS, commit `294e362691041b70bef818628e7dfb012b2474aa`. La correspondance exacte de son binaire EJS reste à établir.
- CPython-3.12.10-LICENSE.txt : contenu de l’archive officielle Python ; fins de lignes CRLF normalisées en LF. Le hash de cette copie diffère donc du LICENSE.txt installé sous Windows. Conserver le fichier officiel intact lors d’une installation ou d’une redistribution de Python.

Le catalogue possède sa propre copie GPLv2 verrouillée dans cheat-catalog-lock.json. Les futurs avis de dépendances doivent conserver les copyrights de leurs auteurs ; ne pas afficher uniquement « MIT Karl » pour tout l’assemblage.
