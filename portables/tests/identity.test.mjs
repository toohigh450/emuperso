import test from 'node:test';
import assert from 'node:assert/strict';
import { cheatIdentity, classifyCheatFiles, linkedCheatValid } from '../js/cheats.mjs';
import { Store, MemoryAdapter } from '../js/store.mjs';
import { analyzeRom } from '../js/systems.mjs';
import { makeGb, makeGba, makeNds } from './helpers.mjs';
const hash = 'ab'.repeat(32);

test('identité .cht : empreinte complète, casse, commentaire et métadonnée absente', () => {
  assert.deepEqual(cheatIdentity(`# rom_sha256 = "${hash.toUpperCase()}"`), { declared: true, sha256: hash });
  assert.deepEqual(cheatIdentity('cheats = 1'), { declared: false, sha256: null });
});
test('identité .cht : métadonnées invalides ou contradictoires refusées', () => {
  for (const text of ['rom_sha256 = "abc"', `rom_sha256 = ${hash}\nrom_sha256 = ${'cd'.repeat(32)}`, `rom_sha256 = ${hash}\nrom_sha256 = invalide`, `rom_sha256 = "${hash}`]) {
    assert.deepEqual(cheatIdentity(text), { declared: true, sha256: null });
  }
});
test('un nom identique ne prouve pas l’identité ; une empreinte différente exclut les suggestions', () => {
  const files = [
    { name: 'jeu.cht', path: 'name' },
    { name: 'renommé.cht', path: 'sha', romSha256: hash, identityDeclared: true },
    { name: 'jeu.cht', path: 'other', romSha256: 'cd'.repeat(32), identityDeclared: true },
    { name: 'jeu.cht', path: 'invalid', romSha256: null, identityDeclared: true },
  ];
  const result = classifyCheatFiles('jeu.gba', hash, files);
  assert.deepEqual(result.identified.map(f => f.path), ['sha']);
  assert.deepEqual(result.exact.map(f => f.path), ['name']);
});
test('métadonnées de cheats conservées par console et suppression des associations périmées', async () => {
  const store = new Store(new MemoryAdapter());
  await store.importCheatFile({ system: 'gba', path: 'jeu.cht', name: 'jeu.cht', text: `rom_sha256 = ${hash}` });
  assert.equal((await store.listCheatFiles('gba'))[0].romSha256, hash);
  assert.deepEqual(await store.listCheatFiles('gb'), []);
  await store.setCheatLink('gba:key', { path: 'jeu.cht', romSha256: hash });
  await store.clearCheatFiles();
  assert.equal(await store.getCheatLink('gba:key'), null);
});
test('sauvegardes simultanées : les trois dernières versions restent distinctes et ordonnées', async () => {
  const store = new Store(new MemoryAdapter());
  await Promise.all([1, 2, 3, 4].map(n => store.mirrorSave('jeu', new Uint8Array([n]), `hash${n}`, n)));
  const info = await store.mirrorInfo('jeu');
  assert.deepEqual(info.map(s => s.hash), ['hash4', 'hash3', 'hash2']);
});
test('une sauvegarde en échec ne bloque pas les suivantes', async () => {
  const adapter = new MemoryAdapter();
  const rotate = adapter.rotateMirror.bind(adapter);
  let fail = true;
  adapter.rotateMirror = async (...args) => { if (fail) { fail = false; throw new Error('quota'); } return rotate(...args); };
  const store = new Store(adapter);
  await assert.rejects(store.mirrorSave('jeu', new Uint8Array([1]), '1'), /quota/);
  await store.mirrorSave('jeu', new Uint8Array([2]), '2');
  assert.equal((await store.getMirrorSave('jeu')).hash, '2');
});
test('détection par contenu : extension erronée et fichier sans extension', () => {
  assert.equal(analyzeRom('jeu.gb', makeGba()).system, 'gba');
  assert.equal(analyzeRom('jeu.gba', makeNds()).system, 'nds');
  assert.equal(analyzeRom('jeu.nds', makeGb()).system, 'gb');
  assert.equal(analyzeRom('jeu', makeGba()).system, 'gba');
  assert.equal(analyzeRom('jeu.exe', makeGba()).ok, false);
});

test('réimport au même chemin : contenu changé, ancien lien refusé', async () => {
  const store = new Store(new MemoryAdapter());
  const input = {system: 'gba', path: 'game.cht', name: 'game.cht', text: 'cheat0_code = "1234"'};
  await store.importCheatFile(input);
  const old = await store.getCheatFile('gba', input.path);
  const link = {romSha256: hash, contentSha256: old.contentSha256};
  assert.equal(linkedCheatValid(link, old, hash), true);
  await store.importCheatFile({...input, text: 'cheat0_code = "5678"'});
  const changed = await store.getCheatFile('gba', input.path);
  assert.equal(changed.reviewRequired, true);
  assert.equal(linkedCheatValid(link, changed, hash), false);
  assert.equal(linkedCheatValid({...link,contentSha256: changed.contentSha256}, changed, hash), true);
});

test('réimport identique conserve le lien ; fichier déclaré changé exclu du chargement automatique', async () => {
  const store = new Store(new MemoryAdapter());
  const input = {system: 'gba', path: 'game.cht', name: 'game.cht', text: `rom_sha256 = ${hash}\ncheat0_code = "1234"`};
  await store.importCheatFile(input);
  const old = await store.getCheatFile('gba', input.path);
  await store.importCheatFile(input);
  assert.equal((await store.getCheatFile('gba', input.path)).reviewRequired, false);
  await store.importCheatFile({...input, text: input.text+'\n# modifié'});
  assert.equal(classifyCheatFiles('game.gba', hash, await store.listCheatFiles('gba')).identified.length, 0);
  assert.equal(linkedCheatValid({romSha256:hash}, old, hash), false);
});

test('identifiants numériques : collision résolue, attribution persistante et retour en début de plage', async () => {
  const adapter = new MemoryAdapter();
  const store = new Store(adapter);
  assert.equal(await store.engineNumericId('A', 0x7fffffff), 0x7fffffff);
  assert.equal(await store.engineNumericId('B', 0x7fffffff), 2);
  assert.equal(await new Store(adapter).engineNumericId('B', 500), 2);
  assert.equal(await store.engineNumericId('C', 2), 3);
  await assert.rejects(store.engineNumericId('D', -1), /invalide/);
});
