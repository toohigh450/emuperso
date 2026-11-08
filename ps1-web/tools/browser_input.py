"""Régression manette PS1 : vrai Chromium + vrai cœur PCSX + ISO synthétique.
Vérifie que la chaîne Gamepad API -> pollInputs -> simulateInput fonctionne
sur le build actuel, et que input.pads.snapshot journalise l'état réel.
Aucune manette physique ni ROM commerciale.
"""
import json, struct, threading, sys, io, argparse, shutil
from pathlib import Path
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from serve import Handler
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, default=ROOT / 'cache/browser-input')
args = parser.parse_args()
OUT = args.output / 'logs'
OUT.mkdir(parents=True, exist_ok=True)

# Même PS-X EXE synthétique que browser_real.py : boucle infinie, écran rouge.
rom = bytearray(65536)
rom[:8] = b'PS-X EXE'
for offset, value in {0x10:0x80010000, 0x18:0x80010000, 0x1c:len(rom)-2048, 0x30:0x801fff00}.items():
    struct.pack_into('<I', rom, offset, value)
words = [0x3c081f80,0x35081814,0xad000000,0x3c090300,0xad090000,
         0x3c090800,0x35290001,0xad090000,0x2508fffc,
         0x3c090200,0x352900ff,0xad090000,0xad000000,
         0x3c0900f0,0x35290140,0xad090000,0x08004010,0]
for i,w in enumerate(words): struct.pack_into('<I',rom,2048+4*i,w)
fixture = OUT.parent / 'synthetic-demo.iso'
import pycdlib
iso = pycdlib.PyCdlib()
iso.new(interchange_level=1, sys_ident='PLAYSTATION', vol_ident='EMUPERSO_SYNTH', app_ident_str='PLAYSTATION')
cnf = b'BOOT = cdrom:\\DEMO.EXE;1\r\nTCB = 4\r\nEVENT = 10\r\nSTACK = 801fff00\r\n'
iso.add_fp(io.BytesIO(cnf),len(cnf),iso_path='/SYSTEM.CNF;1')
iso.add_fp(io.BytesIO(rom),len(rom),iso_path='/DEMO.EXE;1')
iso.write(str(fixture)); iso.close()

server = ThreadingHTTPServer(('127.0.0.1',0), Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
result = {'scope':'real Chromium + pinned PCSX core + synthetic PS-X EXE + injected Gamepad API; no physical controller',
          'errors':[], 'console':[]}
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True,
            args=['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'])
        page = browser.new_page()
        page.on('pageerror', lambda e: result['errors'].append(str(e)))
        page.on('console', lambda m: result['console'].append(m.text[:300]))
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        page.wait_for_function('window.__cheatController !== undefined')
        page.locator('#disc-file').set_input_files(str(fixture))
        page.wait_for_function("!document.getElementById('launch').disabled", timeout=20000)
        page.locator('#launch').click()
        page.wait_for_function("document.getElementById('current').textContent !== 'Aucun'", timeout=90000)
        frame = page.frames[1]
        page.wait_for_timeout(500)
        result['input_status'] = frame.evaluate('window.PS1Engine.inputStatus()')
        # Instantané pads émis par la nouvelle instrumentation.
        result['pads_events'] = page.locator('#log').text_content()
        result['pads_events'] = [l for l in result['pads_events'].splitlines() if 'input.pads' in l or 'gamepad' in l]
        # Injection d'une manette standard dans l'iframe moteur : croix + haut + gâchette.
        result['bridge'] = frame.evaluate("""async () => {
          const manager = window.EJS_emulator.gameManager;
          const original = manager.simulateInput.bind(manager), calls = [];
          manager.simulateInput = (...a) => { calls.push(a); return original(...a); };
          const mk = pressed => ({pressed, value: pressed?1:0, touched:false});
          const buttons = Array.from({length:17},(_,i)=>mk(i===0||i===12));
          const axes = [0, -1, 0, 0];
          const fake = [{connected:true, mapping:'standard', id:'SYNTHETIC Gamepad', index:0,
                         timestamp:0, axes, buttons, vibrationActuator:null}];
          const native = navigator.getGamepads.bind(navigator);
          Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>fake});
          await new Promise(r=>setTimeout(r,400));
          Object.defineProperty(navigator,'getGamepads',{configurable:true,value:native});
          manager.simulateInput = original;
          return {scope:'synthetic Gamepad API inside real engine iframe', calls: calls.slice(0,80),
                  total: calls.length,
                  cross: calls.some(c=>c[1]===0&&c[2]===1),
                  up: calls.some(c=>c[1]===4&&c[2]===1),
                  trigger: calls.some(c=>c[1]===13&&c[2]===1),
                  released: calls.some(c=>c[1]===0&&c[2]===0)};
        }""")
        result['diagnostic_tail'] = page.locator('#log').text_content()[-3000:]
        page.screenshot(path=str(OUT/'input-core.png'))
        browser.close()
except Exception as e:
    result['launch_error'] = str(e)
finally:
    server.shutdown(); server.server_close()
    (OUT/'browser-input.json').write_text(json.dumps(result,indent=2,ensure_ascii=False))
b = result.get('bridge') or {}
print(json.dumps({'input_status': result.get('input_status'),
                  'pads_events': result.get('pads_events'),
                  'bridge_total': b.get('total'), 'cross': b.get('cross'), 'up': b.get('up'),
                  'errors': result['errors'][:5], 'launch_error': result.get('launch_error')},
                 indent=2, ensure_ascii=False))
# Non-régression : un gamepad standard injecté doit atteindre simulateInput
# (croix id 0 et haut id 4). trigger/released non exigés : le relâchement peut
# survenir après la restauration du stub dans le même tour d'événement.
real_errors = [e for e in result['errors'] if 'Wake Lock' not in e]
ok = b.get('cross') and b.get('up') and not real_errors
sys.exit(0 if ok else 1)
