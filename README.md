# N64 Web Lab — Phase 1A

Banc d'essai **synthétique** pour le projet N64 Web de Karl.
**Ce n'est PAS un émulateur** : aucun moteur N64 réel, aucune ROM, aucun jeu.
Il simule le contrat technique (sauvegarde/chargement d'état, journal, audio)
pour valider l'instrumentation avant tout vrai moteur.

Démo en ligne : `index.html` (même contenu que `N64-Web-Lab-Phase1A.html`).

## Statut

- **Version dans ce dépôt : 1.0.2-candidate** (construite par Codex le 2026-10-28).
- Contre-audit Méo (2026-10-30) : **ACCEPTÉE comme banc synthétique, avec réserves**.
  **REJETÉE comme preuve d'émulateur / de compatibilité Conker PAL / de correctif Sonic.**
- **La 1.0.1 reste la référence.** STOP à toute promotion / remplacement sans le GO explicite de Karl.
- Tests navigateur non rejoués de façon indépendante, Windows non validé : c'est à Karl de valider sur son PC.

## Règles d'or (décidées par Karl, seul admin)

- Aucun correctif pour le plaisir de corriger. On protège ce qui marche, on documente ce qui casse, les tests décident.
- Rien n'est déclaré réparé avant le test réel de Karl.
- Aucun écrasement de la 1.0.1, aucune promotion sans son GO, aucune modification hors mandat.
- Les originaux restent intacts ; on travaille sur copies / branches.

## Collaboration (trio)

- **Méo (Muse)** : développe et propose ses corrections.
- **Codex** : travaille sur le code et les tests.
- **GPT** : audite, vérifie les régressions.
- **Karl** : teste, approuve, décide des versions officielles.

On travaille par **branches + pull requests**, pas par ZIP.
Chaque IA utilise son propre accès autorisé au dépôt.

## Provenance

- `CHANGELOG.md` : ce qui a changé en 1.0.2.
- `MANIFEST-SHA256.txt` : manifeste d'intégrité (101/101 vérifiés).
- `docs/` : rapports d'audit (Codex, GPT, contre-audit Méo).
- `references/` : pièces de transmission (fichiers binaires de référence exclus du dépôt — disponibles sur demande, traçabilité par SHA-256 dans le manifeste).
- `evidence*/` : exports de validation (captures PNG exclues du dépôt).
