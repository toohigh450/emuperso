from pathlib import Path
import sys,json,threading
from http.server import ThreadingHTTPServer
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from serve import Handler
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1]
s=ThreadingHTTPServer(('127.0.0.1',8770),Handler);threading.Thread(target=s.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=b.new_page();logs=[]
  def log(t,x):logs.append({'type':t,'text':x});print(t,x[:1700],flush=True)
  page.on('console',lambda m:log(m.type,m.text));page.on('pageerror',lambda e:log('PAGEERROR',e.stack));page.on('requestfailed',lambda r:log('FETCH_FAILED',r.url+' '+str(r.failure)))
  page.goto('http://127.0.0.1:8770/?debug'+('&legacy' if '--legacy' in sys.argv else ''));page.locator('#start').click();page.wait_for_timeout(20000)
  d=page.evaluate('({d:RealN64.diagnostic(),e:!!window.EJS_emulator,m:!!window.EJS_emulator?.Module,g:!!window.EJS_emulator?.gameManager,frame:window.EJS_emulator?.gameManager?.getFrameNum()})')
  print('DIAGNOSTIC',json.dumps(d),flush=True)
  (R/'evidence/probe-results.json').write_text(json.dumps({'logs':logs,'diagnostic':d},indent=2));page.screenshot(path=str(R/'evidence/probe.png'),full_page=True);b.close()
finally:s.shutdown();s.server_close()
