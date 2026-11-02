# PSP 0.4.0-alpha.1 (branche feature/psp)

## Fait

- PSP dans le même lanceur : .iso, .cso, .pbp ; identifiant du disque lu sans charger le jeu ; .chd/.zso refusés avec la conversion à faire.
- Codes CWCheat par jeu, garde-fous (titres de section non activables, conflits signalés, fichier écrit avant le démarrage).
- Sauvegardes de carte mémoire : export/import ZIP contrôlé, copie de sécurité chaque minute ; états.
- COOP/COEP sur /portables/ (Vercel, serveur Windows, serveur de test) ; portail à 9 consoles.
- Détails, essais réels et limites : PSP.md.

## Encore à vérifier

- Effet des codes en jeu, son, manette, gros jeux, téléphone ; tests Playwright à relancer sur le PC de Karl.

# Consoles Nintendo 0.3.0 alpha.1 — NES et SNES (branche feature/nes-snes-unified)

## Fait

- NES (FCEUmm) et SNES (Snes9x) dans le même lanceur que GB/GBC/GBA/DS, accessibles depuis l'accueil commun à 8 consoles.
- Démos libres hébergées avec le site : Snake (NES, zlib), Neon Breaker et Shmup (SNES, MIT), démos Super FX / SA-1 / DSP-1.
- Catalogue de dossiers (noms seulement, liste virtuelle), filtres console / région / français / hacks / doublons, favoris.
- Codes : saisie, validation NES/SNES, activation et suppression par jeu ; codes .cht associés jamais actifs par défaut.
- Sauvegardes : export et import immédiats, 4 états par jeu avec copie du précédent, écriture immédiate avant changement de jeu.
- 0.3.0-alpha.2 : sauvegardes GB/GBC/GBA/DS liées à l'empreinte de la ROM (ROM renommée = même sauvegarde) ; l'ancienne sauvegarde est copiée au premier lancement, jamais déplacée ni supprimée.
- Tests réels dans Chrome Windows : voir TESTS-NES-SNES.md.

## Encore à vérifier

- Vrai téléphone Android (tactile, son, arrière-plan, mémoire), manettes physiques, jeux PAL, cartes NES autres que NROM.

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
