// Régression RC-1.16 (bug Lesteem « no memory card » / perte à la fermeture) :
// la carte mémoire native doit être capturée automatiquement quand l'onglet se
// ferme ou passe en arrière-plan, sans clic sur « Carte mémoire ».
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness } from './helpers/app-harness.mjs';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

async function launchedWithBattery() {
  const h = await makeHarness();
  let captures = 0;
  h.nextEngineSetup = engine => { engine.captureBattery = () => { captures++; return new Uint8Array([1, 2, 3]); }; };
  const puts = [];
  const proto = h.mods['./save-store.mjs'].SaveStore.prototype;
  const originalPut = proto.put;
  proto.put = async function (...args) { puts.push(args); return originalPut.apply(this, args); };
  await h.launch('Future Cop L.A.P.D..bin');
  return { h, puts, captures: () => captures };
}

test('RC-1.16 : pagehide capture la carte mémoire sans clic utilisateur', async () => {
  const { h, puts, captures } = await launchedWithBattery();
  assert.equal(captures(), 0);
  h.dispatch('window', 'pagehide');
  await tick(); await tick();
  assert.equal(captures(), 1, 'captureBattery doit être appelé une fois sur pagehide');
  assert.equal(puts.length, 1, 'la carte mémoire doit être écrite dans le coffre');
});

test('RC-1.16 : visibilitychange hidden + pagehide ne doublent pas la capture', async () => {
  const { h, puts, captures } = await launchedWithBattery();
  h.document.visibilityState = 'hidden';
  h.dispatch('document', 'visibilitychange');
  h.dispatch('window', 'pagehide');
  h.dispatch('window', 'beforeunload');
  await tick(); await tick();
  assert.equal(captures(), 1, 'une seule capture malgré les trois événements de fermeture');
  assert.equal(puts.length, 1, 'une seule écriture dans le coffre');
});

test('RC-1.16 : aucune batterie produite => aucune écriture, aucune erreur', async () => {
  const h = await makeHarness();
  h.nextEngineSetup = engine => { engine.captureBattery = () => null; };
  const puts = [];
  const proto = h.mods['./save-store.mjs'].SaveStore.prototype;
  const originalPut = proto.put;
  proto.put = async function (...args) { puts.push(args); return originalPut.apply(this, args); };
  await h.launch('Jeu sans carte mémoire.bin');
  h.dispatch('window', 'pagehide');
  await tick(); await tick();
  assert.equal(puts.length, 0);
});
