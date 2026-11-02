"""Actual core API observations using only the repository MIT homebrew."""
from pathlib import Path
import os,sys,json,threading
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1];sys.path.insert(0,str(R/'tools'))
from serve import Handler
s=ThreadingHTTPServer(('127.0.0.1',8775),Handler);threading.Thread(target=s.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=b.new_page(); logs=[];page.on('console',lambda m:logs.append(m.text[-1000:]));page.on('pageerror',lambda e:logs.append('PAGEERROR:'+str(e)))
  page.goto('http://127.0.0.1:8775/');page.locator('#start').click();page.wait_for_function("()=>RealN64.diagnostic().phase==='started'",timeout=60000)
  info=page.evaluate('''()=>{const gm=EJS_emulator.gameManager;window.beforeState=RealN64.engineWindow.N64Engine.captureState();return {path:gm.getSaveFilePath(),nativeBytes:gm.getSaveFile()?.length,states:gm.supportsStates(),stateBytes:beforeState.length,statePrefix:Array.from(beforeState.slice(0,32)),frame:gm.getFrameNum()};}''');print('INFO',json.dumps(info),flush=True)
  candidates=page.evaluate('''()=>{const e=EJS_emulator,rom=e.gameManager.FS.readFile(e.fileName),raw=Array.from(rom.slice(0x1000,0x1040)),p=raw.slice();for(let i=0;i<p.length;i+=4)p.splice(i,4,...p.slice(i,i+4).reverse());const find=(bytes,pat)=>{const out=[];for(let i=0;i<bytes.length-pat.length;i+=4)if(bytes[i]===pat[0]&&pat.every((x,j)=>bytes[i+j]===x))out.push(i-0x400);return out;};return {heap_raw:find(e.Module.HEAPU8,raw),heap_swapped:find(e.Module.HEAPU8,p),state_raw:find(beforeState,raw),state_swapped:find(beforeState,p)};}''');print('RAM_CANDIDATES',json.dumps(candidates),flush=True)
  page.wait_for_function('()=>EJS_emulator.gameManager.getFrameNum()>95',timeout=45000)
  page.evaluate("()=>RealN64.engineWindow.N64Engine.setCheats([{code:'81010000 A1B2+81010002 C3D4+81010004 E5F6+81010006 0718'}])");page.wait_for_timeout(2000)
  scan='''()=>{const state=RealN64.engineWindow.N64Engine.captureState();const patterns=[[0xA1,0xB2,0xC3,0xD4,0xE5,0xF6,0x07,0x18],[0xD4,0xC3,0xB2,0xA1,0x18,0x07,0xF6,0xE5],[0xB2,0xA1,0xD4,0xC3,0xF6,0xE5,0x18,0x07]];return patterns.map(p=>{const a=[];for(let i=0;i<state.length-p.length;i++)if(p.every((v,j)=>state[i+j]===v))a.push(i);return a;});}'''
  marked=page.evaluate(scan);print('MARKED',json.dumps(marked),flush=True)
  page.evaluate('()=>RealN64.engineWindow.N64Engine.setCheats([])')
  restored=page.evaluate('()=>RealN64.engineWindow.N64Engine.loadState(beforeState)');print('RESTORED',json.dumps(restored),flush=True)
  after=page.evaluate(scan);print('AFTER',json.dumps(after),flush=True)
  invalid=page.evaluate('''()=>{const g=EJS_emulator.gameManager;g.FS.writeFile('/bad-state.bin',new Uint8Array([1,2,3,4]));return g.functions.loadState('/bad-state.bin',0);}''');page.wait_for_timeout(500);print('INVALID_NATIVE',invalid,flush=True)
  result={'info':info,'ram_candidates':candidates,'cheat_pattern_offsets':marked,'restore_result':restored,'after_restore_pattern_offsets':after,'invalid_native_status':invalid,'console':logs[-30:]}
  (R/'evidence/session-api-probe.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');b.close()
finally:s.shutdown();s.server_close()
