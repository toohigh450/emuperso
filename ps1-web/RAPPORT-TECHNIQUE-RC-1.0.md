# Rapport technique — EMUPERSO PS1 Release Candidate 1.0

**Date** : 1er novembre 2026, 01h20 (America/Toronto)
**Auteur** : Méo (agent personnel de Karl)
**Statut** : Candidate pour audits finaux (Codex, GPT) et essais Windows de Karl
**Archive** : `emuperso-ps1-RC-1.0.zip` (735 Ko)
**SHA-256** : `49564677180f178d2a93619b3b11a0dea63866cf1451134f9db933d9cff85f51`

---

## 1. Résumé exécutif

La RC-1.0 intègre de façon cohérente les 6 modules du mandat de Karl :
1. Identification automatique des jeux (avec mémoire locale d'édition vérifiée)
2. Bibliothèque complète de cheats (1 394 jeux / 18 640 codes)
3. Manettes (mapping OEM + 2 profils)
4. Sauvegardes et stabilité (isolation SHA-256, restauration fidèle)
5. Interface et distribution (lanceur Windows, serveur local sécurisé)
6. Validation complète (48 tests JS + 3 tests Python, tous PASS)

**Verdict de Méo** : GO pour les essais Windows de Karl et les audits Codex/GPT.
**Publication** : NON — en attente du GO explicite de Karl après les audits.

---

## 2. Architecture

```
emuperso-ps1-RC-1.0/
├── ps1-web/
│   ├── index.html          # Interface principale
│   ├── app.js              # Logique applicative (cheats, UI, sessions)
│   ├── disc-file.mjs       # Identification des disques (5 formats)
│   ├── cheat-catalog-psx.mjs # Moteur de recherche catalogue
│   ├── data/psx-catalog.json # Catalogue (1.8 Mo, 1 394 jeux)
│   ├── input-profile.mjs   # Mapping manette OEM
│   ├── input-presets.mjs   # 2 profils nommés
│   ├── engine-session.mjs  # Interface EmulatorJS/PCSX
│   ├── session-controller.mjs # Gestion des sessions
│   ├── save-store.mjs      # Sauvegardes (IndexedDB)
│   ├── state-bundle.mjs    # États de sauvegarde
│   ├── assets/             # Fond d'écran GT
│   ├── tools/              # Lanceur Windows + serveur local
│   └── tests/              # 8 fichiers de tests JS + 1 Python
├── DEMARRER-PS1.bat        # Lanceur Windows (double-clic)
└── README-FR.md            # Documentation
```

---

## 3. Module 1 : Identification des jeux

### Formats supportés
| Format | Serial | Méthode |
|--------|--------|---------|
| ISO/BIN/IMG | ✅ Oui | Lecture SYSTEM.CNF (BOOT=cdrom:\) |
| CHD | ⚠️ Non | Signature vérifiée, serial non lisible sans décompression |
| PBP | ⚠️ Non | Signature vérifiée, serial non lisible sans décompression |

### Chaîne d'identification (par priorité)
1. **Mémoire locale** : SHA-256 du fichier → édition vérifiée (IndexedDB)
2. **Serial disque** : extrait de SYSTEM.CNF (ISO/BIN/IMG)
3. **Serial manuel** : saisi par l'utilisateur dans le panneau
4. **SerialMap** : 13 numéros connus → titre catalogue
5. **Nom de fichier** : matching par mots entiers (titleStem + titleMatches)

### Limite honnête
La décompression CHD/PBP pour lire SYSTEM.CNF interne nécessite un décodeur complet
(zlib/lzma par hunk + parsing ISO9660). Hors périmètre de cette RC. Le fallback
par mémoire locale + confirmation utilisateur couvre le besoin réel de Karl.

---

## 4. Module 2 : Cheats

### Catalogue
- **Source** : libretro-database (CC BY-SA 4.0)
- **Contenu** : 1 394 jeux, 18 640 codes
- **Formats** : GameShark (12 599), Game Buster (4 656), Xploder (576), DuckStation (88)

### Sécurité
- Tous désactivés par défaut (jamais d'activation silencieuse)
- Codes Xploder : marqués ⚠️, activation bloquée (format incompatible PCSX)
- Codes multi-instructions : validés et conservés comme un seul cheat
- Décalage région (ex: FR.pbp → codes USA) : warning explicite + confirmation requise
- Éditions multiples (USA/World) : choix explicite, jamais mélangées

### Application PCSX
Via `emulator.gameManager.setCheat(index, true, code)` (API EmulatorJS).
Les codes sont joints avec `+` comme attendu par l'API.
**Non prouvé en jeu réel** : la compatibilité de chaque code avec PCSX ReARMed
nécessite les essais Windows de Karl.

---

## 5. Module 3 : Manettes

### Mapping (Xbox 360 → PS1, positionnel OEM)
- A → ✕ (Croix), B → ○ (Rond), X → □ (Carré), Y → △ (Triangle)
- LB → L1, RB → R1, LT → L2, RT → R2
- Menu → START, View → SELECT, D-pad → D-pad

### Profils
1. **PS1 authentique** : comportement d'origine, stick analogique natif
2. **Confort moderne** : stick gauche → croix directionnelle (jeux sans stick)

### Fix critique (0.1.4)
`defaultControllers = { 0: unbound, 1: {}, 2: {}, 3: {} }` — les 4 joueurs
doivent être définis sinon `EmulatorJS.setupKeys()` crash (bug 0.1.2/0.1.3).

### Validation terrain
En attente : matrice PAD-01→13 avec la manette Xbox 360 de Karl.

---

## 6. Module 4 : Sauvegardes

- **Isolation** : par SHA-256 du fichier disque (aucune pollution entre jeux)
- **Stockage** : IndexedDB (transactions atomiques du navigateur)
- **Restauration** : les cheats actifs sont marqués `on:true` fidèlement
- **Anti-réinjection** : si édition ambiguë, les cheats restaurés attendent le choix utilisateur
- **Changement de jeu** : l'ancienne session est disposée proprement (rollback en cas d'échec)

---

## 7. Module 5 : Distribution

### Lanceur Windows
`DEMARRER-PS1.bat` → PowerShell → Python portable auto-téléchargé → serveur local.
Aucune installation requise, aucune commande à taper.

### Serveur local (tools/serve.py)
- Bind 127.0.0.1 uniquement (pas d'exposition réseau)
- Protection path traversal (allowlist)
- Pas de listing de répertoires (403)
- Headers sécurité : COOP, COEP, CORP, no-store

### Protections
- `.gitignore` : bloque ROMs, BIOS, sauvegardes, diagnostics
- Aucun jeu commercial ni BIOS inclus dans l'archive
- LICENSE MIT pour le code EMUPERSO

---

## 8. Tests

### Résultats
| Suite | Tests | Résultat |
|-------|-------|----------|
| input-profile | 18 | ✅ PASS |
| input-presets | 6 | ✅ PASS |
| disc-file | 4 | ✅ PASS |
| save-store | 9 | ✅ PASS |
| engine-input-contract | 4 | ✅ PASS |
| cheat-catalog-psx | 6 | ✅ PASS |
| cheat-integration | 10 | ✅ PASS |
| cheat-dom | 3 | ✅ PASS |
| **Total JS** | **48** | **✅ PASS** |
| test_make_lock.py | 3 | ✅ PASS |

### Ce que les tests prouvent
La logique de matching, validation, contrats d'interface, et rendu DOM.

### Ce que les tests NE prouvent PAS
- L'émulation réelle (nécessite Chrome Windows)
- La compatibilité des cheats en jeu (nécessite essais Karl)
- Le mapping manette physique (nécessite manette Xbox 360)
- La décompression CHD/PBP (hors périmètre)

---

## 9. Historique des régressions (transparence)

| Version | Problème | Cause | Résolution |
|---------|----------|-------|------------|
| 0.1.2 | Crash lancement | `defaultControllers` incomplet | 0.1.4 : 4 joueurs définis |
| 0.1.9 | `filter is not a function` | Contrat `findCheatsForGame` changé sans MAJ `loadCheats` | 0.1.10 : contrat réparé |
| 0.1.12 | Boutons USA/World effacés | `renderCheats()` après `renderCheatCandidates()` | 0.1.13 : ordre corrigé |

Chaque régression a été documentée dans `ps1-web/IMPORT-PS1.md` sur GitHub.

---

## 10. Prochaines étapes

1. **Karl** : essais Windows (FF5, NBA Jam, Dave Mirra + choix USA/World)
2. **Karl** : matrice manette PAD-01→13
3. **Codex** : audit indépendant (après N64)
4. **GPT** : audit final
5. **Karl** : GO / NO-GO publication

---

*Rapport généré par Méo le 2026-11-01. Aucune modification à la N64.*
