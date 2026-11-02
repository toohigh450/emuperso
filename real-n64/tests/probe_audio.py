from pathlib import Path
import sys,json,threading
from http.server import ThreadingHTTPServer
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from serve import Handler
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1];s=ThreadingHTTPServer(('127.0.0.1',8770),Handler);threading.Thread(target=s.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=b.new_page();page.add_init_script('''window.bufferSamples=[];const original=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...a){if(this.buffer){const c=this.buffer.getChannelData(0);bufferSamples.push({time:performance.now(),rms:Math.sqrt(c.reduce((s,x)=>s+x*x,0)/c.length),frames:c.length,sample_rate:this.buffer.sampleRate});}return original.apply(this,a);};''')
  page.goto('http://127.0.0.1:8770/');page.locator('#start').click();page.wait_for_function('window.EJS_emulator?.gameManager?.getFrameNum()>30',timeout=45000)
  page.locator('#audio').click();page.locator('#game canvas').click();page.keyboard.down('x');page.wait_for_timeout(3000)
  data=page.evaluate('''() => {const al=EJS_emulator.Module.AL,c=al.currentCtx;return {contexts:RealN64.diagnostic().contexts,al_keys:Object.keys(al),ctx_keys:Object.keys(c),sources:Object.values(c.sources).map(s=>({keys:Object.keys(s),state:s.state,sourceType:s.sourceType,gain:s.gain?.gain?.value,queue:s.bufQueue})),buffers:bufferSamples};}''')
  page.keyboard.up('x');print(json.dumps(data,indent=2));(R/'evidence/audio-probe.json').write_text(json.dumps(data,indent=2));b.close()
finally:s.shutdown();s.server_close()
