import test from 'node:test';
import assert from 'node:assert/strict';
import {regionEvidence} from '../region-evidence.mjs';
import {titleStem} from '../cheat-catalog-psx.mjs';
import {makeHarness} from './helpers/app-harness.mjs';

for(const name of ['The Last of US.bin','Among Us.bin','The-Last-of-US.bin','Among-Us.bin',
 'Made-in-Japan.bin','Europe Racing.bin','Japan Pro Wrestling.bin','World Championship.bin']) {
 test(`GPT P2: natural title remains unknown: ${name}`,()=>assert.equal(regionEvidence(name).region,null));
}
for(const [name,expected] of [['Game (USA).bin','USA'],['Game (US).bin','USA'],
 ['Game-PAL.bin','Europe'],['Game-NTSC-U.bin','USA'],['Game-NTSC-J.bin','Japan'],
 ['Game NTSC-U.bin','USA'],['Game NTSC-J.bin','Japan'],
 ['Gran Turismo 2-PSX-PAL-CD1.chd','Europe'],['Gran Turismo 2-PSX-NTSC-U-CD2.chd','USA'],
 ['Demo-PSX-US-CD1.bin','USA'],['Demo-PS1-JP-Rev1.bin','Japan']]) {
 test(`GPT positive structured metadata: ${name}`,()=>assert.equal(regionEvidence(name).region,expected));
}
async function poisonedHarness(){
 const h=await makeHarness();await h.launch('Synthetic audit.bin');
 await h.ctl().addManual('Synthetic','80010000 0001');await h.ctl().confirmRegion();await h.ctl().toggle(0,true);
 h.engine.fail=()=> 'unchanged';await h.ctl().toggle(0,false);assert.equal(h.view().engineSync,'unknown');return h;
}
test('C02: suspect native/state captures are refused even if handlers are called directly',async()=>{
 const h=await poisonedHarness();let captures=0;
 h.engine.captureState=()=>{captures++;return new Uint8Array([1,2,3]);};
 h.engine.captureBattery=()=>{captures++;return new Uint8Array([4,5,6]);};
 await h.$('state-save').onclick();await h.$('battery-save').onclick();
 assert.equal(captures,0,'unknown engine must never reach capture or overwrite an original slot');
 assert.equal(h.$('state-save').disabled,true);assert.equal(h.$('battery-save').disabled,true);
});
test('C02: explicit fresh-realm recovery skips unsafe capture, with cancellation supported',async()=>{
 const h=await poisonedHarness(),old=h.engine;let captures=0;
 old.captureBattery=()=>{captures++;throw new Error('unsafe capture');};
 const button=h.button('Nouvelle session');assert.ok(button);
 h.answerConfirm=false;await button.onclick();assert.equal(h.engine,old);
 h.answerConfirm=true;await button.onclick();assert.notEqual(h.engine,old);
 assert.equal(captures,0);assert.equal(h.view().engineSync,'ok');assert.equal(h.view().applied,0);
});

test('noms archivés : titre et région reconnus sans authentifier une édition',()=>{
 for(const ext of ['zip','rar','7z']) {const name=`Gran Turismo 2-PSX-PAL-CD1.${ext}`;assert.equal(titleStem(name),'gran turismo 2');assert.equal(regionEvidence(name).region,'Europe');assert.equal(regionEvidence(name).editionVerified,false);}
});
