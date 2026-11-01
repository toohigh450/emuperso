"""Real v0.4 UI/session/cheat/state integration, with the project's MIT ROM only.

The RAM marker is a controlled test input in unused diagnostic-ROM memory, never
an original save or commercial ROM. An independent code/framebuffer probe locates
actual live RDRAM for every session; its fallback restores a temporary unused-RAM
nonce in finally. Ambiguity fails the test.
"""
from pathlib import Path
import base64
import hashlib
import io
import json
import os
import sys
import tempfile
import threading
import zipfile
from http.server import ThreadingHTTPServer

from PIL import Image, ImageChops
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from serve import Handler

EVIDENCE = ROOT / 'evidence'
EVIDENCE.mkdir(exist_ok=True)
ROM = (ROOT / 'homebrew/fallback-open/demo-emuperso-open.z64').read_bytes()
VARIANT = bytearray(ROM)
VARIANT[0x3f] ^= 1  # Homebrew revision byte only: same owned code, different identity.
VARIANT = bytes(VARIANT)
SHA = hashlib.sha256(ROM).hexdigest()
VARIANT_SHA = hashlib.sha256(VARIANT).hexdigest()
URL = 'http://127.0.0.1:8776/'
RDRAM_BASE = 0
RAM_PROBE_SOURCE = (ROOT / 'tests/own_demo_ram_probe.js').read_text(encoding='utf-8')
ram_probes = []
MARKER_ADDRESS = 0x10000
MARKER_A, MARKER_B = 0x1357, 0x2468
results, requests, page_errors, dialogs = [], [], [], []

AUDIO_PROBE = r'''(() => {
  window.__hubAudio = [];
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    if (this.buffer) {
      const samples = this.buffer.getChannelData(0);
      const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
      window.__hubAudio.push({rms, frames: samples.length, sample_rate: this.buffer.sampleRate});
      if (window.__hubAudio.length > 2000) window.__hubAudio.shift();
    }
    return start.apply(this, args);
  };
})();'''


def ok(name, proof, status='RÉUSSI'):
    results.append({'test': name, 'status': status, 'proof': proof})
    print(status + ' — ' + name, flush=True)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def payload(name, data):
    return {'name': name, 'mimeType': 'application/octet-stream', 'buffer': data}


def zip_rom(name, data):
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(name, data)
    return out.getvalue()


def diagnostic(page):
    return page.evaluate('RealN64.diagnostic()')


def events(page, name):
    return page.evaluate('(name)=>RealN64.diagnostic().records.filter(record=>record.type===name)', name)


def wait_idle(page):
    page.wait_for_function('''()=> {
      const d = RealN64.diagnostic();
      return d.phase === 'started' && d.session.active?.started &&
        d.session.frame_count === 1 && d.session.candidate_generation === null &&
        !document.getElementById('state-save').disabled;
    }''', timeout=60000)


def wait_started(page, after_generation=0):
    global RDRAM_BASE
    page.wait_for_function('''previous => {
      const d = RealN64.diagnostic();
      return d.phase === 'started' && d.session.active_generation > previous &&
        d.session.active?.frame > 8 && d.session.frame_count === 1 &&
        d.session.candidate_generation === null;
    }''', arg=after_generation, timeout=60000)
    wait_idle(page)
    current = diagnostic(page)
    RDRAM_BASE = 0
    if current['identity']['rom_sha256'] == SHA:
        page.evaluate('(function(){' + RAM_PROBE_SOURCE + '\n})()')
        found = page.evaluate('''async()=> {
          const found = await findOwnDemoRam(); window.__hubRamProbe = found; return found;
        }''')
        assert found['rom_sha256'] == SHA
        assert found['base'] > 0
        method = found.get('identification_method')
        if method == 'framebuffer-alternation':
            assert 0xA0100000 in found['pointers'] and 0xA0140000 in found['pointers']
        else:
            # Fixed-interval samples can alias the double-buffer parity. Accept
            # the independent fallback only with a full native-state round trip,
            # never merely because the helper returned an address.
            assert method == 'native-state-nonce', found
            proof = found.get('native_proof')
            assert proof and proof['heap_base'] == found['base'], found
            assert proof['physical_address'] == 0x10010 and proof['byte_count'] == 8
            assert len(proof['nonce']) == len(proof['original']) == 8
            assert proof['nonce'] != proof['original']
            assert proof['native_before'] == proof['original']
            assert proof['positive_matches'] and proof['positive_echo'] == proof['nonce']
            assert proof['restoration_matches']
            assert proof['restored_heap'] == proof['restored_native'] == proof['original']
            for observation in [proof['positive_frames'], proof['restoration_frames']]:
                assert observation['after'] - observation['before'] >= 2
                assert observation['delta'] == observation['after'] - observation['before']
        RDRAM_BASE = found['base']
        ram_probes.append({'generation': current['session']['active_generation'], **found})


def event_action(page, selector, event_name, generation_change=False):
    before = len(events(page, event_name))
    old_generation = diagnostic(page)['session']['active_generation'] or 0
    old_errors = len(events(page, 'operation.failed'))
    page.locator(selector).click()
    page.wait_for_function('''({name, count, errors}) => {
      const rows = RealN64.diagnostic().records;
      return rows.filter(row=>row.type===name).length > count ||
        rows.filter(row=>row.type==='operation.failed').length > errors;
    }''', arg={'name': event_name, 'count': before, 'errors': old_errors}, timeout=60000)
    failures = events(page, 'operation.failed')
    assert len(failures) == old_errors, failures[-1] if failures else None
    if generation_change:
        wait_started(page, old_generation)
    else:
        wait_idle(page)
    return events(page, event_name)[-1]['data']


def select_rom(page, name, data, expected_sha):
    page.locator('#rom-file').set_input_files(payload(name, data))
    page.wait_for_function('sha=>RealN64.diagnostic().local_selection?.canonical_sha256===sha', arg=expected_sha)
    assert page.locator('#launch-local').is_enabled()


def read_marker(page):
    assert RDRAM_BASE > 0, 'Independent live RDRAM probe is missing; no fabricated state validation.'
    return page.evaluate('''address => {
      const bytes = ownDemoReadBytes(address, 2); return (bytes[0] << 8) | bytes[1];
    }''', MARKER_ADDRESS)


def write_marker(page, value):
    assert RDRAM_BASE > 0, 'Independent live RDRAM probe is missing.'
    page.evaluate('''({address, value}) => {
      const heap = RealN64.engineWindow.EJS_emulator.Module.HEAPU8;
      const {base, wordSwapped} = window.__hubRamProbe;
      if (!Number.isSafeInteger(base) || base <= 0 || base + 0x800000 > heap.length)
        throw new Error('Independent RDRAM probe is outside the real Wasm heap.');
      heap[base + (wordSwapped ? address ^ 3 : address)] = value >>> 8;
      heap[base + (wordSwapped ? (address + 1) ^ 3 : address + 1)] = value & 255;
    }''', {'address': MARKER_ADDRESS, 'value': value})
    assert read_marker(page) == value


def wait_marker(page, value):
    page.wait_for_function('''({address, value}) => {
      const bytes = ownDemoReadBytes(address, 2); return ((bytes[0] << 8) | bytes[1]) === value;
    }''', arg={'address': MARKER_ADDRESS, 'value': value}, timeout=10000)


def battery_hash(page):
    return page.evaluate('''async()=> {
      const bytes = RealN64.engineWindow.N64Engine.captureBattery();
      if (!bytes) return null;
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map(byte=>byte.toString(16).padStart(2,'0')).join('');
      return {bytes:bytes.length, sha256:hash};
    }''')


def capture_canvas(page, name):
    canvas = page.frame_locator('iframe.engine-frame').locator('canvas').first
    raw = canvas.screenshot(path=str(EVIDENCE / name))
    return canvas, Image.open(io.BytesIO(raw)).convert('RGB')


def prove_audio(page, label):
    page.locator('#audio').click()
    wait_idle(page)
    canvas = page.frame_locator('iframe.engine-frame').locator('canvas').first
    canvas.click()
    page.evaluate('RealN64.engineWindow.__hubAudio=[]')
    page.keyboard.down('x')
    page.wait_for_timeout(1500)
    tone = page.evaluate('RealN64.engineWindow.__hubAudio')
    page.keyboard.up('x')
    page.wait_for_timeout(800)
    page.evaluate('RealN64.engineWindow.__hubAudio=[]')
    page.wait_for_timeout(700)
    released = page.evaluate('RealN64.engineWindow.__hubAudio')
    tone_max = max((row['rms'] for row in tone), default=0)
    released_max = max((row['rms'] for row in released), default=0)
    assert tone and tone_max > 0.001, {'label': label, 'buffers': len(tone), 'rms': tone_max}
    assert released and released_max < 0.001, {'label': label, 'buffers': len(released), 'rms': released_max}
    before = page.evaluate('EJS_emulator.gameManager.getFrameNum()')
    page.wait_for_timeout(1000)
    after = page.evaluate('EJS_emulator.gameManager.getFrameNum()')
    assert 0 < after - before <= 120, {'before': before, 'after': after}
    return {'tone_max_rms': tone_max, 'released_max_rms': released_max,
            'frame_delta_per_observed_second': after - before, 'physical_speakers': 'NON TESTABLE'}


def add_manual(page, name, code):
    page.wait_for_function('()=>!document.getElementById("cheat-status").textContent.includes("Recherche des codes")')
    if page.locator('#manual-cheats').get_attribute('open') is None:
        page.locator('#manual-cheats summary').click()
    page.locator('#cheat-manual-name').fill(name)
    page.locator('#cheat-manual-code').fill(code)
    page.locator('#cheat-add').click()
    wait_idle(page)
    checkbox = page.locator('#cheat-list label').filter(has_text=name).locator('input[type=checkbox]')
    assert checkbox.count() == 1
    return checkbox


class AuditHandler(Handler):
    seen = []

    def do_GET(self):
        self.seen.append((self.command, self.path, int(self.headers.get('Content-Length', '0'))))
        super().do_GET()

    def do_POST(self):
        self.seen.append((self.command, self.path, int(self.headers.get('Content-Length', '0'))))
        self.send_error(405)

    def do_PUT(self):
        self.do_POST()


server = ThreadingHTTPServer(('127.0.0.1', 8776), AuditHandler)
threading.Thread(target=server.serve_forever, daemon=True).start()
context = page = None
saved_state_hash = saved_previous_hash = None
try:
    with tempfile.TemporaryDirectory(prefix='n64-hub-owned-mit-') as profile, sync_playwright() as pw:
        def launch_context():
            ctx = pw.chromium.launch_persistent_context(
                user_data_dir=profile,
                executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'),
                headless=True, accept_downloads=True, viewport={'width': 1280, 'height': 1050},
                args=['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
            )
            ctx.add_init_script(AUDIO_PROBE)
            ctx.on('request', lambda req: requests.append({'url': req.url, 'method': req.method,
                                                         'body_bytes': len(req.post_data_buffer or b'')}))
            return ctx

        def new_page(ctx):
            p = ctx.new_page()
            p.on('pageerror', lambda error: page_errors.append(str(error)))
            p.on('dialog', lambda dialog: (dialogs.append(dialog.message), dialog.accept()))
            p.goto(URL)
            p.wait_for_function('()=>!!window.RealN64')
            return p

        context = launch_context()
        page = new_page(context)
        select_rom(page, 'same-name.z64', ROM, SHA)
        page.locator('#launch-local').click()
        wait_started(page)
        identity = diagnostic(page)['identity']
        assert identity['rom_sha256'] == SHA
        assert len(identity['engine_sha256']) == 64 and len(identity['config_sha256']) == 64
        assert diagnostic(page)['session']['frame_count'] == 1
        actual = page.evaluate('''async()=> {
          const e = EJS_emulator, bytes = e.gameManager.FS.readFile(e.fileName);
          return {bytes:bytes.length, sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
            .map(x=>x.toString(16).padStart(2,'0')).join('')};
        }''')
        assert actual['sha256'] == SHA
        canvas, first = capture_canvas(page, 'hub-first.png')
        before = page.evaluate('EJS_emulator.gameManager.getFrameNum()')
        page.wait_for_timeout(700)
        _, later = capture_canvas(page, 'hub-animation.png')
        after = page.evaluate('EJS_emulator.gameManager.getFrameNum()')
        assert after > before and ImageChops.difference(first, later).getbbox() is not None
        assert len(first.getcolors(first.width * first.height)) >= 2
        assert diagnostic(page)['cheats']['active'] == []
        ok('Session réelle isolée, identité des octets et animation', {
            'identity': identity, 'loaded': actual, 'frame_before': before, 'frame_after': after,
            'iframe_count': 1, 'cheats_active_by_default': 0,
        })

        guard_before = diagnostic(page)['session']['active_generation']
        blocked = page.evaluate('''()=>{
          const w=RealN64.engineWindow,g=EJS_emulator.gameManager,options=g.getCoreOptions();
          const wrapper=g.loadState(new Uint8Array([1,2,3,4]));
          const transfer=new w.DataTransfer(); transfer.items.add(new w.File([new Uint8Array([1,2,3,4])],'invalid-fixture.state'));
          w.document.getElementById('game').dispatchEvent(new w.DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
          g.setVariable('mupen64plus-cpucore','cached_interpreter');
          return {wrapper,configuration_unchanged:g.getCoreOptions()===options};
        }''')
        assert blocked == {'wrapper': False, 'configuration_unchanged': True}
        assert diagnostic(page)['session']['active_generation'] == guard_before
        assert len(events(page, 'state.unguarded.blocked')) >= 2
        assert events(page, 'config.change.blocked')
        ok('Chargements directs non vérifiés et changement de configuration bloqués', blocked)

        before = diagnostic(page)
        count = len(events(page, 'rom.local.rejected'))
        page.locator('#rom-file').set_input_files(payload('fixture-invalid-active.zip', b'PK' + bytes(4094)))
        page.wait_for_function('n=>RealN64.diagnostic().records.filter(r=>r.type==="rom.local.rejected").length>n', arg=count)
        page.wait_for_timeout(500)
        retained = diagnostic(page)
        assert retained['identity'] == before['identity']
        assert retained['session']['active_generation'] == before['session']['active_generation']
        assert retained['session']['active']['frame'] > before['session']['active']['frame']
        assert retained['session']['frame_count'] == 1
        assert page.locator('#launch-local').is_disabled()
        ok('Import invalide pendant le jeu : session et progression conservées', {
            'generation': retained['session']['active_generation'], 'rom_sha256': SHA,
        })

        # Test-only RDRAM marker, independently located in the pinned real core.
        assert read_marker(page) == 0
        write_marker(page, MARKER_A)
        assert page.locator('#save-slot option').evaluate_all('(rows)=>rows.map(row=>row.value)') == ['1', '2', '3']
        page.locator('#save-slot').select_option('1')
        first_saved = event_action(page, '#state-save', 'state.saved')
        saved_previous_hash = first_saved['payload_sha256']
        write_marker(page, MARKER_B)
        second_saved = event_action(page, '#state-save', 'state.saved')
        saved_state_hash = second_saved['payload_sha256']
        assert saved_state_hash != saved_previous_hash
        for slot in (2, 3):
            page.locator('#save-slot').select_option(str(slot))
            event_action(page, '#state-save', 'state.saved')
        page.locator('#save-slot').select_option('1')
        slots = diagnostic(page)['saves']
        assert [row['slot'] for row in slots] == [1, 2, 3]
        assert slots[0]['revision'] == 2 and slots[0]['has_previous'] is True
        ok('Trois emplacements réels, empreintes et révision précédente', {
            'slots': slots, 'current_payload_sha256': saved_state_hash,
            'previous_payload_sha256': saved_previous_hash,
        })

        native_before = battery_hash(page)
        if native_before:
            saved_native = event_action(page, '#battery-save', 'battery.saved')
            assert saved_native['bytes'] == native_before['bytes']
            assert saved_native['payload_sha256'] == native_before['sha256']
            ok('Capture de la sauvegarde native réellement fournie par le cœur', native_before)
        else:
            page.locator('#battery-save').click()
            wait_idle(page)
            expect(page.locator('#save-status')).to_contain_text('pas encore produit')
            ok('Sauvegarde native de la démo', {
                'reason': 'Le cœur ne fournit aucun contenu natif pour cette démo ; message UI vérifié.',
                'native_preservation_claim': False,
            }, status='NON TESTABLE')

        with page.expect_download() as download:
            page.locator('#save-export').click()
        exported_state = json.loads(Path(download.value.path()).read_text())
        state_bytes = base64.b64decode(exported_state['payload_base64'], validate=True)
        assert exported_state['kind'] == 'state' and exported_state['identity'] == identity
        assert digest(state_bytes) == exported_state['payload_sha256'] == saved_state_hash
        assert len(state_bytes) == exported_state['payload_size']
        assert state_bytes[:4] not in (bytes.fromhex('80371240'), bytes.fromhex('37804012'), bytes.fromhex('40123780'))
        assert 'rom_bytes' not in exported_state and 'rom_base64' not in exported_state
        wait_idle(page)
        ok('Export utilisateur d’un véritable état intègre, copie privée de la mémoire du jeu', {
            'payload_size': len(state_bytes), 'payload_sha256': digest(state_bytes),
            'download_name': download.value.suggested_filename,
        })

        before_import = diagnostic(page)
        marker_before_import = read_marker(page)
        page.locator('#save-slot').select_option('3')
        imported_before = len(events(page, 'state.imported'))
        with page.expect_file_chooser() as chooser:
            page.locator('#save-import').click()
        # Represent an autosave that starts while the OS picker is open. The
        # first actual native-save digest is held, not replaced or fabricated.
        # The file event must queue until that write finishes, rather than vanish.
        page.evaluate('''()=>{
          const subtle=crypto.subtle,original=subtle.digest;
          window.__hubImportGate={blocked:false,release:null,original};
          subtle.digest=function(...args){
            const actual=original.apply(this,args),gate=window.__hubImportGate;
            if(!gate.blocked){gate.blocked=true;return Promise.all([actual,new Promise(resolve=>{gate.release=resolve;})]).then(([bytes])=>bytes);}
            return actual;
          };
          document.querySelector('#battery-save').click();
        }''')
        page.wait_for_function('()=>window.__hubImportGate.blocked')
        queued_before=len(events(page,'state.import.queued'))
        chooser.value.set_files(payload('fixture-owned-state-valid.json', json.dumps(exported_state).encode('utf-8')))
        page.wait_for_function('n=>RealN64.diagnostic().records.filter(r=>r.type==="state.import.queued").length>n',arg=queued_before)
        page.evaluate('()=>{crypto.subtle.digest=window.__hubImportGate.original;window.__hubImportGate.release();}')
        try:
            page.wait_for_function('n=>RealN64.diagnostic().records.filter(r=>r.type==="state.imported").length>n', arg=imported_before, timeout=60000)
        except Exception:
            (EVIDENCE/'hub-failure-diagnostic.json').write_text(json.dumps(diagnostic(page),ensure_ascii=False,indent=2),encoding='utf-8')
            raise
        wait_idle(page)
        imported = events(page, 'state.imported')[-1]['data']
        assert imported['slot'] == 3 and imported['payload_sha256'] == saved_state_hash
        assert diagnostic(page)['session']['active_generation'] == before_import['session']['active_generation']
        assert read_marker(page) == marker_before_import
        after_valid_import = diagnostic(page)['saves']
        assert next(row for row in after_valid_import if row['slot'] == 3)['revision'] == 2
        invalid_state = dict(exported_state)
        invalid_state['payload_sha256'] = '0' * 64
        failures_before = len(events(page, 'operation.failed'))
        page.locator('#save-import-file').set_input_files(payload('fixture-owned-state-bad-hash.json', json.dumps(invalid_state).encode('utf-8')))
        page.wait_for_function('n=>RealN64.diagnostic().records.filter(r=>r.type==="operation.failed").length>n', arg=failures_before, timeout=60000)
        wait_idle(page)
        assert events(page, 'operation.failed')[-1]['data']['code'] == 'E_INTEGRITY'
        assert diagnostic(page)['saves'] == after_valid_import
        assert diagnostic(page)['session']['active_generation'] == before_import['session']['active_generation']
        assert read_marker(page) == marker_before_import
        page.locator('#save-slot').select_option('1')
        ok('Import d’état vérifié : aucun lancement implicite, checksum altéré refusé sans écrasement', {
            'imported_payload_sha256': imported['payload_sha256'], 'target_slot': 3,
            'bad_checksum_rejected': True, 'live_ram_unchanged': marker_before_import,
        })

        # Same filename, a different owned ROM hash: state namespace must differ.
        old = diagnostic(page)
        page.evaluate('window.__oldManager=EJS_emulator.gameManager;window.__oldFrame=document.querySelector("iframe.engine-frame")')
        select_rom(page, 'same-name.z64', VARIANT, VARIANT_SHA)
        assert diagnostic(page)['identity'] == identity  # selection alone cannot stop the active ROM
        assert diagnostic(page)['session']['active_generation'] == old['session']['active_generation']
        event_action(page, '#launch-local', 'session.committed', generation_change=True)
        switched = diagnostic(page)
        assert switched['identity']['rom_sha256'] == VARIANT_SHA
        assert switched['active_rom']['name'] == 'same-name.z64'
        assert switched['saves'] == []
        assert switched['session']['disposed'] > old['session']['disposed']
        assert page.evaluate('window.__oldFrame.isConnected') is False
        old_counter = page.evaluate('__oldManager.getFrameNum()')
        page.wait_for_timeout(500)
        assert page.evaluate('__oldManager.getFrameNum()') == old_counter
        disposed = events(page, 'session.disposed')[-1]['data']
        assert disposed['timeout'] is False
        assert disposed['audio'], 'No real old AudioContext observed; cannot claim its closure.'
        assert all(row['state'] == 'closed' for row in disposed['audio'])
        errors_before = len(events(page, 'operation.failed'))
        page.locator('#state-load').click()
        page.wait_for_function('n=>RealN64.diagnostic().records.filter(r=>r.type==="operation.failed").length>n', arg=errors_before)
        wait_idle(page)
        assert events(page, 'operation.failed')[-1]['data']['code'] == 'E_EMPTY'
        assert diagnostic(page)['identity']['rom_sha256'] == VARIANT_SHA
        ok('Changement en cours de jeu : ancienne boucle arrêtée, audio fermé, sauvegardes isolées par hash', {
            'old_identity': identity, 'new_identity': switched['identity'],
            'same_filename': 'same-name.z64', 'disposed': disposed, 'old_counter_stable': old_counter,
        })

        select_rom(page, 'fixture-return-owned.zip', zip_rom('renamed-return.z64', ROM), SHA)
        event_action(page, '#launch-local', 'session.committed', generation_change=True)
        assert diagnostic(page)['identity'] == identity
        assert len(diagnostic(page)['saves']) == 3
        ok('Retour par ZIP au même contenu : les trois états restent retrouvables', {
            'rom_sha256': SHA, 'source': diagnostic(page)['active_rom']['source'],
            'slots': [row['slot'] for row in diagnostic(page)['saves']],
        })

        # Close the actual Chromium process, then reopen its profile.
        context.close()
        context = None
        context = launch_context()
        page = new_page(context)
        assert diagnostic(page)['active_rom'] is None
        assert diagnostic(page)['session']['frame_count'] == 0
        assert page.locator('#launch-local').is_disabled()
        hostile_name = '<img src=x onerror=window.__hubFilename=1>.z64'
        select_rom(page, hostile_name, ROM, SHA)
        assert page.locator('#rom-name').inner_text() == hostile_name
        assert page.locator('#rom-name img').count() == 0
        assert page.evaluate('window.__hubFilename??null') is None
        page.locator('#launch-local').click()
        wait_started(page)
        assert diagnostic(page)['identity'] == identity
        assert [row['slot'] for row in diagnostic(page)['saves']] == [1, 2, 3]
        page.locator('#save-slot').select_option('1')
        loaded = event_action(page, '#state-load', 'state.loaded', generation_change=True)
        assert loaded['payload_sha256'] == saved_state_hash
        wait_marker(page, MARKER_B)
        audio_after_load = prove_audio(page, 'after-full-browser-restart-and-state-load')
        ok('Fermeture/réouverture Chromium : vrai état restauré, RAM et audio vérifiés', {
            'identity': identity, 'payload_sha256': loaded['payload_sha256'],
            'ram_marker': read_marker(page), 'audio': audio_after_load,
            'rom_reselected_by_user': True, 'filename_treated_as_text': True,
        })

        loaded_previous = event_action(page, '#state-previous', 'state.loaded', generation_change=True)
        assert loaded_previous['previous'] is True
        assert loaded_previous['payload_sha256'] == saved_previous_hash
        wait_marker(page, MARKER_A)
        assert diagnostic(page)['saves'][0]['revision'] == 2
        ok('Récupération de la version précédente : ancien contenu RAM réellement restauré', {
            'marker': read_marker(page), 'payload_sha256': saved_previous_hash,
            'current_slot_revision_preserved': 2,
        })

        # A manual code is first added disabled, and its label must remain text.
        page.wait_for_function('()=>!document.getElementById("cheat-status").textContent.includes("Recherche des codes")')
        assert diagnostic(page)['cheats']['active'] == []
        page.locator('#cheat-search').fill('fixture-no-catalog-match-zzzz')
        assert diagnostic(page)['cheats']['active'] == []
        page.locator('#cheat-search').fill('')
        if page.locator('#manual-cheats').get_attribute('open') is None:
            page.locator('#manual-cheats summary').click()
        old_failures = len(events(page, 'operation.failed'))
        old_cheat_rows = page.locator('#cheat-list label').count()
        page.locator('#cheat-manual-name').fill('Fixture de code interdit')
        page.locator('#cheat-manual-code').fill('F1000000 1234')
        page.locator('#cheat-add').click()
        page.wait_for_function('n=>RealN64.diagnostic().records.filter(r=>r.type==="operation.failed").length>n', arg=old_failures)
        wait_idle(page)
        assert page.locator('#cheat-list label').count() == old_cheat_rows
        assert diagnostic(page)['cheats']['active'] == []
        assert read_marker(page) == MARKER_A
        malicious_cheat_name = '<img src=x onerror=window.__hubCheatName=1>'
        checkbox = add_manual(page, malicious_cheat_name, '81010000 A1B2')
        assert not checkbox.is_checked()
        assert diagnostic(page)['cheats']['active'] == []
        assert page.locator('#cheat-list img').count() == 0
        assert page.evaluate('window.__hubCheatName??null') is None
        assert read_marker(page) == MARKER_A
        ok('Catalogue/recherche sans activation implicite et ajout manuel désactivé', {
            'manual_label_treated_as_text': True, 'active_cheats': 0,
            'ram_marker_unchanged': MARKER_A, 'unsupported_manual_code_rejected_before_activation': True,
        })

        before_checkpoint_slots = diagnostic(page)['saves']
        native_pre_cheat = battery_hash(page)
        old_changed = len(events(page, 'cheats.changed'))
        page.wait_for_function('()=>EJS_emulator.gameManager.getFrameNum()>95', timeout=15000)
        checkbox.check()
        page.wait_for_function('n=>RealN64.diagnostic().records.filter(r=>r.type==="cheats.changed").length>n', arg=old_changed)
        wait_idle(page)
        wait_marker(page, 0xA1B2)
        assert len(diagnostic(page)['cheats']['active']) == 1
        assert diagnostic(page)['cheats']['tainted'] is True
        assert events(page, 'cheats.checkpoint.saved')
        event_action(page, '#cheat-disable-all', 'cheats.changed')
        page.wait_for_timeout(400)
        assert diagnostic(page)['cheats']['active'] == []
        assert diagnostic(page)['cheats']['tainted'] is True
        assert read_marker(page) == 0xA1B2
        ok('GameShark appliqué au vrai cœur ; désactiver ne prétend pas nettoyer la RAM', {
            'code': '81010000 A1B2', 'observed_ram': read_marker(page),
            'active_after_disable': 0, 'tainted_after_disable': True,
        })

        event_action(page, '#reset-before-cheats', 'cheats.reset.before', generation_change=True)
        wait_marker(page, MARKER_A)
        assert diagnostic(page)['cheats'] == {'active': [], 'tainted': False}
        assert diagnostic(page)['saves'] == before_checkpoint_slots
        native_after_checkpoint = battery_hash(page)
        if native_pre_cheat:
            assert native_after_checkpoint == native_pre_cheat
        ok('Point d’avant cheats : mémoire restaurée, états utilisateur intacts', {
            'ram_marker': read_marker(page), 'native_before': native_pre_cheat,
            'native_after': native_after_checkpoint, 'user_slots_preserved': True,
        })

        checkbox = add_manual(page, 'Fixture pour reset propre', '81010000 C3D4')
        old_changed = len(events(page, 'cheats.changed'))
        page.wait_for_function('()=>EJS_emulator.gameManager.getFrameNum()>95', timeout=15000)
        checkbox.check()
        page.wait_for_function('n=>RealN64.diagnostic().records.filter(r=>r.type==="cheats.changed").length>n', arg=old_changed)
        wait_idle(page)
        wait_marker(page, 0xC3D4)
        native_before_reset = battery_hash(page)
        event_action(page, '#reset-clean', 'cheats.reset.clean', generation_change=True)
        wait_marker(page, 0)
        assert diagnostic(page)['cheats'] == {'active': [], 'tainted': False}
        assert diagnostic(page)['saves'] == before_checkpoint_slots
        if native_before_reset:
            assert battery_hash(page) == native_before_reset
        audio_after_reset = prove_audio(page, 'after-clean-cold-reset')
        ok('Reset propre : nouvelle RAM sans cheats, sauvegardes conservées et audio actif', {
            'ram_marker': read_marker(page), 'native_before': native_before_reset,
            'native_after': battery_hash(page), 'audio': audio_after_reset,
        })

        # Inject latency around real file I/O and real SHA operations to reproduce
        # preparation completing during another real asynchronous save operation.
        page.evaluate('''()=>{
          window.__raceRead=File.prototype.arrayBuffer;
          window.__raceDigest=crypto.subtle.digest;
          File.prototype.arrayBuffer=async function(){await new Promise(r=>setTimeout(r,100));return __raceRead.call(this);};
          crypto.subtle.digest=async function(...args){await new Promise(r=>setTimeout(r,250));return __raceDigest.apply(this,args);};
        }''')
        old_saved = len(events(page, 'state.saved'))
        page.locator('#rom-file').set_input_files(payload('fixture-race-preparation.z64', ROM))
        page.locator('#state-save').click()
        page.wait_for_function('()=>RealN64.diagnostic().local_selection?.name==="fixture-race-preparation.z64"', timeout=15000)
        page.wait_for_function('n=>RealN64.diagnostic().records.filter(r=>r.type==="state.saved").length>n', arg=old_saved, timeout=30000)
        wait_idle(page)
        assert page.locator('#launch-local').is_enabled()
        page.evaluate('''()=>{File.prototype.arrayBuffer=__raceRead;crypto.subtle.digest=__raceDigest;}''')
        ok('Lecture de ROM pendant une sauvegarde : résultat conservé, aucune attente bloquée', {'selected': 'fixture-race-preparation.z64'})

        # Both export actions are explicit local Blob downloads. Diagnostic carries
        # only metadata, never a state payload or raw cartridge bytes.
        if not page.locator('#export').is_visible():
            page.locator('details').filter(has=page.locator('#export')).locator('summary').click()
        with page.expect_download() as download:
            page.locator('#export').click()
        print('DIAGNOSTIC_DOWNLOAD', download.value.suggested_filename, 'page_closed', page.is_closed(), flush=True)
        exported = json.loads(Path(download.value.path()).read_text())
        serialized = json.dumps(exported)
        assert exported['identity'] == identity
        assert 'payload_base64' not in serialized
        assert base64.b64encode(ROM).decode() not in serialized
        assert all('payload' not in row and row['payload_verified'] is False for row in exported['saves'])
        for width in (390, 1280):
            page.set_viewport_size({'width': width, 'height': 1050})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.screenshot(path=str(EVIDENCE / 'hub-final.png'), full_page=True)
        assert not page_errors, page_errors
        http = [req for req in requests if req['url'].startswith(('http:', 'https:'))]
        assert all(req['method'] == 'GET' and req['body_bytes'] == 0 and req['url'].startswith(URL) for req in http), http
        assert not any('fixture-' in req['url'] or 'same-name' in req['url'] or SHA in req['url'] or VARIANT_SHA in req['url'] for req in http)
        assert all(method == 'GET' and length == 0 for method, path, length in AuditHandler.seen)
        ok('Diagnostics et confidentialité : aucune ROM/sauvegarde envoyée', {
            'http_requests': len(http), 'diagnostic_contains_save_payload': False,
            'page_errors': page_errors, 'private_rom_used': False,
        })
        context.close()
        context = None
except Exception as error:
    ok('Parcours du hub interrompu', {'error': str(error)}, status='ÉCHOUÉ')
    if page is not None:
        try:
            page.screenshot(path=str(EVIDENCE / 'hub-failure.png'), full_page=True)
            (EVIDENCE / 'hub-failure-diagnostic.json').write_text(json.dumps(diagnostic(page), ensure_ascii=False, indent=2), encoding='utf-8')
        except Exception:
            pass
    raise
finally:
    if context is not None:
        try:
            context.close()
        except Exception:
            pass  # Playwright's context manager already closed it on failure.
    server.shutdown()
    server.server_close()
    report = {
        'schema': 'emuperso/hub-browser-tests/v1', 'results': results, 'page_errors': page_errors,
        'http': requests, 'dialogs_accepted_by_test': dialogs, 'server_requests': AuditHandler.seen,
        'rdram_probe': {'sessions': ram_probes, 'physical_marker_address': MARKER_ADDRESS},
        'scope': 'Owned MIT diagnostic ROM, revision-byte variant and own ZIP only. No commercial ROM or original save.',
        'non_testables': ['Chrome on Karl PC', 'Physical gamepad', 'Physical speakers', 'Commercial games'],
    }
    (EVIDENCE / 'tests-hub-browser.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('TOTAL', len(results), 'contrôles hub navigateur', flush=True)
