import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, MemoryAdapter, SAVE_GENERATIONS } from '../js/store.mjs';

const newStore = () => new Store(new MemoryAdapter());
const bytes = (n, fill) => new Uint8Array(n).fill(fill);

test('copie miroir : 3 générations, la plus récente d\'abord, rien n\'est écrasé sans trace', async () => {
  const s = newStore();
  await s.mirrorSave('sp', bytes(4, 1), 'h1', 100);
  await s.mirrorSave('sp', bytes(4, 2), 'h2', 200);
  await s.mirrorSave('sp', bytes(4, 3), 'h3', 300);
  await s.mirrorSave('sp', bytes(4, 4), 'h4', 400);
  const info = await s.mirrorInfo('sp');
  assert.equal(info.length, SAVE_GENERATIONS);
  assert.deepEqual(info.map((i) => i.hash), ['h4', 'h3', 'h2']);
  assert.deepEqual((await s.getMirrorSave('sp', 0)).bytes, bytes(4, 4));
  assert.deepEqual((await s.getMirrorSave('sp', 2)).bytes, bytes(4, 2));
});

test('copie miroir : une version identique n\'est pas dupliquée', async () => {
  const s = newStore();
  await s.mirrorSave('sp', bytes(4, 1), 'h1', 100);
  const r = await s.mirrorSave('sp', bytes(4, 1), 'h1', 200);
  assert.equal(r.changed, false);
  assert.equal((await s.mirrorInfo('sp')).length, 1);
});

test('espaces de sauvegarde indépendants : jamais mélangés', async () => {
  const s = newStore();
  await s.mirrorSave('gba:mgba:aaa', bytes(4, 1), 'h1');
  await s.mirrorSave('gba:mgba:bbb', bytes(4, 9), 'h9');
  await s.mirrorSave('nds:melonds:aaa', bytes(4, 5), 'h5');
  assert.deepEqual((await s.getMirrorSave('gba:mgba:aaa')).bytes, bytes(4, 1));
  assert.deepEqual((await s.getMirrorSave('gba:mgba:bbb')).bytes, bytes(4, 9));
  await s.deleteMirror('gba:mgba:aaa');
  assert.equal(await s.getMirrorSave('gba:mgba:aaa'), null);
  assert.deepEqual((await s.getMirrorSave('gba:mgba:bbb')).bytes, bytes(4, 9));
  assert.deepEqual((await s.getMirrorSave('nds:melonds:aaa')).bytes, bytes(4, 5));
});

test('la copie stockée est indépendante du tampon d\'origine', async () => {
  const s = newStore();
  const src = bytes(4, 1);
  await s.mirrorSave('sp', src, 'h1');
  src.fill(0);
  assert.deepEqual((await s.getMirrorSave('sp')).bytes, bytes(4, 1));
});

test('historique des jeux : compteur et tri par dernière partie', async () => {
  const s = newStore();
  await s.recordGame({ gameKey: 'a', title: 'A' }, 100);
  await s.recordGame({ gameKey: 'b', title: 'B' }, 200);
  await s.recordGame({ gameKey: 'a', title: 'A' }, 300);
  const list = await s.listGames();
  assert.deepEqual(list.map((g) => g.gameKey), ['a', 'b']);
  assert.equal(list[0].plays, 2);
  await s.forgetGame('a');
  assert.equal((await s.listGames()).length, 1);
});

test('fichiers de codes par console + association explicite', async () => {
  const s = newStore();
  await s.importCheatFile({ system: 'gba', path: 'x/A.cht', name: 'A.cht', text: 'cheats = 0' });
  await s.importCheatFile({ system: 'nds', path: 'x/B.cht', name: 'B.cht', text: 'cheats = 0' });
  assert.equal((await s.listCheatFiles('gba')).length, 1);
  assert.equal((await s.listCheatFiles('nds'))[0].name, 'B.cht');
  assert.equal((await s.getCheatFile('gba', 'x/A.cht')).text, 'cheats = 0');
  assert.equal(await s.countCheatFiles(), 2);
  await s.setCheatLink('gba:abc', { path: 'x/A.cht', name: 'A.cht' });
  assert.equal((await s.getCheatLink('gba:abc')).name, 'A.cht');
  await s.setCheatLink('gba:abc', null);
  assert.equal(await s.getCheatLink('gba:abc'), null);
  await s.clearCheatFiles();
  assert.equal(await s.countCheatFiles(), 0);
});

test('réglages et BIOS', async () => {
  const s = newStore();
  assert.equal(await s.getSetting('dsCore', 'desmume2015'), 'desmume2015');
  await s.setSetting('dsCore', 'melonds');
  assert.equal(await s.getSetting('dsCore', 'x'), 'melonds');
  assert.equal(await s.getBios('nds-bios'), null);
  await s.setBios('nds-bios', bytes(3, 7));
  assert.deepEqual((await s.getBios('nds-bios')).bytes, bytes(3, 7));
  await s.deleteBios('nds-bios');
  assert.equal(await s.getBios('nds-bios'), null);
});
