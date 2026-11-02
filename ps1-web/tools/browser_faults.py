"""Real pinned core + explicit JS/native-boundary faults. Synthetic ISO only.
Generate the fixture with tools/browser_real.py, then pass its synthetic-demo.iso.
This does not invent a native ACK or inject a fault inside WASM itself.
"""
import argparse
import json
import sys
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright
from serve import Handler

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--fixture',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--chromium',default='/usr/bin/chromium');args=parser.parse_args()
    out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
    result={'scope':'real PCSX core with synthetic ISO; exceptions instrumented at JS/native boundary, not inside WASM','checks':{},'errors':[]}
    read_slots='''async()=>{const db=await new Promise((ok,ko)=>{const r=indexedDB.open('emuperso-real-saves-v1-ps1',1);r.onsuccess=()=>ok(r.result);r.onerror=()=>ko(r.error)});try{return await new Promise((ok,ko)=>{const r=db.transaction('slots').objectStore('slots').getAll();r.onsuccess=()=>ok(r.result.map(x=>({key:x.key,revision:x.revision,id:x.current.id,sha256:x.current.payload_sha256})).sort((a,b)=>a.key.localeCompare(b.key)));r.onerror=()=>ko(r.error)})}finally{db.close()}}'''
    try:
      with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'])
        page=browser.new_page();page.on('pageerror',lambda e:result['errors'].append(str(e)))
        dialogs=[];accept_dialog=True
        def dialog(d):
            dialogs.append(d.message)
            if accept_dialog:d.accept()
            else:d.dismiss()
        page.on('dialog',dialog)
        page.goto(f'http://127.0.0.1:{server.server_port}/');page.wait_for_function('window.__cheatController!==undefined')
        page.locator('#disc-file').set_input_files(str(args.fixture));page.wait_for_function("!document.getElementById('launch').disabled");page.locator('#launch').click()
        page.wait_for_function("document.getElementById('current').textContent!=='Aucun'",timeout=60000)
        frame=page.frames[1]
        offset=frame.evaluate('''()=>{const h=window.EJS_emulator.gameManager.Module.HEAPU8,p=[0x68,0x24,0x57,0x13,0xab,0xcd,0xef,0x42];for(let i=0;i<h.length-p.length;i++)if(h[i]===p[0]&&p.every((b,j)=>h[i+j]===b))return i;return null;}''')
        assert offset is not None
        await_a=page.evaluate('''async()=>{const c=window.__cheatController;await c.addManual('Synthetic A','80011000 5678');await c.addManual('Synthetic B','80011004 ABCD');await c.confirmRegion();await c.toggle(0,true);return c.view();}''')
        frame.wait_for_function('i=>{const h=window.EJS_emulator.gameManager.Module.HEAPU8;return h[i]===0x78&&h[i+1]===0x56}',arg=offset,timeout=10000)
        native_value=lambda f,i:f.evaluate('i=>Array.from(window.EJS_emulator.gameManager.Module.HEAPU8.slice(i,i+6))',i)
        result['initial_ram']=native_value(frame,offset);result['checks']['native_positive']=result['initial_ram'][:2]==[0x78,0x56] and await_a['applied']==1
        # Keep a known snapshot with A already effective in RAM and in its metadata.
        page.locator('#state-save').click();page.wait_for_function("!document.getElementById('choose').disabled")
        result['slots_before_fault']=page.evaluate(read_slots);assert len(result['slots_before_fault'])==2
        frame.evaluate('''()=>{const m=window.EJS_emulator.gameManager;window.__fault={set:m.setCheat.bind(m),reset:m.resetCheat.bind(m),calls:[],nativeAcceptedBeforeFailure:false};m.setCheat=(i,...args)=>{window.__fault.calls.push(i);const result=window.__fault.set(i,...args);if(i===1){window.__fault.nativeAcceptedBeforeFailure=true;throw new Error('SYNTHETIC exception after native setCheat(1)')}return result}}''')
        await_b=page.evaluate('''async()=>{await window.__cheatController.toggle(1,true);return window.__cheatController.view();}''')
        frame.evaluate('i=>window.EJS_emulator.gameManager.Module.HEAPU8.set([0x68,0x24],i)',offset)
        result['rollback_frame_before']=frame.evaluate('window.EJS_emulator.gameManager.getFrameNum()')
        frame.wait_for_function('i=>{const h=window.EJS_emulator.gameManager.Module.HEAPU8;return h[i]===0x78&&h[i+1]===0x56}',arg=offset,timeout=10000)
        result['rollback_frame_after']=frame.evaluate('window.EJS_emulator.gameManager.getFrameNum()')
        result['partial_failure_ram']=native_value(frame,offset)
        result['fault_after_native_set']=frame.evaluate('window.__fault.nativeAcceptedBeforeFailure')
        result['checks']['partial_failure_rollback_native']=result['fault_after_native_set'] and await_b['engineSync']=='ok' and await_b['applied']==1 and result['partial_failure_ram'][:2]==[0x78,0x56] and result['partial_failure_ram'][4:6]==[0xab,0xcd]
        frame.evaluate('''()=>{const m=window.EJS_emulator.gameManager;m.setCheat=window.__fault.set;m.resetCheat=()=>{throw new Error('SYNTHETIC persistent resetCheat exception')}}''')
        poisoned=page.evaluate('''async()=>{await window.__cheatController.toggle(0,false);return window.__cheatController.view();}''')
        result['poisoned_snapshot']=frame.evaluate('window.PS1Engine.snapshot()')
        frame.evaluate('''()=>{const m=window.EJS_emulator.gameManager;window.__captureCalls=0;const state=m.getState.bind(m),battery=m.getSaveFile.bind(m);m.getState=(...a)=>{window.__captureCalls++;return state(...a)};m.getSaveFile=(...a)=>{window.__captureCalls++;return battery(...a)}}''')
        result['direct_capture_refusals']=frame.evaluate('''()=>{const errors=[];for(const name of ['captureState','captureBattery']){try{window.PS1Engine[name]();errors.push(null)}catch(e){errors.push(e.message)}}return errors;}''')
        page.evaluate("document.getElementById('state-save').onclick()");page.evaluate("document.getElementById('battery-save').onclick()")
        result['capture_calls_while_poisoned']=frame.evaluate('window.__captureCalls')
        result['slots_after_capture_attempts']=page.evaluate(read_slots)
        result['checks']['uncertain_captures_refused']=poisoned['engineSync']=='unknown' and result['poisoned_snapshot']['cheats_quarantined'] and result['capture_calls_while_poisoned']==0 and all(result['direct_capture_refusals'])
        result['checks']['existing_slots_preserved']=result['slots_before_fault']==result['slots_after_capture_attempts']
        result['checks']['quarantined_paused']=result['poisoned_snapshot']['paused']
        # Removing the injected fault must not lift sticky quarantine in this realm.
        frame.evaluate('window.EJS_emulator.gameManager.resetCheat=window.__fault.reset')
        resync=page.evaluate('''async()=>{await window.__cheatController.resync();return window.__cheatController.view();}''')
        result['checks']['resync_cannot_lift_quarantine']=resync['engineSync']=='unknown'
        page.get_by_role('button',name='Nouvelle session saine',exact=False).click();page.wait_for_function("!document.getElementById('choose').disabled",timeout=60000)
        frame=page.frames[1];result['recovered_snapshot']=frame.evaluate('window.PS1Engine.snapshot()')
        result['slots_after_recovery']=page.evaluate(read_slots)
        result['checks']['new_realm_only_recovery']=result['recovered_snapshot']['session_id']!=result['poisoned_snapshot']['session_id'] and not result['recovered_snapshot']['cheats_quarantined'] and not result['recovered_snapshot']['paused']
        result['checks']['recovery_preserves_slots']=result['slots_before_fault']==result['slots_after_recovery']
        # First cancel and then accept the cheat/state warning.
        accept_dialog=False;before_id=result['recovered_snapshot']['session_id'];page.locator('#state-load').click();page.wait_for_function("!document.getElementById('choose').disabled")
        result['checks']['state_warning_cancel']=page.frames[1].evaluate('window.PS1Engine.snapshot().session_id')==before_id
        accept_dialog=True;page.locator('#state-load').click();page.wait_for_function("!document.getElementById('choose').disabled",timeout=60000)
        frame=page.frames[1];result['restored_ram']=native_value(frame,offset)
        result['state_after_load']=page.evaluate('window.__cheatController.view()')
        result['checks']['saved_ram_effects_not_new_injection']=result['restored_ram'][:2]==[0x78,0x56] and result['state_after_load']['applied']==0
        frame.evaluate('i=>window.EJS_emulator.gameManager.Module.HEAPU8.set([0x68,0x24],i)',offset);page.wait_for_timeout(250)
        result['ram_before_reconfirmation']=native_value(frame,offset)
        result['checks']['no_reinjection_before_confirmation']=result['ram_before_reconfirmation'][:2]==[0x68,0x24]
        page.evaluate('window.__cheatController.confirmRegion()')
        frame.wait_for_function('i=>{const h=window.EJS_emulator.gameManager.Module.HEAPU8;return h[i]===0x78&&h[i+1]===0x56}',arg=offset,timeout=10000)
        result['checks']['positive_after_reconfirmation']=native_value(frame,offset)[:2]==[0x78,0x56]
        result['dialogs']=dialogs
        state_dialogs=[d for d in dialogs if 'Cet état' in d]
        result['checks']['accurate_state_warning']=bool(state_dialogs) and all('données RAM' in d and 'Aucun code ne sera réactivé avant' in d for d in state_dialogs)
        result['journal']=page.locator('#log').text_content();page.screenshot(path=str(out/'native-faults.png'));browser.close()
    except Exception as error:
        result['failure']=str(error)
    finally:
        server.shutdown();server.server_close();(out/'native-faults.json').write_text(json.dumps(result,indent=2,ensure_ascii=False))
    print(json.dumps({'checks':result['checks'],'failure':result.get('failure'),'errors':result['errors']},indent=2,ensure_ascii=False))
    return 0 if len(result['checks'])==13 and all(result['checks'].values()) and not result.get('failure') and not result['errors'] else 1

if __name__=='__main__':sys.exit(main())
