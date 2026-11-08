"""Sonde memcard PS1 : vrai Chromium + vrai cœur PCSX + ISO synthétique.
Après le boot, inspecte /data/saves/PCSX-ReARMed/ dans le MEMFS du moteur :
le .srm existe-t-il, quelle taille, est-il rempli de zeros ou contient-il
une vraie structure de carte mémoire PS1 ?
Aucune ROM commerciale, aucun BIOS.
"""
import json, struct, threading, sys, io, re
from pathlib import Path
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from serve import Handler
OUT = ROOT / 'cache' / 'browser-memcard' / 'logs'
OUT.mkdir(parents=True, exist_ok=True)

import os
ROM_ARG = sys.argv[1] if len(sys.argv) > 1 else None

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
rom_path = ROM_ARG or str(fixture)
if not ROM_ARG:
    import pycdlib
    iso = pycdlib.PyCdlib()
    iso.new(interchange_level=1, sys_ident='PLAYSTATION', vol_ident='EMUPERSO_SYNTH', app_ident_str='PLAYSTATION')
    cnf = b'BOOT = cdrom:\\DEMO.EXE;1\r\nTCB = 4\r\nEVENT = 10\r\nSTACK = 801fff00\r\n'
    iso.add_fp(io.BytesIO(cnf),len(cnf),iso_path='/SYSTEM.CNF;1')
    iso.add_fp(io.BytesIO(rom),len(rom),iso_path='/DEMO.EXE;1')
    iso.write(str(fixture)); iso.close()

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
        page.wait_for_function("!document.getElementById('launch').disabled", timeout=600000 if ROM_ARG else 20000)
        page.locator('#launch').click()
        if os.environ.get('PROBE_BLOCK_SRM'):
            # Bloque l'injection .srm : wrap writeFile dès que gameManager existe
            # dans l'iframe moteur, avant startGame. Simule un boot sans fichier carte.
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
            if not frame: raise RuntimeError('iframe moteur introuvable pour PROBE_BLOCK_SRM')
            frame.evaluate("""() => {
              const gm = window.EJS_emulator.gameManager;
              const orig = gm.writeFile.bind(gm);
              gm.writeFile = (p, d) => { if (/\\.srm$/i.test(String(p))) return; return orig(p, d); };
              window.__srmBlocked = true;
            }""")
        page.wait_for_function("document.getElementById('current').textContent !== 'Aucun'", timeout=600000 if ROM_ARG else 90000)
        frame = page.frames[1]
        # Laisse le jeu tourner : Future Cop vérifie la carte mémoire tôt.
        wait_s = int(os.environ.get('PROBE_WAIT', '25'))
        page.wait_for_timeout(wait_s * 1000)
        shot = OUT / 'game-screen.png'
        try:
            page.screenshot(path=str(shot))
            result['screenshot'] = str(shot)
        except Exception as e2:
            result['screenshot_error'] = str(e2)
        result['probe'] = frame.evaluate("""() => {
          const out = {};
          try {
            const gm = window.EJS_emulator.gameManager, FS = gm.FS;
            const ls = (path) => {
              try {
                const names = FS.readdir(path).filter(n => n !== '.' && n !== '..');
                return names.map(name => {
                  const p = path + '/' + name;
                  try {
                    const st = FS.stat(p);
                    if (FS.isDir(st.mode)) return { name, dir: true, ls: ls(p) };
                    const bytes = FS.readFile(p);
                    let nonzero = 0; const head = [];
                    for (let i = 0; i < bytes.length; i++) { if (bytes[i]) nonzero++; if (i < 64) head.push(bytes[i]); }
                    return { name, dir: false, size: bytes.length, nonzero_bytes: nonzero,
                             head_hex: head.map(b => b.toString(16).padStart(2, '0')).join('') };
                  } catch (e) { return { name, stat_error: String(e && e.message || e) }; }
                });
              } catch (e) { return { readdir_error: String(e && e.message || e), errno: e && e.errno }; }
            };
            out.saves_root = ls('/data/saves');
            out.pcsx_dir = ls('/data/saves/PCSX-ReARMed');
            out.data_dir = ls('/data');
          } catch (e) { out.error = String(e && e.message || e); out.error_json = JSON.stringify(e); }
          try {
            const opts = window.EJS_emulator.gameManager.getCoreOptions();
            out.memcard_options = String(opts).split('\\n').filter(l=>/memcard|srm|card/i.test(l));
          } catch (e) { out.options_error = String(e); }
          try { out.save_path = window.EJS_emulator.gameManager.getSaveFilePath?.(); } catch(e) {}
          return out;
        }""")
        result['capture'] = frame.evaluate("""() => {
          try { const b = window.PS1Engine.captureBattery?.(); return b ? { bytes: b.length,
            nonzero: Array.from(b).filter(x=>x).length,
            head_hex: Array.from(b.slice(0,64)).map(x=>x.toString(16).padStart(2,'0')).join(''),
            b64: (() => { let s=''; for (let i=0;i<b.length;i+=8192) s+=String.fromCharCode(...b.subarray(i,i+8192)); return btoa(s); })() } : null; }
          catch(e){ return { error: String(e) }; }
        }""")
        # Phase 2 : après le boot, demander au cœur de recharger ses fichiers de
        # sauvegarde (équivalent du bouton « charger sauvegarde » du moteur) et
        # voir si la carte devient visible pour le jeu.
        frame.evaluate("() => { try { window.EJS_emulator.gameManager.loadSaveFiles(); } catch(e){} }")
        page.wait_for_timeout(3000)
        result['probe2'] = frame.evaluate("""async () => {
          const out = {};
          const gm = window.EJS_emulator.gameManager, FS = gm.FS;
          const sp = gm.getSaveFilePath();
          out.save_path = sp;
          const rd = () => { try { return FS.readFile(sp); } catch(e){ return null; } };
          const hex = (b,n=16) => b ? Array.from(b.slice(0,n)).map(x=>x.toString(16).padStart(2,'0')).join('') : null;
          const count = (b,v) => b ? b.reduce((a,x)=>a+(x===v?1:0),0) : -1;
          const snap = () => { const b = rd(); return b ? { size: b.length, head: hex(b,8), n5a: count(b,0x5a), n4d: count(b,0x4d) } : null; };
          const nap = () => new Promise(r=>setTimeout(r,500));
          try {
            const before = snap();
            out.before_save = before;
            // 1) saveSaveFiles : la RAM -> fichier. Si le fichier change, l'écriture marche.
            gm.saveSaveFiles();
            await nap();
            const afterSave1 = snap();
            out.after_save1 = afterSave1;
            out.save_writes_memory = JSON.stringify(afterSave1) !== JSON.stringify(before);
            // 2) Marqueur dans le fichier -> loadSaveFiles -> saveSaveFiles.
            //    Si le marqueur revient dans le fichier, refresh_save_files charge fichier->RAM.
            const marker = new Uint8Array(131072);
            marker[0]=0x4d; marker[1]=0x43;
            for (let i=4096;i<8192;i++) marker[i]=0x5a;
            FS.writeFile(sp, marker);
            gm.loadSaveFiles();
            await nap();
            gm.saveSaveFiles();
            await nap();
            const after = snap();
            out.after_marker = after;
            out.marker_roundtrip = after && after.n5a > 1000;
          } catch(e) { out.roundtrip_error = String(e && e.message || e); }
          return out;
        }""")
        result['console_tail'] = console_lines[-200:]
        result['console_memcard'] = [l for l in console_lines if re.search(r'card|srm|save|mem', l, re.I)]
        browser.close()
finally:
    server.shutdown(); server.server_close()
    (OUT/'memcard-probe.json').write_text(json.dumps(result,indent=2,ensure_ascii=False))
print(json.dumps(result,indent=2,ensure_ascii=False)[:4000])
