import test from 'node:test';
import assert from 'node:assert/strict';
import { cheatIdentity, classifyCheatFiles } from '../js/cheats.mjs';
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
  const put = adapter.put.bind(adapter);
  let fail = true;
  adapter.put = async (...args) => { if (fail) { fail = false; throw new Error('quota'); } return put(...args); };
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
