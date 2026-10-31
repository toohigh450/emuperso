"""Test-only Journal access injected into the in-memory HTML, never into delivery.
No network response leaves the process. Reorders exports to test UI rendering only.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
results=[]
def ok(message):
 results.append('RÉUSSI — '+message)
 print(results[-1],flush=True)
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 context=browser.new_context(offline=True)
 page=context.new_page();errors=[];requests=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('request',lambda r:requests.append(r.url) if r.url.startswith(('http:','https:')) else None)
 html=(ROOT/'N64-Web-Lab-Phase1A.html').read_text()
 marker='// LOCAL LAB MODULE: ui.mjs'
 assert html.count(marker)==1
 html=html.replace(marker,'globalThis.__testJournalClass = Journal;\n'+marker)
 context.route('http://127.0.0.1:18766/**',lambda route:route.fulfill(status=200,content_type='text/html',body=html))
 page.goto('http://127.0.0.1:18766/')
 page.wait_for_function('() => window.N64Lab?.view()?.state === "IDLE" && document.getElementById("journal-count").textContent !== ""')
 page.evaluate('''async () => {
  const original = __testJournalClass.prototype.export;
  window.pendingJournal = [];
  __testJournalClass.prototype.export = function() {
   const data = original.call(this);
   let resolve, reject;
   const delayed = new Promise((a,b) => { resolve=a;reject=b; });
   const item = { delivered:false, release:async () => { if(item.delivered)return;item.delivered=true;resolve(await data); }, fail:() => { if(item.delivered)return;item.delivered=true;reject(new Error('OBSOLETE_RENDER_ERROR')); } };
   pendingJournal.push(item);
   return delayed;
  };
 }''')
 # Multiple renders of one instance, delayed export completions intentionally inverted.
 page.locator('#initialize').click()
 page.wait_for_function('() => N64Lab.view().state === "READY" && N64Lab.view().busy === null')
 page.locator('#select').click()
 page.wait_for_function('() => N64Lab.view().state === "SELECTED" && N64Lab.view().busy === null')
 page.evaluate('async () => { window.last = pendingJournal.length-1; await pendingJournal[last].release(); }')
 page.wait_for_function('() => Number(document.getElementById("journal-count").textContent) > 0')
 newest=page.locator('#journal-count').inner_text()
 head=page.locator('#journal-head').inner_text()
 assert page.locator('#journal-freshness').get_attribute('data-status')=='current'
 page.evaluate('async () => { for(let i=last-1;i>=0;i--) if(i%2===0) await pendingJournal[i].release(); }')
 assert page.locator('#journal-count').inner_text()==newest
 assert page.locator('#journal-head').inner_text()==head
 ok('DOM réel : succès retardés délivrés en ordre inverse, compteur et tête courants conservés')
 feedback=page.locator('#feedback').inner_text()
 page.evaluate('() => { for(let i=0;i<last;i++) if(i%2===1) pendingJournal[i].fail(); }')
 # Drain queued rejection reactions without a timing assumption.
 page.evaluate('async () => { await new Promise(resolve => setTimeout(resolve,0)); }')
 assert page.locator('#feedback').inner_text()==feedback
 assert page.locator('#journal-freshness').get_attribute('data-status')=='current'
 assert 'OBSOLETE_RENDER_ERROR' not in feedback
 ok('DOM réel : erreurs obsolètes ignorées sans masquer le message courant')
 # Latest error remains visible (do not accidentally suppress all errors).
 page.locator('#load').click()
 page.wait_for_function('() => N64Lab.view().state === "LOADED" && N64Lab.view().busy === null')
 assert page.locator('#journal-freshness').get_attribute('data-status')=='pending'
 page.evaluate('() => pendingJournal[pendingJournal.length-1].fail()')
 expect(page.locator('#feedback')).to_contain_text('OBSOLETE_RENDER_ERROR')
 assert page.locator('#journal-freshness').get_attribute('data-status')=='stale'
 expect(page.locator('#journal-freshness')).to_contain_text('potentiellement ancienne')
 ok('DOM réel : erreur de la requête courante toujours affichée')
 # New instance must reject pending callbacks from the previous instance.
 page.locator('#reset').click()
 page.get_by_role('button',name='Confirmer',exact=True).click()
 page.wait_for_function('() => N64Lab.view().state === "IDLE"')
 page.evaluate('async () => { await pendingJournal[pendingJournal.length-1].release(); }')
 expect(page.locator('#journal-count')).to_have_text('1')
 page.evaluate('async () => { for(const item of pendingJournal) await item.release(); }')
 expect(page.locator('#journal-count')).to_have_text('1')
 assert len(page.locator('#journal-head').inner_text())==64
 assert page.locator('#journal-freshness').get_attribute('data-status')=='current'
 assert not errors,errors
 assert all(url=='http://127.0.0.1:18766/' for url in requests),requests
 ok('DOM réel : changement de laboratoire neutralise les anciens callbacks ; aucune erreur JS ni requête externe')
 browser.close()
(ROOT/'evidence/tests-rendu-journal.txt').write_text('\n'.join(results)+'\n',encoding='utf-8')
print('TOTAL',len(results),'contrôles DOM avec injection de retard réservée au test')
