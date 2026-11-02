# EMUPERSO PS1 — RC-1.15-audit-candidate

Candidate locale issue des contre-audits de RC-1.14 : voir `docs/CANDIDATE-RC1.15.md`.
Le refus mémoire d’une archive conserve le jeu en cours. Un échec après fermeture
explicitement acceptée demeure irrécupérable ; les sauvegardes enregistrées restent conservées.
Les sections de versions anciennes ci-dessous décrivent l’historique, pas une
authentification actuelle d’édition : nom, région et série restent des indices.


**Statut** : Candidate pour audits finaux et essais Windows de Karl.
**Date** : 1er novembre 2026
**Validation candidate** : voir `docs/CANDIDATE-RC1.14.md` et les journaux fournis. Les anciens totaux ci-dessous sont historiques.
**Essais terrain** : À faire par Karl sur Windows (Chrome + manette Xbox 360)

> **Note d'honnêteté** : Les tests automatisés valident la logique, pas l'émulation réelle.
> La compatibilité des cheats avec PCSX ReARMed en jeu, le mapping manette terrain (matrice PAD-01→13),
> et la lecture des numéros de série CHD/PBP (nécessite décompression complète) restent à valider.

---

## Nouveauté RC-1.0 : reconnaissance automatique des jeux
- **Mémoire locale d'édition vérifiée** : quand tu confirmes une édition (ou entres un serial), l'émulateur mémorise le lien fichier→édition. La prochaine fois, reconnaissance automatique sans choix USA/World!
- **Saisie manuelle du numéro de série** : nouveau champ dans le panneau cheats. Entre le numéro du boîtier (ex: SLUS-01156) pour une identification exacte.
- **SerialMap enrichi** : 13 numéros connus (FF Anthology, FFVII, MGS, Crash, Tony Hawk, Tekken...).
- **Badge ✅** : quand l'édition est reconnue automatiquement, le panneau l'indique clairement.
- Tous les cheats restent désactivés par défaut. Aucune réinjection avant validation.

## Corrections RC-1.0 (audit GPT Dave Mirra)
- **DOM** : les boutons USA/World ne sont plus effacés — `renderCheats()` d'abord, `renderCheatCandidates()` ensuite SANS `replaceChildren()`.
- **Réinjection** : les cheats restaurés ne sont plus injectés dans le moteur avant le choix d'édition (détection d'ambiguïté avant `sessions.start()`).
- **Tests DOM** : 3 nouveaux tests vérifient que les boutons survivent au rendu.

## Corrections RC-1.0 (mandat Karl + audit GPT)
1. **Compatibilité régionale** : décalage FR→USA détecté et affiché clairement ; activation bloquée jusqu'à confirmation explicite de l'utilisateur.
2. **Restauration** : les codes restaurés d'un état sont marqués on:true même en cas d'ambiguïté ; le choix d'édition les réapplique correctement. Jamais d'injection silencieuse.
3. **Interface** : le message affiche le vrai nombre de codes ACTIFs dans le moteur, plus de « Aucun actif » mensonger.

## Correction critique RC-1.0 (régression audit GPT)
- **Contrat findCheatsForGame réparé** : loadCheats() utilise maintenant result.status/result.cheats au lieu de traiter l'objet comme un tableau. L'erreur « catalogCheats.filter is not a function » est éliminée.

## Corrections RC-1.0 (audit GPT complet)
- **Sélection de région** : quand plusieurs variantes existent (ex: Dave Mirra USA/World), l'utilisateur choisit explicitement — jamais de mélange.
- **États explicites** : le catalogue retourne `loaded` | `load_error` | `no_match` | `match` | `ambiguous`.
- **Erreurs visibles** : échec de chargement du catalogue affiché à l'utilisateur, pas « 0 cheat ».
- **titleStem** : normalisation robuste (extension + région retirées, chiffres romains convertis).
- **Tests d'intégration** : 6 nouveaux tests avec le vrai catalogue (NBA Jam 12 codes, Dave Mirra USA/World séparés, Xploder marqués).

## Corrections RC-1.0 (audit GPT cheats)
- **Titre nettoyé** : l'extension (.pbp/.chd/.iso) et les tags de région sont retirés avant le matching — « Final Fantasy 5 FR.pbp » matche maintenant le catalogue.
- **Validateur multi-instructions** : accepte les codes GameShark avec plusieurs paires « XXXXXXXX YYYY » par ligne.
- **Codes Xploder** : marqués ⚠️ « non supporté par PCSX » au lieu d'être cachés ; activation bloquée avec explication.
- **Ancien catalogue vide supprimé** : plus de fetch inutile vers cheats/catalog.json.
- **Erreurs de catalogue visibles** : console.warn en cas d'échec de chargement.

## Nouveautés RC-1.0
- **Catalogue de cheats PS1** : 1 394 jeux, 18 640 codes (source : libretro-database, CC BY-SA 4.0).
  - Panneau « Cheats du jeu » déplacé directement sous l'émulateur.
  - Les cheats du jeu chargé apparaissent automatiquement ; changement de jeu = remplacement auto.
  - Tous désactivés par défaut, activation individuelle. Badge 📥 = importé non validé, ✅ = validé en jeu.
  - Lookup par numéro de série (5 mappings) puis fallback par titre. Aucun mélange entre jeux.
  - Codes manuels toujours possibles (sauvegardés par jeu dans le navigateur).
- **Fond d'écran racing** : wallpaper original style Gran Turismo (assets/gran-turismo-racing.webp).

## Correction RC-1.0 (audit GPT blocage manette)
- **Cause racine du crash** : `defaultControllers` ne définissait que le joueur 0, mais `EmulatorJS.setupKeys()` boucle sur 4 joueurs → `this.controls[1]` undefined → `TypeError: Cannot read properties of undefined (reading '0')`.
- **Fix** : `defaultControllers = { 0: unbound, 1: {}, 2: {}, 3: {} }` — joueur 0 neutralisé (mapping custom), joueurs 1-3 gardent leurs bindings natifs.
- **Test de contrat** : `tests/engine-input-contract.test.mjs` (4 tests) vérifie la structure à 4 joueurs et simule le merge + setupKeys d'EmulatorJS.

## Corrections RC-1.0 (suite à l'audit GPT pré-test)
- **Profil persisté** : `normalizeInput` préserve désormais `_profile` — le profil choisi (« PS1 authentique » / « Confort moderne ») survit au rechargement.
- **Préréglage complet** : le changement de profil synchronise aussi la case « commandes natives » (`in-native`).
- **Diagnostic enrichi** : les erreurs d'opération capturent désormais la stack trace (2000 caractères) pour identifier le blocage de démarrage observé en 0.1.2.
- **Note** : `defaultControllers` est le nom d'option correct dans EmulatorJS (vérifié dans le source) — pas de changement requis.

Projet indépendant de la N64 : dossier, port (8771), base de sauvegardes et page séparés. Rien du dépôt N64 n'est modifié ; les modules réutilisés ont été **copiés** depuis `real-n64/` (MIT).

## Ce que ce paquet n'a PAS prouvé
Écrit sans accès Internet et sans Windows : **jamais lancé**. Seuls des tests unitaires ont tourné (`tests/`, 24 JS + 3 Python) : validation des disques, calcul des commandes, coffre de sauvegardes, verrouillage du cœur sur un faux paquet. **Aucun jeu n'a démarré**, ni image, ni son, ni sauvegarde réelle.

## Fonctionnement (même chaîne que DEMARRER-N64.bat)
`DEMARRER-PS1.bat` → `ps1-web/lancer.bat` → PowerShell → Python portable vérifié (même verrou que la N64) → `tools/launcher.py` → EmulatorJS 4.2.3 (empreintes reprises du verrou N64) + cœur `pcsx_rearmed` → serveur local 127.0.0.1:8771 → Chrome.

**Écart avec la N64** : les empreintes du cœur PS1 n'étaient pas connues ici. `tools/make_lock.py` les calcule au **premier lancement** (SHA-512 vérifié contre le registre npm, puis SHA-256 figés dans `docs/runtime-lock.json`). C'est de la confiance au premier téléchargement, à relire avant toute publication.

## Exigences du mandat
| Exigence | État |
|---|---|
| Lanceur double-clic, sans installation/compte/admin | écrit, **non testé** |
| Import local sans envoi | écrit (iso/bin/img/chd/pbp, signatures, taille), **non testé** dans Chrome |
| Sauvegardes par jeu jamais mélangées | clé = SHA-256 du disque + moteur + configuration ; module N64 réutilisé, tests unitaires OK ; **restauration réelle non testée** |
| Chargement sans bug | chargement = session neuve + vérification de taille + progression d'images ; **en-tête d'état PS1 non vérifié** |
| Changement de jeu en session | session isolée (iframe) comme la N64, **non testé** |
| Cheats par jeu | mécanisme écrit (série du jeu ou empreinte, ajout manuel GameShark) ; **catalogue vide** |

## Profils de commandes (nouveau en RC-1.0 — contribution Méo)

Deux profils nommés, sélectionnables dans la section « Manette », enregistrés par jeu :

| Profil | Comportement |
|---|---|
| **Confort moderne** (défaut) | Mapping positionnel OEM. Le stick gauche pilote aussi la croix (zone morte réglable). |
| **PS1 authentique** | Commandes originales, aucune simulation stick → croix. |

Le changement de profil applique un préréglage aux contrôles ; chaque réglage reste ajustable individuellement.
Module : `input-presets.mjs` (6 tests). Logique de mapping : `input-profile.mjs` de Claude (5 tests).

## Limites connues
- **Formats supportés** : `.iso`, `.bin` (piste unique uniquement), `.img`, `.chd`, `.pbp`.
- **Formats NON supportés** : `.cue` seul (refusé avec message clair) ; jeux à **plusieurs pistes** `.bin`+`.cue` (piste data + pistes audio CD) — non pris en charge dans cette version ; pas de ZIP.
- **Identification** : le numéro de série interne (SYSTEM.CNF) est lu pour ISO/BIN/IMG. Pour CHD/PBP, le serial n'est pas lisible sans décompression complète — l'édition est mémorisée après votre choix, ou saisie manuellement.
- BIOS : non géré (BIOS émulé du cœur). Le BIOS utilisateur viendra après le premier test.
- Carte mémoire : le chemin de sauvegarde du cœur est supposé ; le diagnostic dira s'il diffère.
- Absents par rapport à la N64 : export/import d'états, point de retour avant cheats, tests navigateur.
- **Licences (B07)** : EmulatorJS et cœurs sous GPL à ma connaissance, **à vérifier** avant publication. Catalogue de cheats : libretro-database, **CC BY-SA 4.0** (attribution requise). Aucun disque ni BIOS distribué. Vérification complète des licences requise avant toute diffusion publique.

## Commandes manette (RC-1.0)
**Vérifié dans la documentation, pas par un test :**
- Cœur PCSX ReARMed : l'option réelle est `pcsx_rearmed_pad1type` = standard | analog | dualshock | negcon | none. En `standard` (numérique), le cœur ignore les sticks : c'est pourquoi seule la croix répondait. `analog` émule un Analog/Dual Analog (LED verte), `dualshock` un DualShock (LED rouge). Autre option : `pcsx_rearmed_analog_axis_modifier` (circle | square). Je n'ai trouvé aucune option de zone morte des sticks : elle est appliquée par cette application.
- Certains jeux ne répondent plus en mode analogique (cas rapporté : Air Combat) et les jeux d'avant mi-1997 n'ont pas d'analogique : réglage **par jeu**, numérique par défaut.
- EmulatorJS : identifiants RetroPad (B=0, Y=1, SELECT=2, START=3, croix 4-7, A=8, X=9, L/R=10/11, L2/R2=12/13, L3/R3=14/15, sticks 16-23), `simulateInput(joueur, id, valeur)` existe, `EJS_defaultControls` devient `defaultControllers` en interne.

**Non vérifié (le code source d'EmulatorJS n'était pas accessible ici) :**
- valeur analogique 0..0x7fff pour les identifiants 16-23 (constante `SCALE`, `input-profile.mjs`) ;
- que `value2: ''` retire bien une liaison manette native et que `emulator.controls` soit la table vivante ;
- un signalement public indique que `simulateInput` peut être capricieux hors focus.
Au démarrage, le diagnostic exporté contient `input.verify` : ligne réelle de l'option du cœur et table réelle des commandes. Si les doubles commandes ou l'absence de réponse apparaissent, cocher « commandes natives » pour le jeu.

**Comportement voulu (non testé) :** Xbox 360 positionnelle (A bas = Croix, B droite = Rond, X gauche = Carré, Y haut = Triangle) ; croix physique toujours active ; mode numérique (défaut) : stick gauche → croix ; mode analogique/DualShock : stick gauche (et droit) → sticks PS1 ; zone morte réglable par jeu ; réglage enregistré par numéro de série (ou empreinte). Un changement redémarre le jeu ; le type de manette est dans l'identité des états (séparés), pas dans celle de la carte mémoire.
