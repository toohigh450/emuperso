// P0 chargement (mandat RC-1.13) : l'interface ne reste jamais bloquée sans diagnostic,
// et un échec de préparation ne touche ni au jeu en cours ni aux cheats appliqués.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness } from './helpers/app-harness.mjs';

const events = h => JSON.parse(h.$('log').textContent || '[]').map(e => e.type);
const select = (h, name) => { h.$('disc-file').files = [{ name, size: 400 * 1048576 }]; return h.$('disc-file').onchange(); };

test('préparation bloquée : « Annuler la lecture » libère l’interface, le jeu en cours reste intact', async () => {
  const h = await makeHarness();
  await h.launch('Crash Bandicoot (USA).bin');
  const engine = h.engine;
  let options;
  h.prepareOverride = (file, o) => { options = o; o.onStage('read.progress', { bytes: 8 * 1048576, size: file.size, ms: 10 }); return new Promise(() => {}); };
  const pending = select(h, 'Dragon Ball.chd');
  await new Promise(r => setTimeout(r, 0));
  assert.match(h.status(), /Lecture et vérification locales.*8 \/ 400 Mio/);
  assert.equal(h.$('prep-cancel').hidden, false, 'bouton d’annulation visible');
  assert.equal(h.$('choose').disabled, true);
  h.$('prep-cancel').onclick();
  await pending;
  assert.equal(options.signal.aborted, true, 'signal transmis à prepareDisc');
  assert.match(h.status(), /annulée/);
  assert.equal(h.$('choose').disabled, false, 'interface libérée');
  assert.equal(h.$('prep-cancel').hidden, true);
  assert.equal(h.engine, engine, 'même moteur : le jeu en cours n’a pas été remplacé');
  assert.equal(h.$('current').textContent, 'Crash Bandicoot (USA).bin');
  assert.ok(events(h).includes('disc.cancelled'));
});

test('échec de préparation pendant un jeu : erreur explicite, aucun remplacement, sélection vide', async () => {
  const h = await makeHarness();
  await h.launch('Crash Bandicoot (USA).bin');
  const engine = h.engine, calls = engine.calls.length;
  h.prepareOverride = async () => { const e = new Error('Lecture impossible à 120 Mio : fichier déplacé (NotReadableError).'); e.code = 'E_READ'; throw e; };
  await select(h, 'Dragon Ball.chd');
  assert.match(h.status(), /Lecture impossible à 120 Mio/);
  assert.equal(h.$('status').classList.contains('error'), true);
  assert.equal(h.$('launch').disabled, true, 'rien à lancer');
  assert.equal(h.engine, engine); assert.equal(engine.calls.length, calls, 'aucun appel moteur');
  assert.ok(events(h).includes('disc.failed'));
});

test('chien de garde : sans progression, l’état est signalé et journalisé (10 s, 30 s)', async () => {
  const h = await makeHarness();
  const realNow = performance.now.bind(performance); let offset = 0;
  performance.now = () => realNow() + offset;
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    h.prepareOverride = (file, o) => { o.onStage('read.progress', { bytes: 16 * 1048576, size: file.size, ms: 5 }); return new Promise(() => {}); };
    void select(h, 'Lent.chd');
    await new Promise(r => setImmediate(r));
    offset = 12_000; mock.timers.tick(1000);
    assert.match(h.status(), /Aucune progression depuis 12 s.*16 \/ 400 Mio/);
    offset = 31_000; mock.timers.tick(1000);
    const stalls = JSON.parse(h.$('log').textContent).filter(e => e.type === 'disc.stalled');
    assert.deepEqual(stalls.map(e => e.data.quiet_s), [12, 31]);
    assert.equal(stalls[0].data.stage, 'read.progress');
    h.$('prep-cancel').onclick();
  } finally { mock.timers.reset(); performance.now = realNow; }
});

test('diagnostic exportable sans jeu lancé : préparation en cours et dernière préparation incluses', async () => {
  const h = await makeHarness();
  const blobs = []; const realURL = URL.createObjectURL;
  URL.createObjectURL = blob => { blobs.push(blob); return 'blob:test'; };
  try {
    h.prepareOverride = async () => { const e = new Error('Signature CHD absente'); e.code = 'E_FORMAT'; throw e; };
    await select(h, 'faux.chd');
    h.$('export').onclick();
    const diag = JSON.parse(await blobs[0].text());
    assert.equal(diag.game, null);
    assert.equal(diag.preparation.last.ok, false);
    assert.equal(diag.preparation.last.code, 'E_FORMAT');
    assert.ok('user_agent' in diag.env);
    assert.ok(diag.events.some(e => e.type === 'disc.selected'));
    assert.ok(!JSON.stringify(diag).includes('MComprHD'), 'aucune donnée de disque');
  } finally { URL.createObjectURL = realURL; }
});

test('lancement instrumenté : début et fin journalisés avec la durée', async () => {
  const h = await makeHarness();
  await h.launch('Crash Bandicoot (USA).bin');
  const log = JSON.parse(h.$('log').textContent);
  assert.ok(log.some(e => e.type === 'launch.start' && e.data.replacing === false));
  assert.ok(log.some(e => e.type === 'launch.done' && typeof e.data.ms === 'number'));
});
