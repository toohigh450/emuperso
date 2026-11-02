"""Actual-core battery persistence with a distinctive controlled EEPROM byte.

Only the repository's MIT homebrew runs, in a new temporary browser profile.
The test edits its generated native-save bytes through the core's public FS /
refresh APIs. A changed FS file alone is NOT considered proof: captureBattery()
must first reproduce the change from the refreshed core. No commercial ROM or
original save file is read, modified, imported or exported.
"""
from pathlib import Path
import json
import os
import sys
import tempfile
import threading
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from serve import Handler

URL = 'http://127.0.0.1:8778/'
results, page_errors, requests, dialogs = [], [], [], []


def record(name, proof, status='RÉUSSI'):
    results.append({'test':name,'status':status,'proof':proof})
    print(status + ' — ' + name, flush=True)


def diagnostic(page):
    return page.evaluate('RealN64.diagnostic()')


def ready(page, previous_generation=0):
    page.wait_for_function('''previous=>{
      const d=RealN64.diagnostic();return d.phase==='started' &&
        d.session.active_generation>previous && d.session.frame_count===1 &&
        d.session.candidate_generation===null && d.session.active?.frame>8 &&
        !document.getElementById('battery-save').disabled;
    }''', arg=previous_generation, timeout=60000)


def native_snapshot(page):
    return page.evaluate('''async()=>{
      const bytes=RealN64.engineWindow.N64Engine.captureBattery();
      if(!bytes)return null;
      return {bytes:bytes.length,byte17:bytes[17],sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('')};
    }''')


def new_page(context):
    page=context.new_page()
    page.on('pageerror',lambda error:page_errors.append(str(error)))
    page.on('request',lambda request:requests.append({'url':request.url,'method':request.method,'body_bytes':len(request.post_data_buffer or b'')}))
    def accept_dialog(dialog):
        dialogs.append({'type':dialog.type,'message':dialog.message});dialog.accept()
    page.on('dialog',accept_dialog)
    page.goto(URL);page.wait_for_function('()=>!!window.RealN64')
    page.locator('#start').click();ready(page)
    assert page.evaluate('EJS_emulator===RealN64.engineWindow.EJS_emulator')
    return page


def main():
    report_path=ROOT/'evidence/probe-native-roundtrip.json'
    server=ThreadingHTTPServer(('127.0.0.1',8778),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    exit_code=0
    try:
        with tempfile.TemporaryDirectory(prefix='n64-native-roundtrip-') as profile,sync_playwright() as pw:
            options={'executable_path':os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),'headless':True,
                'args':['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
                'viewport':{'width':1280,'height':1050}}
            context=pw.chromium.launch_persistent_context(profile,**options)
            try:
                page=new_page(context)
                before=native_snapshot(page)
                if not before or before['bytes']!=296960:
                    record('Mutation native distinctive','Format natif inattendu : '+json.dumps(before),status='NON TESTABLE')
                    return 0
                # Native refresh must actually accept the changed EEPROM byte.
                # No heap pointer, mock getSaveFile, or replacement API is used.
                injected=page.evaluate('''async()=>{
                  const api=RealN64.engineWindow.N64Engine,manager=EJS_emulator.gameManager;
                  await api.pause();
                  try{
                    const bytes=api.captureBattery(),old=bytes[17];bytes[17]^=0x5a;
                    const path=manager.getSaveFilePath();
                    manager.FS.writeFile(path,new RealN64.engineWindow.Uint8Array(bytes));
                    manager.functions.loadSaveFiles();
                    return {old_byte17:old,expected_byte17:bytes[17],expected_sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join(''),path};
                  }finally{await api.play();}
                }''')
                page.wait_for_timeout(300)
                changed=native_snapshot(page)
                if not changed or changed['sha256']!=injected['expected_sha256'] or changed['byte17']!=injected['expected_byte17']:
                    record('Mutation native distinctive',{'before':before,'attempt':injected,'actual_core_capture':changed,'reason':'Le refresh du vrai cœur ne reproduit pas la modification ; aucun test de persistance ne sera déclaré réussi.'},status='NON TESTABLE')
                    return 0
                assert changed['sha256']!=before['sha256'] and changed['byte17']!=before['byte17']
                record('Le vrai cœur reproduit un octet EEPROM modifié',{'before':before,'changed':changed,'refresh_api':'gameManager.functions.loadSaveFiles','path':injected['path']})

                # An autosave may already have persisted this same changed hash.
                # A deduplicating manual save must not be forced to create a new
                # identical revision just to satisfy this test.
                page.locator('#battery-save').click()
                page.wait_for_function('''hash=>{
                  const d=RealN64.diagnostic(),saved=d.records.filter(r=>r.type==='battery.saved');
                  return saved.length && saved.at(-1).data.payload_sha256===hash && !document.getElementById('battery-save').disabled;
                }''',arg=changed['sha256'],timeout=30000)
                old_generation=diagnostic(page)['session']['active_generation']
                page.locator('#reset-clean').click();ready(page,old_generation)
                restarted=native_snapshot(page)
                assert restarted==changed,{'expected':changed,'actual':restarted}
                events=page.evaluate('RealN64.diagnostic().records.filter(r=>r.type==="battery.injected")')
                assert events and events[-1]['data']['bytes']==296960
                record('Sauvegarde native distinctive réinjectée après reset propre',{'native':restarted,'previous_generation':old_generation,'active_generation':diagnostic(page)['session']['active_generation'],'injection_event':events[-1]['data']})
                identity=diagnostic(page)['identity']
            finally:
                context.close()

            # Reopen the whole browser with the same persistent profile, then
            # reselect the same own ROM through the visible reference button.
            context=pw.chromium.launch_persistent_context(profile,**options)
            try:
                page=new_page(context)
                assert diagnostic(page)['identity']==identity
                reopened=native_snapshot(page)
                assert reopened==changed,{'expected':changed,'actual':reopened}
                assert reopened['sha256']!=before['sha256']
                injected_events=page.evaluate('RealN64.diagnostic().records.filter(r=>r.type==="battery.injected")')
                assert injected_events
                record('Persistance native distinctive après fermeture complète du navigateur',{'native':reopened,'different_from_fresh_sha256':before['sha256'],'new_process_profile_reopened':True,'injection_event':injected_events[-1]['data']})
                def change_fixture_byte(value):
                    page.evaluate('''async value=>{
                      const api=RealN64.engineWindow.N64Engine,g=EJS_emulator.gameManager;
                      await api.pause();
                      try{const bytes=api.captureBattery();bytes[17]=value;g.FS.writeFile(g.getSaveFilePath(),new RealN64.engineWindow.Uint8Array(bytes));g.functions.loadSaveFiles();}
                      finally{await api.play();}
                    }''',value)
                    return native_snapshot(page)
                second=change_fixture_byte(changed['byte17']^0x33)
                assert second['sha256']!=changed['sha256']
                saved_before=len(page.evaluate('RealN64.diagnostic().records.filter(r=>r.type==="battery.saved")'))
                page.locator('#battery-save').click()
                page.wait_for_function('''({count,hash})=>{
                  const rows=RealN64.diagnostic().records.filter(r=>r.type==='battery.saved');
                  return rows.length>count&&rows.at(-1).data.payload_sha256===hash&&!document.querySelector('#battery-save').disabled;
                }''',arg={'count':saved_before,'hash':second['sha256']},timeout=30000)
                unsaved=change_fixture_byte(second['byte17']^0x17)
                assert unsaved['sha256'] not in (changed['sha256'],second['sha256'])
                generation=diagnostic(page)['session']['active_generation']
                page.locator('#battery-load').click();ready(page,generation)
                reloaded=native_snapshot(page)
                assert reloaded==second,{'expected':second,'actual':reloaded,'unsaved':unsaved}
                record('Bouton natif : copie courante relue sans écraser la cible avec le natif non enregistré',{'saved':second,'unsaved_discarded':unsaved,'reloaded':reloaded,'verification':page.evaluate('RealN64.diagnostic().records.filter(r=>r.type==="battery.loaded").at(-1).data')})
                change_fixture_byte(second['byte17']^0x17)
                generation=diagnostic(page)['session']['active_generation']
                page.locator('#battery-previous').click();ready(page,generation)
                prior=native_snapshot(page)
                assert prior==changed,{'expected_previous':changed,'actual':prior}
                record('Bouton natif précédent : ancienne copie réellement relue par le cœur',{'expected_previous':changed,'reloaded':prior,'verification':page.evaluate('RealN64.diagnostic().records.filter(r=>r.type==="battery.loaded").at(-1).data')})
                page.screenshot(path=str(ROOT/'evidence/native-roundtrip.png'),full_page=True)
            finally:
                context.close()
        assert not page_errors,page_errors
        assert all((r['url'].startswith(URL) or r['url'].startswith('blob:' + URL)) and r['method']=='GET' and r['body_bytes']==0 for r in requests),requests
    except Exception as error:
        record('Parcours de persistance native interrompu',str(error),status='ÉCHOUÉ')
        exit_code=1
        raise
    finally:
        report={'schema':'emuperso/native-roundtrip-probe/v1','results':results,'page_errors':page_errors,'http':requests,'dialogs':dialogs,
            'scope':'Actual pinned N64 core, own MIT homebrew, newly generated battery bytes and a temporary Chromium profile. A controlled EEPROM byte is changed through actual FS/refresh APIs. No original or commercial save was used.',
            'not_tested':['Gameplay EEPROM writes by a commercial game','Physical Chrome on Karl PC','All N64 save types and games']}
        report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        server.shutdown();server.server_close()
    print('TOTAL',len(results),'contrôles natifs distinctifs',flush=True)
    return exit_code


if __name__=='__main__':
    raise SystemExit(main())
