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

`putBatch(identity, entries)` étend l’atomicité à un groupe de 1 à 9 emplacements
uniques d’une même identité, tous types confondus. Chaque entrée est de la forme
`{ slot, envelope }`. Tous les objets et octets sont copiés avant le premier `await`,
puis vérifiés avant l’ouverture de la transaction d’écriture. La somme des contenus
est limitée à 128 Mio et chaque enveloppe reste limitée à 64 Mio.

Une transaction IndexedDB unique lit les révisions de tous les membres, vérifie la
comparaison de révision/identifiant/empreinte avec les contenus préalablement validés,
puis écrit tous les couples courant/précédent. Le succès est rendu uniquement après
`complete`. Échec du second membre, quota ou `abort` : aucun membre n’est publié.
Un conflit concurrent recommence le groupe entier, au maximum quatre tentatives.
Une enveloppe courante corrompue ou un index incohérent refuse le groupe entier.
`put()` délègue à `putBatch()` avec un seul membre et conserve son API historique.
Le schéma de base reste en version 1 : aucune migration ni réécriture automatique.

Une entrée peut porter `deduplicate:true`. Elle reste membre de toutes les lectures
et comparaisons de révision, même si ses octets semblaient déjà présents avant le
groupe. La décision est prise dans la transaction, après le CAS : empreinte et taille
du contenu ainsi que métadonnées canoniques exactement identiques. Le module ne
réécrit alors ni courant ni précédent. Le résultat porte `skipped_unchanged:true`
et les identifiant/date/révision de l’enveloppe réellement conservée, pas ceux de la
nouvelle enveloppe inutilisée. Sans cette option, une écriture explicite conserve
son comportement historique. Un autre onglet qui modifie le natif entre la lecture
et le commit force une nouvelle validation du groupe ; la valeur concurrente reste
récupérable comme révision précédente si elle doit être remplacée.

Il ne faut donc jamais omettre le membre natif d’un groupe état+natif après une
simple lecture de déduplication hors transaction. L’appelant doit toujours le
fournir, avec l’option `deduplicate:true` si souhaitée.

Le contrôleur doit capturer état et natif au même point de session, utiliser les
mêmes octets natifs dans le paquet d’état et l’enveloppe native, puis enregistrer
les deux avec `putBatch`. Le checkpoint d’avant cheats et son natif doivent aussi
être écrits ensemble. Ce module ne peut pas rendre atomiques la mémoire d’un cœur
N64 et IndexedDB : aucune écriture ne doit précéder la validation d’une restauration
qui pourrait ensuite échouer. Un chargement qui échoue doit laisser le coffre intact.

## Délais et annulation

L’ouverture de la base et chaque transaction ont un délai nominal de 8 secondes.
Un timeout de transaction appelle `abort()` avant de rejeter `E_STORAGE_TIMEOUT` ;
les callbacks tardifs du groupe sont ignorés. Il ne s’agit pas d’un `Promise.race`
qui laisserait une écriture active après le rejet. Une ouverture tardive ferme sa
connexion ; une création de schéma tardive est avortée. Les requêtes de lecture ne
sont pas attendues isolément d’une transaction qui pourrait rester bloquée.

Si le commit natif est déjà irréversible et `abort()` échoue pour cette raison,
le module attend son événement `complete`/`abort` : annoncer une annulation et une
conservation inchangée serait faux. Le délai n’est donc pas une interruption forcée
du navigateur/du système d’exploitation. L’option de constructeur `timeoutMs` existe
pour l’injection de pannes dans les tests ; sa valeur par défaut est 8 000 ms.

Une coupure physique d’alimentation et la durabilité réelle du matériel ne sont pas
simulées. Une fermeture peut perdre l’accusé de réception d’une transaction déjà
validée : après réouverture, le groupe doit être entièrement ancien ou entièrement
nouveau, avec ses copies précédentes cohérentes, jamais une paire mélangée.

## API

```js
const envelope = await makeStateEnvelope(bytes, identity, {
  kind: 'state', label: 'Emplacement 1', cheats: []
});
const vault = new SaveStore();
// Alternative pour un seul membre : await vault.put(identity, 1, envelope);
const native = await makeStateEnvelope(nativeBytes, identity, { kind: 'battery' });
const writes = await vault.putBatch(identity, [
  { slot: 1, envelope }, { slot: 1, envelope: native, deduplicate: true }
]); // tableau dans le même ordre ; un seul commit
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

- `node tests/save-store.test.mjs` : 16 tests d’enveloppes, empreintes indépendantes,
  refus d’incompatibilité/corruption/type, limites de groupe, ouverture/lecture/écriture
  bloquées injectées, callbacks tardifs et course avec un commit irréversible.
  Les objets IDB de panne sont synthétiques : ces tests ne remplacent pas IndexedDB réel.
- `python3 tests/browser_save_store.py` : vraies transactions IndexedDB Chromium,
  fermeture et réouverture du navigateur avec profil persistant, copie précédente,
  séparation des trois types, corruption injectée, deux connexions concurrentes,
  quota injecté et suppression ciblée. Sept contrôles de groupe supplémentaires
  vérifient le succès état+natif, l’échec du second membre, l’abort après succès réel
  du premier `put`, un membre courant corrompu, les groupes concurrents, la copie des
  entrées et la fermeture du navigateur pendant une transaction tenue ouverte.
  Trois contrôles supplémentaires vérifient la déduplication avec conservation du
  précédent distinct, une vraie écriture concurrente entre lecture et commit et le
  refus de dédupliquer des métadonnées différentes.
  Données uniquement synthétiques. Le résultat navigateur doit être consigné par
  l’exécuteur ; l’écriture du banc ne constitue pas une réussite.

Le test de quota injecte une exception ; il ne remplit pas réellement un disque.
Ces tests de coffre ne constituent pas des tests de restauration du moteur N64.
