"""Real homebrew/core trial: no mocked ROM, CPU, video, audio or frame counter."""
from pathlib import Path
import sys,json,time,threading,subprocess,hashlib,io,os
from http.server import ThreadingHTTPServer
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from serve import Handler
from playwright.sync_api import sync_playwright
from PIL import Image,ImageChops
ROOT=Path(__file__).resolve().parents[1];E=ROOT/'evidence';E.mkdir(exist_ok=True)
results=[];console=[];errors=[];requests=[]
def ok(name,proof):
 results.append({'test':name,'status':'RÉUSSI','proof':proof});print('RÉUSSI — '+name,flush=True)
def shot(canvas,name):
 data=canvas.screenshot(path=str(E/name));return Image.open(io.BytesIO(data)).convert('RGB')
def color(image):return image.getpixel((image.width//2,image.height//2))
def wait_ocr(canvas,capture_name,ocr_name,word):
 # Rendering and OCR are asynchronous; observe a bounded series of real frames.
 last=''
 for attempt in range(6):
  image=shot(canvas,capture_name);last=ocr(image,ocr_name)
  if word in last.upper():return image,last
  canvas.page.wait_for_timeout(250)
 raise AssertionError('No matching rendered text after 6 observations: '+last)
def ocr(image,name):
 path=E/name;image.resize((image.width*2,image.height*2)).save(path)
 p=subprocess.run(['tesseract',str(path),'stdout','--psm','6'],capture_output=True,text=True)
 return p.stdout
server=ThreadingHTTPServer(('127.0.0.1',8770),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  ctx=browser.new_context(viewport={'width':1280,'height':1100},accept_downloads=True)
  page=ctx.new_page();page.add_init_script('''window.scheduledAudio=[];const nativeStart=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){if(this.buffer){const c=this.buffer.getChannelData(0);scheduledAudio.push({host_ms:performance.now(),rms:Math.sqrt(c.reduce((sum,x)=>sum+x*x,0)/c.length),frames:c.length,sample_rate:this.buffer.sampleRate,pcm:window.capturePCM?Array.from(c):undefined});}return nativeStart.apply(this,args);};''');page.on('console',lambda m:console.append({'type':m.type,'text':m.text[:3000]}));page.on('pageerror',lambda e:errors.append(e.stack));page.on('response',lambda r:requests.append({'url':r.url,'status':r.status}))
  try:
   page.goto('http://127.0.0.1:8770/');page.locator('#start').click()
   page.wait_for_function('() => window.EJS_emulator?.gameManager?.getFrameNum() > 10 || RealN64.diagnostic().records.some(r=>r.type==="browser.error")',timeout=45000)
   assert page.evaluate('EJS_emulator.gameManager.getFrameNum()')>10,errors
   ok('Cœur N64 réel chargé et compteur en progression',{'frame':page.evaluate('EJS_emulator.gameManager.getFrameNum()'),'core':page.evaluate('EJS_emulator.config.system'),'wasm_events':page.evaluate('RealN64.diagnostic().records.filter(r=>r.type==="wasm.instantiated")')})
   canvas=page.locator('#game canvas').first;page.wait_for_timeout(1500)
   frame0=page.evaluate('EJS_emulator.gameManager.getFrameNum()');image0=shot(canvas,'boot.png');text0=ocr(image0,'boot-ocr.png')
   page.wait_for_timeout(1500);image1=shot(canvas,'animation.png');frame1=page.evaluate('EJS_emulator.gameManager.getFrameNum()')
   assert frame1>frame0 and ImageChops.difference(image0,image1).getbbox() is not None
   assert 'DEMO' in text0.upper(),text0
   ok('Affichage homebrew et animation',{'frame_before':frame0,'frame_after':frame1,'ocr':text0,'captures':['boot.png','animation.png']})
   # Hash actual emulated filesystem ROM bytes, not just the preloader download.
   loaded=page.evaluate('''async () => {const e=EJS_emulator,b=e.gameManager.FS.readFile(e.fileName);const hash=await crypto.subtle.digest('SHA-256',b);return {path:e.fileName,bytes:b.length,sha256:[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')};}''')
   expected=json.loads((ROOT/'homebrew/fallback-open/build-info.json').read_text())['rom']['sha256'];assert loaded['sha256']==expected
   ok('Identité des octets remis au cœur',loaded)
   canvas.click();page.keyboard.down('x');page.wait_for_timeout(900);imageA,textA=wait_ocr(canvas,'keyboard-A.png','keyboard-A-ocr.png','PRESSE');page.keyboard.up('x')
   assert 'PRESSE' in textA.upper(),textA
   page.wait_for_timeout(300);page.keyboard.down('s');page.wait_for_timeout(900);imageB,textB=wait_ocr(canvas,'keyboard-B.png','keyboard-B-ocr.png','PRESSE');page.keyboard.up('s')
   assert 'PRESSE' in textB.upper(),textB
   ok('Clavier navigateur : X/A et S/B reçus par la ROM',{'ocr_A':textA,'ocr_B':textB,'captures':['keyboard-A.png','keyboard-B.png']})
   # Observe actual buffers scheduled by the core, preserving their samples and native start.
   page.locator('#audio').click();page.evaluate('scheduledAudio=[]');page.wait_for_timeout(700);silent=page.evaluate('scheduledAudio');page.evaluate('scheduledAudio=[];capturePCM=true')
   canvas.click();page.keyboard.down('x');page.wait_for_timeout(1800);tone=page.evaluate('scheduledAudio');page.keyboard.up('x');page.wait_for_timeout(900);page.evaluate('scheduledAudio=[];capturePCM=false');page.wait_for_timeout(700);after=page.evaluate('scheduledAudio')
   maximum=lambda buffers:max([a['rms'] for a in buffers] or [0])
   assert tone and maximum(tone)>0.001 and maximum(tone)>maximum(silent)*3
   assert after and maximum(after)<0.001
   ok('Audio réel : PCM non nul ordonnancé vers WebAudio avec A, silence après relâchement',{'silent_max_rms':maximum(silent),'tone_max_rms':maximum(tone),'released_max_rms':maximum(after),'scheduled_tone_buffers':len(tone),'physical_speakers':'NON TESTABLE'})
   (E/'audio-samples.json').write_text(json.dumps({'silent':silent,'tone':tone,'released':after}))
   f=page.evaluate('EJS_emulator.gameManager.getFrameNum()');page.wait_for_timeout(30000);f2=page.evaluate('EJS_emulator.gameManager.getFrameNum()');assert f2>f and not errors,errors
   ok('Stabilité observée pendant 30 secondes supplémentaires',{'frame_before':f,'frame_after':f2,'page_errors':errors})
   assert not [r for r in requests if r['url'].startswith(('http:','https:')) and not r['url'].startswith('http://127.0.0.1:8770/')],requests
   ok('Ressources moteur servies localement, sans service externe au lancement',{'http_responses':len(requests)})
   (E/'runtime-diagnostic.json').write_text(json.dumps(page.evaluate('RealN64.diagnostic()'),indent=2))
   page.screenshot(path=str(E/'interface-real.png'),full_page=True)
  except Exception as error:
   results.append({'test':'Parcours réel interrompu','status':'ÉCHOUÉ','proof':str(error)});page.screenshot(path=str(E/'failure-real.png'),full_page=True);raise
  finally:
   try:(E/'runtime-diagnostic.json').write_text(json.dumps(page.evaluate('RealN64.diagnostic()'),indent=2))
   except Exception:pass
   (E/'browser-real-results.json').write_text(json.dumps({'results':results,'console':console,'page_errors':errors,'responses':requests},ensure_ascii=False,indent=2));browser.close()
finally:server.shutdown();server.server_close()
