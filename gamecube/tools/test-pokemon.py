"""Test reel Pokemon XD GameCube : boot headed, capture statut/log/canvas.
Usage: python gamecube/tools/test-pokemon.py "<chemin zip>"
"""
import threading, sys, json, os, time, functools
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
ROOT = Path(__file__).resolve().parents[2]
REPO = Path(__file__).resolve().parents[1]
ROM = sys.argv[1]

class H(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

Handler = functools.partial(H, directory=str(ROOT))
server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
port = server.server_port
result = {'errors': [], 'snapshots': []}
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=['--enable-unsafe-webgpu'])
        ctx = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = ctx.new_page()
        page.on('pageerror', lambda e: result['errors'].append('PAGEERR ' + str(e)))
        page.on('console', lambda m: result['errors'].append(m.type + ': ' + m.text[:300]) if m.type in ('error', 'warning') else None)
        page.on('dialog', lambda d: d.accept())
        page.goto(f'http://127.0.0.1:{port}/gamecube/')
        page.wait_for_timeout(1500)
        try:
            result['status0'] = page.locator('#status').inner_text(timeout=15000)
        except Exception:
            result['debug'] = {'url': page.url, 'title': page.title(),
                               'frames': len(page.frames),
                               'body': (page.locator('body').inner_text()[:800] if page.locator('body').count() else 'NO BODY')}
            print(json.dumps(result, indent=2, ensure_ascii=False)[:4000])
            raise
        page.locator('#game-file').set_input_files(ROM)
        page.locator('#launch').click()
        shot_dir = REPO / 'tools' / 'shots'
        shot_dir.mkdir(exist_ok=True)
        deadline = time.time() + 600  # 10 min max
        last_status = ''
        while time.time() < deadline:
            page.wait_for_timeout(10000)
            try:
                st = page.locator('#status').inner_text()
                logtxt = page.locator('#log').inner_text()
            except Exception:
                continue
            snap = {'t': int(time.time()), 'status': st, 'log_tail': logtxt[-600:]}
            result['snapshots'].append(snap)
            # canvas info + pixel sample depuis la frame gcplayer
            try:
                for f in page.frames:
                    if 'gcplayer' in (f.url or ''):
                        snap['canvas'] = f.evaluate("""() => {
                          const c = document.querySelector('body > canvas');
                          if (!c) return null;
                          const g = c.getContext('webgl2') || c.getContext('webgl');
                          let nonBlack = -1;
                          try {
                            const px = new Uint8Array(4 * 64);
                            g.readPixels(0, 0, 16, 4, g.RGBA, g.UNSIGNED_BYTE, px);
                            nonBlack = px.reduce((a, v, i) => a + (i % 4 === 3 ? v : (v > 8 ? 1 : 0)), 0);
                          } catch (e) { nonBlack = 'err:' + e.message; }
                          return { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight, nonBlack };
                        }""")
            except Exception as e:
                snap['canvas_error'] = str(e)[:200]
            if st != last_status:
                last_status = st
                page.screenshot(path=str(shot_dir / f'pokemon-{int(time.time())}.png'))
            if 'erreur' in st.lower() or 'n’a pas démarré' in st or 'pas démarré' in st:
                break
        page.screenshot(path=str(shot_dir / 'pokemon-final.png'))
        result['status_final'] = page.locator('#status').inner_text()
        result['log_final'] = page.locator('#log').inner_text()[-3000:]
        ctx.close(); browser.close()
finally:
    server.shutdown()
print(json.dumps(result, indent=2, ensure_ascii=False)[:8000])
