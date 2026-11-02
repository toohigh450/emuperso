# Correctifs des audits cloud — 2 novembre 2026

Base : branche `feature/nes-snes-unified`, commit `7d2db05426c7d1589b6290499511ac32fa97f709`.
Validation nouvelle sur Windows, Node 24.22.1 et Chrome installé, profils de test isolés.

## Changements

- Import de sauvegarde : une erreur de copie (notamment quota IndexedDB) interrompt le remplacement.
  L'ancienne sauvegarde reste dans le moteur et le message propose « Exporter maintenant ».
  La copie automatique signale ses erreurs sans rejet asynchrone perdu. Un changement de jeu pendant
  la lecture ou la copie annule l'import. La présence d'une ancienne copie n'est annoncée que si elle existe.
- Codes : ajout, suppression, activation et rapprochement des fichiers associés passent par une
  transaction unique lecture/modification/écriture. Deux onglets ne peuvent plus perdre une mutation
  en réécrivant une liste périmée. Un doublon est contrôlé dans cette transaction.
  Cela ne synchronise pas automatiquement les moteurs déjà ouverts dans d'autres onglets.
- Moteur : les erreurs et rejets continuent à remonter après `ready`, pendant le démarrage et en jeu.
  Le clic Démarrer arme un délai distinct de 120 secondes, annulé au lancement ou à la fermeture.
  L'attente de l'utilisateur devant le bouton Démarrer ne consomme pas ce délai.
- Test navigateur : attendre `body.dataset.ready` avant d'envoyer une ROM après rechargement.
- DS : retour de Pong-NDS au commit `80ff184546cc20cfd1a117f15ed8f4453b4db24b`, avant la mise à jour
  libnds 2.0. Le binaire auparavant sélectionné au commit `dfabbdde` donne une image native entièrement
  blanche avec DeSmuME 2015. L'auteur documente une incompatibilité liée à libnds 2.0 :
  https://github.com/Chi-Iroh/Pong-NDS#libnds-20. Le résultat ne signifie pas que toutes les ROM DS échouent.
- Les tests du portail mesurent désormais l'image native du cœur ; la bordure et les contrôles du
  lanceur ne peuvent plus masquer une image blanche. Le test de collection refuse aussi l'image uniforme.
- La fiche de compatibilité distingue les essais Windows précédemment rapportés et ceux revérifiés ici.

## Vérifications effectuées

| Vérification | Résultat |
|---|---|
| Logique `npm test` | 113/113 |
| Syntaxe `npm run check` | Réussie |
| `npm run test:browser` | 3 groupes existants et 3 groupes de régression réussis |
| Quota à l'import | Aucun remplacement ; ancienne sauvegarde `[1,2,3]` conservée ; export possible |
| Import après rétablissement du stockage | `[9,9,9]` importé ; copie `[1,2,3]` relue dans IndexedDB |
| Codes simultanés | Deux activations en interface conservées et appliquées ; deux onglets conservent leurs ajouts |
| Mutation de codes annulée | Liste inchangée ; mutation suivante réussie |
| Erreurs moteur | Erreur après ready, rejet asynchrone et erreur en jeu affichés au lanceur |
| Délai du cœur | Attente avant clic sans erreur ; démarrage bloqué détecté ; lancement réussi annule le délai |
| Vrais cœurs NES/SNES `npm run test:real` | 43/43, dont sauvegardes, états, cheats, relance du navigateur et cinq démos |
| Pong-NDS corrigé, DeSmuME 2015 | 256×384 ; 262 puis 261 couleurs ; compteur 725 → 1210 |
| Pong-NDS corrigé, DeSmuME | 256×384 ; 262 puis 261 couleurs ; compteur 727 → 1212 |
| Super Mario Bros. (Europe), ROM locale | Démarrage NROM PAL, 50 images/s, 10 couleurs natives |
| Tetris DS (Europe), ROM locale | Démarrage DeSmuME 2015, 60 images/s, 12 couleurs natives |

Les ROM personnelles ont été lues depuis `E:\roms`, sans modification ni publication. Le dossier
`D:\roms ps1` a été repéré ; aucun changement PS1 ni test PS1 commercial n'est revendiqué ici.
Aucun test de téléphone physique, de manette physique, d'écoute audio ou de partie complète.

## Reproduction

Depuis `portables`, avec Playwright installé et `CHROMIUM_PATH` vers Chrome :

```text
npm test
npm run check
npm run test:browser
npm run test:real
npm run test:nds
```

`tests/real-nds.mjs` accepte aussi le chemin d'une ROM locale en argument et `DS_CORES` pour sélectionner
les cœurs séparés par des virgules. Les démos restent épinglées et leurs empreintes sont vérifiées.

## Plein écran et migration — 0.3.0-alpha.3

La migration des sauvegardes de Claude (9f49847) est intégrée. Son essai réel repasse 16/16 avec les correctifs réunis. NES/SNES : 43/43.

Start, Select, Fast et Slow disposent maintenant d’une bande opaque séparée de l’image native. Les cibles tactiles mesurent au moins 44 pixels et restent accessibles avant, pendant et après le plein écran. La barre native est déplacée au-dessus de cette bande pour ne pas intercepter les pressions. La disposition se désactive lorsque la manette tactile est masquée.

`npm run test:fullscreen` vérifie le vrai moteur GBA, la vraie API Fullscreen et les pressions/relâchements des quatre commandes sur trois profils Android simulés : paysage 844×390, portrait 390×844 et tablette 1024×768. Essais avec la démo libre et une ROM GBA locale. Aucun téléphone physique revendiqué.

### Limite N64 encore ouverte

Super Mario 64 (Europe) démarre et progresse, mais restaurer certains états avec le cœur Mupen64Plus-Next verrouillé provoque une erreur WebAssembly dans le chemin audio. Le chargement reste refusé et la session précédente est conservée. Ce défaut ne fait pas partie des corrections validées de cette version. Les contrôles d’identité et de mémoire ne sont pas affaiblis et aucun état sauvegardé n’est modifié.
