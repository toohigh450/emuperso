import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { File } from 'node:buffer';
import { MAX_ROM_BYTES, validateFileDescriptor, detectRomFormat, normalizeRom, prepareRomBytes, prepareLocalRom } from '../rom-file.mjs';
const original = new Uint8Array(readFileSync(new URL('../homebrew/fallback-open/demo-emuperso-open.z64', import.meta.url)));
const hash = b => createHash('sha256').update(b).digest('hex');
function encode(bytes, width) { const out = bytes.slice(); for (let i=0;i<out.length;i+=width) out.set(bytes.subarray(i,i+width).slice().reverse(),i); return out; }
const formats = { z64: original, v64: encode(original,2), n64: encode(original,4) };
for (const [format,bytes] of Object.entries(formats)) test(`${format} : normalisation exacte de la démo, source inchangée et hash indépendant`,async()=>{
 const before=bytes.slice();assert.equal(detectRomFormat(bytes),format);
 const p=await prepareLocalRom(new File([bytes],`démo.${format.toUpperCase()}`));
 assert.deepEqual(p.bytes,original);assert.deepEqual(bytes,before);assert.equal(p.metadata.source_sha256,hash(bytes));assert.equal(p.metadata.canonical_sha256,hash(original));assert.equal(p.metadata.detected_format,format);assert.equal(p.metadata.extension_mismatch,false);assert.equal(p.metadata.source,'local-file');
});
test('Vecteurs connus : permutation par paire et par mot, pas inversion du fichier entier',()=>{
 const b=new Uint8Array(4096);b.set([0x80,0x37,0x12,0x40,1,2,3,4]);
 const v=b.slice();v.set([0x37,0x80,0x40,0x12,2,1,4,3]);assert.deepEqual(normalizeRom(v).canonical,b);
 const n=b.slice();n.set([0x40,0x12,0x37,0x80,4,3,2,1]);assert.deepEqual(normalizeRom(n).canonical,b);
});
test('Extension trompeuse : signature prioritaire et avertissement explicite',async()=>{const p=await prepareRomBytes(original,'renomme.n64');assert.equal(p.metadata.detected_format,'z64');assert(p.metadata.extension_mismatch);assert.deepEqual(p.bytes,original);});
test('ZIP, exécutable et signature nulle ne deviennent pas ROM en étant renommés',()=>{for(const magic of [[80,75,3,4],[127,69,76,70],[0,0,0,0]]){const b=new Uint8Array(4096);b.set(magic);assert.throws(()=>normalizeRom(b),{code:'E_FORMAT'});}});
test('Fichiers ZIP/extension étrangère refusés avant lecture',async()=>{let read=false;const file={name:'archive.zip',size:4096,arrayBuffer:async()=>{read=true;return new ArrayBuffer(4096);}};await assert.rejects(prepareLocalRom(file),{code:'E_EXTENSION'});assert.equal(read,false);});
test('Tailles invalides/énormes refusées avant lecture et allocation',async()=>{for(const size of [0,4,4092,NaN,Infinity,MAX_ROM_BYTES+4]){let read=false;await assert.rejects(prepareLocalRom({name:'x.z64',size,arrayBuffer:async()=>{read=true;}}),{code:'E_SIZE'});assert.equal(read,false);}});
test('Alignement4 et limites explicites : 4K et 64M autorisés sans obligation puissance2',()=>{assert.equal(validateFileDescriptor({name:'x.z64',size:4096}),'z64');assert.equal(validateFileDescriptor({name:'x.n64',size:MAX_ROM_BYTES}),'n64');assert.equal(validateFileDescriptor({name:'x.v64',size:6144}),'v64');assert.throws(()=>validateFileDescriptor({name:'x.v64',size:4098}),{code:'E_ALIGNMENT'});});
test('Lectures partielles ou changement de taille refusés',async()=>{await assert.rejects(prepareLocalRom({name:'x.z64',size:6144,arrayBuffer:async()=>new ArrayBuffer(4096)}),{code:'E_READ'});});
test('Nom non fiable conservé comme métadonnée, jamais comme chemin de conversion',async()=>{const p=await prepareLocalRom(new File([original],'<img src=x onerror=alert(1)>.z64'));assert.equal(p.metadata.name,'<img src=x onerror=alert(1)>.z64');assert.equal(p.metadata.canonical_sha256,hash(original));});
test('Aucune normalisation en place : les octets originaux et leur hash restent distincts',async()=>{const p=await prepareRomBytes(formats.n64,'x.n64');assert.notEqual(p.metadata.source_sha256,p.metadata.canonical_sha256);p.bytes[4]^=1;assert.equal(hash(formats.n64),p.metadata.source_sha256);});
