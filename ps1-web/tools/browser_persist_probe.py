"""Sonde persistance memcard PS1 — chemin applicatif complet.

Session 1 : boot ISO synthetique -> marqueur injecte dans la carte (.srm)
via FS + refresh/save natifs -> clic #battery-save (coffre IndexedDB).
Relance : re-selection du meme fichier + #launch -> nouvelle session.
Session 2 : verifier si la RAM Mcd1Data contient le marqueur SANS appel
manuel a refresh_save_files (lecture via cmd_savefiles RAM->fichier).

Si le marqueur disparait : le coeur ne charge jamais le .srm au boot ->
toute sauvegarde meurt au redemarrage (bug confirme).
Aucune ROM commerciale, aucun BIOS.
"""
import json, struct, threading, sys, io, os, re, time
from pathlib import Path
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from serve import Handler
OUT = ROOT / 'cache' / 'browser-persist' / 'logs'
OUT.mkdir(parents=True, exist_ok=True)

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
rom_path = str(fixture)

MARKER_JS = """() => {
  const marker = new Uint8Array(131072);
  marker[0]=0x4d; marker[1]=0x43;
  for (let i=4096;i<8192;i++) marker[i]=0x5a;
  return marker;
}"""

READ_JS = """() => {
  const gm = window.EJS_emulator.gameManager, FS = gm.FS;
  const sp = gm.getSaveFilePath();
  const rd = () => { try { return FS.readFile(sp); } catch(e){ return null; } };
  const snap = (b) => b ? { size: b.length,
    head: Array.from(b.slice(0,8)).map(x=>x.toString(16).padStart(2,'0')).join(''),
    n5a: b.reduce((a,x)=>a+(x===0x5a?1:0),0) } : null;
  return { save_path: sp, file: snap(rd()) };
}"""

server = ThreadingHTTPServer(('127.0.0.1',0), Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
result = {'errors': []}
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True,
            args=['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'])
        ctx = browser.new_context()
        page = ctx.new_page()
        page.on('pageerror', lambda e: result['errors'].append(str(e)))
        console_lines = []
        page.on('console', lambda m: console_lines.append(f'{m.type}: {m.text}'))
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        page.wait_for_function('window.__cheatController !== undefined')

        def engine_frame(timeout=90000):
            page.wait_for_function("document.getElementById('current').textContent !== 'Aucun'", timeout=timeout)
            for _ in range(400):
                for f in page.frames:
                    if f != page.main_frame:
                        try:
                            if f.evaluate("!!(window.EJS_emulator && window.EJS_emulator.gameManager && window.EJS_emulator.gameManager.FS && window.EJS_emulator.gameManager.getSaveFilePath)"):
                                return f
                        except Exception:
                            pass
                page.wait_for_timeout(50)
            raise RuntimeError('iframe moteur introuvable')

        # ---------- Session 1 ----------
        page.locator('#disc-file').set_input_files(rom_path)
        page.wait_for_function("!document.getElementById('launch').disabled", timeout=20000)
        page.locator('#launch').click()
        f1 = engine_frame()
        page.wait_for_timeout(4000)
        result['s1_initial'] = f1.evaluate(READ_JS)
        # Marqueur -> fichier -> RAM -> fichier (simule une sauvegarde en jeu)
        f1.evaluate(f"""() => {{
          const gm = window.EJS_emulator.gameManager, FS = gm.FS;
          const marker = ({MARKER_JS})();
          FS.writeFile(gm.getSaveFilePath(), marker);
          gm.functions.loadSaveFiles();
          gm.functions.saveSaveFiles();
        }}""")
        page.wait_for_timeout(500)
        result['s1_marked'] = f1.evaluate(READ_JS)
        # Coffre via le vrai bouton applicatif
        page.locator('#battery-save').click()
        page.wait_for_timeout(1500)
        result['s1_after_vault'] = f1.evaluate(READ_JS)

        # ---------- Relance (meme chemin qu'un changement de jeu) ----------
        page.locator('#disc-file').set_input_files(rom_path)
        page.wait_for_function("!document.getElementById('launch').disabled", timeout=20000)
        page.locator('#launch').click()
        page.wait_for_function("document.getElementById('current').textContent !== 'Aucun'", timeout=120000)
        page.wait_for_timeout(5000)
        # La frame moteur peut etre recreee pendant le boot : on la recherche
        # tant que la lecture echoue (frame detachee).
        def read_stable(timeout=60000):
            deadline = time.time() + timeout
            last = None
            while time.time() < deadline:
                for f in page.frames:
                    if f == page.main_frame: continue
                    try:
                        v = f.evaluate(READ_JS)
                        if v.get('save_path'): return v, f
                    except Exception:
                        pass
                page.wait_for_timeout(500)
            return last, None
        s2_boot, f2 = read_stable()
        result['s2_boot'] = s2_boot
        if f2 is None: raise RuntimeError('session 2 : frame moteur introuvable')
        # RAM -> fichier SANS refresh : si la RAM contient le marqueur, le
        # boot a bien charge le .srm. Sinon la RAM etait une carte vierge.
        try:
            f2.evaluate("() => { window.EJS_emulator.gameManager.functions.saveSaveFiles(); }")
        except Exception:
            s2b, f2b = read_stable(15000)
            if f2b: f2 = f2b
            f2.evaluate("() => { window.EJS_emulator.gameManager.functions.saveSaveFiles(); }")
        page.wait_for_timeout(500)
        s2_after, _ = read_stable(15000)
        result['s2_after_ram_flush'] = s2_after
        result['marker_in_session2_ram'] = ((s2_after or {}).get('file') or {}).get('n5a', 0) > 1000

        result['console_tail'] = console_lines[-80:]
        result['console_memcard'] = [l for l in console_lines if re.search(r'card|srm|save|mem|BIOS|SRAM', l, re.I)]
        ctx.close(); browser.close()
finally:
    server.shutdown(); server.server_close()
    (OUT/'persist-probe.json').write_text(json.dumps(result,indent=2,ensure_ascii=False))
print(json.dumps(result,indent=2,ensure_ascii=False)[:5000])
