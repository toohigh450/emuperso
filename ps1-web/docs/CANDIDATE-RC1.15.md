# RC-1.15-audit-candidate — suites aux contre-audits de RC-1.14

Base exacte : `70df42eed84434efabe84f4d4a94a70f44bc8f73`, elle-même fille directe
de Claude `d4d06eaa779d25f2fd049f2d2d4d743c077d5c41`.
Branche dédiée : `codex/ps1-rc1.15-audits`. Karl a autorisé la publication des
sources et preuves partageables sur cette branche pour contre-audit GPT/Méo.
Aucune fusion main, release ou mise en ligne de site n’est effectuée.
Le code testé correspond à `a2ff191ccb8b52356c37ef5fb81761da94f187d3` ;
le commit de livraison ajoute uniquement documentation et preuves publiques.
Voir [le dossier d’audit public](audits/rc1.15/README.md).

R1 : le contrôle mémoire des archives a lieu avant toute capture et toute fermeture,
puis à nouveau après confirmation. Refus conservateur si le tas actuellement libre
ne suffit pas selon l’heuristique héritée (4,5 × fichier compressé). Cela peut refuser
un fichier qui aurait tenu après collecte de l’ancien moteur : priorité à la
préservation du jeu en cours. Une métrique absente est tracée comme indisponible.
Le navigateur n’expose pas de mesure portable permettant de garantir la mémoire.

Quand le précontrôle passe, le remplacement d’une archive demande toujours l’accord
pour fermer l’ancien moteur et abandonner la progression non enregistrée. Le dialogue
précise qu’un échec du nouveau jeu ne peut pas rétablir cette session. Les échecs de
préparation/démarrage après fermeture rappellent explicitement cette conséquence.
Les sauvegardes natives doivent être enregistrées avec succès avant la fermeture,
sauf récupération de quarantaine : aucune capture suspecte dans ce dernier cas.

R2 reste ouvert : les instantanés du tas avant/après décompression et le total réel
d’octets extraits sont des diagnostics, ni une mesure du pic ni un plafond imposé
au worker. Employer uniquement des fichiers autorisés/de confiance. Aucune hausse
du plafond de 900 Mio. Une vraie borne exigerait un décodeur isolé avec contrôle
des allocations et de la taille décompressée, pour ZIP, RAR et 7z séparément.

Tests reproductibles :

```
python tools/run_tests.py --output cache/tests
python tools/browser_real.py --output cache/browser --chromium /chemin/chromium
python tools/browser_storage.py --output cache/browser --chromium /chemin/chromium
python tools/browser_faults.py --fixture cache/browser/synthetic-demo.iso --output cache/faults --chromium /chemin/chromium
python tools/browser_archives.py --fixture cache/browser/synthetic-demo.iso --output cache/archives --chromium /chemin/chromium
```

Les scripts navigateur nécessitent Playwright, pycdlib, Chromium et le runtime local
vérifié par `docs/runtime-lock.json`. Le test de refus remplace uniquement la métrique
mémoire : le contrôleur, l’application, Chromium et PCSX sont réels, sans provoquer
d’épuisement mémoire. Les slides/copies/conditions sont observés dans la RAM synthétique,
avec traces des appels au gestionnaire natif, pas avec un accusé de réception WASM.

Les sorties locales de cette candidate prouvent 185 tests JavaScript et 10 Python,
ainsi que les essais synthétiques sous Chromium Linux. La CI de la branche dédiée
exécute séparément Node/Python sous Windows/Linux ; son résultat doit être consulté
pour le commit de livraison exact. Elle n’exécute pas les navigateurs Windows/Linux.
Voir le dossier d’audit pour les limites, empreintes et captures des essais locaux.

R4/R5 restent ouverts : pas d’ACK exhaustif des cheats, pas d’authentification complète
d’un état, pas de validation manette physique/audio/jeux commerciaux/RAR/7z de Karl.
Licences et sources correspondantes EmulatorJS/PCSX/UnRAR à clore avant diffusion.
Un nom ou un numéro de série ne constitue toujours pas une édition authentifiée.
Le verdict demeure essais privés contrôlés ; GO final réservé à Karl après audits.
