"""Real browser/session/IndexedDB smoke tests, synthetic disc only."""
import json, sys, threading, argparse, shutil
from pathlib import Path
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=ROOT/'cache/browser-audit');parser.add_argument('--chromium',default=shutil.which('chromium'));args=parser.parse_args()
from serve import Handler
OUT=args.output/'logs';OUT.mkdir(parents=True,exist_ok=True);fixture=OUT.parent/'synthetic-demo.iso'
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
base=f'http://127.0.0.1:{server.server_port}/'
result={'scope':'real synthetic ISO, native state/card plumbing, Chromium IndexedDB, browser process restart; no gameplay save or audio waveform proof','errors':[]}
profile=OUT.parent/'browser-profile-storage'
chrome_args=['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']
def open_context(p):
 c=p.chromium.launch_persistent_context(str(profile),executable_path=args.chromium,headless=True,args=chrome_args)
 page=c.new_page();page.on('dialog',lambda d:d.accept());page.on('pageerror',lambda e:result['errors'].append(str(e)))
 page.goto(base);page.wait_for_function('window.__cheatController !== undefined');return c,page
def launch(page,payload):
 old=page.locator('#log').inner_text();page.locator('#disc-file').set_input_files(payload)
 page.wait_for_function("!document.getElementById('launch').disabled")
 page.locator('#launch').click()
 page.wait_for_function("!document.getElementById('choose').disabled",timeout=60000)
 return page.locator('#status').inner_text()
def frame(page):return next(f for f in page.frames if f!=page.main_frame)
def marker(page):
 return frame(page).evaluate('''() => {
   const heap=window.EJS_emulator.gameManager.Module.HEAPU8,pattern=[0x68,0x24,0x57,0x13,0xab,0xcd,0xef,0x42];
   for(let i=0;i<heap.length-16;i++)if(pattern.every((b,j)=>heap[i+j]===b))return i;
   return null;
 }''')
def battery(page):return frame(page).evaluate('''async()=>{
 const bytes=window.PS1Engine.captureBattery();return {bytes:bytes?.length??0,
 sha256:bytes?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join(''):null};
}''')
try:
 with sync_playwright() as p:
  context,page=open_context(p)
  result['first_launch']=launch(page,str(fixture));offset=marker(page);result['initial_marker_offset']=offset
  page.locator('#state-save').click();page.wait_for_function("!document.getElementById('choose').disabled",timeout=20000)
  result['state_save_note']=page.locator('#save-note').inner_text()
  result['battery_before']=battery(page)
  page.locator('#battery-save').click();page.wait_for_function("!document.getElementById('choose').disabled")
  frame(page).evaluate('offset=>window.EJS_emulator.gameManager.Module.HEAPU8.fill(0xff,offset,offset+2)',offset)
  page.locator('#state-load').click();page.wait_for_function("!document.getElementById('choose').disabled",timeout=60000)
  result['state_restore_note']=page.locator('#save-note').inner_text()
  result['state_marker_restored']=marker(page) is not None
  result['frames_after_state']=page.locator('iframe').count()
  # Exercise a rejected replacement while the working old realm is retained.
  result['invalid_replacement_status']=launch(page,{'name':'invalid-synthetic.iso','mimeType':'application/octet-stream','buffer':bytes(65536)})
  result['invalid_retained_game']=page.locator('#current').inner_text()
  result['invalid_frame_count']=page.locator('iframe').count()
  result['rollback_events']=page.locator('#log').inner_text()
  # Three ordinary replacements, checking realm count and disposal observations.
  result['replacements']=[]
  for i in range(3):
   status=launch(page,str(fixture));result['replacements'].append({'status':status,'frames':page.locator('iframe').count(),'snapshot':frame(page).evaluate('window.PS1Engine.snapshot()')})
  result['disposal_events']=page.locator('#log').inner_text()
  result['storage_abort_preserves_previous']=page.evaluate("""async()=>{
    const {SaveStore,makeStateEnvelope}=await import('./save-store.mjs');
    const store=new SaveStore('emuperso-real-saves-v1-ps1-audit-abort');
    const identity={rom_sha256:'a'.repeat(64),engine_sha256:'b'.repeat(64),config_sha256:'c'.repeat(64),state_schema:'emuperso-ps1-state-v1'};
    await store.put(identity,1,await makeStateEnvelope(new Uint8Array([1,2,3]),identity));
    const original=IDBObjectStore.prototype.put;let refused=false;
    IDBObjectStore.prototype.put=function(...args){const value=original.apply(this,args);this.transaction.abort();return value;};
    try{await store.put(identity,1,await makeStateEnvelope(new Uint8Array([9,9,9]),identity));}
    catch(e){refused=true;}finally{IDBObjectStore.prototype.put=original;}
    const loaded=await store.load(identity,1);await store.close();
    return refused&&Array.from(loaded.bytes).join(',')==='1,2,3';
  }""")
  result['slot_before_close']=page.locator('#slot-info').inner_text()
  context.close()
  # Same profile + same origin, new Chromium process.
  context,page=open_context(p)
  result['restart_launch']=launch(page,str(fixture));result['slot_after_restart']=page.locator('#slot-info').inner_text()
  result['battery_after_restart']=battery(page)
  page.locator('#state-load').click();page.wait_for_function("!document.getElementById('choose').disabled",timeout=60000)
  result['restart_state_note']=page.locator('#save-note').inner_text()
  result['restart_state_marker']=marker(page) is not None
  other=bytearray(fixture.read_bytes());other[16*2048+40]=ord('B')
  result['other_game_launch']=launch(page,{'name':'synthetic-other.iso','mimeType':'application/octet-stream','buffer':bytes(other)})
  result['other_game_slot']=page.locator('#slot-info').inner_text()
  result['other_game_frame_count']=page.locator('iframe').count()
  context.close()
except Exception as e:
 result['failure']=str(e)
finally:
 server.shutdown();server.server_close();(OUT/'browser-storage.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps({k:v for k,v in result.items() if not k.endswith('_events')},ensure_ascii=False,indent=2))

checks=[result.get('state_marker_restored'),result.get('restart_state_marker'),result.get('storage_abort_preserves_previous'),result.get('invalid_frame_count')==1,result.get('invalid_retained_game')=='synthetic-demo.iso',result.get('other_game_frame_count')==1,'vide' in result.get('other_game_slot',''),result.get('battery_before')==result.get('battery_after_restart')]
if result.get('failure') or not all(checks):sys.exit(1)
