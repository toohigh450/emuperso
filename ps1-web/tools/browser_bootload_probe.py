"""Sonde boot-load memcard PS1 : le .srm injecte au boot atteint-il la RAM
Mcd1Data SANS appel manuel a refresh_save_files ?

 Methode :
 1. wrap gameManager.writeFile : tout .srm recu est remplace par un marqueur
    connnu (0x4d 0x43 'MC' + zone 0x5a a l'offset 4096) au moment de l'injection.
 2. wrap functions.loadSaveFiles / saveSaveFiles pour compter les appels natifs.
 3. Apres le boot (aucun appel manuel), saveSaveFiles() ecrit RAM->fichier :
    si le marqueur est toujours dans le fichier, le coeur l'a charge en RAM
    au demarrage. Sinon la RAM contenait une carte vierge -> le .srm n'est
    JAMAIS charge au boot -> les sauvegardes ne survivent pas au redemarrage.
Aucune ROM commerciale, aucun BIOS.
"""
import json, struct, threading, sys, io, os, re
from pathlib import Path
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from serve import Handler
OUT = ROOT / 'cache' / 'browser-bootload' / 'logs'
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

server = ThreadingHTTPServer(('127.0.0.1',0), Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
result = {'errors': []}
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not os.environ.get('PROBE_HEADED'),
            args=['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'])
        page = browser.new_page()
        page.on('pageerror', lambda e: result['errors'].append(str(e)))
        console_lines = []
        page.on('console', lambda m: console_lines.append(f'{m.type}: {m.text}'))
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        page.wait_for_function('window.__cheatController !== undefined')
        page.locator('#disc-file').set_input_files(rom_path)
        page.wait_for_function("!document.getElementById('launch').disabled", timeout=20000)
        page.locator('#launch').click()
        # Attend que gameManager + FS existent dans l'iframe moteur.
        frame = None
        for _ in range(2400):
            for f in page.frames:
                if f != page.main_frame:
                    try:
                        if f.evaluate("!!(window.EJS_emulator && window.EJS_emulator.gameManager && window.EJS_emulator.gameManager.FS)"):
                            frame = f; break
                    except Exception:
                        pass
            if frame: break
            page.wait_for_timeout(50)
        if not frame: raise RuntimeError('iframe moteur introuvable')
        # Injecte le marqueur : tout .srm ecrit passe par writeFile ; on le
        # remplace par un contenu connu, puis on compte les appels natifs.
        frame.evaluate("""() => {
          const gm = window.EJS_emulator.gameManager;
          window.__calls = { refresh: 0, savefiles: 0, srm_writes: [] };
          const origW = gm.writeFile.bind(gm);
          gm.writeFile = (p, d) => {
            if (/\\.srm$/i.test(String(p))) {
              const marker = new Uint8Array(131072);
              marker[0]=0x4d; marker[1]=0x43;
              for (let i=4096;i<8192;i++) marker[i]=0x5a;
              window.__calls.srm_writes.push(String(p));
              return origW(p, marker);
            }
            return origW(p, d);
          };
          const of = gm.functions.loadSaveFiles, os = gm.functions.saveSaveFiles;
          gm.functions.loadSaveFiles = (...a) => { window.__calls.refresh++; return of(...a); };
          gm.functions.saveSaveFiles = (...a) => { window.__calls.savefiles++; return os(...a); };
        }""")
        page.wait_for_function("document.getElementById('current').textContent !== 'Aucun'", timeout=90000)
        page.wait_for_timeout(5000)
        result['probe'] = frame.evaluate("""() => {
          const out = {};
          const gm = window.EJS_emulator.gameManager, FS = gm.FS;
          const sp = gm.getSaveFilePath();
          out.save_path = sp;
          out.calls = window.__calls;
          const rd = () => { try { return FS.readFile(sp); } catch(e){ return null; } };
          const snap = (b) => b ? {
            size: b.length,
            head: Array.from(b.slice(0,8)).map(x=>x.toString(16).padStart(2,'0')).join(''),
            n5a: b.reduce((a,x)=>a+(x===0x5a?1:0),0),
            n_mc_hdr: (b[0]===0x4d && b[1]===0x43) ? 1 : 0,
          } : null;
          try {
            const before = rd();
            out.file_before_flush = snap(before);
            // RAM -> fichier SANS refresh prealable : si le marqueur injecte
            // au boot avait ete charge en RAM, il reapparait ici.
            gm.saveSaveFiles();
            const after = rd();
            out.file_after_ram_to_disk = snap(after);
            out.marker_survived_boot = !!(after && after.n5a > 1000);
            out.boot_loaded_srm_into_ram = out.marker_survived_boot;
            // Controle : refresh manuel -> le marqueur doit revenir si le
            // fichier contient encore le marqueur (il a ete ecrase par le
            // flush ci-dessus, donc on re-ecrit le marqueur d'abord).
            const marker = new Uint8Array(131072);
            marker[0]=0x4d; marker[1]=0x43;
            for (let i=4096;i<8192;i++) marker[i]=0x5a;
            FS.writeFile(sp, marker);
            gm.functions.loadSaveFiles();
            gm.functions.saveSaveFiles();
            const ctl = rd();
            out.manual_refresh_roundtrip = snap(ctl)?.n5a > 1000;
          } catch(e) { out.error = String(e && e.message || e); }
          return out;
        }""")
        result['console_tail'] = console_lines[-100:]
        result['console_memcard'] = [l for l in console_lines if re.search(r'card|srm|save|mem|BIOS', l, re.I)]
        browser.close()
finally:
    server.shutdown(); server.server_close()
    (OUT/'bootload-probe.json').write_text(json.dumps(result,indent=2,ensure_ascii=False))
print(json.dumps(result,indent=2,ensure_ascii=False)[:4000])
