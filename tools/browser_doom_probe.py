"""Test reel DOOM : lance /portables/?console=doom avec un vrai .wad IWAD.
Usage: python tools/browser_doom_probe.py "D:\\chemin\\DOOM2.WAD" [secondes]
Le fichier reste local (set_input_files), rien n'est envoye.
"""
import threading, sys, json, os, time, functools
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = Path(__file__).resolve().parents[1] / 'dist'
if len(sys.argv) < 2 or not Path(sys.argv[1]).is_file():
    sys.exit('Usage: python tools/browser_doom_probe.py "D:\\chemin\\DOOM2.WAD" [secondes]')
ROM = sys.argv[1]
DURATION = int(sys.argv[2]) if len(sys.argv) > 2 else 150

class H(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(H, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
port = server.server_port
out = {'errors': [], 'log': []}
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        page.on('pageerror', lambda e: out['errors'].append('PAGEERR ' + str(e)))
        page.on('console', lambda m: out['log'].append(m.type + ': ' + m.text[:200]) if m.type in ('error', 'warning') else None)
        page.on('dialog', lambda d: d.accept())
        page.goto(f'http://127.0.0.1:{port}/portables/?console=doom', wait_until='domcontentloaded')
        page.wait_for_timeout(2000)
        out['title'] = page.title()
        page.locator('#romInput').set_input_files(ROM)
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
            if any(k in st.lower() for k in ('erreur', 'impossible', 'refus')):
                break
            # jeu lance = player iframe present + status ok
            if page.locator('#playerMount iframe').count() and 'actif' not in st.lower():
                out['iframe_seen'] = True
                break
        out['status_final'] = last
        out['slot_title'] = page.locator('#gameTitle').inner_text() if page.locator('#gameTitle').count() else None
        out['game_core'] = page.locator('#gameCore').inner_text() if page.locator('#gameCore').count() else None
        out['iframes'] = page.locator('#playerMount iframe').count()
        shot = ROOT.parent / 'tools' / 'shots' / 'doom-final.png'
        shot.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(shot), full_page=False)
        browser.close()
finally:
    server.shutdown()
print(json.dumps(out, indent=1, ensure_ascii=False)[:8000])
