import test from 'node:test';
import assert from 'node:assert/strict';
import { sriValue, verifyRuntimeBytes } from '../runtime-integrity.mjs';
const bytes = new TextEncoder().encode('EMUPERSO runtime fixture');
const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
test('Octets réellement reçus vérifiés, y compris une vue avec offset', async()=>{
 const wrapped = new Uint8Array(bytes.length+2); wrapped.set(bytes,1);
 assert.equal(await verifyRuntimeBytes(wrapped.subarray(1,-1),sha,'fixture.js'),sha);
});
test('Modification même syntaxiquement valide du script refusée',async()=>{
 await assert.rejects(verifyRuntimeBytes(new TextEncoder().encode('EMUPERSO runtime fixture // changed'),sha,'fixture.js'),{code:'E_RUNTIME_INTEGRITY'});
});
test('Ressource sans empreinte fixée refusée',async()=>{
 for(const value of [null,undefined,'BAD','a'.repeat(63)])await assert.rejects(verifyRuntimeBytes(bytes,value,'fixture.js'),{code:'E_RUNTIME_UNPINNED'});
});
test('SRI correspond au SHA exact et refuse une valeur non valide',()=>{
 assert.equal(sriValue(sha),'sha256-'+Buffer.from(sha,'hex').toString('base64'));
 assert.throws(()=>sriValue('x'));assert.throws(()=>sriValue(undefined));
});
