"""Private staged HTTPS validation; never publishes or contacts a public host.

The localhost name addresses our loopback TLS server only.
The self-signed certificate is temporary and ignored only by test contexts.
A deployment on a genuinely public address remains NON TESTABLE without Karl GO.
"""
from pathlib import Path
import json, os, ssl, subprocess, sys, tempfile, threading
from http.server import ThreadingHTTPServer
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import package_rc
from serve import Handler
PORT=18880
URL=f'https://localhost:{PORT}/lab/'
results=[]
def ok(name,proof):
 results.append({'test':name,'status':'RÉUSSI','proof':proof});print('RÉUSSI — '+name,flush=True)
def main():
 server=None
 try:
  with tempfile.TemporaryDirectory(prefix='n64-private-https-review-') as folder:
   temp=Path(folder)
   bundle=package_rc.build_web(ROOT,temp/'archives')
   site=package_rc.extract_verified(bundle.archive,temp/'site')
   key,cert=temp/'key.pem',temp/'certificate.pem'
   subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   class Staged(Handler):
    document_root=site
    def send_head(self):
     original=self.path;parsed=urlsplit(original)
     if not parsed.path.startswith('/lab/'):
      self.send_error(404);return None
     self.path='/' + parsed.path[len('/lab/'):] + ('?'+parsed.query if parsed.query else '')
     try:return super().send_head()
     finally:self.path=original
   server=ThreadingHTTPServer(('127.0.0.1',PORT),Staged)
   tls=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);tls.load_cert_chain(cert,key)
   server.socket=tls.wrap_socket(server.socket,server_side=True)
   threading.Thread(target=server.serve_forever,daemon=True).start()
   with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    context=browser.new_context(ignore_https_errors=True,viewport={'width':1280,'height':1000})
    page=context.new_page();response=page.goto(URL);page.wait_for_function('()=>!!window.RealN64')
    security=page.evaluate('({secure:isSecureContext,isolated:crossOriginIsolated,protocol:location.protocol,origin:location.origin,gamepad:typeof navigator.getGamepads})')
    assert response.status==200 and security['secure'] and security['isolated'] and security['protocol']=='https:' and security['gamepad']=='function',security
    assert response.headers['cross-origin-opener-policy']=='same-origin'
    ok('Assemblage extrait sous un préfixe HTTPS privé : contexte sécurisé et isolation',{'security':security,'archive_sha256':bundle.sha256,'temporary_self_signed_tls':True,'public_deployment':False})
    (site/'private.z64').write_bytes(b'PRIVATE SYNTHETIC SENTINEL')
    (site/'diagnostic.json').write_text('{"private":"synthetic only"}')
    refused=page.evaluate('''async()=>{const result={};for(const path of ['private.z64','diagnostic.json','tools/serve.py','tests/browser_restore_rc.py','vendor/../private.z64'])result[path]=(await fetch(path)).status;return result}''')
    assert all(value==403 for value in refused.values()),refused
    ok('HTTPS : fichiers privés et outils refusés même présents dans le dossier de revue',refused)
    for width in [390,1280,3440]:
     page.set_viewport_size({'width':width,'height':1000});page.locator('#manual-cheats').evaluate('(e)=>e.open=true')
     layout=page.evaluate('''()=>{const image=document.querySelector('.brand-banner img'),bg=getComputedStyle(document.body,'::before'),buttons=[];for(const element of document.querySelectorAll('button')){if(!element.checkVisibility())continue;element.scrollIntoView({block:'center'});const r=element.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);buttons.push({id:element.id,unobstructed:top===element||element.contains(top)})}window.scrollTo(0,0);return{width:innerWidth,body_width:document.documentElement.scrollWidth,image_width:image.naturalWidth,image_fit:getComputedStyle(image).objectFit,pointer_events:bg.pointerEvents,buttons}}''')
     assert layout['body_width']<=width and layout['image_width']==1942 and layout['image_fit']=='contain' and layout['pointer_events']=='none'
     assert all(button['unobstructed']for button in layout['buttons']),layout
     if width==1280:page.screenshot(path=str(ROOT/'evidence/web-rc-interface.png'),full_page=True)
     ok('Décor original et commandes dégagées à '+str(width)+' pixels',layout)
    context.close()
    for resource,kind in [('data/src/GameManager.js','script-sri'),('data/cores/mupen64plus_next-wasm.data','core-bytes')]:
     context=browser.new_context(ignore_https_errors=True);page=context.new_page()
     original=(site/'vendor'/resource).read_bytes()
     changed=original+b'\n// controlled SRI failure\n' if kind=='script-sri' else bytes([original[0]^1])+original[1:]
     page.route(URL+'vendor/'+resource,lambda route,request,*,data=changed,typ=kind:route.fulfill(status=200,body=data,content_type='text/javascript'if typ=='script-sri'else'application/octet-stream'))
     page.goto(URL);page.wait_for_function('()=>!!window.RealN64');page.locator('#start').click()
     page.wait_for_function('()=>RealN64.diagnostic().records.some(r=>r.type==="operation.failed")&&!document.querySelector("#start").disabled',timeout=60000)
     diagnostic=page.evaluate('RealN64.diagnostic()');assert diagnostic['session']['active_generation']is None
     assert not any(record['type']=='wasm.instantiated'for record in diagnostic['records'])
     ok('Octets altérés refusés avant exécution du cœur : '+kind,{'resource':resource,'active_generation':None,'error':page.locator('#status').inner_text(),'integrity_records':[r for r in diagnostic['records']if r['type'].startswith('integrity.')]})
     context.close()
    browser.close()
   env=os.environ.copy();env['N64_RESTORE_TEST_URL']=URL
   subprocess.run([sys.executable,'-X','utf8',str(ROOT/'tests/browser_restore_rc.py')],env=env,cwd=ROOT,check=True,timeout=600)
   restoration=json.loads((ROOT/'evidence/tests-web-rc-restoration.json').read_text())
   assert len(restoration['results'])==9 and all(row['status']=='RÉUSSI'for row in restoration['results'])
   ok('Parcours complet de restauration réel sur le ZIP Web extrait en HTTPS',{'checks':9,'report':'tests-web-rc-restoration.json','no_public_address_test':True})
 except Exception as error:
  results.append({'test':'Validation HTTPS privée interrompue','status':'ÉCHOUÉ','proof':str(error)})
  raise
 finally:
  if server:server.shutdown();server.server_close()
  (ROOT/'evidence/tests-web-rc-browser.json').write_text(json.dumps({'schema':'emuperso/web-private-https-tests/v1','results':results,'url':URL,'scope':'Temporary local TLS on localhost, exact staged Web archive. Not a publicly deployed site.','public_url':{'status':'NON TESTABLE','reason':'No publication authorized by Karl; F6 is open.'}},ensure_ascii=False,indent=2)+'\n')
if __name__=='__main__':main()
