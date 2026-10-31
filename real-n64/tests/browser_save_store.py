"""Real Chromium IndexedDB save-vault checks; synthetic payloads only, no engine/ROM.

The quota failure is deliberately injected, not a claim to have filled a real disk.
"""
from pathlib import Path
import json
import os
import sys
import tempfile
import threading
import uuid
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from serve import Handler

URL = 'http://127.0.0.1:8774/tests/save-store-browser.html'
DB = 'emuperso-real-saves-v1-test-' + uuid.uuid4().hex
results = []
page_errors = []
requests = []

def ok(name, proof):
    results.append({'test': name, 'status': 'RÉUSSI', 'proof': proof})
    print('RÉUSSI — ' + name, flush=True)

def setup(page):
    page.on('pageerror', lambda error: page_errors.append(str(error)))
    page.on('request', lambda request: requests.append({'url':request.url,'method':request.method,'body_bytes':len(request.post_data_buffer or b'')}))
    page.goto(URL)
    page.wait_for_function('()=>!!window.SaveTestAPI')
    page.evaluate('''db => {
      window.vault = new SaveTestAPI.SaveStore(db);
      window.identity = {rom_sha256:'a'.repeat(64),engine_sha256:'b'.repeat(64),config_sha256:'c'.repeat(64),state_schema:'n64lab-state-v1'};
    }''', DB)

server = ThreadingHTTPServer(('127.0.0.1', 8774), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with tempfile.TemporaryDirectory(prefix='n64-save-tests-') as profile, sync_playwright() as pw:
        options = {'executable_path': os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), 'headless': True, 'args': ['--no-sandbox']}
        context = pw.chromium.launch_persistent_context(profile, **options)
        page = context.new_page(); setup(page)
        first = page.evaluate('''async () => {
          const e=await SaveTestAPI.makeStateEnvelope(new Uint8Array([1,2,3,4]),identity,{label:'Premier'});
          const written=await vault.put(identity,1,e), loaded=await vault.load(identity,1), list=await vault.list(identity);
          return {written,bytes:[...loaded.bytes],list};
        }''')
        assert first['bytes'] == [1,2,3,4] and first['written']['revision'] == 1
        assert first['list'][0]['payload_size'] == 4 and 'payload' not in first['list'][0]
        ok('Écriture et lecture IndexedDB réelles', {'revision':1,'list_contains_payload':False})

        second = page.evaluate('''async () => {
          const e=await SaveTestAPI.makeStateEnvelope(new Uint8Array([5,6,7,8]),identity,{label:'Second'});
          await vault.put(identity,1,e);
          const current=await vault.load(identity,1), previous=await vault.load(identity,1,{previous:true});
          return {current:[...current.bytes],previous:[...previous.bytes],revision:current.revision};
        }''')
        assert second == {'current':[5,6,7,8],'previous':[1,2,3,4],'revision':2}
        ok('Version précédente conservée atomiquement', second)
        context.close()

        context = pw.chromium.launch_persistent_context(profile, **options)
        page = context.new_page(); setup(page)
        persisted = page.evaluate('''async()=>{const s=await vault.load(identity,1);return {bytes:[...s.bytes],revision:s.revision};}''')
        assert persisted == {'bytes':[5,6,7,8],'revision':2}
        ok('Persistance après fermeture complète de Chromium', persisted)

        isolated = page.evaluate('''async()=>{
          await vault.put(identity,1,await SaveTestAPI.makeStateEnvelope(new Uint8Array([9,10]),identity,{kind:'battery'}));
          await vault.put(identity,1,await SaveTestAPI.makeStateEnvelope(new Uint8Array([31,32]),identity,{kind:'checkpoint'}));
          let other;try{await vault.load({...identity,rom_sha256:'d'.repeat(64)},1);}catch(e){other=e.code;}
          return {battery:[...(await vault.load(identity,1,{kind:'battery'})).bytes],checkpoint:[...(await vault.load(identity,1,{kind:'checkpoint'})).bytes],state:[...(await vault.load(identity,1)).bytes],other};
        }''')
        assert isolated == {'battery':[9,10],'checkpoint':[31,32],'state':[5,6,7,8],'other':'E_EMPTY'}
        ok('ROM, sauvegarde système et checkpoint isolés des états utilisateur', isolated)

        corruption = page.evaluate('''async()=>{
          const db=await vault.open();
          const records=await new Promise((resolve,reject)=>{const t=db.transaction('slots','readonly'),r=t.objectStore('slots').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
          const target=records.find(r=>r.kind==='state'&&r.slot===1), original=structuredClone(target);
          target.current.payload[0]^=255;
          await new Promise((resolve,reject)=>{const t=db.transaction('slots','readwrite');t.objectStore('slots').put(target);t.oncomplete=resolve;t.onabort=()=>reject(t.error);});
          let loadError,overwriteError;
          try{await vault.load(identity,1);}catch(e){loadError=e.code;}
          try{await vault.put(identity,1,await SaveTestAPI.makeStateEnvelope(new Uint8Array([11]),identity));}catch(e){overwriteError=e.code;}
          const backup=[...(await vault.load(identity,1,{previous:true})).bytes];
          await new Promise((resolve,reject)=>{const t=db.transaction('slots','readwrite');t.objectStore('slots').put(original);t.oncomplete=resolve;t.onabort=()=>reject(t.error);});
          return {loadError,overwriteError,backup};
        }''')
        assert corruption == {'loadError':'E_INTEGRITY','overwriteError':'E_INTEGRITY','backup':[1,2,3,4]}
        ok('Corruption refusée et copie précédente récupérable', corruption)

        race = page.evaluate('''async db=>{
          const one=new SaveTestAPI.SaveStore(db),two=new SaveTestAPI.SaveStore(db);
          const a=await SaveTestAPI.makeStateEnvelope(new Uint8Array([21]),identity),b=await SaveTestAPI.makeStateEnvelope(new Uint8Array([22]),identity);
          const revisions=await Promise.all([one.put(identity,2,a),two.put(identity,2,b)]);
          const latest=await vault.load(identity,2),previous=await vault.load(identity,2,{previous:true});
          await one.close();await two.close();
          return {revisions:revisions.map(x=>x.revision).sort(),current:[...latest.bytes],previous:[...previous.bytes]};
        }''', DB)
        assert race['revisions'] == [1,2] and {race['current'][0],race['previous'][0]} == {21,22}
        ok('Deux connexions concurrentes sans perte de révision', race)

        quota = page.evaluate('''async()=>{
          const original=IDBObjectStore.prototype.put;let code;
          IDBObjectStore.prototype.put=function(value,...args){if(this.name==='slots')throw new DOMException('Injected quota test','QuotaExceededError');return original.call(this,value,...args);};
          try{await vault.put(identity,1,await SaveTestAPI.makeStateEnvelope(new Uint8Array([99]),identity));}catch(e){code=e.code;}finally{IDBObjectStore.prototype.put=original;}
          return {code,current:[...(await vault.load(identity,1)).bytes],previous:[...(await vault.load(identity,1,{previous:true})).bytes]};
        }''')
        assert quota == {'code':'E_QUOTA','current':[5,6,7,8],'previous':[1,2,3,4]}
        ok('Échec quota injecté : ancienne sauvegarde conservée', {**quota,'quota_is_simulated':True})

        deletion = page.evaluate('''async()=>{
          await vault.delete(identity,2);
          let empty;try{await vault.load(identity,2);}catch(e){empty=e.code;}
          return {empty,remaining:(await vault.list(identity)).map(x=>x.slot),battery:[...(await vault.load(identity,1,{kind:'battery'})).bytes]};
        }''')
        assert deletion == {'empty':'E_EMPTY','remaining':[1],'battery':[9,10]}
        ok('Suppression explicite limitée au bon emplacement', deletion)
        await_close = page.evaluate('''async()=>{await vault.close();return true;}''')
        assert await_close
        context.close()
    assert not page_errors, page_errors
    assert all(request['url'].startswith('http://127.0.0.1:8774/') and request['method']=='GET' and request['body_bytes']==0 for request in requests), requests
    report = {'schema':'emuperso/save-store-browser-tests/v1','results':results,'page_errors':page_errors,'http':requests,'scope':'Real Chromium IndexedDB, synthetic state/battery bytes only. No emulator restoration or ROM compatibility tested here.','quota_failure':'Injected exception, not a real full-disk experiment.'}
    (ROOT/'evidence/tests-save-store-browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('TOTAL',len(results),'contrôles stockage navigateur',flush=True)
finally:
    server.shutdown();server.server_close()
