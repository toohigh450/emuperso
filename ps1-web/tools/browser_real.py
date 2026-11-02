"""Real Chromium + pinned PCSX ReARMed, using a newly generated PS-X EXE.
No commercial disc or BIOS. All generated files stay in this audit directory.
"""
import json, struct, threading, sys, time, io, argparse, shutil
import pycdlib
from pathlib import Path
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=ROOT/'cache/browser-audit');parser.add_argument('--chromium',default=shutil.which('chromium'))
args=parser.parse_args()
sys.path.insert(0, str(ROOT / 'tools'))
from serve import Handler
OUT = args.output/'logs'
OUT.mkdir(parents=True,exist_ok=True)
rom = bytearray(65536)
rom[:8] = b'PS-X EXE'
for offset, value in {0x10:0x80010000, 0x18:0x80010000, 0x1c:len(rom)-2048, 0x30:0x801fff00}.items():
    struct.pack_into('<I', rom, offset, value)
# GPU reset, enable display, clear 320x240 red, loop forever.
words = [0x3c081f80,0x35081814,0xad000000,0x3c090300,0xad090000,
         0x3c090800,0x35290001,0xad090000,0x2508fffc,
         0x3c090200,0x352900ff,0xad090000,0xad000000,
         0x3c0900f0,0x35290140,0xad090000,0x08004010,0]
for i,w in enumerate(words):struct.pack_into('<I',rom,2048+4*i,w)
sentinel = bytes.fromhex('68245713abcdef4281e3a5c790badcfe')
rom[2048+0x1000:2048+0x1010] = sentinel
fixture = OUT.parent / 'synthetic-demo.iso'
iso = pycdlib.PyCdlib(); iso.new(interchange_level=1, sys_ident='PLAYSTATION', vol_ident='EMUPERSO_SYNTH', app_ident_str='PLAYSTATION')
cnf = b'BOOT = cdrom:\\DEMO.EXE;1\r\nTCB = 4\r\nEVENT = 10\r\nSTACK = 801fff00\r\n'
iso.add_fp(io.BytesIO(cnf),len(cnf),iso_path='/SYSTEM.CNF;1')
iso.add_fp(io.BytesIO(rom),len(rom),iso_path='/DEMO.EXE;1');iso.write(str(fixture));iso.close()
server = ThreadingHTTPServer(('127.0.0.1',0), Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
result = {'scope':'real Chromium, real pinned PCSX core, synthetic PS-X EXE; no commercial compatibility claim', 'errors':[], 'console':[]}
try:
  with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=args.chromium,headless=True,
      args=['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'])
    page=browser.new_page()
    page.on('pageerror',lambda e:result['errors'].append(str(e)))
    page.on('console',lambda m:result['console'].append(m.text[:500]))
    page.goto(f'http://127.0.0.1:{server.server_port}/')
    page.wait_for_function('window.__cheatController !== undefined')
    result['ui_version']=page.locator('header .tag').inner_text()
    page.locator('#disc-file').set_input_files(str(fixture))
    page.wait_for_function("!document.getElementById('launch').disabled",timeout=20000)
    page.locator('#launch').click()
    try:
      page.wait_for_function("document.getElementById('current').textContent !== 'Aucun'",timeout=60000)
      frame=page.frames[1]
      result['engine_snapshot']=frame.evaluate('window.PS1Engine.snapshot()')
      result['core_options']=frame.evaluate('window.EJS_emulator.gameManager.getCoreOptions()')
      result['input_status']=frame.evaluate('window.PS1Engine.inputStatus()')
      result['frame_before']=frame.evaluate('window.EJS_emulator.gameManager.getFrameNum()')
      # Locate our marker in WASM heap, then observe the native cheat changing guest RAM.
      result['marker_offsets']=frame.evaluate('''hex => {
        const pattern = Uint8Array.from(hex.match(/../g), h=>parseInt(h,16));
        const heap = window.EJS_emulator.gameManager.Module.HEAPU8; const found=[];
        for(let i=0;i<heap.length-pattern.length;i++) {
          if(pattern.every((b,j)=>heap[i+j]===b))found.push(i);
        } return found;
      }''',sentinel.hex())
      ctl_result=page.evaluate('''async () => {
        const ctl=window.__cheatController;
        await ctl.addManual('Synthetic RAM positive control','80011000 5678');
        const before=ctl.view(); await ctl.toggle(before.cheats.length-1,true);
        const blocked=ctl.view(); await ctl.confirmRegion();
        return {before,blocked,confirmed:ctl.view()};
      }''')
      result['controller']=ctl_result
      page.wait_for_timeout(700)
      result['marker_after']=frame.evaluate('''offsets => offsets.map(offset=>({offset,
        bytes:Array.from(window.EJS_emulator.gameManager.Module.HEAPU8.slice(offset,offset+16))}))''',result['marker_offsets'])
      result['frame_after']=frame.evaluate('window.EJS_emulator.gameManager.getFrameNum()')
      result['native_ram_cheat_observed']=any(row['bytes'][:2]==[0x78,0x56] for row in result['marker_after'])
      # Real controller + real engine: every historical language case, with native RAM proof.
      result['regional_matrix']=page.evaluate("""async ({offset, initial}) => {
        const api=document.querySelector('iframe').contentWindow.PS1Engine;
        const heap=document.querySelector('iframe').contentWindow.EJS_emulator.gameManager.Module.HEAPU8;
        const regions=await import('./cheat-catalog-psx.mjs');
        const {createCheatController}=await import('./cheat-controller.mjs');
        const tags=['En,Fr,Es','En,Fr,Es,Pt-BR','En,Fr,Es,zh-Hans-CN','En,Fr,Es,Pt-419','En,Fr,Es,fil-PH','En,Fr,Es,yue-Hant-HK','En,Fr,Es,cmn-Hans-CN'];
        const code={name:'Synthetic',code:'80011000 5678'}, rows=[];
        for(const tag of tags) {
          api.setCheats([]);heap.set(initial,offset);let calls=0;
          const store={get:async()=>null,set:async()=>{}};
          const ctl=createCheatController({getEngine:()=>({setCheats:list=>{calls++;api.setCheats(list)}}),regions,
            catalog:{find:async()=>({status:'match',catalogTitle:'Demo (Europe)',cheats:[code]}),load:async()=>({bySerial:{'SLES-00001':[code]},byTitle:{'Demo (Europe)':[code]},serialMap:{'SLES-00001':'Demo (Europe)'}})},
            stores:{cheats:store,editions:store}});
          await ctl.startSession({name:`Demo (${tag}).chd`},[code]);await ctl.toggle(0,true);
          await new Promise(r=>setTimeout(r,200));
          const blocked={calls,applied:ctl.view().applied,bytes:Array.from(heap.slice(offset,offset+2))};
          await ctl.applySerial('SLES-00001');const serialCalls=calls;
          await ctl.toggle(0,true);const serialBlocked={extraCalls:calls-serialCalls,applied:ctl.view().applied};
          await ctl.confirmRegion();await new Promise(r=>setTimeout(r,200));
          const positive=Array.from(heap.slice(offset,offset+2));
          rows.push({tag,blocked,serialBlocked,positive,pass:blocked.calls===0&&blocked.applied===0&&blocked.bytes[0]===initial[0]&&serialBlocked.extraCalls===0&&positive[0]===0x78&&positive[1]===0x56});
        }
        api.setCheats([]);return rows;
      }""", {'offset':result['marker_offsets'][0], 'initial':list(sentinel)})
      result['gamepad_bridge']=frame.evaluate("""async()=>{
        const manager=window.EJS_emulator.gameManager, original=manager.simulateInput.bind(manager), calls=[];
        manager.simulateInput=(...args)=>{calls.push(args);return original(...args)};
        const buttons=Array.from({length:17},(_,i)=>({pressed:i===0,value:i===0?1:0}));
        const native=navigator.getGamepads.bind(navigator);
        Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[{connected:true,mapping:'standard',id:'SYNTHETIC Xbox standard mapping',index:0,axes:[0.8,-0.9,0,0],buttons}]});
        await new Promise(r=>setTimeout(r,200));
        Object.defineProperty(navigator,'getGamepads',{configurable:true,value:native});
        await new Promise(r=>setTimeout(r,100));manager.simulateInput=original;
        return {scope:'synthetic Gamepad API, real bridge/native simulateInput; no physical controller',calls,
          cross:calls.some(c=>c[1]===0&&c[2]===1),up:calls.some(c=>c[1]===4&&c[2]===1),right:calls.some(c=>c[1]===7&&c[2]===1),
          released:calls.some(c=>c[1]===0&&c[2]===0)};
      }""")
      result['available_controller_exports']=frame.evaluate("Object.keys(window.EJS_emulator.gameManager.Module).filter(k=>/controller|port_device/i.test(k))")
      result['diagnostic']=page.locator('#log').text_content()
      page.screenshot(path=str(OUT/'real-core.png'))
    except Exception as e:
      result['launch_error']=str(e)
      result['status']=page.locator('#status').inner_text()
      result['diagnostic']=page.locator('#log').text_content()
    browser.close()
finally:
  server.shutdown();server.server_close()
  (OUT/'real-browser.json').write_text(json.dumps(result,indent=2,ensure_ascii=False))
print(json.dumps({k:v for k,v in result.items() if k not in ['core_options','console','diagnostic','controller']},indent=2,ensure_ascii=False))

if not result.get('native_ram_cheat_observed') or not all(r['pass'] for r in result.get('regional_matrix',[])) or len(result.get('regional_matrix',[])) != 7: sys.exit(1)
