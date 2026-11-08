"""Sonde carte memoire GameCube — roundtrip persistance avec IndexedDB tue.

1. /gamecube/ + fausse image .iso valide (magic GC a 0x1C) -> launch() ->
   loadCard() cree la carte 2 Mio (le moteur echouera apres, sans importance).
2. Import d'une carte .mcr marqueur (2 Mio, motif 0x5a) -> flushCard ->
   miroir localStorage + cardDB.
3. On TUE indexedDB 'emuperso-gamecube-v1' -> reload -> re-launch meme jeu
   -> loadCard ne peut plus lire que le miroir localStorage ->
   card-status doit afficher « enregistree ».

Prouve que la carte survit au pire cas de dechargement, comme RC-1.20 PS1.
"""
import json, struct, threading, sys, time, functools, os
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / 'dist'
OUT = ROOT / 'tools' / 'shots'
OUT.mkdir(parents=True, exist_ok=True)
WORK = OUT / '_gc_card_probe'
WORK.mkdir(exist_ok=True)

# Fausse image GC minimale : magic 0xC2339F3D a 0x1C + ID 6 chars a 0x00.
iso = bytearray(4096)
iso[0:6] = b'GCARDC'
struct.pack_into('>I', iso, 0x1C, 0xC2339F3D)
iso_path = WORK / 'sonde-gc.iso'
iso_path.write_bytes(iso)

# Carte .mcr marqueur 2 Mio.
mcr = bytearray(2 * 1024 * 1024)
mcr[0:2] = b'MC'
for i in range(4096, 8192):
    mcr[i] = 0x5A
mcr_path = WORK / 'marqueur-2mb.mcr'
mcr_path.write_bytes(mcr)

class H(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(H, directory=str(DIST)))
threading.Thread(target=server.serve_forever, daemon=True).start()
port = server.server_port
out = {'errors': []}
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        page.on('pageerror', lambda e: out['errors'].append('PAGEERR ' + str(e)))
        page.on('dialog', lambda d: d.accept())
        page.goto(f'http://127.0.0.1:{port}/gamecube/', wait_until='domcontentloaded')
        page.wait_for_timeout(1200)

        def launch_game():
            page.locator('#game-file').set_input_files(str(iso_path))
            page.wait_for_function("!document.getElementById('launch').disabled", timeout=20000)
            page.locator('#launch').click()
            # loadCard est await dans launch() : attendre le statut carte
            page.wait_for_function(
                "document.getElementById('card-status').textContent.includes('neuve') || document.getElementById('card-status').textContent.includes('enregistr')",
                timeout=30000)
            page.wait_for_timeout(500)
            return page.locator('#card-status').inner_text()

        out['s1_card_status'] = launch_game()

        # Import carte marqueur -> flushCard (IDB + miroir LS)
        page.locator('#card-file').set_input_files(str(mcr_path))
        page.wait_for_timeout(2500)
        out['after_import_status'] = page.locator('#status').inner_text()
        out['after_import_card'] = page.locator('#card-status').inner_text()

        ls = page.evaluate("""() => {
          const hits = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('emuperso-gc-card:')) {
              const v = JSON.parse(localStorage.getItem(k));
              hits.push({ key: k, b64len: (v.b64||'').length });
            }
          }
          return hits;
        }""")
        out['localstorage_cards'] = ls

        # Tue IndexedDB gamecube -> reload -> relance
        page.evaluate("""async () => { try { indexedDB.deleteDatabase('emuperso-gamecube-v1'); } catch(e){} }""")
        page.wait_for_timeout(800)
        page.reload(wait_until='domcontentloaded')
        page.wait_for_timeout(1200)
        out['s2_card_status'] = launch_game()
        # Le statut « enregistree » apres IDB vide = recuperation via miroir LS.
        out['card_recovered_despite_empty_idb'] = 'enregistr' in out['s2_card_status'].lower()
        browser.close()
finally:
    server.shutdown()
print(json.dumps(out, indent=1, ensure_ascii=False))
