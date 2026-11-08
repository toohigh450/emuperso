"""Test reel PSP : lance /portables/ avec un vrai .cso/.iso de la collection.
Usage: python tools/browser_psp_probe.py "D:\\chemin\\jeu.cso" [secondes]
Le fichier reste local (set_input_files), rien n'est envoye.
"""
import threading, sys, json, time, functools
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = Path(__file__).resolve().parents[1] / 'dist'
ROM = sys.argv[1]
DURATION = int(sys.argv[2]) if len(sys.argv) > 2 else 240
CONSOLE = sys.argv[3] if len(sys.argv) > 3 else 'psp'

class H(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        # PSP (et d'autres cœurs threadés) exigent l'isolation cross-origin.
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()

server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(H, directory=str(ROOT)))
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
        page.goto(f'http://127.0.0.1:{port}/portables/?console={CONSOLE}', wait_until='domcontentloaded')
        page.wait_for_timeout(2000)
        out['title'] = page.title()
        page.locator('#romInput').set_input_files(ROM)
        # Archive multi-versions : le dialog version-picker propose la conseillée.
        try:
            page.wait_for_selector('dialog.version-picker', timeout=90000)
            out['version_picker'] = True
            page.locator('dialog.version-picker .btn.primary').click()
            out['log'].append('VERSION-PICKER: version conseillée choisie')
        except Exception:
            out['version_picker'] = False
        deadline = time.time() + DURATION
        last = ''
        while time.time() < deadline:
            page.wait_for_timeout(5000)
            try:
                st = page.locator('#status').inner_text()
            except Exception:
                st = '?'
            if st != last:
                out['log'].append('STATUS: ' + st[:200])
                last = st
            if any(k in st.lower() for k in ('erreur', 'impossible', 'refus', 'non reconnu')):
                break
            if page.locator('#playerMount iframe').count() and ('prêt' in st.lower() or 'moteur' in st.lower()):
                # moteur lance : on laisse tourner un peu puis on capture
                page.wait_for_timeout(20000)
                break
        out['status_final'] = last
        out['slot_title'] = page.locator('#gameTitle').inner_text() if page.locator('#gameTitle').count() else None
        out['game_core'] = page.locator('#gameCore').inner_text() if page.locator('#gameCore').count() else None
        out['game_system'] = page.locator('#gameSystem').inner_text() if page.locator('#gameSystem').count() else None
        out['iframes'] = page.locator('#playerMount iframe').count()
        shot = Path(__file__).resolve().parents[1] / 'tools' / 'shots' / f'psp-{CONSOLE}-final.png'
        shot.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(shot))
        browser.close()
finally:
    server.shutdown()
print(json.dumps(out, indent=1, ensure_ascii=False)[:8000])
