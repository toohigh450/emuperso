"""Independent v0.4 restore acknowledgement probe, using only this repo's MIT demo.

--baseline routes the v0.4 adapter from its immutable Git revision. A real native
queued load is made to fail by deleting its temporary MEMFS input immediately
after the native call returns. No native return value or frame count is mocked.
The test must show actual RAM contents, rather than infer load from a callback.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import subprocess
import sys
import threading
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
REPO=ROOT.parent
sys.path.insert(0,str(ROOT/'tools'))
from serve import Handler
BASE='029845b800a61eeee60915363c16c0b218e6e39e'
parser=argparse.ArgumentParser()
parser.add_argument('--baseline',action='store_true')
args=parser.parse_args()
records=[]
server=ThreadingHTTPServer(('127.0.0.1',8787),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=browser.new_page(viewport={'width':1280,'height':900})
  console=[];page.on('console',lambda m:console.append({'type':m.type,'text':m.text[-1800:]}))
  if args.baseline:
   for name in ['app.js','engine-session.mjs','session-controller.mjs','index.html','style.css']:
    data=subprocess.check_output(['git','show',BASE+':real-n64/'+name],cwd=REPO)
    mime='text/html'if name.endswith('.html')else'text/css'if name.endswith('.css')else'text/javascript'
    page.route('http://127.0.0.1:8787/'+name,lambda route,request,*,data=data,mime=mime:route.fulfill(status=200,body=data,content_type=mime))
  page.goto('http://127.0.0.1:8787/')
  page.locator('#start').click()
  page.wait_for_function("()=>RealN64.diagnostic().phase==='started'&&EJS_emulator.gameManager.getFrameNum()>10",timeout=60000)
  page.evaluate((ROOT/'tests/own_demo_ram_probe.js').read_text())
  ram=page.evaluate('async()=>{window.__proofRAM=await findOwnDemoRam();return __proofRAM}')
  def marker(value=None):
   return page.evaluate('''value=>{const p=window.__proofRAM,heap=EJS_emulator.Module.HEAPU8,a=0x10000;const idx=x=>p.base+(p.wordSwapped?x^3:x);if(value!==null){heap[idx(a)]=value>>>8;heap[idx(a+1)]=value&255;}return(heap[idx(a)]<<8)|heap[idx(a+1)]}''',value)
  marker(0x1357)
  saved=page.evaluate('()=>{window.__proofState=RealN64.engineWindow.N64Engine.captureState();return {length:__proofState.length,header:Array.from(__proofState.slice(0,64))}}')
  marker(0x2468)
  normal=page.evaluate('()=>RealN64.engineWindow.N64Engine.loadState(__proofState)')
  restored=marker()
  assert restored==0x1357,{'normal_restore':normal,'actual_ram':restored}
  records.append({'test':'Valid native state restores actual unused-RAM marker','status':'RÉUSSI','expected_ram':0x1357,'actual_ram':restored,'adapter_result':normal})
  marker(0x2468)
  page.evaluate('''()=>{const g=EJS_emulator.gameManager,original=g.functions.loadState;window.__proofOriginalLoad=original;g.functions.loadState=(path,flags)=>{const status=original(path,flags);g.FS.unlink(path);return status;}}''')
  outcome=page.evaluate('''async()=>{try{return{accepted:true,result:await RealN64.engineWindow.N64Engine.loadState(__proofState)}}catch(error){return{accepted:false,message:error.message}}}''')
  page.wait_for_timeout(500)
  after=marker()
  errors=[c for c in console if '[State]'in c['text']or'failed to load'in c['text'].lower()]
  false_positive=outcome['accepted'] and after!=0x1357
  records.append({'test':'Native queued file-read failure is not accepted as restored','status':'ÉCHOUÉ'if false_positive else'RÉUSSI','injection':'Actual native load queued, then its MEMFS file removed before task processing; actual native return unchanged','adapter':outcome,'expected_ram':0x1357,'actual_ram':after,'native_log':errors[-8:]})
  page.evaluate('()=>{EJS_emulator.gameManager.functions.loadState=window.__proofOriginalLoad;}')
  before=page.evaluate("()=>RealN64.diagnostic().records.filter(x=>x.type==='state.saved').length")
  page.locator('#state-save').click()
  page.wait_for_function("n=>RealN64.diagnostic().records.filter(x=>x.type==='state.saved').length>n",arg=before,timeout=15000)
  page.wait_for_function("()=>!document.querySelector('#state-load').disabled")
  running=page.evaluate("()=>RealN64.engineWindow.N64Engine.snapshot().contexts.some(c=>c.state==='running')")
  assert running,'Audio running prerequisite not demonstrated; do not fabricate a suspend-hang proof.'
  page.evaluate('''()=>{const w=RealN64.engineWindow;w.__proofSuspendCount=0;w.__proofOriginalSuspend=w.AudioContext.prototype.suspend;w.AudioContext.prototype.suspend=function(){w.__proofSuspendCount++;return new Promise(()=>{});};}''')
  failures_before=page.evaluate("()=>RealN64.diagnostic().records.filter(x=>x.type==='operation.failed').length")
  page.locator('#state-load').click()
  if args.baseline:page.wait_for_timeout(3000)
  else:
   page.wait_for_function("n=>!document.querySelector('#state-load').disabled&&RealN64.diagnostic().records.filter(x=>x.type==='operation.failed').length>n",arg=failures_before,timeout=15000)
  hung=page.locator('#state-load').is_disabled()
  suspend_calls=page.evaluate('()=>RealN64.engineWindow.__proofSuspendCount')
  records.append({'test':'Pending WebAudio suspend is bounded and releases the UI with an error','status':'ÉCHOUÉ'if hung else'RÉUSSI','injection':'Existing actual session AudioContext.suspend replaced by a deliberately never-settling promise, simulating an unresolved WebAudio operation','suspend_calls':suspend_calls,'load_button_still_disabled':hung,'observed_wait_ms':3000 if args.baseline else'bounded by 15000','message':page.locator('#status').inner_text()})
  page.evaluate('()=>{const w=RealN64.engineWindow;w.AudioContext.prototype.suspend=w.__proofOriginalSuspend;}')
  report={'schema':'emuperso/restore-independent-probe/v1','baseline':args.baseline,'baseline_commit':BASE if args.baseline else None,'rom_sha256':ram['rom_sha256'],'scope':'Repository MIT ROM, fresh browser profile, controlled RAM/MEMFS test only. Not a reproduction of Karl Windows PC.','results':records,'console':console[-50:]}
  out=ROOT/'evidence'/('probe-restore-baseline.json'if args.baseline else'probe-restore-rc.json')
  out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
  print(json.dumps({'report':str(out),'results':[{'test':r['test'],'status':r['status']}for r in records]},ensure_ascii=False),flush=True)
  browser.close()
  if args.baseline:assert false_positive and hung,'Baseline deficiencies not both reproduced; inspect report honestly.'
  else:assert not false_positive and not hung,'Candidate accepted a failed restore or retained a stuck UI.'
finally:
 server.shutdown();server.server_close()
