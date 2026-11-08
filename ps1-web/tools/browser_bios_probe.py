"""Sonde BIOS PS1 : charge un fichier BIOS personnel via #bios-file et vérifie
que le cœur le détecte (« found BIOS file ») dans le MEMFS. BIOS factice
(512 Kio de zeros) : on vérifie la détection/le chemin, pas le boot réel.
"""
import json, threading, sys
from pathlib import Path
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from serve import Handler
OUT = ROOT / 'cache' / 'browser-memcard' / 'logs'
BIOS = Path(sys.argv[1]) if len(sys.argv) > 1 else OUT / 'SCPH1001.BIN'
ROM = ROOT / 'cache' / 'browser-memcard' / 'synthetic-demo.iso'

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
result = {'errors': []}
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True,
            args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'])
        page = browser.new_page()
        page.on('pageerror', lambda e: result['errors'].append(str(e)))
        console_lines = []
        page.on('console', lambda m: console_lines.append(f'{m.type}: {m.text}'))
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        page.wait_for_function('window.__cheatController !== undefined')
        page.locator('#bios-file').set_input_files(str(BIOS))
        page.wait_for_timeout(500)
        result['bios_status'] = page.locator('#bios-status').inner_text()
        page.locator('#disc-file').set_input_files(str(ROM))
        page.wait_for_function("!document.getElementById('launch').disabled", timeout=60000)
        page.locator('#launch').click()
        page.wait_for_function("document.getElementById('current').textContent !== 'Aucun'", timeout=120000)
        page.wait_for_timeout(12000)
        result['page_log_bios'] = [l for l in page.locator('#log').inner_text().split('},') if 'bios' in l.lower()]
        result['console_bios'] = [l for l in console_lines if 'bios' in l.lower() or 'environ' in l.lower() or 'memcard' in l.lower() or 'card' in l.lower()]
        result['engine_events'] = page.evaluate("() => (window.__engineEvents || []).slice(-30)") if page.evaluate("() => !!window.__engineEvents") else 'n/a'
        frame = page.frames[1] if len(page.frames) > 1 else None
        if frame:
            try:
                result['fs_root'] = frame.evaluate("""() => {
                  const out = {};
                  const emu = window.EJS_emulator;
                  const gm = emu && emu.gameManager;
                  if (emu && emu.config) out.biosUrl_type = typeof emu.config.biosUrl + ':' + (emu.config.biosUrl && emu.config.biosUrl.name ? emu.config.biosUrl.name : String(emu.config.biosUrl).slice(0,60));
                  if (!gm) return { error: 'no gameManager', ...out };
                  const names = gm.FS.readdir('/').filter(n => n !== '.' && n !== '..');
                  return { root_files: names.slice(0, 60), ...out };
                }""")
            except Exception as e:
                result['fs_root_error'] = str(e)
        browser.close()
finally:
    server.shutdown(); server.server_close()
print(json.dumps(result, indent=2, ensure_ascii=False)[:5000])
