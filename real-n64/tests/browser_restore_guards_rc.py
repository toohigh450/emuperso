"""Four real-engine guards for the final RC, with the repository MIT ROM only.

The first state is captured close to boot without writing a RAM marker. Safe
preflight refusal is distinguished from reaching the deliberate native no-op.
An authentic early state can therefore remain unsupported: that limitation is
reported, never presented as successful restoration or a fault that did not run.
A second subcase reads the ENTIRE native input through the actual FS but never
deserializes it; distinctive controlled RAM must still prevent false success.
Stable RAM hashes and the same actual engine prove retention, not a load ACK.

Other explicitly injected faults are an unresolved WebAudio suspend during save
or pre-cheat checkpoint, and an IndexedDB list failure strictly AFTER a session
commit. They are controlled regressions, not tests on Karl's Windows computer.
"""
from pathlib import Path
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

PORT=int(os.environ.get('N64_RESTORE_GUARDS_PORT','18879'))
URL=f'http://127.0.0.1:{PORT}/'
results,errors,requests,dialogs=[],[],[],[]

# Read the actual pinned native serialization, not the product's RAM verdict.
# Its MEM payload layout and the code byte order are independently checked
# against our exact MIT ROM. No RAM byte is written by this fingerprint helper.
CORE_FINGERPRINT=r'''async()=>{
  const e=EJS_emulator,api=RealN64.engineWindow.N64Engine,state=api.captureState();
  const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const rom=e.gameManager.FS.readFile(e.fileName),romSha=await sha(rom);
  if(romSha!=='f18280a16c83721bdd56564701d505f96346784f36168402e5431b12499e2252')throw Error('Guard is restricted to the owned MIT ROM');
  if(String.fromCharCode(...state.subarray(0,7))!=='RASTATE'||state[7]!==1)throw Error('Unknown real native container');
  const view=new DataView(state.buffer,state.byteOffset,state.byteLength);let mem=null;
  for(let cursor=8;cursor+8<=state.length;){
    const tag=String.fromCharCode(...state.subarray(cursor,cursor+4)),size=view.getUint32(cursor+4,true);
    if(cursor+8+size>state.length)throw Error('Native chunk exceeds real capture');
    if(tag==='MEM '){mem={offset:cursor+8,size};break;}
    cursor+=8+Math.ceil(size/8)*8;
  }
  if(!mem||String.fromCharCode(...state.subarray(mem.offset,mem.offset+8))!=='M64+SAVE')throw Error('Unknown real core payload');
  const ram=state.subarray(mem.offset+444,mem.offset+444+0x800000);
  if(ram.length!==0x800000)throw Error('Actual RAM is truncated');
  const program=rom.slice(0x1000,0x1040),swapped=program.slice();
  for(let i=0;i<swapped.length;i+=4)swapped.set(program.slice(i,i+4).reverse(),i);
  if(!swapped.every((v,i)=>ram[0x400+i]===v))throw Error('The inspected payload is not the owned ROM live code');
  const unused=ram.subarray(0x10000,0x10080);
  return{rom_sha256:romSha,rom_bytes:rom.length,rdram_bytes:ram.length,
    code_sha256:await sha(ram.subarray(0x400,0x440)),unused_sha256:await sha(unused),
    unused_nonzero_bytes:[...unused].filter(v=>v!==0).length,
    native_frame:e.gameManager.getFrameNum(),paused:api.snapshot().paused};
}'''

# The second mode exercises the actual FS.read tracker by consuming the complete
# verified file, while deliberately omitting the native deserialize call. The
# real Wasm CPU/VI continue running. This is a labelled test fault, not a claimed
# real-world emulator or Windows failure.
FAULT_INIT=r'''(() => {
  if(window===window.top||!location.pathname.endsWith('/engine.html'))return;
  if(!window.top.__rcNoopLoad)return;
  let manager;
  Object.defineProperty(window,'EJS_GameManager',{configurable:true,get:()=>manager,set(klass){
    manager=new Proxy(klass,{construct(target,args,newTarget){
      const value=Reflect.construct(target,args,newTarget);
      if(value.functions?.loadState)value.functions.loadState=(path)=>{
        window.top.__rcNoopCalls=(window.top.__rcNoopCalls??0)+1;
        if(window.top.__guardLoadMode==='read-all-no-apply'){
          const expected=value.FS.stat(path).size,bytes=value.FS.readFile(path);
          window.top.__guardReadAll={expected_bytes:expected,read_bytes:bytes.length,native_deserialize_called:false};
        }
        return 0;
      };
      return value;
    }});
  }});
})();'''


def record(name,proof,status='RÉUSSI'):
    results.append({'test':name,'status':status,'proof':proof})
    print(status+' — '+name,flush=True)


def diagnostic(page):return common.diagnostic(page)

def events(page,name):return common.events(page,name)

def idle(page):return common.idle(page)

def vault(page):return common.vault(page)

def core(page):return page.evaluate(CORE_FINGERPRINT)


def remember_engine(page):
    page.evaluate('''()=>{window.__guardOldEngine=EJS_emulator;window.__guardOldModule=EJS_emulator.Module;}''')


def assert_retained(page,before_diag,before_core):
    after_diag=diagnostic(page);after_core=core(page)
    assert page.evaluate('EJS_emulator===window.__guardOldEngine&&EJS_emulator.Module===window.__guardOldModule')
    assert after_diag['identity']==before_diag['identity']
    assert after_diag['session']['active_generation']==before_diag['session']['active_generation']
    assert after_diag['session']['frame_count']==1
    for key in ('rom_sha256','rom_bytes','rdram_bytes','code_sha256','unused_sha256','unused_nonzero_bytes'):
        assert after_core[key]==before_core[key],{'field':key,'before':before_core,'after':after_core}
    page.wait_for_timeout(450)
    progress=page.evaluate('EJS_emulator.gameManager.getFrameNum()')
    assert progress>after_core['native_frame'],{'before':after_core['native_frame'],'after':progress}
    return {'after':after_core,'frame_after_observation':progress,'same_actual_engine_and_module':True,
        'ram_scope':'Code and unused RAM unchanged; framebuffer animation legitimately continues.'}


def wait_failed(page,count,timeout=30000):
    page.wait_for_function('n=>RealN64.diagnostic().records.filter(r=>r.type==="operation.failed").length>n',arg=count,timeout=timeout)
    idle(page)
    error=events(page,'operation.failed')[-1]['data']
    assert isinstance(error.get('message'),str) and len(error['message'])>25,error
    assert page.locator('#status').inner_text().strip()
    return error


def running_audio(page):
    page.locator('#audio').click();idle(page)
    page.wait_for_function('()=>RealN64.engineWindow.N64Engine.snapshot().contexts.some(c=>c.state==="running")',timeout=10000)


def inject_suspend(page):
    page.evaluate('''()=>{
      const w=RealN64.engineWindow;w.__guardSuspendOriginal=w.AudioContext.prototype.suspend;w.__guardSuspendCalls=0;
      w.AudioContext.prototype.suspend=function(){w.__guardSuspendCalls++;return new Promise(()=>{});};
    }''')


def restore_suspend(page):
    page.evaluate('''()=>{const w=RealN64.engineWindow;w.AudioContext.prototype.suspend=w.__guardSuspendOriginal;}''')


def mark_unused_pages(page,phase):
    # Only our MIT ROM runs. Physical 0x10000..0x8ffff is unused by its code,
    # stack, framebuffers (>=0x100000), controller (0x200000) and PCM (0x300000).
    # Many pages prevent a natural framebuffer coincidence satisfying a 90%
    # witness while one diagnostic marker happens to be in the unmatched tail.
    return page.evaluate('''phase=>{
      const {base,wordSwapped}=window.__rcRam,heap=EJS_emulator.Module.HEAPU8;
      const pattern=phase==='saved'?[0x13,0x57,0x9b,0xdf]:[0x24,0x68,0xac,0xe0];
      for(let page=0;page<128;page++)for(let i=0;i<32;i++){
        const physical=0x10000+page*0x1000+i;
        heap[base+(wordSwapped?physical^3:physical)]=pattern[i%pattern.length];
      }
      return{phase,pages:128,bytes_per_page:32,physical_first:0x10000,physical_last:0x8f01f,pattern};
    }''',phase)


def failed_pause_action(page,selector,success_event,name,extra_check=None):
    running_audio(page)
    before_diag=diagnostic(page);before_core=core(page);before_vault=vault(page)
    failures=len(events(page,'operation.failed'));successes=len(events(page,success_event));remember_engine(page)
    inject_suspend(page)
    try:
        page.locator(selector).click();error=wait_failed(page,failures)
        assert error.get('code')=='E_AUDIO_SUSPEND_TIMEOUT',error
        assert page.evaluate('RealN64.engineWindow.__guardSuspendCalls')>0
        assert len(events(page,success_event))==successes
        assert vault(page)==before_vault
        retained=assert_retained(page,before_diag,before_core)
        assert retained['after']['paused'] is False,'The failed pause must resume the actual old main loop'
        if extra_check:extra_check()
        record(name,{'injected_fault':'Actual session AudioContext.suspend returns a never-settling promise',
            'error':error,'vault_before':before_vault,'vault_after':vault(page),'retention':retained,
            'native_frame_before':before_core['native_frame'],'operation_success_event_emitted':False,
            'not_a_test_on_karl_pc':True})
    finally:restore_suspend(page)


def main():
    report_path=ROOT/'evidence/tests-restore-guards-rc-browser.json'
    server=ThreadingHTTPServer(('127.0.0.1',PORT),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    context=page=None
    try:
        with tempfile.TemporaryDirectory(prefix='n64-guards-rc-owned-mit-')as profile,sync_playwright()as pw:
            context=pw.chromium.launch_persistent_context(profile,
                executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,
                viewport={'width':1280,'height':1050},args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
            context.add_init_script(FAULT_INIT)
            page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
            page.on('request',lambda req:requests.append({'url':req.url,'method':req.method,'body_bytes':len(req.post_data_buffer or b'')}))
            def accept(dialog):dialogs.append(dialog.message);dialog.accept()
            page.on('dialog',accept);page.goto(URL);page.wait_for_function('()=>!!window.RealN64')
            page.locator('#start').click();common.started(page,own=False)
            # Freeze only the setup capture so the saved state really is near
            # boot. No marker, cheat, RAM patch or synthetic ROM is introduced.
            page.evaluate('()=>RealN64.engineWindow.N64Engine.pause()')
            paused_frame=diagnostic(page)['session']['active']['frame']
            assert paused_frame<180,{'near_boot_prerequisite_not_met':paused_frame}
            common.action(page,'#state-save','state.saved')
            near_boot_core=core(page)
            assert near_boot_core['unused_nonzero_bytes']==0,'First state must contain no diagnostic RAM marker'
            before_diag=diagnostic(page);before_core=core(page);before_vault=vault(page);remember_engine(page)
            failures=len(events(page,'operation.failed'));loads=len(events(page,'state.loaded'))
            page.evaluate('()=>{window.__rcNoopLoad=true;window.__rcNoopCalls=0;}')
            try:
                page.locator('#state-load').click();error=wait_failed(page,failures)
                raw_calls=page.evaluate('window.__rcNoopCalls')
                if raw_calls==0:
                    assert error.get('code')=='E_RESTORE_UNPROVEN',error
                    disposition='safe_preflight_refusal_without_memory_witness'
                else:
                    assert error.get('code') in ('E_RESTORE_UNCONFIRMED','E_NATIVE_REJECTED'),error
                    disposition='native_noop_reached_and_rejected'
                assert len(events(page,'state.loaded'))==loads,'No-op must not be announced as loaded'
                assert vault(page)==before_vault
                retained=assert_retained(page,before_diag,before_core)
                near_boot_proof={
                    'fault_configured':'Only the candidate native load entry is a no-op; the real N64 core keeps running.',
                    'native_fault_reached':raw_calls>0,'disposition':disposition,
                    'saved_near_boot_native_frame':paused_frame,'saved_unused_nonzero_bytes':0,
                    'error':error,'native_noop_calls':raw_calls,
                    'vault_before':before_vault,'vault_after':vault(page),'retention':retained,
                    'no_ram_marker_written_before_this_case':True,
                    'functional_limitation':'Un état authentique proche du démarrage peut être refusé faute de témoin RAM. Ce cas prouve un refus sûr, pas la prise en charge fonctionnelle de ces états ni une injection native jamais atteinte.'}
            finally:page.evaluate('window.__rcNoopLoad=false')

            # This is deliberately AFTER the marker-free near-boot case. Real
            # progression and controlled pages make the next RAM witness strong.
            common.probe(page);progressed=common.wait_visual(page,180)
            saved_markers=mark_unused_pages(page,'saved')
            common.action(page,'#state-save','state.saved')
            live_markers=mark_unused_pages(page,'live')
            before_diag=diagnostic(page);before_core=core(page);before_vault=vault(page);remember_engine(page)
            failures=len(events(page,'operation.failed'));loads=len(events(page,'state.loaded'))
            page.evaluate('''()=>{window.__rcNoopLoad=true;window.__rcNoopCalls=0;window.__guardLoadMode='read-all-no-apply';window.__guardReadAll=null;}''')
            try:
                page.locator('#state-load').click();error=wait_failed(page,failures)
                read_all=page.evaluate('window.__guardReadAll')
                assert page.evaluate('window.__rcNoopCalls')>0,'Read-all fault did not reach the raw load entry'
                assert read_all and read_all['read_bytes']==read_all['expected_bytes']>0,read_all
                assert read_all['native_deserialize_called'] is False
                assert error.get('code') in ('E_RESTORE_UNCONFIRMED','E_NATIVE_REJECTED'),error
                assert len(events(page,'state.loaded'))==loads
                assert vault(page)==before_vault
                read_all_proof={'injected_fault':'The complete verified input is read through actual FS.readFile, but native deserialization is deliberately omitted.',
                    'native_fault_reached':True,'read_all':read_all,'error':error,
                    'actual_drawn_progression_before_capture':progressed,'saved_markers':saved_markers,'retained_live_markers':live_markers,
                    'vault_before':before_vault,'vault_after':vault(page),'retention':assert_retained(page,before_diag,before_core)}
                record('Refus sûr sans témoin précoce ; lecture complète sans désérialisation également refusée',{
                    'near_boot_without_marker':near_boot_proof,'read_all_without_apply':read_all_proof,
                    'not_a_test_on_karl_pc':True})
            finally:page.evaluate('()=>{window.__rcNoopLoad=false;window.__guardLoadMode=null;}')

            page.locator('#save-slot').select_option('2');idle(page)
            failed_pause_action(page,'#state-save','state.saved',
                'Audio bloqué pendant Enregistrer : erreur bornée, coffre intact et boucle réelle reprise')

            page.wait_for_function('()=>!document.querySelector("#cheat-status").textContent.includes("Recherche des codes")')
            if page.locator('#manual-cheats').get_attribute('open')is None:page.locator('#manual-cheats summary').click()
            manual_name='Guard checkpoint must fail safely'
            page.locator('#cheat-manual-name').fill(manual_name);page.locator('#cheat-manual-code').fill('81010000 A1B2')
            page.locator('#cheat-add').click()
            idle(page)
            checkbox=page.locator('#cheat-list label').filter(has_text=manual_name).locator('input[type=checkbox]')
            assert checkbox.count()==1 and not checkbox.is_checked()
            assert diagnostic(page)['cheats']=={'active':[],'tainted':False}
            before_checkpoints=len(events(page,'cheats.checkpoint.saved'));before_changed=len(events(page,'cheats.changed'))
            def no_cheat_enabled():
                assert diagnostic(page)['cheats']=={'active':[],'tainted':False}
                assert len(events(page,'cheats.checkpoint.saved'))==before_checkpoints
                assert len(events(page,'cheats.changed'))==before_changed
                page.wait_for_function('''name=>{
                  const label=[...document.querySelectorAll('#cheat-list label')].find(e=>e.textContent.includes(name));
                  return label&&!label.querySelector('input').checked;
                }''',arg=manual_name)
            # The locator resolves the current row even after a render replaces it.
            running_audio(page)
            before_diag=diagnostic(page);before_core=core(page);before_vault=vault(page);remember_engine(page)
            failures=len(events(page,'operation.failed'));inject_suspend(page)
            try:
                checkbox.click();error=wait_failed(page,failures)
                assert error.get('code')=='E_AUDIO_SUSPEND_TIMEOUT'
                assert page.evaluate('RealN64.engineWindow.__guardSuspendCalls')>0
                no_cheat_enabled();assert vault(page)==before_vault
                retained=assert_retained(page,before_diag,before_core)
                assert retained['after']['paused'] is False
                assert retained['after']['unused_nonzero_bytes']==before_core['unused_nonzero_bytes'],'The disabled code must not alter the controlled live RAM'
                record('Audio bloqué au checkpoint : aucun cheat activé, coffre intact et partie reprise',{
                    'injected_fault':'Unresolved suspend before the first cheat checkpoint',
                    'error':error,'vault_before':before_vault,'vault_after':vault(page),'retention':retained,
                    'cheats':diagnostic(page)['cheats'],'checkpoint_success_event_emitted':False})
            finally:restore_suspend(page)

            # The fourth case uses an explicit marker to independently prove a
            # VALID restoration. The marker-free near-boot subcase stays separate.
            common.probe(page);common.set_marker(page,0x1357)
            page.locator('#save-slot').select_option('1');common.action(page,'#state-save','state.saved')
            common.set_marker(page,0x2468)
            before_vault=vault(page);before_generation=diagnostic(page)['session']['active_generation']
            before_failures=len(events(page,'operation.failed'));before_warnings=len(events(page,'storage.list.warning'));before_loads=len(events(page,'state.loaded'))
            page.evaluate('''previous=>{
              window.__guardIndexGetAll=IDBIndex.prototype.getAll;window.__guardListFailures=0;
              IDBIndex.prototype.getAll=function(...args){
                const committed=RealN64.diagnostic().records.some(r=>r.type==='session.committed'&&r.data.generation>previous);
                if(this.name==='group'&&this.objectStore.name==='slots'&&committed&&window.__guardListFailures===0){
                  window.__guardListFailures++;throw new DOMException('Injected list failure strictly after session commit','UnknownError');
                }
                return window.__guardIndexGetAll.apply(this,args);
              };
            }''',before_generation)
            try:
                page.locator('#state-load').click()
                page.wait_for_function('''({loads,failures})=>{
                  const rows=RealN64.diagnostic().records;return rows.filter(r=>r.type==='state.loaded').length>loads||rows.filter(r=>r.type==='operation.failed').length>failures;
                }''',arg={'loads':before_loads,'failures':before_failures},timeout=70000)
                idle(page)
                assert len(events(page,'operation.failed'))==before_failures,events(page,'operation.failed')[-1:]
                assert len(events(page,'state.loaded'))==before_loads+1
                assert len(events(page,'storage.list.warning'))==before_warnings+1
                assert page.evaluate('window.__guardListFailures')==1
                assert diagnostic(page)['session']['active_generation']>before_generation
                common.probe(page);assert common.marker(page)==0x1357
                assert vault(page)==before_vault
                loaded=events(page,'state.loaded')[-1]['data'];proof=loaded['verification']
                assert proof['native_payload_read_bytes']==proof['native_payload_expected_bytes']>0
                assert proof['memory']['verified'] is True
                record('Liste IDB en échec après commit : chargement réel réussi avec avertissement distinct',{
                    'injected_fault':'IDBIndex.getAll throws once, gated by the newer actual session.committed event',
                    'loaded':loaded,'list_warning':events(page,'storage.list.warning')[-1]['data'],
                    'new_generation':diagnostic(page)['session']['active_generation'],'ram_marker_restored':0x1357,
                    'operation_failure_count_unchanged':before_failures,'vault_before':before_vault,'vault_after':vault(page)})
            finally:page.evaluate('()=>{IDBIndex.prototype.getAll=window.__guardIndexGetAll;}')

            assert len(results)==4
            assert not errors,errors
            assert all((r['url'].startswith(URL)or r['url'].startswith('blob:'+URL))and r['method']=='GET'and r['body_bytes']==0 for r in requests),requests
            page.screenshot(path=str(ROOT/'evidence/restore-guards-rc-final.png'),full_page=True)
            context.close();context=None
    except Exception as error:
        record('Garde-fous RC interrompus',str(error),status='ÉCHOUÉ')
        if page and not page.is_closed():
            try:page.screenshot(path=str(ROOT/'evidence/restore-guards-rc-failure.png'),full_page=True)
            except Exception:pass
        raise
    finally:
        if context:
            try:context.close()
            except Exception:pass
        report={'schema':'emuperso/restore-guards-rc-browser-tests/v1','results':results,'page_errors':errors,
            'http':requests,'dialogs':dialogs,'scope':'Actual pinned N64 Wasm engine with only the repository MIT diagnostic ROM. Marker-free near-boot preflight refusal is distinct from a reached fault; a later full-file-read/no-deserialize case uses explicit controlled RAM. WebAudio and post-commit IDB failures are injected.',
            'functional_limitations':['Authentic near-boot or graphical states without a usable RAM witness may be refused; safe refusal is not proof of functional support.','Generic graphical-state and commercial-game compatibility remain unproven; this bench grants no publication approval.'],
            'original_saves_used':False,'not_tested':['Karl Windows PC','Commercial games','Physical gamepad or speakers']}
        report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        server.shutdown();server.server_close()
    print('TOTAL',len(results),'garde-fous restauration RC',flush=True)


if __name__=='__main__':main()
