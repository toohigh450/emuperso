"""Test reel PSP : verifie l'isolation des sauvegardes par contenu dans le moteur.

Lance /portables/ avec un vrai .cso, attend le moteur, puis lit le MEMFS du cœur
pour verifier que le dossier canonique SAVEDATA/<discId> porte le marqueur
.emuperso-owner et que la case « ~id~empreinte » est prete.

Usage: python tools/browser_psp_saves_probe.py "D:\\chemin\\jeu.cso" [secondes]
Le fichier reste local (set_input_files), rien n'est envoye.
"""
import threading, sys, json, time, functools
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = Path(__file__).resolve().parents[1] / 'dist'
if len(sys.argv) < 2 or not Path(sys.argv[1]).is_file():
    sys.exit('Usage: python tools/browser_psp_saves_probe.py "D:\\chemin\\jeu.rom" [secondes]')
ROM = sys.argv[1]
DURATION = int(sys.argv[2]) if len(sys.argv) > 2 else 300

class H(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()

server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(H, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
port = server.server_port
out = {'errors': [], 'log': [], 'savedata': None}
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'])
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        page.on('pageerror', lambda e: out['errors'].append('PAGEERR ' + str(e)))
        page.on('dialog', lambda d: d.accept())
        page.goto(f'http://127.0.0.1:{port}/portables/?console=psp', wait_until='domcontentloaded')
        page.wait_for_timeout(2000)
        page.locator('#romInput').set_input_files(ROM)
        started = False
        deadline = time.time() + DURATION
        # Attendre le moteur, cliquer « Démarrer », puis inspecter le MEMFS dans l'iframe.
        while time.time() < deadline and out['savedata'] is None:
            page.wait_for_timeout(5000)
            try:
                st = page.locator('#status').inner_text()
            except Exception:
                st = ''
            if st:
                out['log'].append('STATUS: ' + st[:160])
            if not started and 'Moteur prêt' in st:
                for frame in page.frames:
                    try:
                        if frame.evaluate("!!document.querySelector('.ejs_start_button')"):
                            frame.click('.ejs_start_button')
                            started = True
                            out['log'].append('START: Démarrer cliqué dans le moteur')
                            break
                    except Exception:
                        pass
            for frame in page.frames:
                if 'player' not in (frame.url or ''):
                    continue
                try:
                    res = frame.evaluate("""() => {
                      try {
                        var emu = window.EJS_emulator;
                        if (!emu || !emu.gameManager || !emu.gameManager.FS) return null;
                        var FS = emu.gameManager.FS, SD = '/data/saves/PPSSPP/PSP/SAVEDATA';
                        if (!FS.analyzePath(SD).exists) return { error: 'SAVEDATA absent' };
                        var top = FS.readdir(SD).filter(n => n !== '.' && n !== '..');
                        var detail = {};
                        top.forEach(function (n) {
                          var p = SD + '/' + n;
                          if (!FS.isDir(FS.stat(p).mode)) return;
                          var marker = null;
                          try { marker = FS.readFile(p + '/.emuperso-owner'); } catch (e) {}
                          detail[n] = { marker: marker ? String.fromCharCode.apply(null, new Uint8Array(marker)) : null,
                                        entries: FS.readdir(p).filter(x => x !== '.' && x !== '..').slice(0, 8) };
                        });
                        return { top: top, detail: detail };
                      } catch (e) { return { error: String(e) }; }
                    }""")
                except Exception:
                    res = None
                if res:
                    out['savedata'] = res
                    break
        browser.close()
finally:
    server.shutdown()
print(json.dumps(out, ensure_ascii=False, indent=2))
