"""Release-candidate restoration regressions using only the repository MIT ROM.

A native-frame counter that merely increases is never restoration proof here.
We independently locate live RDRAM, decode the FRAME digits actually drawn by
our owned homebrew into both real framebuffers, and check a separate RAM marker.
The native-save fixture is newly generated and changed through the actual core
FS/refresh API. No original save or commercial ROM is opened.

Faults are explicitly injected: malformed native-state header with valid vault
hashes, candidate-page failure, native load API deliberately doing nothing, and
an AudioContext.suspend promise that never settles. Those tests do not identify
the cause of Karl's Windows failure. Run with a fresh temporary browser profile.
"""
from pathlib import Path
import hashlib
import json
import os
import sys
import tempfile
import threading
from http.server import ThreadingHTTPServer

from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from serve import Handler

PORT = int(os.environ.get('N64_RESTORE_TEST_PORT', '18876'))
URL = os.environ.get('N64_RESTORE_TEST_URL', f'http://127.0.0.1:{PORT}/')
HTTPS_REVIEW = URL.startswith('https://localhost:') and URL.endswith('/lab/')
if URL != f'http://127.0.0.1:{PORT}/' and not HTTPS_REVIEW:
    raise ValueError('Only the local HTTPS review origin is allowed in this test.')
ORIGIN = URL.split('/lab/')[0] + '/' if HTTPS_REVIEW else URL
EVIDENCE = ROOT / 'evidence'
EVIDENCE.mkdir(exist_ok=True)
ROM = (ROOT / 'homebrew/fallback-open/demo-emuperso-open.z64').read_bytes()
SHA = hashlib.sha256(ROM).hexdigest()
assert SHA == 'f18280a16c83721bdd56564701d505f96346784f36168402e5431b12499e2252'
VARIANT = bytearray(ROM)
VARIANT[0x3f] ^= 1
VARIANT = bytes(VARIANT)
VARIANT_SHA = hashlib.sha256(VARIANT).hexdigest()
PROBE = (ROOT / 'tests/own_demo_ram_probe.js').read_text(encoding='utf-8')
MARKER = 0x10000
MARKER_A, MARKER_B, MARKER_LIVE = 0x1357, 0x2468, 0x5e5e
results, errors, requests, dialogs, probes = [], [], [], [], []

# Original 5x7 digit masks from our MIT diagnostic ROM, not OCR or UI counters.
# The source draws the frame number at x100,y50 into the real VI framebuffer.
VISUAL_COUNTER = r'''() => {
  const digits=[[14,17,19,21,25,17,14],[4,12,4,4,4,4,14],[14,17,1,2,4,8,31],
    [30,1,1,14,1,1,30],[2,6,10,18,31,2,2],[31,16,16,30,1,1,30],
    [14,16,16,30,17,17,14],[31,1,2,4,8,8,8],[14,17,17,14,17,17,14],
    [14,17,17,15,1,1,14]];
  const found=[];
  for(const base of [0x100000,0x140000]){
    const rows=Array.from({length:7},(_,row)=>ownDemoReadBytes(base+((50+row*2)*320+100)*2,240));
    let text='',valid=true;
    for(let digit=0;digit<10;digit++){
      const pattern=rows.map(row=>{
        let value=0;
        for(let col=0;col<5;col++){
          const i=digit*24+col*4;
          if(row[i]===255&&row[i+1]===255)value|=16>>col;
        }
        return value;
      });
      if(pattern.every(value=>value===0))break;
      const value=digits.findIndex(candidate=>candidate.every((v,i)=>v===pattern[i]));
      if(value<0){valid=false;break;}
      text+=value;
    }
    if(valid&&text)found.push({framebuffer:base,drawn_frame:Number(text),digits:text});
  }
  return {surfaces:found,drawn_frame:found.length?Math.max(...found.map(row=>row.drawn_frame)):null};
}'''

VAULT_SNAPSHOT = r'''async()=>{
  const names=await indexedDB.databases();
  if(!names.some(row=>row.name==='emuperso-real-saves-v1'))throw Error('Expected real vault absent');
  const db=await new Promise((resolve,reject)=>{
    const r=indexedDB.open('emuperso-real-saves-v1');
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
    r.onupgradeneeded=()=>{r.transaction.abort();reject(Error('Test must not create a vault'));};
  });
  const rows=await new Promise((resolve,reject)=>{
    const tx=db.transaction('slots','readonly'),r=tx.objectStore('slots').getAll();
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });db.close();rows.sort((a,b)=>a.key.localeCompare(b.key));
  const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const canonical=async value=>{
    if(ArrayBuffer.isView(value))return {bytes:value.byteLength,sha256:await digest(new Uint8Array(value.buffer,value.byteOffset,value.byteLength))};
    if(value instanceof ArrayBuffer)return {bytes:value.byteLength,sha256:await digest(value)};
    if(Array.isArray(value))return Promise.all(value.map(canonical));
    if(value&&typeof value==='object'){
      const out={};for(const key of Object.keys(value).sort())out[key]=await canonical(value[key]);return out;
    }
    return value;
  };
  const normalized=await canonical(rows);
  return {record_count:rows.length,sha256:await digest(new TextEncoder().encode(JSON.stringify(normalized))),
    records:rows.map(row=>({key:row.key,kind:row.kind,slot:row.slot,revision:row.revision,
      current_sha256:row.current?.payload_sha256,previous_sha256:row.previous?.payload_sha256??null}))};
}'''

# This hook runs only in test-created candidate iframes while the parent flag is
# true. CPU, VI, real Wasm and WebAudio remain genuine; only native load is a noop.
FAULT_INIT = r'''(() => {
  if(window===window.top||!location.pathname.endsWith('/engine.html'))return;
  if(!window.top.__rcNoopLoad)return;
  let manager;
  Object.defineProperty(window,'EJS_GameManager',{configurable:true,get:()=>manager,set(klass){
    manager=new Proxy(klass,{construct(target,args,newTarget){
      const value=Reflect.construct(target,args,newTarget);
      if(value.functions?.loadState)value.functions.loadState=()=>{window.top.__rcNoopCalls=(window.top.__rcNoopCalls??0)+1;return 0;};
      return value;
    }});
  }});
})();'''


def record(name, proof, status='RÉUSSI'):
    results.append({'test': name, 'status': status, 'proof': proof})
    print(status + ' — ' + name, flush=True)


def diagnostic(page):
    return page.evaluate('RealN64.diagnostic()')


def events(page, kind):
    return page.evaluate('kind=>RealN64.diagnostic().records.filter(row=>row.type===kind)', kind)


def idle(page):
    page.wait_for_function('''()=>{
      const d=RealN64.diagnostic();return d.phase==='started'&&d.session.frame_count===1&&
        d.session.candidate_generation===null&&!document.getElementById('state-save').disabled;
    }''', timeout=70000)


def probe(page):
    page.evaluate('(function(){'+PROBE+'\n})()')
    found=page.evaluate('''async()=>{
      const found=await findOwnDemoRam();window.__rcRam=found;return found;
    }''')
    assert found['rom_sha256']==SHA and found['base']>0,found
    probes.append(found)
    return found


def started(page, previous=0, own=True):
    page.wait_for_function('''previous=>{
      const d=RealN64.diagnostic();return d.phase==='started'&&d.session.active_generation>previous&&
        d.session.active?.frame>8&&d.session.frame_count===1&&d.session.candidate_generation===null;
    }''',arg=previous,timeout=70000)
    idle(page)
    if own:probe(page)


def choose(page, data=ROM, sha=SHA):
    page.locator('#rom-file').set_input_files({'name':'owned-diagnostic.z64','mimeType':'application/octet-stream','buffer':data})
    page.wait_for_function('sha=>RealN64.diagnostic().local_selection?.canonical_sha256===sha',arg=sha)


def launch(page, data=ROM, sha=SHA):
    old=diagnostic(page)['session']['active_generation'] or 0
    choose(page,data,sha)
    page.locator('#launch-local').click()
    started(page,old,own=sha==SHA)


def action(page, selector, kind, generation=False):
    old_generation=diagnostic(page)['session']['active_generation'] or 0
    count=len(events(page,kind));failures=len(events(page,'operation.failed'))
    page.locator(selector).click()
    page.wait_for_function('''({kind,count,failures})=>{
      const rows=RealN64.diagnostic().records;return rows.filter(row=>row.type===kind).length>count||rows.filter(row=>row.type==='operation.failed').length>failures;
    }''',arg={'kind':kind,'count':count,'failures':failures},timeout=70000)
    assert len(events(page,'operation.failed'))==failures,events(page,'operation.failed')[-1:]
    if generation:started(page,old_generation)
    else:idle(page)
    return events(page,kind)[-1]['data']


def marker(page):
    return page.evaluate('address=>{const b=ownDemoReadBytes(address,2);return b[0]*256+b[1];}',MARKER)


def set_marker(page,value):
    page.evaluate('''({address,value})=>{
      const e=EJS_emulator,ram=window.__rcRam,heap=e.Module.HEAPU8;
      heap[ram.base+(ram.wordSwapped?address^3:address)]=value>>>8;
      heap[ram.base+(ram.wordSwapped?(address+1)^3:address+1)]=value&255;
    }''',{'address':MARKER,'value':value})
    assert marker(page)==value


def visual(page):
    return page.evaluate(VISUAL_COUNTER)


def wait_visual(page, minimum):
    page.wait_for_function('minimum=>{const value=('+VISUAL_COUNTER+')();return value.drawn_frame!==null&&value.drawn_frame>=minimum;}',arg=minimum,timeout=90000)
    return visual(page)


def native(page):
    return page.evaluate('''async()=>{
      const bytes=RealN64.engineWindow.N64Engine.captureBattery();if(!bytes)return null;
      return {bytes:bytes.length,byte17:bytes[17],byte18:bytes[18],sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('')};
    }''')


def change_native(page, index, mask, click=None):
    # The actual core refresh, followed immediately by an optional click in the
    # same JS task, prevents an unrelated autosave tick racing the fault setup.
    return page.evaluate('''({index,mask,click})=>{
      const w=RealN64.engineWindow,g=w.EJS_emulator.gameManager,b=w.N64Engine.captureBattery();
      if(!b||b.length!==296960)throw Error('Unexpected actual native fixture');
      b[index]^=mask;g.FS.writeFile(g.getSaveFilePath(),new w.Uint8Array(b));g.functions.loadSaveFiles();
      if(click)document.querySelector(click).click();return {index,expected:b[index]};
    }''',{'index':index,'mask':mask,'click':click})


def vault(page):
    return page.evaluate(VAULT_SNAPSHOT)


def seed_checkpoint(page):
    return page.evaluate('''async()=>{
      const {SaveStore,makeStateEnvelope}=await import('./save-store.mjs');
      const {packStateBundle}=await import('./state-bundle.mjs');
      const identity=RealN64.diagnostic().identity,api=RealN64.engineWindow.N64Engine,v=new SaveStore();
      const battery=api.captureBattery(),bundle=packStateBundle(api.captureState(),battery);
      await v.put(identity,2,await makeStateEnvelope(bundle,identity,{kind:'checkpoint',label:'Controlled RC test checkpoint'}));
      if(battery)await v.put(identity,2,await makeStateEnvelope(battery,identity,{kind:'battery',label:'Controlled RC test native backup'}));
      await v.close();return true;
    }''')


def install_bad_header(page):
    return page.evaluate('''async()=>{
      const {SaveStore,makeStateEnvelope}=await import('./save-store.mjs');
      const {unpackStateBundle,packStateBundle}=await import('./state-bundle.mjs');
      const identity=RealN64.diagnostic().identity,v=new SaveStore(),saved=await v.load(identity,3);
      const bundle=unpackStateBundle(saved.bytes);bundle.state[16]^=0xff;
      await v.put(identity,3,await makeStateEnvelope(packStateBundle(bundle.state,bundle.battery),identity,{label:'Controlled invalid native header, valid envelope SHA'}));
      await v.close();return true;
    }''')


def failed_load(page, label, selector='#state-load', native_change=True, route_failure=False, noop=False):
    idle(page);set_marker(page,MARKER_LIVE)
    before_diag=diagnostic(page);before_vault=vault(page);before_native=native(page)
    before_visual=visual(page);before_errors=len(events(page,'operation.failed'))
    if route_failure:page.route('**/engine.html',lambda route:route.abort('failed'))
    if noop:page.evaluate('()=>{window.__rcNoopLoad=true;window.__rcNoopCalls=0;}')
    try:
        if native_change:change_native(page,17,0x33,click=selector)
        else:page.locator(selector).click()
        page.wait_for_function('n=>RealN64.diagnostic().records.filter(row=>row.type==="operation.failed").length>n',arg=before_errors,timeout=70000)
        idle(page)
        after_vault=vault(page);after_diag=diagnostic(page)
        assert after_vault==before_vault,{'label':label,'before':before_vault,'after':after_vault}
        assert after_diag['identity']==before_diag['identity']
        assert after_diag['session']['active_generation']==before_diag['session']['active_generation']
        assert marker(page)==MARKER_LIVE
        page.wait_for_timeout(400)
        after_visual=visual(page)
        assert after_visual['drawn_frame'] is not None and after_visual['drawn_frame']>before_visual['drawn_frame'],(before_visual,after_visual)
        assert page.locator('#status').inner_text().strip()
        if noop:assert page.evaluate('window.__rcNoopCalls')>0,'Fault hook did not exercise native load'
        error=events(page,'operation.failed')[-1]['data']
        record(label,{'injected_fault':True,'error':error,'vault_before':before_vault,'vault_after':after_vault,
            'retained_generation':after_diag['session']['active_generation'],'ram_marker':MARKER_LIVE,
            'visible_before':before_visual,'visible_after':after_visual,'old_native_before':before_native,
            'old_native_after':native(page),'real_native_load_noop_calls':page.evaluate('window.__rcNoopCalls??0') if noop else None})
    finally:
        if route_failure:page.unroute('**/engine.html')
        if noop:page.evaluate('window.__rcNoopLoad=false')
        # Restore the controlled unsaved native byte only in the retained core;
        # never rewrite the vault or any original/personal save.
        if native_change and diagnostic(page)['session']['active_generation']==before_diag['session']['active_generation']:
            change_native(page,17,0x33)


def main():
    report_path=EVIDENCE/('tests-web-rc-restoration.json' if HTTPS_REVIEW else 'tests-restore-rc-browser.json')
    server=None
    if not HTTPS_REVIEW:
        server=ThreadingHTTPServer(('127.0.0.1',PORT),Handler)
        threading.Thread(target=server.serve_forever,daemon=True).start()
    context=page=None
    try:
        with tempfile.TemporaryDirectory(prefix='n64-restore-rc-owned-mit-') as profile,sync_playwright() as pw:
            def launch_context():
                c=pw.chromium.launch_persistent_context(profile,executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),
                    headless=True,ignore_https_errors=HTTPS_REVIEW,accept_downloads=True,viewport={'width':1280,'height':1050},
                    args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
                c.add_init_script(FAULT_INIT)
                return c
            def new_page(c):
                p=c.new_page();p.on('pageerror',lambda error:errors.append(str(error)))
                p.on('request',lambda req:requests.append({'url':req.url,'method':req.method,'body_bytes':len(req.post_data_buffer or b'')}))
                def accept(dialog):dialogs.append(dialog.message);dialog.accept()
                p.on('dialog',accept);p.goto(URL);p.wait_for_function('()=>!!window.RealN64');return p
            context=launch_context();page=new_page(context);launch(page)
            visible_before=visual(page);assert visible_before['drawn_frame'] is not None,visible_before
            first=page.frame_locator('iframe.engine-frame').locator('canvas').first.screenshot()
            page.wait_for_timeout(800);visible_after=visual(page)
            second=page.frame_locator('iframe.engine-frame').locator('canvas').first.screenshot()
            import io
            assert ImageChops.difference(Image.open(io.BytesIO(first)).convert('RGB'),Image.open(io.BytesIO(second)).convert('RGB')).getbbox()
            assert visible_after['drawn_frame']>visible_before['drawn_frame']
            record('Progression réellement dessinée par la ROM : chiffres FRAME et pixels du canvas',{'before':visible_before,'after':visible_after,'rom_sha256':SHA})

            fresh_native=native(page);change_native(page,17,0x5a);native_a=native(page)
            assert native_a['sha256']!=fresh_native['sha256']
            action(page,'#battery-save','battery.saved')
            change_native(page,18,0x6b);native_b=native(page);assert native_b['sha256']!=native_a['sha256']
            action(page,'#battery-save','battery.saved')
            record('Natif distinctif : deux captures réelles et révision précédente, sans sauvegarde personnelle',{'fresh':fresh_native,'first':native_a,'current':native_b})

            wait_visual(page,180);set_marker(page,MARKER_A);saved_a=visual(page)
            page.locator('#save-slot').select_option('1');a=action(page,'#state-save','state.saved')
            wait_visual(page,saved_a['drawn_frame']+30);set_marker(page,MARKER_B);saved_b=visual(page)
            b=action(page,'#state-save','state.saved');assert a['payload_sha256']!=b['payload_sha256']
            for slot in (2,3):page.locator('#save-slot').select_option(str(slot));action(page,'#state-save','state.saved')
            page.locator('#save-slot').select_option('1')
            divergent=wait_visual(page,saved_b['drawn_frame']+180);set_marker(page,MARKER_LIVE)
            action(page,'#state-load','state.loaded',generation=True)
            restored=visual(page)
            assert marker(page)==MARKER_B
            assert restored['drawn_frame']>=saved_b['drawn_frame'] and restored['drawn_frame']<divergent['drawn_frame']-40,(saved_b,divergent,restored)
            assert native(page)==native_b
            record('Chargement réel : RAM, compteur dessiné et natif reviennent au point enregistré',{'saved':saved_b,'diverged':divergent,'restored':restored,'marker':MARKER_B,'native':native_b})

            launch(page,VARIANT,VARIANT_SHA)
            assert diagnostic(page)['saves']==[]
            no_other_game=vault(page);count=len(events(page,'operation.failed'));page.locator('#state-load').click()
            page.wait_for_function('n=>RealN64.diagnostic().records.filter(row=>row.type==="operation.failed").length>n',arg=count);idle(page)
            assert vault(page)==no_other_game
            launch(page);assert native(page)==native_b
            assert [row['slot']for row in diagnostic(page)['saves']]==[1,2,3]
            record('Changement de ROM : états isolés, refus du mauvais jeu et récupération du natif au retour',{'other_rom':VARIANT_SHA,'restored_rom':SHA,'native':native_b,'slots':[1,2,3]})
            context.close();context=launch_context();page=new_page(context);launch(page)
            assert native(page)==native_b
            fresh_after_reopen=visual(page)
            action(page,'#state-load','state.loaded',generation=True);reopened=visual(page)
            assert marker(page)==MARKER_B and reopened['drawn_frame']>=saved_b['drawn_frame']
            assert reopened['drawn_frame']>fresh_after_reopen['drawn_frame']+40
            assert native(page)==native_b
            action(page,'#state-previous','state.loaded',generation=True);previous=visual(page)
            assert marker(page)==MARKER_A and previous['drawn_frame']>=saved_a['drawn_frame']
            record('Fermeture complète : vrai état et version précédente restaurés, natif distinctif conservé',{'fresh_counter':fresh_after_reopen,'current_counter':reopened,'previous_counter':previous,'current_marker':MARKER_B,'previous_marker':MARKER_A,'native':native_b})

            seed_checkpoint(page);install_bad_header(page);page.locator('#save-slot').select_option('3')
            failed_load(page,'Échec format natif : toutes les lignes, révisions et copies précédentes restent identiques')
            page.locator('#save-slot').select_option('1')
            failed_load(page,'Échec de préparation candidate : ancienne partie et coffre complets conservés',route_failure=True)
            failed_load(page,'Absence de désérialisation : les seules frames réelles ne prouvent pas le chargement',noop=True)

            # Only the OLD realm receives this stalled promise. A new real engine
            # can still restore; if the product chooses rollback, it must explain
            # the error, re-enable controls and preserve all vault bytes.
            before=vault(page);generation=diagnostic(page)['session']['active_generation'];failures=len(events(page,'operation.failed'));loads=len(events(page,'state.loaded'))
            page.evaluate('''()=>{const w=RealN64.engineWindow;w.AudioContext.prototype.suspend=function(){return new Promise(()=>{});};}''')
            page.locator('#state-load').click()
            page.wait_for_function('''({failures,loads})=>{
              const rows=RealN64.diagnostic().records;return !document.getElementById('state-load').disabled&&
                (rows.filter(r=>r.type==='operation.failed').length>failures||rows.filter(r=>r.type==='state.loaded').length>loads);
            }''',arg={'failures':failures,'loads':loads},timeout=30000)
            idle(page)
            if len(events(page,'state.loaded'))>loads:
                probe(page);assert marker(page)==MARKER_B
                outcome='restored'
            else:
                assert diagnostic(page)['session']['active_generation']==generation
                assert vault(page)==before
                assert page.locator('#status').inner_text().strip();outcome='explicit_error_and_rollback'
            record('Audio suspend jamais résolu : commande bornée, contrôles réactivés et résultat explicite',{'injected_fault':'old AudioContext.suspend returns a never-settling Promise','outcome':outcome,'not_a_reproduction_on_karl_pc':True})

            assert not errors,errors
            assert all((req['url'].startswith(URL)or req['url'].startswith('blob:'+ORIGIN))and req['method']=='GET'and req['body_bytes']==0 for req in requests),requests
            page.screenshot(path=str(EVIDENCE/'restore-rc-final.png'),full_page=True)
            context.close();context=None
    except Exception as error:
        detail={'message':str(error)}
        if page and not page.is_closed():
            try:detail['diagnostic']=diagnostic(page)
            except Exception:pass
        record('Régression de restauration interrompue',detail,status='ÉCHOUÉ')
        if page and not page.is_closed():
            try:page.screenshot(path=str(EVIDENCE/'restore-rc-failure.png'),full_page=True)
            except Exception:pass
        raise
    finally:
        if context:
            try:context.close()
            except Exception:pass
        report={'schema':'emuperso/restore-rc-browser-tests/v1','results':results,'page_errors':errors,'http':requests,'dialogs':dialogs,'ram_probes':probes,
            'scope':'Real pinned N64 engine and only our MIT diagnostic ROM; new temporary persistent profile, generated native bytes and explicitly injected failures. Actual RDRAM plus framebuffer digit decoding prove progression restoration; frontend frame counts alone are insufficient.',
            'not_tested':['Karl Windows/Chrome device','Commercial game progression or compatibility','All native-save peripherals','Physical gamepad and speakers'],'original_saves_used':False}
        report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        if server:server.shutdown();server.server_close()
    print('TOTAL',len(results),'contrôles régression restauration RC',flush=True)


if __name__=='__main__':main()
