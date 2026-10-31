# Point de reprise — Opération N64 Web

Mandat Karl : vrai moteur N64 autorisé, uniquement branche emulateur-reel ; aucun main,
Lab1.0.2-candidate, Conker, TN-1 ou sauvegarde originale à modifier.

Dépôt local : /workspace/emuperso-real, branche emulateur-reel,
base 1219ecfeb51a43011c050b0113aa01dd5249ed9e. Main initial4936007df68882a5417746e5ef36cfadadf5537e.
Tous nouveauxfichiers dans real-n64/ ; sourcesoriginalesdemo-n64/ intactes.

ROM Claude/libdragon compilée sans correction :147456octets,
SHA dbc... (complet homebrew/build-info.json). Boot initial échoue dans core4.2.3/2.0.2.
Plusieurs variantes bootstrap compatiblesémulateur essayées ; conserver échecs, nepaslesdirevalidées.

Succès : port autonome réel C/MIPS32, VI/SI/AI, propre boot MIT8MiB dans
homebrew/fallback-open/ ; ROM6144octets, SHA f18280a16c83721bdd56564701d505f96346784f36168402e5431b12499e2252.
Code homebrew CPUréel dans EmulatorJS4.2.3 / mupen64plus_next build2.0.2,
interpréteur simple, WebGL2. Pas de simulation du moteur.
Clavier X=A, S=B. Double tampon corrige déchirement observé. A produit vrais buffers
PCM WebAudio non nuls ; hautparleurs/manettephysique/PC Karl non testables.
Dernier résultat exact dans evidence/browser-real-results.json ; ne pas élargir sa portée.

Toolchain native officiel .deb SHAfac8e6572493a66468b7d45df41b042f90b1a630ec96aa218bd5fb1f320a0a4d,
SDKlibdragon e356bf3f56f7afbf7e5246329562f145965cfdfc. Préfixe
real-n64/cache/toolchain/opt/libdragon. Docker GHCR denied, pas prétendu validé.
Bootstrap script homebrew/setup-toolchain.py et builds fournis.
Runtime via tools/fetch_runtime.py :2paquetsNPM4.2.3 verrouillés,39assets,
stdlib seulement ; --offline et --verify-only passés. Vendor/cache ignorés Git.
Frontend nonminifié impose EJS_DEBUG_XX=true. Versioncheckpublic redirigé versversionlocale.

À finir : rapportHTML/READMEfrançais et protocoleWindows ; workflowdevbrancheuniquement ;
préservation des98fichiers initiaux ; ZIPsource+ROM sans redistribuerlecorebinaire (sourcecorrespondante
pas entièrementétablie) ; manifesteSHA ; commit/additionsseulement viaGitHubconnecteur surbranche
emulateur-reel, jamais main. Commitpasencorecréé au checkpoint.

Tests : tests/browser_real.py (résultatsJSON et captures), tests/test_real_tools.py4PASS.
Échecsinitiaux conservés. Ne pas dire queROMlibdragonstandardboote : seulportautonome passe.

Mise à jour de fin : sept groupes navigateur RÉUSSIS, zéro erreur console/page finale.
PCMmax0.13619avecA,silenceavant/après;30s stabilitéobservée. RapportRAPPORT.html,
README-FR.md, workflowdebrancheetROMautonomeprêts. Rebuildbinaireidentique.
Commit etarchiveàretrouverdansGit/delivery ; pasdefusionmain.
