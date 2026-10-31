"""Local file import tests, using ONLY the repository's MIT homebrew and synthetic invalid files."""
from pathlib import Path
import os,sys,json,hashlib,threading,base64
from http.server import ThreadingHTTPServer
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from serve import Handler
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1];E=ROOT/'evidence';E.mkdir(exist_ok=True)
ROM=(ROOT/'homebrew/fallback-open/demo-emuperso-open.z64').read_bytes();SHA=hashlib.sha256(ROM).hexdigest()
URL='http://127.0.0.1:8771/';results=[]
def ok(name,proof):results.append({'test':name,'status':'RÉUSSI','proof':proof});print('RÉUSSI — '+name,flush=True)
def encode(width):return b''.join(ROM[i:i+width][::-1] for i in range(0,len(ROM),width))
def payload(name,data=ROM):return {'name':name,'mimeType':'application/octet-stream','buffer':data}
def selected(page,name):page.wait_for_function('(n)=>RealN64.diagnostic().local_selection?.name===n',arg=name)
def ready(page):page.wait_for_function('()=>!!window.RealN64')
def boot(page):
 page.wait_for_function('()=>window.EJS_emulator?.gameManager?.getFrameNum()>15',timeout=45000)
 assert page.locator('iframe.engine-frame').count()==1
 assert page.evaluate('EJS_emulator===RealN64.engineWindow.EJS_emulator'), 'Expected the actual child engine object'
class AuditHandler(Handler):
 requests=[]
 def do_GET(self):self.requests.append((self.command,self.path,int(self.headers.get('Content-Length','0'))));super().do_GET()
 def do_POST(self):self.requests.append((self.command,self.path,int(self.headers.get('Content-Length','0'))));self.send_error(405)
 def do_PUT(self):self.do_POST()
server=ThreadingHTTPServer(('127.0.0.1',8771),AuditHandler);threading.Thread(target=server.serve_forever,daemon=True).start()
all_requests=[];errors=[]
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  def newpage():
   context=browser.new_context(viewport={'width':1200,'height':1000},accept_downloads=True);page=context.new_page()
   page.on('request',lambda r:all_requests.append({'url':r.url,'method':r.method,'body_bytes':len(r.post_data_buffer or b'')}))
   page.on('pageerror',lambda e:errors.append(str(e)));page.goto(URL);ready(page);return context,page
  for ext,data in [('z64',ROM),('v64',encode(2)),('n64',encode(4))]:
   context,page=newpage();begin=len(all_requests);name='import-local-test.'+ext
   with page.expect_file_chooser() as picker:page.locator('#choose-rom').click()
   picker.value.set_files(payload(name,data));selected(page,name)
   d=page.evaluate('RealN64.diagnostic()');assert d['phase']=='idle';assert d['local_selection']['detected_format']==ext;assert d['local_selection']['source_sha256']==hashlib.sha256(data).hexdigest();assert d['local_selection']['canonical_sha256']==SHA
   assert page.evaluate('!!window.EJS_emulator') is False
   page.locator('#launch-local').click();boot(page)
   actual=page.evaluate('''async()=>{const e=EJS_emulator,b=e.gameManager.FS.readFile(e.fileName);return {file:e.fileName,hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join(''),url:e.config.gameUrl};}''')
   assert actual['hash']==SHA and actual['file'].startswith('EMUPERSO_LOCAL_') and actual['url'].startswith('blob:')
   assert not any('/homebrew/' in r['url'] for r in all_requests[begin:] if r['url'].startswith(URL)), 'Import must not fetch a ROM from the server'
   # Mid-game ROM changes are now supported by replacing the isolated session.
   assert name not in actual['file'];assert page.locator('#choose-rom').is_enabled() and page.locator('#start').is_enabled()
   d=page.evaluate('RealN64.diagnostic()');assert d['active_rom']['source']=='local-file';assert 'MIT' not in json.dumps([r for r in d['records'] if r['type']=='rom.validated'])
   assert base64.b64encode(ROM).decode() not in json.dumps(d)
   for width in [390,1280]:
    page.set_viewport_size({'width':width,'height':1000});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   page.screenshot(path=str(E/f'import-{ext}.png'),full_page=True)
   ok('Import '+ext.upper()+' : vrai fichier local, normalisation et octets chargés dans le cœur conformes',actual)
   context.close()
  context,page=newpage()
  for name,bad in [('invalid-archive.zip',b'PK'+bytes(4094)),('short.z64',b'\x80\x37\x12\x40'),('invalid.n64',bytes(4096)),('odd.v64',b'\x37\x80\x40\x12'+bytes(4094))]:
   page.locator('#rom-file').set_input_files(payload(name,bad));expect(page.locator('#status')).to_have_class('error');assert page.locator('#launch-local').is_disabled();assert page.evaluate('!!window.EJS_emulator') is False
  ok('ZIP invalide, signature fausse, fichier tronqué et taille non alignée refusés sans moteur',{'engine_loaded':False})
  name="<img src=x onerror=window.__badName=1>.n64"
  page.locator('#rom-file').set_input_files(payload(name));selected(page,name)
  assert page.locator('#rom-name').inner_text()==name;assert page.evaluate('window.__badName??null') is None;expect(page.locator('#status')).to_contain_text('signature est prioritaire')
  assert page.locator('#rom-name img').count()==0
  with page.expect_file_chooser() as picker:page.locator('#choose-rom').click()
  picker.value.set_files(payload(name));selected(page,name)
  ok('Nom hostile affiché comme texte, extension incohérente signalée et même fichier re-sélectionnable',{'format':'z64','extension':'n64'})
  # Export is a user-initiated local Blob download, never a network upload.
  with page.expect_download() as download:page.locator('#export').click()
  exported=json.loads(Path(download.value.path()).read_text());assert exported['local_selection']['canonical_sha256']==SHA;assert base64.b64encode(ROM).decode() not in json.dumps(exported)
  ok('Diagnostic exporté sans octets de la ROM',{'selection_sha256':exported['local_selection']['canonical_sha256']})
  context.close()
  context,page=newpage();page.evaluate('''()=>{const read=File.prototype.arrayBuffer;File.prototype.arrayBuffer=async function(){if(this.name.startsWith('slow'))await new Promise(r=>setTimeout(r,600));return read.call(this);};}''')
  page.locator('#rom-file').set_input_files(payload('slow.z64'));page.locator('#rom-file').set_input_files(payload('newest.n64',encode(4)));selected(page,'newest.n64');page.wait_for_timeout(700)
  assert page.evaluate('RealN64.diagnostic().local_selection.name')=='newest.n64';assert page.locator('#launch-local').is_enabled()
  ok('Deux lectures concurrentes : le dernier choix reste sélectionné',{'selected':'newest.n64'})
  page.locator('#rom-file').set_input_files(payload('slow-again.z64'));page.locator('#start').click();boot(page);page.wait_for_timeout(700)
  assert page.evaluate('RealN64.diagnostic().active_rom.source')=='reference-demo';assert page.evaluate('EJS_emulator.config.gameName')=='DEMO N64 EMUPERSO';assert page.evaluate('RealN64.diagnostic().local_selection') is None
  ok('Démarrage de la référence pendant une lecture : aucune sélection locale tardive ne la remplace',{'source':'reference-demo'})
  context.close();browser.close()
 assert not errors,errors
 http=[r for r in all_requests if r['url'].startswith(('http:','https:'))]
 assert all(r['method']=='GET' and r['body_bytes']==0 and r['url'].startswith(URL) for r in http),http
 assert not any('import-local-test' in r['url'] or SHA in r['url'] for r in http)
 assert all(method=='GET' and length==0 for method,path,length in AuditHandler.requests)
 ok('Confidentialité : aucun POST/PUT, aucun corps HTTP, aucun domaine externe ni nom de fichier importé envoyé',{'browser_http_requests':len(http),'server_requests':len(AuditHandler.requests),'private_rom_used':False})
 (E/'tests-import-browser.json').write_text(json.dumps({'results':results,'page_errors':errors,'http':http,'server_requests':AuditHandler.requests,'scope':'Only MIT homebrew converted into three byte orders and synthetic invalid files; no user commercial ROM.'},ensure_ascii=False,indent=2))
 print('TOTAL',len(results),'contrôles import navigateur')
finally:server.shutdown();server.server_close()
