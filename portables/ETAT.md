# Portables 0.2.1-alpha.2 — 1er novembre 2026 (Toronto)

## Fait

- Nouvel audit : panneaux asynchrones B04, confirmation locale des codes B03, historique B06 et plafonds/transaction d'import B09 traités. Mémoire et contrôle BIOS précisés.
- 78 tests de logique, syntaxe, parcours Chrome simulé et serveur Windows réussis. Preuves alpha.2 dans preuves/.
- Serveur PowerShell réparé avec TcpListener ; port occupé et routes HTTP testés, sans ouvrir le profil habituel.
- Vrais cœurs GB/GBC/GBA démarrés dans Chrome, puis retour au premier GB et fermeture.
- Sauvegarde GBA de 128 Kio : chargement, miroir, export, rechargement de page, réouverture et restauration identiques octet par octet, via le vrai serveur PowerShell. Les deux sauvegardes originales sont inchangées.
- Autorisation spécifique Vercel reçue : lien temporaire créé et route /portables/ de l'aperçu de reprise confirmée HTTP 200. Protection inchangée.

## Encore à vérifier

- DS : ZIP choisi encore illisible pendant les téléchargements ; attendre un fichier complet.
- Nouvelle progression sauvegardée depuis le menu du jeu ; restauration GB/GBC/DS, son, clavier et manette physiques, cheats réellement actifs, gros jeux DS.
- Double-clic Windows et ouverture du navigateur dans le profil habituel. Les tests utilisent -SansNavigateur et des profils Chrome isolés.
- Licences et intégrité de toutes les sous-ressources du moteur ; mode entièrement hors ligne. L'accès HTTP Vercel ne certifie pas l'émulation distante.

## Livraison

Voir REPONSE-NOUVEL-AUDIT-ALPHA.2.md pour les résultats et limites. PR #1 en brouillon ; pas de fusion ni de promotion de production. Aucune ROM, aucun BIOS, aucune sauvegarde ou capture privée dans le dépôt ou l'archive de distribution. Les aperçus de branche Vercel sont automatiques.
