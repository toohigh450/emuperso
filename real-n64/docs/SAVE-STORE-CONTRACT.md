# Coffre local de sauvegardes — contrat technique

`save-store.mjs` n’exécute aucun moteur, ne lit aucune ROM et ne fait aucun appel
réseau. Il écrit uniquement dans sa nouvelle base IndexedDB
`emuperso-real-saves-v1`. Les autres bases du navigateur et les fichiers originaux
ne sont jamais ouverts par ce module.

## Identité et intégrité

Une identité comporte exactement les valeurs normalisées utilisées pour la clé :
`rom_sha256`, `engine_sha256`, `config_sha256` et `state_schema`. La ROM est identifiée
par son contenu Z64 normalisé ; son nom et son ZIP source ne participent pas à la
clé. Le contrôleur de session doit calculer les empreintes du moteur réellement
chargé et des paramètres critiques réellement employés. `fingerprintConfig()`
fournit un JSON canonique puis SHA-256 pour ces paramètres.

Une enveloppe stocke une copie du contenu, son SHA-256 et une seconde empreinte
qui lie identité, type, taille, date, identifiant et métadonnées. La vérification
refuse incompatibilités, modifications et tailles hors de 1 octet à 64 Mio. Une
signature de ROM N64 brute est refusée pour détecter une erreur d’appel évidente.
Cela ne constitue pas un analyseur de Save State N64 : la validité sémantique du
contenu reste à vérifier par le cœur et les tests de restauration réels.

## Espaces séparés

- `state` : trois emplacements utilisateur.
- `battery` : trois emplacements de sauvegardes système, indépendants des états.
- `checkpoint` : trois emplacements techniques, indépendants des états utilisateur.
  Convention du contrôleur : 1 = retour avant chargement, 2 = avant cheats.

Un écrasement conserve atomiquement l’état courant comme révision précédente.
Deux connexions concurrentes utilisent une comparaison de révision et recommencent
en cas de conflit. Une sauvegarde courante corrompue est refusée à l’écrasement pour
préserver sa copie précédente. Le contrôleur peut proposer cette copie comme secours.
Une suppression est explicite et limitée à un type, une identité et un emplacement.

La liste renvoie uniquement des métadonnées, avec `payload_verified:false` : afficher
la liste ne valide pas son contenu. `load()` effectue la vérification complète avant
de rendre des octets au contrôleur. Aucun octet de sauvegarde n’appartient à un journal
de diagnostic. Les quotas et refus IndexedDB donnent une erreur lisible ; le module
ne supprime aucune autre donnée pour libérer de la place.

L’atomicité porte sur un emplacement. Si une opération associe état et sauvegarde
système, le contrôleur doit préparer et vérifier les deux, les relier à une même
opération, et abandonner l’action si une écriture échoue. Aucun couple incohérent ne
doit être appliqué au moteur.

## API

```js
const envelope = await makeStateEnvelope(bytes, identity, {
  kind: 'state', label: 'Emplacement 1', cheats: []
});
const vault = new SaveStore();
await vault.put(identity, 1, envelope);
const { bytes: verifiedBytes, envelope: metadata } = await vault.load(identity, 1);
const previous = await vault.load(identity, 1, { previous: true });
await vault.list(identity); // métadonnées, pas le contenu
await vault.close();
```

## Limites de restauration à respecter par l’adaptateur

Dans la version EmulatorJS épinglée, `GameManager.getState()` vérifie l’indicateur
de succès fourni par le cœur et retourne une copie. En revanche `loadState()`
écrit `/game.state` puis appelle une fonction native numérique sans transmettre son
retour ; la fin du wrapper ne prouve donc pas une restauration réussie.

`EJS.pause()` arrête la boucle du cœur sans vider explicitement les tampons audio
JavaScript. Une restauration doit être testée avec une nouvelle session isolée,
les cheats désactivés/configurés explicitement, l’état validé avant application,
les horloges et l’audio observés après reprise, et un retour de secours en cas
d’échec. Aucune garantie « sans aucun bug » n’est fournie pour tous les jeux.

`GameManager.mountFileSystems()` monte toujours son propre IDBFS avec
`autoPersist:true` dans le frontend actuel, indépendamment des options qui
désactivent les caches. Le contrôleur doit isoler ou neutraliser ce stockage moteur
s’il veut confier exclusivement la persistance au coffre. Son exit handler effectue
des sauvegardes et un restart ; retirer une session ne doit pas supposer que ce
handler est un simple destructeur.

## Tests disponibles

- `node tests/save-store.test.mjs` : enveloppes, empreintes indépendantes, refus
  d’incompatibilité/corruption/type, métadonnées, limites et séparation de base.
- `python3 tests/browser_save_store.py` : vraies transactions IndexedDB Chromium,
  fermeture et réouverture du navigateur avec profil persistant, copie précédente,
  séparation des trois types, corruption injectée, deux connexions concurrentes,
  quota injecté et suppression ciblée. Données uniquement synthétiques.

Le test de quota injecte une exception ; il ne remplit pas réellement un disque.
Ces tests de coffre ne constituent pas des tests de restauration du moteur N64.
