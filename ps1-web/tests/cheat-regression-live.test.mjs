// Reproduction des bogues suspectés sur le VRAI app.js RC-1.8 (avant correction).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness } from './helpers/app-harness.mjs';

const CASTLE_EU = 'Castlevania - Symphony of the Night (Europe).bin';
const MANUAL = '8001AB00 0001';

async function addManual(h, name = 'Mon code') {
  h.$('cheat-name').value = name; h.$('cheat-code').value = MANUAL; await h.$('cheat-add').onclick(); if (h.view().region?.catalogTitle === 'code manuel') await h.ctl().confirmRegion();
}

test('R1 serial-apply : échec moteur puis resynchro réussie => cheats fantômes ?', async () => {
  const h = await makeHarness({ appPath: 'app.js' });
  await h.launch('Jeu inconnu.bin');
  await addManual(h); await h.toggleRow(0, true);
  assert.equal(h.engine.active.length, 1, 'précondition : 1 cheat actif dans le moteur');
  const before = h.engine.calls.length;
  // Le prochain setCheats (celui de serial-apply) échoue en milieu de liste ; la resynchro réussit.
  h.engine.fail = n => (n === before + 1 ? 'empty' : false);
  h.$('serial-input').value = 'SLUS-00879'; await h.$('serial-apply').onclick();
  console.log('R1 UI cochés:', h.uiChecked(), '| moteur actif:', h.engine.active, '| info:', h.info());
  assert.equal(h.uiChecked().length, h.engine.active.length, 'UI et moteur doivent concorder');
});

test('R2 serial-apply : confirmation régionale contournée ?', async () => {
  const h = await makeHarness({ appPath: 'app.js' });
  // Disque dont le numéro détecté est EUROPE, l'utilisateur saisit un numéro USA du catalogue.
  await h.launch(CASTLE_EU.replace('Europe', 'Europe'), { serial: 'SLES-01881' });
  h.$('serial-input').value = 'SLUS-00594'; await h.$('serial-apply').onclick(); // Metal Gear Solid (USA)
  const idx = h.rows().findIndex(r => !/incompatible|Xploder/.test(r.text()));
  assert.ok(idx >= 0, 'une ligne compatible existe');
  await h.toggleRow(idx, true);
  console.log('R2 moteur actif après 1 clic, sans confirmation:', h.engine.active.length, '| boutons confirmation:', h.buttons().map(b => b.text()));
  assert.equal(h.engine.active.length, 0, 'aucun code USA ne doit être injecté sans confirmation sur un disque détecté Europe');
});

test('R3 changement de jeu : loadCheats échoue => liste du jeu précédent encore affichée ?', async () => {
  const h = await makeHarness({ appPath: 'app.js' });
  await h.launch('Jeu A.bin'); await addManual(h, 'Code A'); await h.toggleRow(0, true);
  assert.equal(h.uiChecked().length, 1);
  h.findOverride = async () => ({ status: 'statut-invalide', cheats: [], candidates: [] });
  await h.launch('Jeu B.bin');
  console.log('R3 UI cochés:', h.uiChecked(), '| moteur (nouveau jeu):', h.engine.active, '| statut:', h.status());
  assert.deepEqual(h.uiChecked(), [], 'le nouveau moteur est vide : rien ne doit apparaître comme actif');
});

test('R4 choix d\'édition : peut-on corriger un mauvais choix ?', async () => {
  const h = await makeHarness({ appPath: 'app.js' });
  await h.launch(CASTLE_EU);
  const before = h.buttons().map(b => b.text());
  await h.button('(USA)').onclick();
  const after = h.buttons().map(b => b.text());
  console.log('R4 boutons avant:', before, '| après:', after);
  assert.ok(after.some(t => t.includes('(Europe)') && /codes\)/.test(t)), 'les autres éditions doivent rester choisissables');
});
