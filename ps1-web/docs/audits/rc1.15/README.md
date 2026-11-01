# RC-1.15 — sources et preuves publiques pour contre-audit

Version : **RC-1.15-audit-candidate**. Code testé :
`a2ff191ccb8b52356c37ef5fb81761da94f187d3`.
Base : `70df42eed84434efabe84f4d4a94a70f44bc8f73` ; parent direct de cette base :
Claude `d4d06eaa779d25f2fd049f2d2d4d743c077d5c41`.

Karl a autorisé la publication de la branche `codex/ps1-rc1.15-audits` pour audit.
Le commit de livraison ajoute uniquement ces preuves et la documentation ;
il conserve les sources applicatives et harnais du commit testé.
Aucune fusion main, release ni mise en ligne du site. Aucun GO de compatibilité
universelle ou d’approbation des auditeurs sur cette candidate n’est revendiqué.

## Entrées pour GPT et Méo

- [Rapport HTML autonome](AUDIT-CODEX-RC1.15.html) : correctif, preuves, limites.
- [Résultats structurés](validation.json).
- [Manifestes des preuves](SHA256SUMS) et [sources du commit testé](tested-sources-a2ff191.sha256).
- [Suite Node/Python](evidence/tests/summary.json) : **185 JS + 10 Python** ; TAP et journal Python dans le même dossier.
- [Vrai cœur et 7 cas régionaux](evidence/real-browser.json), avec contrôle positif de l’injection RAM.
- [Persistance et restauration après redémarrage](evidence/browser-storage.json).
- [13 contrôles de fautes/quarantaine](evidence/native-faults.json).
- [11 contrôles archives/codes composés](evidence/browser-archives.json).
- [Commandes des trois harnais](evidence/browser-executions.json), [contexte](evidence/execution-context.json) et captures PNG dans evidence/.
- [Reproduction avant correction](evidence/memory-refusal-before-fix.json) : contrôleur/app réels, moteur doublé et métrique mémoire forcée.

Ces preuves ont été collectées localement sous Linux sur le commit testé. Elles
ne sont pas les sorties d’un navigateur GitHub Actions. La CI de cette branche
exécute uniquement Node/Python sous Windows/Linux ; consulter son run lié au
commit de livraison pour savoir si ces deux jobs ont effectivement réussi.

## Correctif et limites

Le contrôle mémoire d’une archive intervient avant capture/fermeture de l’ancien
jeu, puis après confirmation. Un refus préserve la session, la RAM et les slots.
Si la fermeture est acceptée et que le nouveau jeu échoue ensuite, l’ancien
moteur reste irrécupérable : dialogue et erreur le disent explicitement.
Le facteur 4,5 est conservateur, pas une borne de décompression ; les octets
réels et le tas sont journalisés avant/après, sans mesurer le pic du worker.

Les codes composés slide16/copy4/conditional16 sont observés en RAM native ;
les formats 32 bits restent rejetés sans appel natif. Aucun ACK exhaustif du
cœur ni aucune authentification universelle d’un state ou d’une édition.

Les fichiers sont tous issus d’essais synthétiques autorisés. La métrique mémoire
est forcée pour le refus : aucune panne par épuisement réel n’a été provoquée.
Aucune manette physique, musique de jeu commercial, archive RAR/7z terrain ou
compatibilité générale CHD/PBP/multidisque n’est démontrée. Plafond 900 Mio inchangé.
Les licences/sources correspondantes tierces restent à examiner avant diffusion
exécutable/site. Aucun runtime généré, profil Chromium, ROM/BIOS commercial,
sauvegarde utilisateur, audit reçu ou contenu QG privé n’est ajouté ici.

## Reproduire

Les cinq commandes et dépendances sont décrites dans
[la fiche candidate](../../CANDIDATE-RC1.15.md). Lancer les trois scripts historiques
puis browser_archives.py sur l’ISO synthétique généré par browser_real.py.
Contrôler les assertions JSON, les journaux et la RAM, pas seulement les captures.

Les premières tentatives de collecte ont révélé un accès loopback interdit dans
la sandbox initiale, un littéral mal échappé dans le nouveau harnais, la lecture
vide d’un panneau replié avec inner_text, et un contrôle natif à délai fixe instable.
Les harnais livrés corrigent la collecte et attendent l’écriture RAM avec timeout.
Les tentatives échouées et audits originaux restent dans le dossier local privé.
