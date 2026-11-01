"""Real PCSX/Chromium, synthetic ISO/ZIP only. Memory budget is deliberately
overridden for the refusal path: no real OOM is induced or claimed.
Also trace compound cheats at the native manager boundary and inspect guest RAM.
"""
import argparse
import io
import json
import sys
import threading
import zipfile
from http.server import ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright
from serve import Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--fixture', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--chromium', default='/usr/bin/chromium')
    args = parser.parse_args()
    out = args.output.resolve(); out.mkdir(parents=True, exist_ok=True)
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, 'w', compression=zipfile.ZIP_STORED) as z:
        z.writestr('Synthetic/SYNTHETIC.ISO', args.fixture.read_bytes())
    result = {'scope': 'real PCSX + real controller + synthetic ISO/ZIP; forced memory metric only for refusal; no real OOM, physical pad, game audio or RAR/7z proof', 'checks': {}, 'errors': []}
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=args.chromium, headless=True,
                args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'])
            page = browser.new_page(); page.on('pageerror', lambda e: result['errors'].append(str(e)))
            dialogs = []; accept = True
            def on_dialog(d):
                dialogs.append(d.message)
                d.accept() if accept else d.dismiss()
            page.on('dialog', on_dialog)
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            page.wait_for_function('window.__cheatController !== undefined')
            page.locator('#disc-file').set_input_files(str(args.fixture))
            page.wait_for_function("!document.getElementById('launch').disabled")
            page.locator('#launch').click()
            page.wait_for_function("document.getElementById('current').textContent !== 'Aucun'", timeout=60000)
            frame = page.frames[1]
            offset = frame.evaluate('''()=>{const h=window.EJS_emulator.gameManager.Module.HEAPU8,p=[0x68,0x24,0x57,0x13,0xab,0xcd,0xef,0x42];for(let i=0;i<h.length-p.length;i++)if(p.every((b,j)=>h[i+j]===b))return i;return null;}''')
            assert offset is not None
            frame.evaluate('''()=>{const m=window.EJS_emulator.gameManager;window.__trace=[];for(const name of ['setCheat','resetCheat']){const fn=m[name].bind(m);m[name]=(...a)=>{window.__trace.push({name,args:a});return fn(...a)}}}''')
            codes = [
                ('slide16', '50000202 0001\n80011000 5678', [0x78, 0x56, 0x79, 0x56]),
                ('copy4', 'C2011000 0004\n80011008 0000', None),
                ('conditional16', 'D0011000 2468\n80011004 ABCD', None),
            ]
            for name, code, _ in codes:
                page.evaluate('''async([name,code])=>{await window.__cheatController.addManual(name,code)}''', [name, code])
            page.evaluate('window.__cheatController.confirmRegion()')
            result['compound'] = []
            for i, (name, code, expected) in enumerate(codes):
                page.evaluate('window.__cheatController.disableAll()')
                frame.evaluate('i=>window.EJS_emulator.gameManager.Module.HEAPU8.set([0x68,0x24,0x57,0x13,0xab,0xcd,0xef,0x42,0x81,0xe3,0xa5,0xc7,0x90,0xba,0xdc,0xfe],i)', offset)
                page.evaluate('i=>window.__cheatController.toggle(i,true)', i); page.wait_for_timeout(250)
                data = frame.evaluate('i=>Array.from(window.EJS_emulator.gameManager.Module.HEAPU8.slice(i,i+16))', offset)
                passed = data[:4] == expected if name == 'slide16' else data[8:12] == [0x68,0x24,0x57,0x13] if name == 'copy4' else data[4:6] == [0xcd,0xab]
                result['compound'].append({'name': name, 'code': code, 'guest_ram': data, 'pass': passed})
                result['checks'][name + '_native'] = passed
            page.evaluate('window.__cheatController.disableAll()')
            calls = frame.evaluate('window.__trace.length')
            result['rejected_32bit'] = page.evaluate('''async(code)=>{const c=window.__cheatController;const before=c.view().cheats.length;try{await c.addManual('invalid32',code)}catch{}return c.view().cheats.length===before}''', 'C2011000 0004\n80011008 12345678')
            result['checks']['reject_32bit_without_native_call'] = result['rejected_32bit'] and frame.evaluate('window.__trace.length') == calls
            result['native_trace'] = frame.evaluate('window.__trace')
            # Keep a known state/card revision, then refuse the archive BEFORE capture.
            frame.evaluate('i=>window.EJS_emulator.gameManager.Module.HEAPU8.set([0xfe,0xca],i)', offset)
            page.locator('#state-save').click(); page.wait_for_function("!document.getElementById('choose').disabled")
            slots_js = '''async()=>{const db=await new Promise((ok,ko)=>{const r=indexedDB.open('emuperso-real-saves-v1-ps1');r.onsuccess=()=>ok(r.result);r.onerror=()=>ko(r.error)});try{return await new Promise((ok,ko)=>{const r=db.transaction('slots').objectStore('slots').getAll();r.onsuccess=()=>ok(r.result.map(x=>({key:x.key,revision:x.revision,id:x.current.id,sha256:x.current.payload_sha256})).sort((a,b)=>a.key.localeCompare(b.key)));r.onerror=()=>ko(r.error)})}finally{db.close()}}'''
            result['slots_before'] = page.evaluate(slots_js)
            before = frame.evaluate('window.PS1Engine.snapshot()'); result['before_refusal'] = before
            frame.evaluate('''()=>{const m=window.EJS_emulator.gameManager,original=m.getSaveFile.bind(m);window.__captureCalls=0;m.getSaveFile=(...a)=>{window.__captureCalls++;return original(...a)}}''')
            page.evaluate('''()=>{window.__memoryDescriptor=Object.getOwnPropertyDescriptor(performance,'memory');Object.defineProperty(performance,'memory',{configurable:true,value:{jsHeapSizeLimit:20*1048576,usedJSHeapSize:19*1048576}})}''')
            page.locator('#disc-file').set_input_files({'name':'Synthetic.zip', 'mimeType':'application/zip', 'buffer':payload.getvalue()})
            page.wait_for_function("!document.getElementById('launch').disabled")
            page.locator('#launch').click(); page.wait_for_function("!document.getElementById('choose').disabled")
            result['refusal_status'] = page.locator('#status').inner_text()
            after = frame.evaluate('window.PS1Engine.snapshot()'); result['after_refusal'] = after
            result['slots_after'] = page.evaluate(slots_js)
            result['checks']['memory_refusal_retains_real_session'] = after['session_id'] == before['session_id'] and after['frame'] >= before['frame'] and not after['closed'] and 'refusé avant fermeture' in result['refusal_status']
            result['checks']['memory_refusal_retains_guest_ram'] = frame.evaluate('i=>Array.from(window.EJS_emulator.gameManager.Module.HEAPU8.slice(i,i+2))', offset) == [0xfe,0xca]
            result['checks']['memory_refusal_no_capture_or_save_write'] = frame.evaluate('window.__captureCalls') == 0 and result['slots_before'] == result['slots_after']
            result['refusal_journal'] = page.locator('#log').inner_text()
            page.screenshot(path=str(out/'memory-refusal.png'))
            page.evaluate("()=>{if(window.__memoryDescriptor)Object.defineProperty(performance,'memory',window.__memoryDescriptor);else delete performance.memory}")
            accept = False
            page.locator('#launch').click(); page.wait_for_function("!document.getElementById('choose').disabled")
            result['checks']['cancel_archive_retains_real_session'] = frame.evaluate('window.PS1Engine.snapshot().session_id') == before['session_id']
            accept = True
            page.locator('#launch').click(); page.wait_for_function("!document.getElementById('choose').disabled", timeout=60000)
            frame = page.frames[1]
            snapshot = frame.evaluate('window.PS1Engine.snapshot()'); result['zip_snapshot'] = snapshot
            journal = json.loads(page.locator('#log').inner_text())
            result['archive_events'] = [e for e in journal if e['type'].startswith(('archive.', 'engine.archive.', 'session.closed.for_archive'))]
            starts = [e for e in journal if e['type'] == 'engine.archive.decompression.before']
            ends = [e for e in journal if e['type'] == 'engine.archive.decompression.after']
            result['checks']['real_zip_boot'] = snapshot['started'] and snapshot['frame'] >= 5 and snapshot['session_id'] != before['session_id']
            result['checks']['real_decompression_byte_counts'] = len(starts) == len(ends) == 1 and starts[0]['data']['compressed_bytes'] == len(payload.getvalue()) and ends[0]['data']['expanded_bytes'] == args.fixture.stat().st_size and ends[0]['data']['files'] == 1 and not ends[0]['data']['peak_measured']
            result['checks']['accurate_archive_warning'] = bool(dialogs) and all('ancienne session ne pourra pas être rétablie' in d and 'dépasser l’estimation' in d for d in dialogs)
            result['dialogs'] = dialogs
            page.screenshot(path=str(out/'real-zip.png')); browser.close()
    except Exception as error:
        result['failure'] = str(error)
    finally:
        server.shutdown(); server.server_close()
        (out/'browser-archives.json').write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps({'checks':result['checks'], 'failure':result.get('failure'), 'errors':result['errors']}, indent=2))
    return 0 if len(result['checks']) == 11 and all(result['checks'].values()) and not result.get('failure') and not result['errors'] else 1


if __name__ == '__main__':
    sys.exit(main())
