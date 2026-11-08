"""Sonde RC-1.19bis — cycle de dechargement page REEL pour la carte memoire PS1.

Session 1 : boot ISO synthetique -> marqueur dans la carte RAM -> dispatch
'pagehide' (declenche autoSaveBattery : capture -> miroir localStorage
synchrone -> vault IndexedDB). On verifie que le miroir localStorage
contient le marqueur.

Puis on TUE IndexedDB pour simuler la pire issue de la course : on vide la
base 'emuperso-ps1-vault' avant la session 2 — le seul espoir de recuperation
est alors le miroir localStorage via newestBattery().

Session 2 (apres reload complet de la page) : re-boot -> verifier que le
marqueur est revenu en RAM malgre la base videe. Si oui : le filet
localStorage est une vraie voie de recuperation, pas du theatre.

Aucune ROM commerciale, aucun BIOS.
"""
import json, struct, threading, sys, io, os, re, time
from pathlib import Path
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from serve import Handler
OUT = ROOT / 'cache' / 'browser-unload' / 'logs'
OUT.mkdir(parents=True, exist_ok=True)
rom_path = str(ROOT / 'cache' / 'browser-persist' / 'synthetic-demo.iso')
if not Path(rom_path).exists():
    raise SystemExit('synthetic-demo.iso absent : lancer d abord browser_persist_probe.py')

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
  const b = rd();
  return { save_path: sp,
    n5a: b ? b.reduce((a,x)=>a+(x===0x5a?1:0),0) : 0 };
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
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        page.wait_for_function('window.__cheatController !== undefined')

        def engine_frame(timeout=90000):
            page.wait_for_function("document.getElementById('current').textContent !== 'Aucun'", timeout=timeout)
            for _ in range(400):
                for f in page.frames:
                    if f != page.main_frame:
                        try:
                            if f.evaluate("!!(window.EJS_emulator && window.EJS_emulator.gameManager && window.EJS_emulator.gameManager.FS)"):
                                return f
                        except Exception: pass
                page.wait_for_timeout(50)
            raise RuntimeError('iframe moteur introuvable')

        # ---------- Session 1 ----------
        page.locator('#disc-file').set_input_files(rom_path)
        page.wait_for_function("!document.getElementById('launch').disabled", timeout=20000)
        page.locator('#launch').click()
        f1 = engine_frame()
        page.wait_for_timeout(4000)
        f1.evaluate(f"""() => {{
          const gm = window.EJS_emulator.gameManager, FS = gm.FS;
          const marker = ({MARKER_JS})();
          FS.writeFile(gm.getSaveFilePath(), marker);
          gm.functions.loadSaveFiles();
        }}""")
        page.wait_for_timeout(400)
        result['s1_ram'] = f1.evaluate(READ_JS)

        # pagehide -> autoSaveBattery -> capture -> miroir LS + vault
        page.evaluate("() => window.dispatchEvent(new Event('pagehide'))")
        page.wait_for_timeout(2500)
        # Le miroir localStorage doit contenir le marqueur (cle emuperso-ps1-battery:*)
        ls = page.evaluate("""() => {
          const hits = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('emuperso-ps1-battery:')) {
              const v = JSON.parse(localStorage.getItem(k));
              hits.push({ key: k.slice(0, 60), utc: v.utc, b64len: (v.b64||'').length });
            }
          }
          return hits;
        }""")
        result['localstorage_mirror'] = ls
        # Verifier que le marqueur est bien dans le miroir (0x5a x ~4096)
        if ls:
            marker_in_ls = page.evaluate("""() => {
              for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k || !k.startsWith('emuperso-ps1-battery:')) continue;
                const v = JSON.parse(localStorage.getItem(k));
                const bin = atob(v.b64), bytes = new Uint8Array(bin.length);
                for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
                let n = 0; for (let j = 0; j < bytes.length; j++) if (bytes[j] === 0x5a) n++;
                return n;
              }
              return -1;
            }""")
            result['marker_in_localstorage'] = marker_in_ls

        # ---------- On TUE IndexedDB (simule la transaction avortee) ----------
        dbs = page.evaluate("""async () => {
          const list = await indexedDB.databases();
          const names = list.map(d => d.name).filter(Boolean);
          for (const n of names) { try { indexedDB.deleteDatabase(n); } catch(e){} }
          return names;
        }""")
        result['idb_deleted'] = dbs
        page.wait_for_timeout(800)

        # ---------- Session 2 : reload complet + re-boot ----------
        page.reload(wait_until='domcontentloaded')
        page.wait_for_function('window.__cheatController !== undefined')
        page.locator('#disc-file').set_input_files(rom_path)
        page.wait_for_function("!document.getElementById('launch').disabled", timeout=20000)
        page.locator('#launch').click()
        page.wait_for_function("document.getElementById('current').textContent !== 'Aucun'", timeout=120000)
        page.wait_for_timeout(5000)

        def read_stable(timeout=60000):
            deadline = time.time() + timeout
            while time.time() < deadline:
                for f in page.frames:
                    if f == page.main_frame: continue
                    try:
                        v = f.evaluate(READ_JS)
                        if v.get('save_path'): return v, f
                    except Exception: pass
                page.wait_for_timeout(500)
            return None, None

        s2_boot, f2 = read_stable()
        result['s2_boot'] = s2_boot
        if f2:
            f2.evaluate("() => { window.EJS_emulator.gameManager.functions.saveSaveFiles(); }")
            page.wait_for_timeout(500)
            s2_after, _ = read_stable(15000)
            result['s2_after_ram_flush'] = s2_after
            result['marker_in_session2_ram_despite_empty_idb'] = ((s2_after or {}).get('n5a') or 0) > 1000
        ctx.close(); browser.close()
finally:
    server.shutdown(); server.server_close()
    (OUT/'unload-probe.json').write_text(json.dumps(result,indent=2,ensure_ascii=False))
print(json.dumps(result,indent=2,ensure_ascii=False)[:6000])
