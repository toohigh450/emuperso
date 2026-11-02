import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parse7z,safeEntry,classify,STATUS,atomic,readJSON,inside,config,sameOwnedProcess} from './lib.mjs';
import {report} from './report.mjs';

test('un compteur qui avance ne valide ni gameplay ni sauvegarde',()=>{
  assert.equal(classify({engineStarted:true,after:{colors:20},frameRate:60}),STATUS.image);
  assert.equal(classify({engineStarted:true,after:{colors:1},frameRate:60}),STATUS.suspect);
  assert.equal(classify({engineStarted:true,after:{colors:20},frameRate:0}),STATUS.suspect);
  assert.equal(classify({engineStarted:true,after:{colors:20},frameRate:60,errors:['wasm trap']}),STATUS.fail);
  assert.equal(classify({timeout:true}),STATUS.timeout);
});
test('archives : nom complet, taille et entrée distincte ; traversée refusée',()=>{
  const entries=parse7z('Path = archive.7z\nSize = 33\n\n----------\nPath = Jeu (FR).gb\nSize = 32768\nAttributes = A\n\nPath = Jeu (JP).gb\nSize = 65536\nAttributes = A\n');
  assert.equal(entries.length,2);assert.equal(entries[0].Path,'Jeu (FR).gb');
  for(const e of ['../game.gb','D:\\x.gb','/x.gb','-x.gb','@liste.gb','a*gb','a\\..\\b.gb'])assert.equal(safeEntry(e),false);
  assert.ok(safeEntry('dossier/jeu [!].gb'));
  assert.equal(inside('C:/lab/tmp','C:/lab/tmp-other'),false);
});
test('rapport : historique conservé, résultat interrompu non terminé, HTML échappé, CSV protégé',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'emuperso-unit-'));
  try {
    const c={stateDir:root,roots:{gb:[]}},item={id:'one',system:'gb',name:'=HYPERLINK("bad")<script>',path:'E:/private.gb'};
    atomic(path.join(root,'inventory.json'),{complete:true,items:[item],warnings:[]});
    atomic(path.join(root,'attempts','a','job.json'),{item,attempt:1});atomic(path.join(root,'attempts','a','result.json'),{status:STATUS.fail,error:'wasm trap'});
    atomic(path.join(root,'attempts','b','job.json'),{item,attempt:2});atomic(path.join(root,'attempts','b','result.json'),{status:STATUS.untested,interrupted:true});
    const r=report(c);assert.equal(r.tested,0);assert.equal(r.remaining,1);assert.ok(fs.existsSync(path.join(root,'attempts','a','result.json')));
    const html=fs.readFileSync(path.join(root,'rapport.html'),'utf8');assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('bad")<script>'));
    assert.ok(fs.readFileSync(path.join(root,'results.csv'),'utf8').includes('"\'=HYPERLINK'));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('atomic : un résultat existant reste lisible après remplacement',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'emuperso-atomic-'));
  try{const p=path.join(root,'r.json');atomic(p,{attempt:1});atomic(p,{attempt:2});assert.deepEqual(readJSON(p),{attempt:2});assert.equal(fs.readdirSync(root).length,1);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('nettoyage : identité conservée pendant la terminaison, PID réutilisé refusé',()=>{
  const owner={pid:123,created:'2026-11-02T22:00:00Z',token:'unique-token',command:'chrome --emuperso-lab=unique-token'};
  assert.equal(sameOwnedProcess(owner,{...owner,command:null}),true);
  assert.equal(sameOwnedProcess(owner,{...owner,created:'2026-11-02T22:01:00Z',command:null}),false);
  assert.equal(sameOwnedProcess(owner,{...owner,command:'chrome personnel'}),false);
  assert.equal(sameOwnedProcess({...owner,command:'autre programme'},owner),false);
});
