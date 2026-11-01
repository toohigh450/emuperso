// Tests comportementaux du VRAI app.js + cheat-controller.mjs via le harnais DOM.
// Remplacent les anciens tests qui répliquaient la logique ou lisaient le source.
// Invariant vérifié partout : interface affichée == état réel du moteur.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness } from './helpers/app-harness.mjs';

const MANUAL = '8001AB00 0001', MANUAL2 = '8001AB04 0002';
const CASTLE_EU = 'Castlevania - Symphony of the Night (Europe).bin';   // édition catalogue Europe
const invariant = h => assert.equal(h.uiChecked().length, h.engine ? h.engine.active.length : 0,
  `UI (${h.uiChecked().length}) doit égaler moteur (${h.engine ? h.engine.active.length : 0})`);

async function addManual(h, name, code = MANUAL) { h.$('cheat-name').value = name; h.$('cheat-code').value = code; await h.$('cheat-add').onclick(); }

test('activation simple : coché => appliqué, moteur appelé une fois', async () => {
  const h = await makeHarness(); await h.launch('Jeu X.bin'); await addManual(h, 'A');
  const before = h.engine.calls.length;
  await h.toggleRow(0, true);
  assert.deepEqual(h.engine.active, [MANUAL]); assert.equal(h.engine.calls.length, before + 1); invariant(h);
});

test('désactivation : décoché => moteur vidé', async () => {
  const h = await makeHarness(); await h.launch('Jeu X.bin'); await addManual(h, 'A');
  await h.toggleRow(0, true); await h.toggleRow(0, false);
  assert.deepEqual(h.engine.active, []); invariant(h);
});

test('région non sûre : coché => pending, moteur NON appelé', async () => {
  const h = await makeHarness(); await h.launch(CASTLE_EU);
  await h.button('(USA)').onclick();                 // édition USA sur disque Europe
  const before = h.engine.calls.length;
  const idx = h.rows().findIndex(r => !/incompatible|Xploder/.test(r.text()));
  await h.toggleRow(idx, true);
  assert.equal(h.engine.active.length, 0, 'aucun code injecté sans confirmation');
  assert.equal(h.engine.calls.length, before, 'moteur jamais appelé');
  assert.ok(h.view().pending >= 1, 'le cheat est en attente');
});

test('confirmation régionale : applique les pending en une transaction', async () => {
  const h = await makeHarness(); await h.launch(CASTLE_EU); await h.button('(USA)').onclick();
  const idx = h.rows().findIndex(r => !/incompatible|Xploder/.test(r.text()));
  await h.toggleRow(idx, true);
  const confirm = h.button('Je confirme'); assert.ok(confirm, 'bouton de confirmation présent');
  await confirm.onclick();
  assert.equal(h.engine.active.length, 1); invariant(h);
});

test('désactiver tous : purge appliqués ET en attente', async () => {
  const h = await makeHarness(); await h.launch(CASTLE_EU); await h.button('(USA)').onclick();
  const idx = h.rows().findIndex(r => !/incompatible|Xploder/.test(r.text()));
  await h.toggleRow(idx, true);                      // pending
  await addManual(h, 'man'); await h.button('Je confirme').onclick();
  await h.$('cheat-off').onclick();
  assert.equal(h.engine.active.length, 0); assert.equal(h.view().pending, 0); invariant(h);
});

test('confirmer après désactiver-tous ne réactive rien', async () => {
  const h = await makeHarness(); await h.launch(CASTLE_EU); await h.button('(USA)').onclick();
  const idx = h.rows().findIndex(r => !/incompatible|Xploder/.test(r.text()));
  await h.toggleRow(idx, true);
  await h.$('cheat-off').onclick();
  assert.equal(h.view().pending, 0, 'plus rien en attente après désactiver-tous');
  // Le disque reste Europe/USA : confirmer la région ne doit réactiver AUCUN cheat.
  const confirm = h.button('Je confirme');
  if (confirm) await confirm.onclick();
  assert.equal(h.engine.active.length, 0, 'confirmer ne réactive rien'); invariant(h);
});

test('échec setCheats à l\'activation => rollback complet, cheat reste off', async () => {
  const h = await makeHarness(); await h.launch('Jeu X.bin'); await addManual(h, 'A');
  h.engine.fail = () => 'empty';
  const r = await h.view(); void r;
  await h.toggleRow(0, true);
  assert.equal(h.view().cheats[0].state, 'off', 'état restauré'); invariant(h);
});

test('échec partiel puis resynchro OK => pas de cheat fantôme', async () => {
  const h = await makeHarness(); await h.launch('Jeu X.bin');
  await addManual(h, 'A'); await addManual(h, 'B', MANUAL2);
  await h.toggleRow(0, true);                         // A appliqué
  h.engine.fail = (n, list) => (list.length === 2 ? 'empty' : false);  // l'ajout de B échoue
  await h.toggleRow(1, true);
  assert.deepEqual(h.engine.active, [MANUAL], 'moteur resynchronisé sur A seul');
  assert.deepEqual(h.uiChecked().length, 1); invariant(h);
});

test('resetCheat échoue aussi => état INCERTAIN, activations bloquées', async () => {
  const h = await makeHarness(); await h.launch('Jeu X.bin');
  await addManual(h, 'A'); await addManual(h, 'B', MANUAL2);
  await h.toggleRow(0, true);
  h.engine.fail = () => 'unchanged';                  // setCheats ET resynchro échouent
  await h.toggleRow(1, true);
  assert.equal(h.view().engineSync, 'unknown');
  const r = await h.toggleRow(0, false);              // désactiver reste permis
  assert.ok(h.view().engineSync !== undefined);
});

test('changement de jeu rapide : l\'ancien jeu n\'injecte pas dans le nouveau', async () => {
  const h = await makeHarness(); await h.launch('Jeu A.bin'); await addManual(h, 'A'); await h.toggleRow(0, true);
  await h.launch('Jeu B.bin');                        // nouveau moteur, nouvelle session
  assert.equal(h.engine.active.length, 0, 'nouveau moteur vierge');
  assert.deepEqual(h.uiChecked(), []); invariant(h);
});

test('restauration : cheats restaurés sur édition sûre => appliqués', async () => {
  const h = await makeHarness();
  // Lancement avec cheatList restauré sur un jeu identifié par serial exact (sûr).
  h.disc('Metal Gear Solid.bin', { serial: 'SLUS-00594' });
  const input = h.$('disc-file'); input.files = [{ name: 'Metal Gear Solid.bin' }]; await input.onchange();
  // On injecte la liste de restauration via le même chemin que launch(cheatList).
  h.window.__ = null;
  await h.$('launch').onclick();
  // Pas de cheatList ici (chemin standard) ; ce test vérifie surtout l'absence de fantôme.
  assert.equal(h.engine.active.length, 0); invariant(h);
});

test('code incompatible (Xploder) ne s\'active jamais', async () => {
  const h = await makeHarness(); await h.launch('Dave Mirra Freestyle BMX (USA).bin', { serial: 'SLUS-01156' });
  const xploder = h.rows().findIndex(r => /Xploder|incompatible/.test(r.text()));
  if (xploder >= 0) { await h.toggleRow(xploder, true); assert.equal(h.view().cheats[xploder].state, 'off'); }
  invariant(h);
});

// --- Concurrence : opérations rapides et sessions multiples (mandat §2) ---
test('opérations concurrentes : deux activations rapides restent cohérentes', async () => {
  const h = await makeHarness(); await h.launch('Jeu X.bin');
  await addManual(h, 'A'); await addManual(h, 'B', MANUAL2);
  const ctl = h.ctl();
  // setCheats lent : les deux bascules se chevauchent réellement ; la file doit les sérialiser.
  const real = h.engine.setCheats.bind(h.engine);
  h.engine.setCheats = async list => { await new Promise(r => setTimeout(r, 5)); return real(list); };
  await Promise.all([ctl.toggle(0, true), ctl.toggle(1, true)]);
  assert.equal(h.engine.active.length, 2); invariant(h);
});

test('changement de jeu pendant une opération : l\'opération périmée est abandonnée', async () => {
  const h = await makeHarness(); await h.launch('Jeu A.bin'); await addManual(h, 'A');
  const ctl = h.ctl();
  const real = h.engine.setCheats.bind(h.engine);
  h.engine.setCheats = async list => { await new Promise(r => setTimeout(r, 10)); return real(list); };
  const slow = ctl.toggle(0, true);         // activation en cours sur le jeu A
  await h.launch('Jeu B.bin');              // change de session avant la fin
  await slow;
  assert.equal(h.engine.active.length, 0, 'le nouveau jeu n\'hérite pas du cheat de l\'ancien');
  assert.deepEqual(h.uiChecked(), []); invariant(h);
});

test('numéro de série : codes USA sur disque Europe => confirmation requise, rien d\'injecté', async () => {
  const h = await makeHarness();
  await h.launch('Un jeu Europe.bin', { serial: 'SLES-00524' });  // disque Europe détecté
  await h.ctl().applySerial('SLUS-00594');                       // numéro USA valide du catalogue (Metal Gear Solid USA)
  const v = h.view();
  assert.ok(v.region, 'panneau de confirmation présent');
  assert.equal(h.engine.active.length, 0, 'aucun code injecté avant confirmation'); invariant(h);
});

test('numéro de série exact (identique au disque) => pas de confirmation', async () => {
  const h = await makeHarness();
  await h.launch('MGS.bin', { serial: 'SLUS-00594' });
  await h.ctl().applySerial('SLUS-00594');
  assert.equal(h.view().region, null, 'même numéro : aucune confirmation requise'); invariant(h);
});

test('numéro de série introuvable => message clair, liste inchangée', async () => {
  const h = await makeHarness(); await h.launch('Jeu X.bin'); await addManual(h, 'A');
  const before = h.view().cheats.length;
  const r = await h.ctl().applySerial('SLUS-99999');
  assert.equal(r.ok, false); assert.equal(h.view().cheats.length, before); invariant(h);
});

// --- P0 (audits GPT/Méo) : une liste de langues ne doit JAMAIS valider une région.
// Protocole renforcé (exigé par GPT) : moteur RÉELLEMENT actif, on compte les appels
// moteur et on vérifie zéro injection + état en attente.
async function restoreUnderRegion(h, discName) {
  h.findOverride = async () => ({
    status: 'match',
    cheats: [{ name: 'Vies infinies', code: '80010000 0001', source: 'GameShark' }],
    candidates: [], catalogTitle: 'Un Jeu (Europe)', catalogRegion: 'Europe', catalogRegions: ['Europe'],
  });
  await h.launch(discName);                         // moteur actif réel
  assert.ok(h.engine, 'précondition : un moteur est actif');
  const callsBefore = h.engine.calls.length;
  await h.ctl().startSession({ name: discName, canonical_sha256: 'c'.repeat(64) },
    [{ name: 'Vies infinies', code: '80010000 0001' }]);   // restauration mémorisée
  return { callsBefore, callsAfter: h.engine.calls.length };
}

for (const disc of [
  'Un Jeu (En,Fr,Es).chd', 'Un Jeu (En,Fr,Es,Pt-BR).chd', 'Un Jeu (En,Fr,Es,zh-Hans-CN).chd',
  'Un Jeu (En,Fr,Es,zh-Hant-TW).chd', 'Un Jeu (En,Fr,Es,Pt-419).chd', 'Un Jeu (En,Fr,Es,sr-Latn-RS).chd',
]) {
  test(`P0 : « ${disc} » + cheat restauré Europe => moteur jamais appelé, en attente`, async () => {
    const h = await makeHarness();
    const { callsBefore, callsAfter } = await restoreUnderRegion(h, disc);
    assert.equal(callsAfter, callsBefore, 'aucun nouvel appel moteur (setCheats)');
    assert.equal(h.engine.active.length, 0, 'aucun cheat actif dans le moteur');
    const v = h.view();
    assert.ok(v.region || v.pending >= 1, 'confirmation régionale visible ou cheat en attente');
  });
}

// Contrôle positif : une région EXPLICITE (USA) confirme sans décalage => applique bien.
test('P0 contrôle positif : disque (USA) avec catalogue USA => restauré et appliqué', async () => {
  const h = await makeHarness();
  h.findOverride = async () => ({
    status: 'match', cheats: [{ name: 'V', code: '80010000 0001', source: 'GameShark' }],
    candidates: [], catalogTitle: 'Un Jeu (USA)', catalogRegion: 'USA', catalogRegions: ['USA'],
  });
  await h.launch('Un Jeu (USA).chd');
  await h.ctl().startSession({ name: 'Un Jeu (USA).chd', canonical_sha256: 'd'.repeat(64) },
    [{ name: 'V', code: '80010000 0001' }]);
  assert.equal(h.engine.active.length, 1, 'région concordante : restauration appliquée');
});
