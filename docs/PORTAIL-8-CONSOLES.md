# Portail EMUPERSO — 8 consoles sur un seul site

Branche : `feature/nes-snes-unified`. Aucun changement sur `main` tant que la PR n'est pas acceptée.

## Une seule page d'accueil

L'accueil commun est `portail/index.html`, publié comme page d'accueil du site (`dist/index.html`) par
`tools/build-portail.mjs`. Il mène à :

| Console | Application | Moteur |
|---|---|---|
| NES / Famicom | `portables/?console=nes` | EmulatorJS 4.2.3 + FCEUmm |
| Super Nintendo / Super Famicom | `portables/?console=snes` | EmulatorJS 4.2.3 + Snes9x |
| Game Boy | `portables/?console=gb` | EmulatorJS 4.2.3 + Gambatte |
| Game Boy Color | `portables/?console=gbc` | EmulatorJS 4.2.3 + Gambatte |
| Game Boy Advance | `portables/?console=gba` | EmulatorJS 4.2.3 + mGBA |
| Nintendo DS | `portables/?console=nds` | EmulatorJS 4.2.3 + DeSmuME / melonDS |
| Nintendo 64 | `real-n64/` | EmulatorJS 4.2.3 + Mupen64Plus-Next (moteur verrouillé) |
| PlayStation | `ps1-web/` | EmulatorJS 4.2.3 + PCSX ReARMed (moteur verrouillé) |

Le `index.html` du dépôt **n'est pas modifié** : c'est une copie octet pour octet du laboratoire N64 Phase 1A,
protégée par `real-n64/tests/test_real_tools.py` (`test_originals_preserved`, avec `README.md`). Sur le site
construit, l'accueil devient le portail et le laboratoire reste publié à `N64-Web-Lab-Phase1A.html`
(lien en pied de page). **C'est un changement visible en production après fusion : il demande l'accord
de Karl.**

NES et SNES rejoignent l'application `portables/` déjà utilisée pour GB/GBC/GBA/DS : même fente, mêmes
sauvegardes, même catalogue, même panneau de codes. Aucun second portail.

## Construction Vercel (`vercel.json`)

Le projet Vercel `emuperso` servait le dépôt tel quel. N64 et PS1 demandent un moteur téléchargé et
vérifié (SHA-256) à la construction, comme sur leurs projets dédiés `emuperso-n64-alpha` et
`emuperso-ps1-alpha`. `vercel.json` enchaîne donc :

1. `ps1-web/tools/fetch_runtime.py` puis `build-vercel-alpha.py` → `ps1-web/dist/`
2. `real-n64/tools/fetch_runtime.py`, `fetch_cheats.py` puis `build-vercel-alpha.py` → `real-n64/dist/`
3. `tools/build-portail.mjs` → `dist/` : tout le site statique + les deux `dist` ci-dessus.

`build-portail.mjs` refuse les liens symboliques et écarte tout fichier de ROM, disque, archive ou
sauvegarde, sauf les homebrews libres de `portables/demos/` (licences jointes). Les lanceurs Windows
(`.bat`, `.ps1`) ne sont pas publiés.

En-têtes : `/real-n64/*` et `/ps1-web/*` gardent leurs en-têtes d'isolation (COOP/COEP/CORP, `no-store`)
identiques à leurs `vercel.json` d'origine.

Essai local (Python 3.10+, Node 22+) :

```
python ps1-web/tools/fetch_runtime.py && python ps1-web/tools/build-vercel-alpha.py
python real-n64/tools/fetch_runtime.py && python real-n64/tools/fetch_cheats.py && python real-n64/tools/build-vercel-alpha.py
node tools/build-portail.mjs
node tools/serve-portail.mjs 8080
```

Puis http://127.0.0.1:8080/. Tests réels (Chrome requis, Playwright installé à part) :
`node tools/test-portail.mjs`, `node tools/test-mobile.mjs`, et dans `portables/` : `npm test`,
`npm run test:browser`, `npm run test:real`.

## Sauvegardes sans conflit sur une même origine

Toutes les consoles partagent désormais l'origine du site. Vérifications faites :

- `portables/` : base IndexedDB `emuperso-portables` (version 2, ajout des magasins `codes` et `states`
  sans toucher aux données existantes). Espace de sauvegarde = console + cœur + SHA-256 de la ROM.
- NES/SNES : le fichier de sauvegarde du moteur porte le nom `rom-<sha256>-<cœur>` : une sauvegarde par
  jeu, même ROM renommée, jamais partagée entre deux ROM de même nom.
- N64 et PS1 : même base `emuperso-real-saves-v1`, même schéma (`slots`, index `group`) ; chaque
  enregistrement est indexé par l'empreinte de (ROM, moteur, configuration). Aucun listage global.
- Moteur EmulatorJS : dossier `/data/saves` commun (IndexedDB), fichiers nommés `EMUPERSO_LOCAL_<sha256>`
  (N64/PS1), `rom-<sha256>-<cœur>` (NES/SNES) ou nom du fichier d'origine (GB/GBC/GBA/DS, inchangé).

Limite connue (antérieure, non modifiée pour ne pas perdre de sauvegardes) : pour GB/GBC/GBA/DS, la
sauvegarde du moteur suit le nom du fichier ROM. Une ROM renommée ne retrouve pas sa sauvegarde du
moteur (la copie de sécurité du lanceur, elle, suit l'empreinte) ; deux ROM différentes de même nom
partageraient ce fichier. Une migration est proposée dans la PR.
