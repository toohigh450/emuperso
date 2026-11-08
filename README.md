# EMUPERSO — Portail d'émulateurs web

**EMUPERSO** est un portail web local-first pour jouer à ses propres jeux dans
le navigateur : **13 systèmes** — 11 consoles (NES, SNES, Game Boy, Game Boy
Color, Game Boy Advance, Nintendo DS, Nintendo 64, PlayStation, PlayStation
Portable, Sega Genesis, GameCube) + Arcade (MAME/FBNeo) + DOOM (jeu PC).
Interface **français / anglais** (détection automatique), thème sombre,
contrôleurs physiques et tactiles, sauvegardes persistantes.

> Statut honnête : tout le portail est en **ALPHA publique**. Chaque système
> affiche son statut ; GameCube est **EN TEST** (voir limites ci-dessous).
> Aucune compatibilité n'est promise au-delà de ce qui est réellement testé.

## Liens

- **Portail de production** : https://emuperso.vercel.app
- **Lien des testeurs** (dernière branche de travail) :
  https://emuperso-git-feature-unified-controller-55789a-toohigh450-1311.vercel.app
- **GitHub Pages** : https://toohigh450.github.io/emuperso/

## Règle d'or : BYOR (Bring Your Own ROMs)

**Aucune ROM, aucun BIOS, aucune sauvegarde n'est dans ce dépôt.** Chacun
apporte ses propres jeux et ses propres fichiers système, qui restent sur sa
machine : tout est traité localement dans le navigateur (IndexedDB /
MEMFS), rien n'est uploadé.

- Les pages console acceptent les formats usuels (.nes, .smc, .gb, .gba, .nds,
  .z64, .chd, .cue, .iso, .pbp, .rvz, .zip…) et décompressent en local.
- **BIOS PS1** : chargement manuel optionnel d'un BIOS personnel (fichier
  local, jamais envoyé) — utile pour les jeux sensibles au timing comme
  *Future Cop L.A.P.D.* (bug de détection carte mémoire connu sur tous les
  émulateurs).
- **GameCube** : carte mémoire de 2 Mio par jeu, export/import `.mcr`.

## Statut par système

| Système | Statut | Notes |
|---|---|---|
| NES / SNES / GB / GBC / GBA / DS / PSP / Genesis | ALPHA | Pages unifiées, sauvegardes et cheats par jeu |
| Nintendo 64 | ALPHA | Page dédiée, sauvegardes fonctionnelles |
| PlayStation | ALPHA | BIOS HLE par défaut ; BIOS personnel possible ; carte mémoire fonctionnelle (GT2 vérifié) |
| GameCube | **EN TEST / ALPHA** | Gecko/WASM + **WebGPU requis**, sans audio, interpréteur (vitesse souvent sous le natif), pas de save states, un boot par session. Boots prouvés (FFCC, Pokémon XD) — **jouabilité complète non garantie** |
| Arcade (MAME/FBNeo) | ALPHA | Pas une console : cartes PCB,DrvX/MAME |
| DOOM | ALPHA | Jeu PC (WASM), pas une console |

## Nouveautés

- **GameCube en test** — 13e système du portail (Gecko/WASM + WebGPU, ALPHA).
  Premiers boots validés : *Final Fantasy Crystal Chronicles* et *Pokémon XD*,
  carte mémoire par jeu.
- **BIOS PS1 personnel** — charge ton propre BIOS PS1 (fichier local, jamais
  envoyé). Il corrige la détection de carte mémoire de *Future Cop L.A.P.D.*,
  un bug connu du jeu sur tous les émulateurs.
- **Sauvegardes PS1 automatiques** — la carte mémoire est capturée
  automatiquement à la fermeture et une carte vierge formatée est injectée au
  premier lancement. *Gran Turismo 2* sauvegarde à l'infini.
- **Nouveau look Portables** — les pages NES, SNES, GB, GBC, GBA, DS, PSP et
  Genesis adoptent le thème sombre N64 avec la bannière EMUPERSO ; le badge de
  version PS1 suit maintenant la vraie version.

## Comment tester

1. Ouvre le **lien des testeurs** (aucune connexion requise).
2. Choisis une console, puis « Choisir un jeu » et sélectionne **ton** fichier
   ROM local — il ne quitte jamais ton appareil.
3. Manette USB/Bluetooth recommandée ; des contrôles tactiles sont prévus.

## Règles d'or

- **Karl seul approuve** ce qui devient officiel (versions, merges).
- Travail par **branches + pull requests** — jamais de push direct sur `main`,
  jamais de force-push.
- Des preuves, pas des promesses : ne déclarer fonctionnel que ce qui est
  vérifié (statuts alpha, GameCube en test, limites connues).

## Historique

L'ancien README du banc d'essai **N64 Web Lab Phase 1A** (octobre 2026,
projet synthétique pré-émulateur) est conservé dans
[`docs/README-N64-WEB-LAB-PHASE1A.md`](docs/README-N64-WEB-LAB-PHASE1A.md).

---

## EMUPERSO — Web emulator portal

**EMUPERSO** is a local-first web portal for playing your own games in the
browser: **13 systems** — 11 consoles (NES, SNES, Game Boy, Game Boy Color,
Game Boy Advance, Nintendo DS, Nintendo 64, PlayStation, PlayStation Portable,
Sega Genesis, GameCube) + Arcade (MAME/FBNeo) + DOOM (PC game). French/English
interface (auto-detected), dark theme, physical and touch controllers,
persistent saves.

> Honest status: the whole portal is **public ALPHA**. Each system shows its
> status; GameCube is **IN TEST** (see limits below). No compatibility is
> claimed beyond what is actually tested.

### Bring Your Own ROMs

**No ROMs, no BIOS files, no saves are in this repository.** Everyone brings
their own games and system files, which stay on their machine: everything runs
locally in the browser (IndexedDB / MEMFS), nothing is uploaded.

- Console pages accept common formats (.nes, .smc, .gb, .gba, .nds, .z64,
  .chd, .cue, .iso, .pbp, .rvz, .zip…) and decompress locally.
- **PS1 BIOS**: optional manual loading of your own BIOS (local file, never
  uploaded) — useful for timing-sensitive games like *Future Cop L.A.P.D.*
  (a known memory-card detection bug on all emulators).
- **GameCube**: 2 MiB per-game memory card, `.mcr` export/import.

### System status

| System | Status | Notes |
|---|---|---|
| NES / SNES / GB / GBC / GBA / DS / PSP / Genesis | ALPHA | Unified pages, per-game saves and cheats |
| Nintendo 64 | ALPHA | Dedicated page, working saves |
| PlayStation | ALPHA | HLE BIOS by default; optional personal BIOS; working memory card (GT2 verified) |
| GameCube | **IN TEST / ALPHA** | Gecko/WASM + **WebGPU required**, no audio, interpreter (often below native speed), no save states, one boot per session. Boots proven (FFCC, Pokémon XD) — **full playability not guaranteed** |
| Arcade (MAME/FBNeo) | ALPHA | Not a console: PCB boards, MAME |
| DOOM | ALPHA | PC game (WASM), not a console |

### Changelog highlights

- **GameCube in testing** — 13th portal system (Gecko/WASM + WebGPU, ALPHA).
  First validated boots: *Final Fantasy Crystal Chronicles* and *Pokémon XD*,
  per-game memory card.
- **Personal PS1 BIOS** — load your own PS1 BIOS (local file, never uploaded).
  Fixes memory-card detection in *Future Cop L.A.P.D.*, a known game bug on all
  emulators.
- **Automatic PS1 saves** — the memory card is captured automatically on close
  and a formatted blank card is injected on first launch. *Gran Turismo 2*
  saves endlessly.
- **New Portables look** — NES, SNES, GB, GBC, GBA, DS, PSP and Genesis pages
  adopt the dark N64 theme with the EMUPERSO banner; the PS1 version badge now
  follows the real version.

### Golden rules

- **Karl alone approves** what becomes official (versions, merges).
- Work via **branches + pull requests** — never push directly to `main`, never
  force-push.
