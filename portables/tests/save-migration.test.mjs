import test from 'node:test';
import assert from 'node:assert/strict';
import { planSaveMigration, CORE_SAVE_FOLDERS, LEGACY_SAVE_SYSTEMS } from '../js/save-migration.mjs';

const NEW = 'rom-abc123-gambatte';
const key = (folder, name) => `/data/saves/${folder}/${name}`;

test('ancienne sauvegarde du nom actuel copiée vers le nom de l’empreinte', () => {
  const keys = ['/data/saves/Gambatte', key('Gambatte', 'Mon jeu (France).srm'), key('Gambatte', 'Mon jeu (France).rtc')];
  const plan = planSaveMigration({ coreId: 'gambatte', newStem: NEW, oldStems: ['Mon jeu (France)', null], keys });
  assert.equal(plan.action, 'copy');
  assert.equal(plan.fromStem, 'Mon jeu (France)');
  assert.deepEqual(plan.copies, [
    { from: key('Gambatte', 'Mon jeu (France).srm'), to: key('Gambatte', `${NEW}.srm`) },
    { from: key('Gambatte', 'Mon jeu (France).rtc'), to: key('Gambatte', `${NEW}.rtc`) },
  ]);
});

test('ROM renommée : le nom du lancement précédent est utilisé', () => {
  const keys = [key('mGBA', 'Ancien nom.srm')];
  const plan = planSaveMigration({ coreId: 'mgba', newStem: 'rom-x-mgba', oldStems: ['Nouveau nom', 'Ancien nom'], keys });
  assert.equal(plan.fromStem, 'Ancien nom');
  assert.deepEqual(plan.copies, [{ from: key('mGBA', 'Ancien nom.srm'), to: key('mGBA', 'rom-x-mgba.srm') }]);
});

test('le nom actuel passe avant le nom précédent', () => {
  const keys = [key('Gambatte', 'A.srm'), key('Gambatte', 'B.srm')];
  assert.equal(planSaveMigration({ coreId: 'gambatte', newStem: NEW, oldStems: ['A', 'B'], keys }).fromStem, 'A');
});

test('une sauvegarde déjà présente sous le nouveau nom n’est jamais remplacée', () => {
  const keys = [key('Gambatte', 'Mon jeu.srm'), key('Gambatte', `${NEW}.srm`)];
  const plan = planSaveMigration({ coreId: 'gambatte', newStem: NEW, oldStems: ['Mon jeu'], keys });
  assert.equal(plan.action, 'none');
  assert.equal(plan.reason, 'already-present');
});

test('le dossier du cœur compte : une sauvegarde d’un autre cœur n’est pas reprise', () => {
  const keys = [key('DeSmuME 2015', 'Jeu DS.dsv')];
  assert.equal(planSaveMigration({ coreId: 'melonds', newStem: 'rom-y-melonds', oldStems: ['Jeu DS'], keys }).action, 'none');
  const plan = planSaveMigration({ coreId: 'desmume2015', newStem: 'rom-y-desmume2015', oldStems: ['Jeu DS'], keys });
  assert.deepEqual(plan.copies, [{ from: key('DeSmuME 2015', 'Jeu DS.dsv'), to: key('DeSmuME 2015', 'rom-y-desmume2015.dsv') }]);
});

test('nom proche refusé : « Zelda.v2.srm » et « Zelda DX.srm » ne sont pas « Zelda »', () => {
  const keys = [key('Gambatte', 'Zelda.v2.srm'), key('Gambatte', 'Zelda DX.srm'), '/data/saves/Gambatte'];
  assert.equal(planSaveMigration({ coreId: 'gambatte', newStem: NEW, oldStems: ['Zelda'], keys }).action, 'none');
});

test('rien à faire : cœur inconnu, aucun ancien nom, aucune sauvegarde', () => {
  assert.equal(planSaveMigration({ coreId: 'inconnu', newStem: NEW, oldStems: ['A'], keys: [key('Gambatte', 'A.srm')] }).reason, 'unknown-core');
  assert.equal(planSaveMigration({ coreId: 'gambatte', newStem: NEW, oldStems: [null, ''], keys: [key('Gambatte', 'A.srm')] }).reason, 'no-legacy');
  assert.equal(planSaveMigration({ coreId: 'gambatte', newStem: NEW, oldStems: ['A'], keys: [] }).reason, 'no-legacy');
});

test('consoles concernées et dossiers connus', () => {
  assert.deepEqual([...LEGACY_SAVE_SYSTEMS].sort(), ['gb', 'gba', 'gbc', 'nds']);
  for (const core of ['gambatte', 'mgba', 'desmume2015', 'desmume', 'melonds', 'fceumm', 'snes9x']) assert.ok(CORE_SAVE_FOLDERS[core], core);
});
