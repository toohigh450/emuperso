"""Test boot GameCube : page /gamecube/ + gcplayer + wasm Gecko, avec la demo
libre Swiss (.dol). Verifie le chemin complet : validation, iframe, WASM,
WebGPU, moteur, memcard. Aucun jeu commercial.
"""
import threading, sys, json
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
ROOT = Path(__file__).resolve().parents[1]
DOL = sys.argv[1] if len(sys.argv) > 1 else None

class H(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

server = ThreadingHTTPServer(('127.0.0.1', 0), H)
threading.Thread(target=server.serve_forever, daemon=True).start()
port = server.server_port
result = {'errors': []}
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        headed = bool(__import__('os').environ.get('PROBE_HEADED'))
        browser = p.chromium.launch(headless=not headed, args=['--enable-unsafe-webgpu'])
        page = browser.new_page()
        page.on('pageerror', lambda e: result['errors'].append('PAGEERR ' + str(e)))
        page.on('console', lambda m: result['errors'].append(m.type + ': ' + m.text[:300]) if m.type in ('error', 'warning') else None)
        page.on('dialog', lambda d: d.accept())
        page.goto(f'http://127.0.0.1:{port}/gamecube/')
        page.wait_for_timeout(1500)
        result['status0'] = page.locator('#status').inner_text()
        if DOL:
            page.locator('#game-file').set_input_files(DOL)
            page.locator('#launch').click()
            st = ''
            for _ in range(180):
                page.wait_for_timeout(1000)
                st = page.locator('#status').inner_text()
                if any(k in st for k in ('lancé', 'démarré', 'pas démarré')) or 'erreur' in st.lower():
                    break
            result['status_final'] = st
            result['log_tail'] = page.locator('#log').inner_text()[-2500:]
            if len(page.frames) > 1:
                try:
                    result['canvas'] = page.frames[1].evaluate("() => { const c = document.querySelector('body > canvas'); return c ? { w: c.width, h: c.height } : null; }")
                except Exception as e:
                    result['canvas_error'] = str(e)
        browser.close()
finally:
    server.shutdown()
print(json.dumps(result, indent=2, ensure_ascii=False)[:6000])
