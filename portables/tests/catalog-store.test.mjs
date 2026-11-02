import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, filterCatalog, visibleWindow, systemFromPath } from '../js/catalog.mjs';
import { Store, MemoryAdapter, STATE_SLOTS } from '../js/store.mjs';

// Faux fichiers : seuls nom, taille et chemin sont lus par le catalogue (comme des File du navigateur).
const file = (path, size = 1024) => ({ name: path.split('/').pop(), size, webkitRelativePath: path,
  arrayBuffer() { throw new Error('le catalogue ne doit jamais lire les octets'); } });

test('Catalogue : consoles, filtres régions / français / hacks, doublons et tri', () => {
  const { entries, skipped } = buildCatalog([
    file('roms/snes/Zelda (F) [!].smc'),
    file('roms/snes/Zelda (U) [!].smc'),
    file('roms/snes/Zelda (U) [h1].smc'),
    file('roms/snes/Zelda (U) [!].smc'),
    file('roms/nes/Legend of Zelda, The (USA).zip'),
    file('roms/nes/1942 [Japan][USA][GoodSet][T+Fre1.0_ks151].nes'),
    file('roms/nes/images/Zelda.png'),
    file('roms/Hackset-NES/NES Roms/1942.7z'),
  ]);
  assert.equal(skipped, 1);
  assert.equal(entries.length, 7);
  assert.equal(entries.find((e) => e.ext === 'zip').system, 'nes');
  assert.equal(entries.find((e) => e.ext === '7z').system, 'nes');
  assert.equal(filterCatalog(entries, { system: 'snes' }).length, 4);
  assert.equal(filterCatalog(entries, { system: 'snes', hideDuplicates: true }).length, 3);
  assert.equal(filterCatalog(entries, { region: 'USA', kind: 'originaux', hideDuplicates: true }).length, 2);
  assert.equal(filterCatalog(entries, { french: true }).length, 2);
  assert.equal(filterCatalog(entries, { kind: 'hacks' }).length, 1);
  assert.equal(filterCatalog(entries, { kind: 'traductions' })[0].info.translation, 'Fre');
  assert.equal(filterCatalog(entries, { q: 'legend zelda' }).length, 1);
  const zelda = entries.filter((e) => e.key === 'zelda');
  assert.equal(zelda[0].variants, 4);
  const fav = new Set([entries[0].favKey]);
  assert.equal(filterCatalog(entries, { favorites: true, favSet: fav }).length, 1);
});

test('Catalogue : 11 337 entrées indexées sans lire un octet, fenêtre virtuelle bornée', () => {
  const files = Array.from({ length: 11337 }, (_, i) => file(`snes/Jeu ${i} (U).smc`, 1 << 20));
  const started = performance.now();
  const { entries } = buildCatalog(files);
  assert.equal(entries.length, 11337);
  assert.ok(performance.now() - started < 3000);
  const w = visibleWindow(entries.length, 56 * 5000, 460, 56);
  assert.ok(w.last - w.first <= 30);
  assert.equal(w.first, 5000 - 8);
});

test('Catalogue : console déduite du dossier pour les archives', () => {
  assert.equal(systemFromPath('FULL Super Nintendo -- Famicom/A/x.zip'), 'snes');
  assert.equal(systemFromPath('roms/gba/x.zip'), 'gba');
  assert.equal(systemFromPath('divers/x.zip'), null);
});

test('Stockage : codes par jeu, isolés entre jeux', async () => {
  const store = new Store(new MemoryAdapter());
  await store.setCodes('nes:aaa', [{ id: '1', name: 'Vies', code: 'SXIOPO', enabled: false, origin: 'manuel' }]);
  assert.equal((await store.getCodes('nes:aaa')).length, 1);
  assert.deepEqual(await store.getCodes('snes:aaa'), []);
});

test('Stockage : états de jeu, l’ancien est gardé quand on remplace un emplacement', async () => {
  const store = new Store(new MemoryAdapter());
  await store.putState('nes:fceumm:x', 1, new Uint8Array([1]), {}, 10);
  await store.putState('nes:fceumm:x', 1, new Uint8Array([2]), {}, 20);
  assert.deepEqual([...(await store.getState('nes:fceumm:x', 1)).bytes], [2]);
  assert.deepEqual([...(await store.getState('nes:fceumm:x', 1, true)).bytes], [1]);
  const list = await store.listStates('nes:fceumm:x');
  assert.equal(list.length, STATE_SLOTS);
  assert.deepEqual([list[0].at, list[0].previousAt, list[1].at], [20, 10, null]);
  assert.equal(await store.getState('snes:snes9x:x', 1), null);
  await assert.rejects(store.putState('nes:fceumm:x', 9, new Uint8Array([1])), /Emplacement/);
  await store.deleteState('nes:fceumm:x', 1);
  assert.equal(await store.getState('nes:fceumm:x', 1), null);
});
