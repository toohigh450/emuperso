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
from serve import test_handler
Handler = test_handler('tests/save-store-browser.html')

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

        batch = page.evaluate('''async()=>{
          window.batchIdentity={...identity,rom_sha256:'e'.repeat(64)};
          window.batchEntries=async(state,battery)=>[
            {slot:3,envelope:await SaveTestAPI.makeStateEnvelope(new Uint8Array([state]),batchIdentity,{label:'État « atomique » 🎮'})},
            {slot:3,envelope:await SaveTestAPI.makeStateEnvelope(new Uint8Array([battery]),batchIdentity,{kind:'battery',label:'Natif associé'})}
          ];
          window.batchRead=async()=>{
            const state=await vault.load(batchIdentity,3),battery=await vault.load(batchIdentity,3,{kind:'battery'});
            const oldState=await vault.load(batchIdentity,3,{previous:true}),oldBattery=await vault.load(batchIdentity,3,{kind:'battery',previous:true});
            return {state:state.bytes[0],battery:battery.bytes[0],previousState:oldState.bytes[0],previousBattery:oldBattery.bytes[0],
              revisions:[state.revision,battery.revision],ids:[state.envelope.id,battery.envelope.id],previousIds:[oldState.envelope.id,oldBattery.envelope.id],label:state.envelope.metadata.label};
          };
          await vault.putBatch(batchIdentity,await batchEntries(42,52));
          const written=await vault.putBatch(batchIdentity,await batchEntries(43,53));
          window.batchBaseline=await batchRead();
          return {written,loaded:batchBaseline};
        }''')
        assert batch['loaded']['state'] == 43 and batch['loaded']['battery'] == 53
        assert batch['loaded']['previousState'] == 42 and batch['loaded']['previousBattery'] == 52
        assert batch['loaded']['revisions'] == [2,2]
        assert batch['loaded']['label'] == 'État « atomique » 🎮'
        assert all(row['payload_sha256'] for row in batch['written'])
        ok('Groupe état+natif : transaction unique et copies précédentes cohérentes', batch)

        second_failure = page.evaluate('''async()=>{
          const original=IDBObjectStore.prototype.put;let writes=0,code;
          IDBObjectStore.prototype.put=function(value,...args){
            if(this.name==='slots'&&++writes===2)throw new DOMException('Injected failure on second member','QuotaExceededError');
            return original.call(this,value,...args);
          };
          try{await vault.putBatch(batchIdentity,await batchEntries(44,54));}catch(error){code=error.code;}
          finally{IDBObjectStore.prototype.put=original;}
          const after=await batchRead();
          return {code,writes,allRecordsUnchanged:JSON.stringify(after)===JSON.stringify(batchBaseline)};
        }''')
        assert second_failure == {'code':'E_QUOTA','writes':2,'allRecordsUnchanged':True}
        ok('Échec du second membre : aucune écriture partielle ni perte des versions précédentes', {**second_failure,'failure_is_injected':True})

        interrupted = page.evaluate('''async()=>{
          const original=IDBObjectStore.prototype.put;let firstWriteSucceeded=false,code,writes=0;
          IDBObjectStore.prototype.put=function(value,...args){
            const transaction=this.transaction,request=original.call(this,value,...args);
            if(this.name==='slots'&&++writes===1)request.addEventListener('success',()=>{firstWriteSucceeded=true;transaction.abort();});
            return request;
          };
          try{await vault.putBatch(batchIdentity,await batchEntries(45,55));}catch(error){code=error.code;}
          finally{IDBObjectStore.prototype.put=original;}
          return {code,firstWriteSucceeded,allRecordsUnchanged:JSON.stringify(await batchRead())===JSON.stringify(batchBaseline)};
        }''')
        assert interrupted == {'code':'E_STORAGE','firstWriteSucceeded':True,'allRecordsUnchanged':True}
        ok('Interruption après succès réel du premier put IDB : groupe entièrement annulé', {**interrupted,'abort_is_injected':True})

        bad_member = page.evaluate('''async()=>{
          const address=await vault.address(batchIdentity,3,'battery'),original=await vault.record(address.key),bad=structuredClone(original);
          const db=await vault.open();
          const rawPut=value=>new Promise((resolve,reject)=>{const t=db.transaction('slots','readwrite');t.objectStore('slots').put(value);t.oncomplete=resolve;t.onabort=()=>reject(t.error);});
          bad.current.payload[0]^=255;await rawPut(bad);let code;
          try{await vault.putBatch(batchIdentity,await batchEntries(46,56));}catch(error){code=error.code;}
          const state=await vault.load(batchIdentity,3),nativeAfter=await vault.record(address.key);
          const unchanged=state.envelope.id===batchBaseline.ids[0]&&JSON.stringify(nativeAfter)===JSON.stringify(bad);
          await rawPut(original);
          return {code,stateAndCorruptMemberUnchanged:unchanged,restoredFixture:JSON.stringify(await batchRead())===JSON.stringify(batchBaseline)};
        }''')
        assert bad_member == {'code':'E_INTEGRITY','stateAndCorruptMemberUnchanged':True,'restoredFixture':True}
        ok('Membre courant corrompu : écriture groupée refusée sans toucher aucun membre', bad_member)

        batch_race = page.evaluate('''async db=>{
          const one=new SaveTestAPI.SaveStore(db),two=new SaveTestAPI.SaveStore(db);
          const entriesA=await batchEntries(61,71),entriesB=await batchEntries(62,72);
          const revisions=await Promise.all([one.putBatch(batchIdentity,entriesA),two.putBatch(batchIdentity,entriesB)]);
          const after=await batchRead();await one.close();await two.close();
          return {revisions:revisions.map(group=>group.map(row=>row.revision)).sort(),after};
        }''', DB)
        assert batch_race['revisions'] == [[3,3],[4,4]]
        race_after = batch_race['after']
        assert (race_after['state'],race_after['battery'],race_after['previousState'],race_after['previousBattery']) in [(61,71,62,72),(62,72,61,71)]
        ok('Groupes concurrents : révisions complètes et paires état+natif jamais mélangées', batch_race)

        batch_copy = page.evaluate('''async()=>{
          const entries=await batchEntries(81,91),pending=vault.putBatch(batchIdentity,entries);
          entries[0].envelope.payload[0]=255;entries[1].envelope.payload[0]=254;
          await pending;return await batchRead();
        }''')
        assert batch_copy['state'] == 81 and batch_copy['battery'] == 91 and batch_copy['revisions'] == [5,5]
        ok('Copie groupée avant await : mutation des entrées sans effet sur les données enregistrées', batch_copy)

        dedupe = page.evaluate('''async()=>{
          window.dedupeIdentity={...identity,rom_sha256:'f'.repeat(64)};
          window.nativeEnvelope=async(value,cheats=[])=>SaveTestAPI.makeStateEnvelope(new Uint8Array([value]),dedupeIdentity,{kind:'battery',label:'Natif atomique',cheats});
          window.stateEnvelope=async value=>SaveTestAPI.makeStateEnvelope(new Uint8Array([value]),dedupeIdentity,{label:'État associé'});
          await vault.putBatch(dedupeIdentity,[{slot:1,envelope:await stateEnvelope(30)},{slot:1,envelope:await nativeEnvelope(10)}]);
          await vault.put(dedupeIdentity,1,await nativeEnvelope(20));
          const before=await vault.load(dedupeIdentity,1,{kind:'battery'}),backup=await vault.load(dedupeIdentity,1,{kind:'battery',previous:true});
          const same=await nativeEnvelope(20);
          const written=await vault.putBatch(dedupeIdentity,[{slot:1,envelope:await stateEnvelope(31)},{slot:1,envelope:same,deduplicate:true}]);
          const after=await vault.load(dedupeIdentity,1,{kind:'battery'}),previous=await vault.load(dedupeIdentity,1,{kind:'battery',previous:true});
          return {written,current:after.bytes[0],previous:previous.bytes[0],revision:after.revision,
            retainedId:after.envelope.id===before.envelope.id,retainedDate:after.envelope.created_utc===before.envelope.created_utc,
            retainedBackup:previous.envelope.id===backup.envelope.id,returnedStoredId:written[1].id===before.envelope.id,
            didNotReturnUnusedId:written[1].id!==same.id};
        }''')
        assert dedupe['current'] == 20 and dedupe['previous'] == 10 and dedupe['revision'] == 2
        assert dedupe['written'][0]['revision'] == 2 and not dedupe['written'][0]['skipped_unchanged']
        assert dedupe['written'][1]['revision'] == 2 and dedupe['written'][1]['skipped_unchanged']
        assert all(dedupe[key] for key in ['retainedId','retainedDate','retainedBackup','returnedStoredId','didNotReturnUnusedId'])
        ok('Déduplication dans le groupe : sauvegarde native et copie précédente distincte intactes', dedupe)

        dedupe_race = page.evaluate('''async dbName=>{
          const checked=new SaveTestAPI.SaveStore(dbName),writer=new SaveTestAPI.SaveStore(dbName),originalRead=checked.record.bind(checked);
          let release,ready,reads=0,hold=true;
          const gate=new Promise(resolve=>{release=resolve;}),captured=new Promise(resolve=>{ready=resolve;});
          checked.record=async key=>{
            const value=await originalRead(key);
            if(hold){if(++reads===2)ready();await gate;}
            return value;
          };
          const pending=checked.putBatch(dedupeIdentity,[{slot:1,envelope:await stateEnvelope(40)},
            {slot:1,envelope:await nativeEnvelope(20),deduplicate:true}]);
          await captured;
          // Both old records have really been read, but no group write began.
          // A second actual connection now changes the native current record.
          await writer.put(dedupeIdentity,1,await nativeEnvelope(99));
          hold=false;release();const written=await pending;
          const state=await vault.load(dedupeIdentity,1),battery=await vault.load(dedupeIdentity,1,{kind:'battery'}),
            previous=await vault.load(dedupeIdentity,1,{kind:'battery',previous:true});
          await checked.close();await writer.close();
          return {written,state:state.bytes[0],native:battery.bytes[0],previousNative:previous.bytes[0],
            stateRevision:state.revision,nativeRevision:battery.revision,realConcurrentWrite:99};
        }''', DB)
        assert dedupe_race['state'] == 40 and dedupe_race['native'] == 20 and dedupe_race['previousNative'] == 99
        assert dedupe_race['stateRevision'] == 3 and dedupe_race['nativeRevision'] == 4
        assert not dedupe_race['written'][1]['skipped_unchanged']
        ok('Déduplication concurrente : membre natif relu par CAS, paire cohérente et valeur concurrente récupérable', dedupe_race)

        dedupe_metadata = page.evaluate('''async()=>{
          const before=await vault.load(dedupeIdentity,1,{kind:'battery'});
          const altered=await nativeEnvelope(20,[{id:'synthetic-cheat-history',code:'80000000 0001',enabled:false}]);
          const written=await vault.putBatch(dedupeIdentity,[{slot:1,envelope:await stateEnvelope(41)},
            {slot:1,envelope:altered,deduplicate:true}]);
          const current=await vault.load(dedupeIdentity,1,{kind:'battery'}),previous=await vault.load(dedupeIdentity,1,{kind:'battery',previous:true});
          return {written,native:current.bytes[0],revision:current.revision,cheats:current.envelope.metadata.cheats.length,
            previousWasUnmarked:previous.envelope.id===before.envelope.id&&previous.envelope.metadata.cheats.length===0};
        }''')
        assert dedupe_metadata['native'] == 20 and dedupe_metadata['revision'] == 5 and dedupe_metadata['cheats'] == 1
        assert not dedupe_metadata['written'][1]['skipped_unchanged'] and dedupe_metadata['previousWasUnmarked']
        ok('Déduplication : mêmes octets avec historique différent restent une vraie nouvelle révision', dedupe_metadata)

        writer = context.new_page(); setup(writer)
        writer.evaluate('''async()=>{
          const id={...identity,rom_sha256:'e'.repeat(64)};
          const entries=[
            {slot:3,envelope:await SaveTestAPI.makeStateEnvelope(new Uint8Array([101]),id)},
            {slot:3,envelope:await SaveTestAPI.makeStateEnvelope(new Uint8Array([111]),id,{kind:'battery'})}
          ];
          const original=IDBObjectStore.prototype.put;let first=true;
          IDBObjectStore.prototype.put=function(value,...args){
            const transaction=this.transaction,request=original.call(this,value,...args);
            if(this.name==='slots'&&first){
              first=false;
              request.addEventListener('success',()=>{
                window.__batchFirstWrite=true;
                const keepOpen=()=>{const next=transaction.objectStore('slots').get('__synthetic_keepalive__');next.onsuccess=keepOpen;};
                keepOpen();
              });
            }
            return request;
          };
          window.__pendingBatch=vault.putBatch(id,entries).catch(error=>{window.__batchInterruptedError=error.code;});
        }''')
        writer.wait_for_function('()=>window.__batchFirstWrite===true')
        # Close the actual persistent browser while a real IDB group has written
        # but cannot complete. This is a browser lifecycle test, not a power cut.
        context.close()
        context = pw.chromium.launch_persistent_context(profile, **options)
        page = context.new_page(); setup(page)
        after_close = page.evaluate('''async()=>{
          const id={...identity,rom_sha256:'e'.repeat(64)},s=await vault.load(id,3),b=await vault.load(id,3,{kind:'battery'}),ps=await vault.load(id,3,{previous:true}),pb=await vault.load(id,3,{kind:'battery',previous:true});
          return {state:s.bytes[0],battery:b.bytes[0],previousState:ps.bytes[0],previousBattery:pb.bytes[0],revisions:[s.revision,b.revision]};
        }''')
        if after_close['state'] == 81:
            assert after_close['battery'] == 91 and after_close['revisions'] == [5,5]
            assert after_close['previousState'] == batch_copy['previousState'] and after_close['previousBattery'] == batch_copy['previousBattery']
            outcome = 'all_previous'
        else:
            assert after_close == {'state':101,'battery':111,'previousState':81,'previousBattery':91,'revisions':[6,6]}
            outcome = 'all_committed'
        ok('Fermeture du navigateur pendant transaction : tous les membres ou aucun après réouverture', {**after_close,'outcome':outcome,'physical_power_loss':'NON TESTABLE'})

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
except Exception as error:
    results.append({'test':'Parcours stockage interrompu','status':'ÉCHOUÉ','proof':{'error':type(error).__name__,'message':str(error)}})
    report = {'schema':'emuperso/save-store-browser-tests/v1','results':results,'page_errors':page_errors,'http':requests,
              'scope':'Real Chromium IndexedDB, synthetic fixtures only. Interrupted run; no success inferred.',
              'quota_failure':'Injected exception, not a real full-disk experiment.'}
    (ROOT/'evidence/tests-save-store-browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    raise
finally:
    server.shutdown();server.server_close()
