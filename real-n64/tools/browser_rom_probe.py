"""Test reel N64 : /real-n64/ avec un vrai .zip/.z64 de la collection.
Usage: python real-n64/tools/browser_rom_probe.py "E:\\chemin\\jeu.zip" [secondes]
"""
import threading, sys, json, time, functools
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT.parent / 'dist'
ROM = sys.argv[1]
DURATION = int(sys.argv[2]) if len(sys.argv) > 2 else 240

class H(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()

server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(H, directory=str(DIST)))
threading.Thread(target=server.serve_forever, daemon=True).start()
port = server.server_port
out = {'errors': [], 'log': []}
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'])
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        page.on('pageerror', lambda e: out['errors'].append('PAGEERR ' + str(e)))
        page.on('console', lambda m: out['log'].append(m.type + ': ' + m.text[:200]) if m.type in ('error', 'warning') else None)
        page.on('dialog', lambda d: d.accept())
        page.goto(f'http://127.0.0.1:{port}/real-n64/', wait_until='domcontentloaded')
        page.wait_for_timeout(2000)
        out['title'] = page.title()
        page.locator('#rom-file').set_input_files(ROM)
        # ZIP multi-ROM : panneau de choix eventuel
        try:
            page.wait_for_selector('#zip-choice-panel:not([hidden])', timeout=30000)
            out['zip_choice'] = True
            # choisir la premiere entree proposee
            sel = page.locator('#zip-entry')
            if sel.count():
                opts = sel.locator('option')
                if opts.count() > 1: sel.select_option(index=1)
            page.locator('#zip-choose, #zip-choice-panel .btn.primary, #zip-choice-panel button').first.click()
        except Exception:
            out['zip_choice'] = False
        page.wait_for_function("!document.getElementById('launch-local').disabled", timeout=120000)
        page.locator('#launch-local').click()
        deadline = time.time() + DURATION
        last = ''
        while time.time() < deadline:
            page.wait_for_timeout(5000)
            # statut = texte du panneau jeu ou save-status
            try:
                st = page.locator('#save-status').inner_text() + ' | ' + page.locator('#game').inner_text()[:100]
            except Exception:
                st = '?'
            if st != last:
                out['log'].append('STATUS: ' + st[:200])
                last = st
            if page.locator('#game canvas').count():
                out['canvas_seen'] = True
                break
        out['status_final'] = last
        out['canvas'] = page.locator('#game canvas').count()
        shot = Path(__file__).resolve().parent / 'shots' / 'n64-final.png'
        shot.parent.mkdir(exist_ok=True)
        page.screenshot(path=str(shot))
        browser.close()
finally:
    server.shutdown()
print(json.dumps(out, indent=1, ensure_ascii=False)[:8000])
