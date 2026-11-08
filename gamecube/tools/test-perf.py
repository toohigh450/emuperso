"""Test perf GameCube : boot headed + get_perf() periode + pixels canvas.
Usage: python gamecube/tools/test-perf.py "<image>"
"""
import threading, sys, json, os, time, functools
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
ROOT = Path(__file__).resolve().parents[2]
ROM = sys.argv[1]
DURATION = int(os.environ.get('TEST_SECONDS', '240'))

class H(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(H, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
port = server.server_port
result = {'errors': [], 'perf': []}
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=['--enable-unsafe-webgpu'])
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        page.on('pageerror', lambda e: result['errors'].append('PAGEERR ' + str(e)))
        page.on('dialog', lambda d: d.accept())
        page.goto(f'http://127.0.0.1:{port}/gamecube/')
        page.wait_for_timeout(1500)
        page.locator('#game-file').set_input_files(ROM)
        page.locator('#launch').click()
        deadline = time.time() + DURATION
        while time.time() < deadline:
            page.wait_for_timeout(10000)
            try:
                st = page.locator('#status').inner_text()
            except Exception:
                st = '?'
            perf = None
            try:
                perf = page.evaluate("""() => {
                  const boots = window.__portablesBoots || {};
                  for (const k of Object.keys(boots)) {
                    const ctl = boots[k] && boots[k].control;
                    if (ctl && ctl.getPerf) { try { return ctl.getPerf(); } catch (e) { return 'err:' + e.message; } }
                  }
                  return 'no-ctl';
                }""")
            except Exception as e:
                perf = 'err:' + str(e)[:100]
            result['perf'].append({'t': int(time.time()), 'status': st, 'perf': perf})
            if 'erreur' in st.lower() or 'pas démarré' in st:
                break
        result['status_final'] = page.locator('#status').inner_text()
        page.screenshot(path=str(ROOT / 'gamecube' / 'tools' / 'shots' / 'perf-final.png'))
        browser.close()
finally:
    server.shutdown()
print(json.dumps(result, indent=1, ensure_ascii=False)[:6000])
