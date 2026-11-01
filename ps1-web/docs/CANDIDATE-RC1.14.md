# RC-1.14-claude-codex — candidate PS1 intégrée

Base : `d4d06eaa779d25f2fd049f2d2d4d743c077d5c41` (RC-1.13-claude.2).
Le fond d’écran manquant est repris sans modification de `0f6749f`.
Cette branche ne contient aucun commit ni fichier du QG privé.
Karl a autorisé la publication des sources sur GitHub ; aucune fusion main,
release GitHub ni mise en ligne de site n’est effectuée.

Fonctions Claude conservées : lecture par blocs, SHA-256 incrémental, progression,
annulation, diagnostic, archives RAR/ZIP/7z et filtre de formats de cheats.
Correctifs intégrés : faux positifs Us, effets RAM/confirmation de cheats,
blocage des captures incertaines, quarantaine et reprise neuve.
Le validateur refuse aussi 50/C2 sans données et les slides 50 dont la donnée
n’est pas une écriture 30/80 (le cœur ignorerait le bloc).

Tests : `python tools/run_tests.py --output cache/tests` ; la CI dédiée Windows/Linux
exécute les tests unitaires/intégration, pas des navigateurs sur ces deux OS.
Les scripts `tools/browser_real.py`, `tools/browser_storage.py` et
`tools/browser_faults.py` testent un ISO synthétique et le vrai cœur sous Chromium.
Le script faults prend `--fixture chemin/synthetic-demo.iso --output chemin/faults`.
Aucun jeu ni BIOS commercial n’est fourni ou téléchargé.

Limites : le facteur mémoire 4.5 des archives est indicatif, pas une borne de la
taille décompressée ; employer uniquement des archives autorisées/de confiance.
900 Mio reste le plafond par fichier compressé ou disque, sans garantie de boot.
Pour une archive, l’ancien jeu est fermé avant lancement après accord explicite ;
un échec ultérieur ne peut pas rétablir ce moteur fermé. Les sauvegardes connues
sont conservées. En récupération de quarantaine, aucun état suspect n’est capturé.
Pour les disques ordinaires, le remplacement conserve la session précédente
jusqu’au démarrage réussi du candidat.

Une API void qui ne lève pas d’erreur n’est pas un ACK de la liste native.
Les fautes de tests sont instrumentées à la frontière JS/native, pas à l’intérieur
du WASM. Les états n’ont pas de validation universelle de contenu ; le dialogue
le rappelle. Manette physique, son de jeux réels, RAR/7z terrain et compatibilité
universelle restent à contre-auditer. Le boot ZIP synthétique n’établit pas cela.
