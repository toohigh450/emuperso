"""Real-core C01/C02/C03 regressions, exclusively with our unchanged MIT ROM.

The UI catalog is an original synthetic MIT fixture: two deliberately ambiguous
USA/EUR-labelled views of the SAME owned header, not a commercial game's codes
or proof of regional compatibility. Only its lock/text HTTP responses are routed;
the genuine pinned EmulatorJS/Mupen Wasm, RAM, VI and native cheat APIs still run.

Native faults are explicitly injected into the existing real GameManager API:
earlier calls execute the actual native setter, then the selected call throws.
No partial native list is claimed readable. Actual RAM writes establish the
healthy list before the fault and absence of writers in the explicit clean
recovery session. All save data belongs to a new temporary browser profile.
"""
from pathlib import Path
import hashlib
import json
import os
import sys
import tempfile
import threading
from http.server import ThreadingHTTPServer

from playwright.sync_api import sync_playwright
import browser_restore_rc as common

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from serve import Handler

PORT=int(os.environ.get('N64_CHEAT_FAULT_TEST_PORT','18883'))
URL=f'http://127.0.0.1:{PORT}/'
REPORT=ROOT/'evidence/tests-cheat-faults-rc-browser.json'
ROM=common.ROM
SHA=hashlib.sha256(ROM).hexdigest()
assert SHA=='f18280a16c83721bdd56564701d505f96346784f36168402e5431b12499e2252'
KEY=f'{ROM[0x10:0x14].hex().upper()}-{ROM[0x14:0x18].hex().upper()}-C:{ROM[0x3e]:02X}'
ADDRESSES=[0x10000,0x10002,0x10004,0x10006]
VALUES={'USA':[0xA1A1,0xB2B2,0xC3C3,0xD4D4],'EUR':[0xE1E1,0xE2E2,0xE3E3,0xE4E4]}
SENTINELS=[0x7101,0x7202,0x7303,0x7404]
parts=['// Original synthetic MIT fixture, not upstream/community game data.']
for view in ('USA','EUR'):
    parts.extend([f'crc {KEY}',f'gn RC FIXTURE {view}'])
    for i,address in enumerate(ADDRESSES):
        parts.extend([f' cn {view} writer {i+1}',f'  81{address:06X} {VALUES[view][i]:04X}'])
CATALOG=('\n'.join(parts)+'\n').encode('ascii')
LOCK={'schema':'emuperso/cheat-catalog-lock/v1','repository':'SYNTHETIC OWNED MIT TEST FIXTURE, NOT UPSTREAM',
      'commit':'0000000000000000000000000000000000000000','license':'MIT synthetic test fixture',
      'assets':[{'file':'mupencheat.txt','bytes':len(CATALOG),'sha256':hashlib.sha256(CATALOG).hexdigest()}],
      'upstream_game_blocks':2,'upstream_cheat_entries':8}
results,page_errors,requests,dialogs=[],[],[],[]


def record(name,proof,status='RÉUSSI'):
    results.append({'test':name,'status':status,'proof':proof})
    print(status+' — '+name,flush=True)


def diagnostic(page):return common.diagnostic(page)

def events(page,name):return common.events(page,name)

def idle(page):return common.idle(page)

def vault(page):return common.vault(page)


def wait_frames(page,count=20):
    before=page.evaluate('EJS_emulator.gameManager.getFrameNum()')
    page.wait_for_function('({before,count})=>EJS_emulator.gameManager.getFrameNum()>=before+count',arg={'before':before,'count':count},timeout=25000)
    return {'before':before,'after':page.evaluate('EJS_emulator.gameManager.getFrameNum()')}


def memory_values(page):
    return page.evaluate('addresses=>addresses.map(address=>{const b=ownDemoReadBytes(address,2);return b[0]*256+b[1];})',ADDRESSES)


def write_sentinels(page):
    page.evaluate('''({addresses,values})=>{
      const {base,wordSwapped}=window.__rcRam,heap=EJS_emulator.Module.HEAPU8;
      addresses.forEach((address,i)=>{
        heap[base+(wordSwapped?address^3:address)]=values[i]>>>8;
        heap[base+(wordSwapped?(address+1)^3:address+1)]=values[i]&255;
      });
    }''',{'addresses':ADDRESSES,'values':SENTINELS})


def prove_writers(page,view,enabled):
    page.wait_for_function('()=>EJS_emulator.gameManager.getFrameNum()>120',timeout=30000)
    write_sentinels(page);frames=wait_frames(page)
    expected=[VALUES[view][i]if i in enabled else SENTINELS[i]for i in range(4)]
    actual=memory_values(page)
    assert actual==expected,{'enabled':enabled,'expected':expected,'actual':actual}
    return {'addresses':ADDRESSES,'expected':expected,'actual':actual,'real_frames':frames,
            'interpretation':'Active writers replace sentinels; disabled writers leave them unchanged.'}


def row(page,view,index):
    return page.locator('#cheat-list label').filter(has_text=f'{view} writer {index+1}').locator('input[type=checkbox]')


def list_snapshot(page):
    return page.evaluate('''()=>({
      selected:document.querySelector('#cheat-variant').value,
      rows:[...document.querySelectorAll('#cheat-list label')].map(label=>({text:label.textContent,checked:label.querySelector('input').checked,id:label.querySelector('input').dataset.cheatId})),
      active:RealN64.diagnostic().cheats.active,
      active_generation:RealN64.diagnostic().session.active_generation
    })''')


def choose_view(page,view):
    value='0'if view=='USA'else'1'
    page.wait_for_function('()=>!document.querySelector("#cheat-variant").hidden&&document.querySelector("#cheat-variant").options.length===3',timeout=15000)
    page.locator('#cheat-variant').select_option(value)
    page.wait_for_function('view=>[...document.querySelectorAll("#cheat-list label")].filter(e=>e.textContent.includes(view+" writer")).length===4',arg=view,timeout=15000)
    assert page.locator('#cheat-variant').input_value()==value
    assert not page.locator('#cheat-variant').is_hidden()


def enable(page,view,index):
    assert row(page,view,index).count()==1
    count=len(events(page,'cheats.changed'));failures=len(events(page,'operation.failed'))
    row(page,view,index).click()
    page.wait_for_function('''({count,failures})=>{
      const r=RealN64.diagnostic().records;return r.filter(e=>e.type==='cheats.changed').length>count||r.filter(e=>e.type==='operation.failed').length>failures;
    }''',arg={'count':count,'failures':failures},timeout=30000)
    idle(page)
    assert len(events(page,'operation.failed'))==failures,events(page,'operation.failed')[-1:]
    assert row(page,view,index).is_checked()


def disable_all(page):
    count=len(events(page,'cheats.changed'));page.locator('#cheat-disable-all').click()
    page.wait_for_function('n=>RealN64.diagnostic().records.filter(e=>e.type==="cheats.changed").length>n',arg=count,timeout=30000)
    idle(page);assert diagnostic(page)['cheats']['active']==[]


def install_fault(page,mode,target=0):
    page.evaluate('''({mode,target})=>{
      const w=RealN64.engineWindow,g=EJS_emulator.gameManager;
      const actualSet=g.functions.setCheat,actualReset=g.functions.resetCheat;
      window.__cheatFault={mode,target,set_calls:[],reset_calls:0,completed_native_sets:0,
        api:w.N64Engine,manager:g,getFrame:g.functions.getFrameNum,originalSet:actualSet,originalReset:actualReset};
      g.functions.setCheat=function(index,enabled,code){
        const f=window.__cheatFault;f.set_calls.push({index,enabled,code});
        if(f.mode==='set'&&f.set_calls.length===f.target)throw new Error('CONTROLLED RC native setCheat fault at call '+f.target);
        const result=actualSet(index,enabled,code);f.completed_native_sets++;return result;
      };
      g.functions.resetCheat=function(){
        const f=window.__cheatFault;f.reset_calls++;
        if(f.mode==='reset')throw new Error('CONTROLLED RC native resetCheat fault, including cleanup');
        return actualReset();
      };
    }''',{'mode':mode,'target':target})


def fault_metadata(page):
    return page.evaluate('''()=>{
      const f=window.__cheatFault;
      return{mode:f.mode,target:f.target,set_calls:f.set_calls,reset_calls:f.reset_calls,
        completed_native_sets:f.completed_native_sets,snapshot:f.api.snapshot(),old_native_frame:f.getFrame()};
    }''')


def restore_observer(page):
    page.evaluate('''()=>{const f=window.__cheatFault;f.manager.functions.setCheat=f.originalSet;f.manager.functions.resetCheat=f.originalReset;delete window.__cheatFault;}''')


def invalid_request_proof(page):
    before_vault=vault(page);before=list_snapshot(page)
    install_fault(page,'observe')
    try:
        rejected=page.evaluate('''()=>{
          try{window.__cheatFault.api.setCheats([{code:'81010000 A1A1'},{code:'INVALID SECOND CODE'}]);return{accepted:true};}
          catch(error){return{accepted:false,code:error.code,message:error.message};}
        }''')
        meta=fault_metadata(page)
        assert rejected['accepted']is False and rejected['code']=='E_CHEAT_INPUT',rejected
        assert meta['set_calls']==[]and meta['reset_calls']==0,meta
        assert meta['snapshot']['poisoned']is False
        assert list_snapshot(page)==before
        assert vault(page)==before_vault
        effects=prove_writers(page,'USA',[0,1])
        return{'rejection':rejected,'native_reset_calls':0,'native_add_calls':0,'prior_list_effects':effects,'vault_unchanged':True}
    finally:restore_observer(page)


def native_identity(page):
    return page.evaluate('''async()=>{
      const e=EJS_emulator,b=e.gameManager.FS.readFile(e.fileName);
      return{bytes:b.length,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join('')};
    }''')


def trigger_and_recover(page,mode,target,trigger,hold_autosave=False):
    before_vault=vault(page);before_generation=diagnostic(page)['session']['active_generation']
    before_changes=len(events(page,'cheats.changed'));before_failures=len(events(page,'operation.failed'))
    old_native=common.native(page)
    install_fault(page,mode,target)
    trigger()
    page.wait_for_function('''previous=>{
      const d=RealN64.diagnostic();return d.session.active_generation===null&&d.session.frame_count===0&&
        d.records.some(r=>r.type==='cheats.quarantined')&&d.records.some(r=>r.type==='session.quarantined'&&r.data.generation===previous)&&
        !document.querySelector('#cheat-recover').hidden&&!document.querySelector('#cheat-recover').disabled;
    }''',arg=before_generation,timeout=20000)
    assert diagnostic(page)['phase']=='idle'
    assert len(events(page,'cheats.changed'))==before_changes
    assert len(events(page,'operation.failed'))==before_failures+1
    assert events(page,'operation.failed')[-1]['data']['code']=='E_CHEAT_STATE_UNKNOWN'
    assert vault(page)==before_vault
    for control in ('state-save','state-load','battery-save','save-export'):
        assert page.locator('#'+control).is_disabled(),control
    stopped=fault_metadata(page)
    assert stopped['snapshot']['poisoned']is True and stopped['snapshot']['fault_code']=='E_CHEAT_STATE_UNKNOWN'
    if mode=='set':
        assert len(stopped['set_calls'])==target and stopped['completed_native_sets']==target-1,stopped
    else:
        assert stopped['reset_calls']>=2,'Initial reset and cleanup reset must both reach the injected failure'
    guards=page.evaluate('''async()=>{
      const api=window.__cheatFault.api,out={};
      for(const method of ['captureState','captureBattery','play']){
        try{await api[method]();out[method]='ACCEPTED';}catch(error){out[method]=error.code;}
      }
      return out;
    }''')
    assert all(code=='E_CHEAT_STATE_UNKNOWN'for code in guards.values()),guards
    if hold_autosave:
        # Cover at least one actual 15-second application autosave interval.
        page.wait_for_timeout(16500)
    else:page.wait_for_timeout(700)
    still=fault_metadata(page)
    assert still['old_native_frame']==stopped['old_native_frame'],(stopped,still)
    assert diagnostic(page)['session']['active_generation']is None
    assert vault(page)==before_vault
    assert page.locator('#cheat-recover').is_visible()
    quarantined={'fault':still,'blocked_api_calls':guards,'waited_ms':16500 if hold_autosave else 700,
        'vault_before':before_vault,'vault_after_wait':vault(page),'automatic_restart':False,
        'error':events(page,'operation.failed')[-1]['data']}

    before_recovery=len(events(page,'cheats.recovery.clean'))
    page.locator('#cheat-recover').click()
    page.wait_for_function('n=>RealN64.diagnostic().records.filter(r=>r.type==="cheats.recovery.clean").length>n',arg=before_recovery,timeout=70000)
    common.started(page,before_generation)
    assert diagnostic(page)['cheats']['active']==[]
    assert page.locator('#cheat-recover').is_hidden()
    assert vault(page)==before_vault
    identity=native_identity(page);assert identity=={'bytes':len(ROM),'sha256':SHA}
    assert common.native(page)==old_native
    no_writers=prove_writers(page,'USA',[])
    assert vault(page)==before_vault
    recovered={'generation':diagnostic(page)['session']['active_generation'],'rom':identity,
        'native':common.native(page),'actual_no_writer_proof':no_writers,'vault_unchanged':True,
        'event':events(page,'cheats.recovery.clean')[-1]['data']}
    page.evaluate('delete window.__cheatFault')
    return{'quarantine':quarantined,'explicit_recovery':recovered}


def main():
    server=ThreadingHTTPServer(('127.0.0.1',PORT),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    context=page=None
    try:
        with tempfile.TemporaryDirectory(prefix='n64-cheat-faults-owned-mit-')as profile,sync_playwright()as pw:
            context=pw.chromium.launch_persistent_context(profile,
                executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,
                viewport={'width':1280,'height':1050},args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
            page=context.new_page();page.on('pageerror',lambda error:page_errors.append(str(error)))
            page.on('request',lambda req:requests.append({'url':req.url,'method':req.method,'body_bytes':len(req.post_data_buffer or b'')}))
            def accept(dialog):dialogs.append(dialog.message);dialog.accept()
            page.on('dialog',accept)
            page.route(URL+'docs/cheat-catalog-lock.json',lambda route:route.fulfill(status=200,content_type='application/json',body=json.dumps(LOCK)))
            page.route(URL+'vendor/cheats/mupencheat.txt',lambda route:route.fulfill(status=200,content_type='text/plain; charset=utf-8',body=CATALOG))
            page.goto(URL);page.wait_for_function('()=>!!window.RealN64')
            assert page.evaluate('RealN64.version')=='0.5.0-rc2-cheat-guards'
            page.locator('#start').click();common.started(page)
            common.action(page,'#battery-save','battery.saved')
            common.action(page,'#state-save','state.saved')
            choose_view(page,'USA')
            assert diagnostic(page)['cheats']['active']==[]
            enable(page,'USA',0);before=list_snapshot(page);before_vault=vault(page)
            active_effect=prove_writers(page,'USA',[0]);blocked_before=len(events(page,'cheats.variant.blocked'))
            attempts=[]
            for attempted_view in ('EUR','USA'):
                assert page.locator('#cheat-variant').is_disabled()
                value='1'if attempted_view=='EUR'else'0'
                # An ordinary user cannot change a disabled picker. Explicitly
                # dispatch a programmatic change as well to exercise its guard.
                page.evaluate('''value=>{const picker=document.querySelector('#cheat-variant');picker.value=value;picker.dispatchEvent(new Event('change',{bubbles:true}));}''',value)
                page.wait_for_function('n=>RealN64.diagnostic().records.filter(r=>r.type==="cheats.variant.blocked").length>n',arg=blocked_before)
                blocked_before=len(events(page,'cheats.variant.blocked'))
                assert list_snapshot(page)==before
                assert vault(page)==before_vault
                attempts.append({'attempted_view':attempted_view,'picker_disabled':True,'programmatic_guard_event':events(page,'cheats.variant.blocked')[-1]['data'],'actual_writer':prove_writers(page,'USA',[0])})
            # A state containing active codes can reopen with an ambiguous
            # catalog. Its active writer must remain visible as a session row.
            page.locator('#save-slot').select_option('2')
            common.action(page,'#state-save','state.saved')
            common.action(page,'#state-load','state.loaded',generation=True)
            page.wait_for_function('()=>!document.querySelector("#cheat-status").textContent.includes("Recherche des codes")')
            assert row(page,'USA',0).count()==1 and row(page,'USA',0).is_checked()
            assert page.locator('#cheat-variant').is_disabled()
            assert page.locator('#cheat-variant').input_value()==''
            restored_visible={'list':list_snapshot(page),'actual_writer':prove_writers(page,'USA',[0]),
                'active_code_visible_without_catalog_variant_selected':True}
            disable_all(page);off=prove_writers(page,'USA',[])
            assert page.locator('#cheat-variant').is_enabled()
            selections=[]
            for view in ('EUR','USA'):
                choose_view(page,view)
                assert diagnostic(page)['cheats']['active']==[]
                assert all(not row(page,view,i).is_checked()for i in range(4))
                selections.append({'view':view,'HTML_value':page.locator('#cheat-variant').input_value(),'rows':list_snapshot(page)['rows']})
            record('C01/C03 : vue active protégée ; variantes HTML retrouvées après désactivation',{
                'fixture':'Original synthetic MIT catalog aliases; no regional/commercial ROM used',
                'active_view':before,'actual_active_writer':active_effect,'blocked_attempts':attempts,
                'restored_state_with_ambiguous_catalog':restored_visible,
                'after_disable_actual_no_writers':off,'allowed_inactive_selections':selections})

            enable(page,'USA',0);enable(page,'USA',1)
            preflight=invalid_request_proof(page);prior=prove_writers(page,'USA',[0,1])
            fault=trigger_and_recover(page,'set',2,lambda:row(page,'USA',2).click(),hold_autosave=True)
            record('C02 : échec du deuxième ajout natif, quarantaine et reprise propre explicite',{'invalid_second_input_preflight':preflight,'known_list_before_fault':prior,**fault})

            choose_view(page,'USA')
            for i in (0,1,2):enable(page,'USA',i)
            prior=prove_writers(page,'USA',[0,1,2])
            fault=trigger_and_recover(page,'set',3,lambda:row(page,'USA',3).click())
            record('C02 : échec du troisième ajout natif, aucun writer résiduel après relance',{'known_list_before_fault':prior,**fault})

            choose_view(page,'USA');enable(page,'USA',0);enable(page,'USA',1)
            prior=prove_writers(page,'USA',[0,1])
            fault=trigger_and_recover(page,'reset',0,lambda:page.locator('#cheat-disable-all').click())
            record('C02 : reset natif et cleanup en erreur, session retirée et nouveau cœur sans cheats',{'known_list_before_fault':prior,**fault})
            assert len(results)==4
            assert not page_errors,page_errors
            assert all((r['url'].startswith(URL)or r['url'].startswith('blob:'+URL))and r['method']=='GET'and r['body_bytes']==0 for r in requests),requests
            page.screenshot(path=str(ROOT/'evidence/cheat-faults-rc-final.png'),full_page=True)
            context.close();context=None
    except Exception as error:
        record('Banc de fautes cheats interrompu',str(error),status='ÉCHOUÉ')
        if page and not page.is_closed():
            try:page.screenshot(path=str(ROOT/'evidence/cheat-faults-rc-failure.png'),full_page=True)
            except Exception:pass
        raise
    finally:
        if context:
            try:context.close()
            except Exception:pass
        report={'schema':'emuperso/cheat-faults-rc-tests/v1','results':results,'page_errors':page_errors,'http':requests,'dialogs':dialogs,
            'rom_sha256':SHA,'catalog_fixture':{'synthetic':True,'MIT_original':True,'header_key':KEY,'sha256':hashlib.sha256(CATALOG).hexdigest(),'game_views':2,'cheat_entries':8},
            'scope':'Real pinned N64 core and unchanged repository MIT demo in a fresh temporary profile. Synthetic catalog HTTP responses and explicitly injected native wrapper exceptions. Actual RAM writes, stopped old loop, unchanged vault and explicit new clean core are checked.',
            'not_tested':['Karl Windows PC','Commercial games and regional compatibility','All cheats or all failure modes'],'original_saves_used':False}
        REPORT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        server.shutdown();server.server_close()
    print('TOTAL',len(results),'contrôles fautes cheats RC',flush=True)


if __name__=='__main__':main()
