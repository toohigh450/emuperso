"""Read-only legacy migration, using a fresh Chromium profile and synthetic data.

The historical database and sentinel records are CREATED BY THIS TEST. Its final
deletion-race fixture deletes only that synthetic database, never a user's data.
"""
from pathlib import Path
import json
import os
import sys
import tempfile
import threading
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from serve import Handler

URL = 'http://127.0.0.1:8779/tests/legacy-battery-browser.html'
results, errors, requests = [], [], []

def ok(name, proof):
    results.append({'test':name,'status':'RÉUSSI','proof':proof})
    print('RÉUSSI — ' + name, flush=True)

server = ThreadingHTTPServer(('127.0.0.1', 8779), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with tempfile.TemporaryDirectory(prefix='n64-legacy-test-') as profile, sync_playwright() as pw:
        context = pw.chromium.launch_persistent_context(profile, executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: requests.append({'url':request.url,'method':request.method,'body_bytes':len(request.post_data_buffer or b'')}))
        page.goto(URL); page.wait_for_function('()=>!!window.LegacyTestAPI')
        page.evaluate('''()=>{
          window.hashBytes=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
          window.identity={rom_sha256:'a'.repeat(64),engine_sha256:'b'.repeat(64),config_sha256:'c'.repeat(64),state_schema:'n64lab-state-v1'};
        }''')

        missing = page.evaluate('''async()=>{
          const before=(await indexedDB.databases()).map(x=>x.name),data=await LegacyTestAPI.readLegacyBattery(identity.rom_sha256),after=(await indexedDB.databases()).map(x=>x.name);
          return {before,after,empty:data===null};
        }''')
        assert missing['empty'] and missing['before']==missing['after'] and '/data/saves' not in missing['after']
        ok('Base absente : aucune base créée', missing)

        seeded = page.evaluate('''async()=>{
          const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('/data/saves',21);r.onupgradeneeded=()=>r.result.createObjectStore('FILE_DATA');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
          const source=Uint8Array.from({length:296960},(_,i)=>i&255),reference=new Uint8Array([41,42,43]);
          const transaction=db.transaction('FILE_DATA','readwrite'),store=transaction.objectStore('FILE_DATA');
          const record={timestamp:new Date('2026-10-31T00:00:00.000Z'),mode:33188,contents:source};
          store.put(record,LegacyTestAPI.legacyBatteryPath(identity.rom_sha256));
          store.put({...record,contents:reference},LegacyTestAPI.legacyBatteryPath(LegacyTestAPI.LEGACY_REFERENCE_SHA256,{reference:true}));
          store.put({...record,contents:new Uint8Array([77,78])},'/data/saves/OtherProject/original.srm');
          await new Promise((resolve,reject)=>{transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error);});db.close();
          return {bytes:source.length,sha256:await hashBytes(source)};
        }''')
        assert seeded['bytes']==296960
        page.evaluate('''()=>{
          window.audit={open:[],transaction:[],get:[],writes:[]};
          const originals={open:IDBFactory.prototype.open,transaction:IDBDatabase.prototype.transaction,get:IDBObjectStore.prototype.get,put:IDBObjectStore.prototype.put,delete:IDBObjectStore.prototype.delete,clear:IDBObjectStore.prototype.clear};
          IDBFactory.prototype.open=function(...args){audit.open.push(args);return originals.open.apply(this,args);};
          IDBDatabase.prototype.transaction=function(...args){if(this.name==='/data/saves')audit.transaction.push(args);return originals.transaction.apply(this,args);};
          IDBObjectStore.prototype.get=function(key){if(this.transaction.db.name==='/data/saves')audit.get.push(key);return originals.get.call(this,key);};
          for(const method of ['put','delete','clear'])IDBObjectStore.prototype[method]=function(...args){if(this.transaction.db.name==='/data/saves')audit.writes.push(method);return originals[method].apply(this,args);};
          window.restoreAudit=()=>{IDBFactory.prototype.open=originals.open;IDBDatabase.prototype.transaction=originals.transaction;IDBObjectStore.prototype.get=originals.get;for(const method of ['put','delete','clear'])IDBObjectStore.prototype[method]=originals[method];};
        }''')
        read = page.evaluate('''async()=>{
          const copied=await LegacyTestAPI.readLegacyBattery(identity.rom_sha256);
          const result={bytes:copied.length,sha256:await hashBytes(copied),audit:structuredClone(audit)};
          copied[0]^=255;window.restoreAudit();return result;
        }''')
        expected_path='/data/saves/Mupen64Plus-Next/EMUPERSO_LOCAL_'+'a'*64+'.srm'
        assert read['bytes']==296960 and read['sha256']==seeded['sha256']
        assert read['audit']=={'open':[['/data/saves']],'transaction':[['FILE_DATA','readonly']],'get':[expected_path],'writes':[]}
        ok('Lecture d’un seul chemin exact, transaction readonly et aucune écriture', read)

        copied = page.evaluate('''async()=>{
          const source=await LegacyTestAPI.readLegacyBattery(identity.rom_sha256),vault=new LegacyTestAPI.SaveStore('emuperso-real-saves-v1-legacy-test');
          await vault.put(identity,1,await LegacyTestAPI.makeStateEnvelope(source,identity,{kind:'battery',label:'Migration 0.3'}));
          const restored=await vault.load(identity,1,{kind:'battery'}),legacy=await LegacyTestAPI.readLegacyBattery(identity.rom_sha256);
          const result={vault_sha256:await hashBytes(restored.bytes),legacy_sha256:await hashBytes(legacy),legacy_first:legacy[0]};await vault.close();return result;
        }''')
        assert copied=={'vault_sha256':seeded['sha256'],'legacy_sha256':seeded['sha256'],'legacy_first':0}
        ok('Copie vers le nouveau coffre ; source historique inchangée', copied)

        reference = page.evaluate('''async()=>{
          const reference=await LegacyTestAPI.readLegacyBattery(LegacyTestAPI.LEGACY_REFERENCE_SHA256,{reference:true});
          let wrong;try{await LegacyTestAPI.readLegacyBattery(identity.rom_sha256,{reference:true});}catch(error){wrong=error.code;}
          return {bytes:[...reference],wrong,missing:await LegacyTestAPI.readLegacyBattery('d'.repeat(64))===null};
        }''')
        assert reference=={'bytes':[41,42,43],'wrong':'E_LEGACY_IDENTITY','missing':True}
        ok('Référence identifiée strictement ; aucune recherche par nom approchant', reference)

        malformed = page.evaluate('''async()=>{
          const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('/data/saves');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
          const path=LegacyTestAPI.legacyBatteryPath('e'.repeat(64)),contents=new Uint8Array(1024*1024+1);
          const transaction=db.transaction('FILE_DATA','readwrite');transaction.objectStore('FILE_DATA').put({mode:33188,timestamp:new Date(),contents},path);
          await new Promise((resolve,reject)=>{transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error);});db.close();
          let code;try{await LegacyTestAPI.readLegacyBattery('e'.repeat(64));}catch(error){code=error.code;}
          const check=await new Promise((resolve,reject)=>{const r=indexedDB.open('/data/saves');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
          const t=check.transaction('FILE_DATA','readonly'),request=t.objectStore('FILE_DATA').get(path),record=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});check.close();
          return {code,original_size:record.contents.length};
        }''')
        assert malformed=={'code':'E_LEGACY_SIZE','original_size':1048577}
        ok('Source hors limites refusée sans modification', malformed)

        unsupported = page.evaluate('''async()=>{
          Object.defineProperty(indexedDB,'databases',{value:undefined,configurable:true});
          try{return await LegacyTestAPI.readLegacyBattery(identity.rom_sha256)===null;}finally{delete indexedDB.databases;}
        }''')
        assert unsupported
        ok('Énumération indisponible : migration ignorée sans création', {'returned_null':True})

        race = page.evaluate('''async()=>{
          const enumerate=indexedDB.databases.bind(indexedDB);
          Object.defineProperty(indexedDB,'databases',{configurable:true,value:async()=>{
            const listing=await enumerate();
            // Simulate external deletion of THIS TEST's synthetic source after enumeration.
            await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('/data/saves');r.onsuccess=resolve;r.onerror=()=>reject(r.error);});
            return listing;
          }});
          let absent;try{absent=await LegacyTestAPI.readLegacyBattery(identity.rom_sha256)===null;}finally{delete indexedDB.databases;}
          return {absent,legacy_recreated:(await indexedDB.databases()).some(x=>x.name==='/data/saves')};
        }''')
        assert race=={'absent':True,'legacy_recreated':False}
        ok('Course de suppression synthétique : nouvelle création avortée', race)
        context.close()
    assert not errors, errors
    assert all(request['url'].startswith('http://127.0.0.1:8779/') and request['method']=='GET' and request['body_bytes']==0 for request in requests), requests
    report={'schema':'emuperso/legacy-battery-browser-tests/v1','results':results,'page_errors':errors,'http':requests,'scope':'Only fresh temporary browser profile, synthetic legacy records and new-vault copy. No user original save was accessed. Deletion race removes only the database created by this test.'}
    (ROOT/'evidence/tests-legacy-battery-browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('TOTAL',len(results),'contrôles migration historique',flush=True)
finally:
    server.shutdown();server.server_close()
