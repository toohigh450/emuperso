import test from 'node:test';
import assert from 'node:assert/strict';
import {makeHarness} from './helpers/app-harness.mjs';
import {regionEvidence} from '../region-evidence.mjs';
import {codeSupport} from '../cheat-controller.mjs';

// Vrai app.js + contrôleur ; doubles DOM/moteur. Les preuves PCSX sont séparées.
async function withMemory(value, task) {
  const descriptor = Object.getOwnPropertyDescriptor(performance, 'memory');
  Object.defineProperty(performance, 'memory', {configurable:true, value});
  try { await task(); }
  finally { descriptor ? Object.defineProperty(performance, 'memory', descriptor) : delete performance.memory; }
}
const low = () => ({jsHeapSizeLimit:4096*1048576, usedJSHeapSize:2000*1048576});
test('R1: refus mémoire avant toute capture/fermeture ; état et progression du jeu préservés', async () => {
  const h=await makeHarness(); await h.launch('Synthetic previous.bin');
  const old=h.engine; let captures=0;
  old.captureBattery=()=>{captures++; return new Uint8Array([1,2]);};
  await withMemory(low(),async()=>{
    h.disc('Synthetic large.zip',{size:663*1048576}); await h.launch('Synthetic large.zip');
  });
  assert.equal(h.engine,old); assert.equal(h.closed??0,0); assert.equal(captures,0);
  assert.equal(h.$('current').textContent,'Synthetic previous.bin');
  assert.match(h.status(),/refusé avant fermeture.*jeu en cours reste ouvert/);
  assert.equal(h.confirms.length,0);
  const check=JSON.parse(h.$('log').textContent).find(e=>e.type==='archive.memory.check');
  assert.equal(check.data.stage,'preflight'); assert.equal(check.data.session_retained,true);
});
test('R1: mémoire devenue insuffisante pendant la confirmation => ancienne session conservée',async()=>{
  const h=await makeHarness(); await h.launch('Synthetic previous.bin'); const old=h.engine;
  const m={...low(),usedJSHeapSize:0}; h.onConfirm=()=>{m.usedJSHeapSize=2000*1048576;};
  await withMemory(m,async()=>{h.disc('Synthetic large.zip',{size:663*1048576});await h.launch('Synthetic large.zip');});
  assert.equal(h.confirms.length,1);assert.equal(h.engine,old);assert.equal(h.closed??0,0);
  assert.match(h.status(),/refusé avant fermeture/);
});
for(const failure of ['prepare','start']) test(`R1: échec ${failure} après fermeture accepté => conséquences explicites`,async()=>{
  const h=await makeHarness(); await h.launch('Synthetic previous.bin');
  h[failure==='prepare'?'nextPrepareError':'nextStartError']=new Error(`synthetic ${failure} failure`);
  await h.launch('Synthetic small.zip');
  assert.equal(h.closed,1);assert.equal(h.engine,null);assert.equal(h.$('current').textContent,'Aucun');
  assert.match(h.confirms.at(-1),/ancienne session ne pourra pas être rétablie/);
  assert.match(h.status(),/jeu précédent a déjà été fermé.*sauvegardes enregistrées sont conservées/);
  assert.match(h.status(),new RegExp(`synthetic ${failure} failure`));
});
test('R1: échec sauvegarde native => refus de fermeture avant archive',async()=>{
  const h=await makeHarness();await h.launch('Synthetic previous.bin');const old=h.engine;
  old.captureBattery=()=>new Uint8Array([1,2]);h.failSave=true;
  await h.launch('Synthetic small.zip');
  assert.equal(h.engine,old);assert.equal(h.closed??0,0);assert.equal(h.confirms.length,0);
  assert.match(h.status(),/sauvegarde native impossible.*session reste ouverte/);
});
test('R2: métrique navigateur indisponible explicitement tracée ; aucune promesse de borne',async()=>{
  await withMemory(undefined,async()=>{
    const h=await makeHarness();await h.launch('Synthetic small.zip');
    const check=JSON.parse(h.$('log').textContent).find(e=>e.type==='archive.memory.check');
    assert.equal(check.data.available,false);assert.equal(check.data.estimator_only,true);
    assert.equal(check.data.free_mib,null);assert.ok(h.engine);
  });
});
for(const [name,region] of [
 ['Spider-Man-PSX-PAL-CD1-Rev 2.zip','Europe'],
 ['X-Men-PS1-NTSC_U-Disc 2-v1.1.chd','USA'],
 ['Demo-PSX-NTSC_J-Disk2.7z','Japan'],
 ['Demo (Europe) (En,Fr,Es,Pt-BR) (Disc 2 of 3) (Rev 1).chd','Europe'],
 ['Demo (Japan) [v1.1] [Disc 2].pbp','Japan'],
 ['Demo (USA) (Europe)-PSX-NTSC-J-CD1.zip',null],
 ['Demo-PSX-PAL-NTSC-U-CD1.zip',null],
 ['Demo_PSX_PAL_CD1.chd',null],
 ['Demo PAL.bin',null],
 ['Demo (En-US,pt-BR,zh-Hant-TW).zip',null],
 ['Demo (USA,En,Fr).chd',null],
 ['Final Fantasy 5 FR.pbp',null],
 ['Made-in-Japan-PSX.bin',null],
 ['The-Last-of-US-CD1.bin',null],
]) test(`P2: conventions et ambiguïtés régionales : ${name}`,()=>{
  const evidence=regionEvidence(name);assert.equal(evidence.region,region);assert.equal(evidence.editionVerified,false);
});
test('P2: composés multiples, données 32 bits et instruction inconnue après donnée',()=>{
  assert.equal(codeSupport('50000202 0001\n80011000 5678\nC2011000 0004\n80011008 0000').ok,true);
  for(const code of ['C2011000 0004\n80011008 12345678','50000202 0001\n80011000 5678\nA4011010 0001',
    'C2011000 0004\n80011008 0000\nC2011000 0004','50000202 0001\n50000202 0001\n80011000 5678'])
    assert.equal(codeSupport(code).ok,false,code);
});
