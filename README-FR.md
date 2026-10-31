# N64 Web Lab — Phase 1A · candidate 1.0.2

**Candidate à auditer — ne remplace pas la 1.0.1. Laboratoire synthétique, sans moteur N64 ni ROM.**

Cette révision traite le mandat reçu le 28 octobre 2026, conservé dans
`references/transmission/00_MANDAT/`. Les quatre audits et les deux exports terrain
restent des références byte pour byte, pas des résultats de tests exécutés par Codex.

## Ouvrir le laboratoire

Extraire tout le ZIP et ouvrir **N64-Web-Lab-Phase1A.html**. Le HTML contient
l’interface, le code et le fond Goku/Vegeta, sans CDN, compte ou connexion requise.
Le décor apparaît uniquement sur la page principale ; aucune image de jeu.

SHA-256 utilise WebCrypto, sans repli sur un hash faible. Si le navigateur bloque
WebCrypto pour file://, dans le dossier extrait, avec Python installé :

- Windows : `py -3 -m http.server 8768 --bind 127.0.0.1`
- Linux/macOS : `python3 -m http.server 8768 --bind 127.0.0.1`

Ouvrir ensuite `http://127.0.0.1:8768/N64-Web-Lab-Phase1A.html`. Ctrl+C arrête le
serveur local. Cette alternative n’a pas été exécutée sous Windows par Codex.

## Parcours sans fichier de jeu

1. Garder « Aucun défaut injecté » ; Initialiser → Sélectionner → Charger la fixture
   → Lancer la simulation. Les trois identités correspondent à du texte synthétique.
2. Avancer une seconde fictive. Les horloges, CPU/RSP/RDP, VI/AI, PCM et audio sont
   des données de modèle. Ce ne sont pas des performances N64.
3. Injecter une dérive : pause attendue. Reprendre réancre la fenêtre. Un statut
   FULL fictif peut exister sans dérive. Une coupure PCM provoque une pause ; après
   reprise, une fenêtre normale ne doit plus re-pauser pour l’ancienne pénurie.
4. Dans États & consentement, créer un snapshot, refuser la copie altérée, restaurer
   en pause ou avec reprise explicite. Aucune vraie sauvegarde n’est lue/écrite.
5. L’écriture système fictive demande un consentement à usage unique, lié à la
   génération, au contenu, à la révision et à l’espace. Annuler ou Échap n’écrit rien.
6. Dans Identité & journal, vérifier et exporter. Le statut de fraîcheur indique si
   la liste est en cours d’actualisation, confirmée ou potentiellement ancienne.
7. Pour un défaut au prochain init : Arrêter, choisir le mode, Initialiser. La
   configuration retenue est visible et journalisée. Changer le menu seul ne change
   pas rétroactivement l’adaptateur déjà initialisé.

Tout reste **en RAM** : recharger la page ou créer un laboratoire neuf efface les
données. Les exports JSON sont volontaires. Aucun import de fichiers n’a été ajouté,
aucun stockage persistant ni pont automatique vers d’autres IA n’existe.

## Changements importants

- Configuration d’injection journalisée à chaque initialisation ; commandes de
  fenêtre et d’audio fictif consignées ; détails attendus/reçus sur refus d’identité.
- Pénuries PCM : compteur cumulatif conservé, garde-fou seulement sur nouvelle hausse.
- Options temporelles/PCM et reprise de restauration strictement typées, refusées
  avant mutation. La chaîne `resume: "false"` n’est plus interprétée comme vraie.
- Fraîcheur du journal explicite, callbacks anciens toujours ignorés.
- **Adaptateur : `synthetic-adapter/1.0.2-candidate`.** Le contrôle de build reste
  strict. Les anciens snapshots 1.0.0 sont vérifiables en lecture seule, mais sont
  refusés à la restauration dans cette candidate. Aucune migration implicite.

La version d’application est `1.0.2-candidate-phase1a`. Il s’agit d’identifiants du
simulateur, pas d’un moteur N64 compilé. Les formats JSON restent v1 ; les empreintes
des nouveaux exports changent avec les nouvelles données/versions/événements.

## Vérifications reproductibles

Aucune installation npm requise. Les outils de développement ne sont pas requis
pour ouvrir le HTML. Node 20+ et Python 3.10+ pour les scripts ci-dessous :

- `python tools/verify.py` : manifeste, lecture seule, refuse chemins sortants/symlinks.
- `node tests/core.test.mjs` : 59 tests conservés.
- `node tests/revision.test.mjs` : 23 tests ciblés supplémentaires ; `npm test` lance les deux.
- `python -m unittest discover -s tests -p test_tools.py -v` : 8 tests d’outillage.
- `node tools/verify_exports.mjs` : vérifie par défaut les deux JSON terrain reçus,
  avec un canonicaliseur indépendant et node:crypto, sans charger l’application.
  Deux chemins JSON peuvent être donnés en arguments. Le résultat est écrit sur
  stdout ; les fichiers d’entrée ne sont jamais modifiés. Ce n’est pas un import UI.
- `python tools/build.py` : assemblage de nos modules/CSS/image, aucun moteur compilé.
- `python tests/browser_check.py` : 23 contrôles Chromium du HTML livré.
- `python tests/browser_journal_race.py` : 4 contrôles DOM à promesses inversées et
  statuts de fraîcheur. Le point d’accès à Journal existe seulement dans la copie
  en mémoire du test, jamais dans le HTML livré.

Les deux scripts navigateur nécessitent Playwright et Chromium, avec un chemin Linux
explicite à adapter si nécessaire. Ils servent le document par interception locale
en mémoire, contexte hors ligne ; aucun service externe requis. Les contrôles
Chromium/Linux ne valident pas Windows, Edge, Firefox ni file:// réel.

## Preuves et décision

Rapport : **docs/Rapport-Phase1A.html**. Détails : **CHANGELOG.md**,
**docs/MATRICE-COUVERTURE.md**, **docs/VALIDATION-PC-KARL.md**,
**docs/FICHIERS-MODIFIES.json**, **evidence/**.

Les preuves courantes sont séparées des fichiers baseline-* (réexécutions de 1.0.1)
et des archives historiques evidence-v1.0.0/, evidence-v1.0.1/ et rapports anciens.
La transmission et le ZIP source reçus sont dans references/transmission/.

GO proposé : audit GPT → contre-audit Méo → validation Karl. **Aucune promotion
ni remplacement de la 1.0.1 effectué.** Aucun moteur N64, ROM ou sauvegarde originale
utilisé ; Conker, TN-1 et Hub non modifiés. Compatibilité Conker PAL, performances
et cause/correction Sonic restent non démontrées. SHA-256 apporte de l’intégrité,
pas une signature ni une preuve de provenance ou d’exécution.
