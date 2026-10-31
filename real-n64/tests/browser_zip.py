"""ZIP import integration with real Chromium/core; only the project's MIT ROM.

ZIP files are generated in memory. No user ROM is read, written or uploaded.
"""
from pathlib import Path
import base64
import hashlib
import io
import json
import os
import struct
import sys
import threading
import zipfile
from http.server import ThreadingHTTPServer

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from serve import Handler

EVIDENCE = ROOT / 'evidence'
EVIDENCE.mkdir(exist_ok=True)
ROM = (ROOT / 'homebrew/fallback-open/demo-emuperso-open.z64').read_bytes()
SHA = hashlib.sha256(ROM).hexdigest()
URL = 'http://127.0.0.1:8772/'
results, requests, page_errors = [], [], []


def ok(name, proof):
    results.append({'test': name, 'status': 'RÉUSSI', 'proof': proof})
    print('RÉUSSI — ' + name, flush=True)


def byte_order(width):
    return b''.join(ROM[i:i + width][::-1] for i in range(0, len(ROM), width))


def archive(entries, compression=zipfile.ZIP_DEFLATED):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=compression) as output:
        for name, data in entries:
            output.writestr(name, data)
    return buffer.getvalue()


def payload(name, data):
    return {'name': name, 'mimeType': 'application/zip', 'buffer': data}


def prepared(page, suffix, timeout=30000):
    page.wait_for_function('''suffix => {
      const s = RealN64.diagnostic().local_selection;
      return s?.source === 'local-zip' && s.name.endsWith(suffix);
    }''', arg=suffix, timeout=timeout)


def engine_boot(page):
    page.wait_for_function('()=>window.EJS_emulator?.gameManager?.getFrameNum()>15', timeout=45000)


def corrupt_crc(data):
    changed = bytearray(data)
    central = changed.find(b'PK\x01\x02')
    assert central >= 0
    value, = struct.unpack_from('<I', changed, central + 16)
    struct.pack_into('<I', changed, central + 16, value ^ 1)
    struct.pack_into('<I', changed, 14, value ^ 1)
    return bytes(changed)


def oversized_entry(data):
    changed = bytearray(data)
    central = changed.find(b'PK\x01\x02')
    assert central >= 0
    struct.pack_into('<I', changed, central + 24, 65 * 1024 * 1024)
    struct.pack_into('<I', changed, 22, 65 * 1024 * 1024)
    return bytes(changed)


class AuditHandler(Handler):
    server_requests = []

    def do_GET(self):
        self.server_requests.append((self.command, self.path, int(self.headers.get('Content-Length', '0'))))
        super().do_GET()

    def do_POST(self):
        self.server_requests.append((self.command, self.path, int(self.headers.get('Content-Length', '0'))))
        self.send_error(405)

    def do_PUT(self):
        self.do_POST()


server = ThreadingHTTPServer(('127.0.0.1', 8772), AuditHandler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True,
            args=['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        )

        def new_page():
            context = browser.new_context(viewport={'width': 1200, 'height': 1000}, accept_downloads=True)
            page = context.new_page()
            page.on('request', lambda req: requests.append({
                'url': req.url, 'method': req.method, 'body_bytes': len(req.post_data_buffer or b''),
            }))
            page.on('pageerror', lambda error: page_errors.append(str(error)))
            page.goto(URL)
            page.wait_for_function('()=>!!window.RealN64')
            assert '.zip' in page.locator('#rom-file').get_attribute('accept').lower()
            return context, page

        for extension, source, compression in [
            ('z64', ROM, zipfile.ZIP_STORED),
            ('v64', byte_order(2), zipfile.ZIP_DEFLATED),
            ('n64', byte_order(4), zipfile.ZIP_DEFLATED),
        ]:
            context, page = new_page()
            beginning = len(requests)
            entry = 'dossier/demo-zip-test.' + extension
            zip_bytes = archive([('README.txt', b'MIT test reference'), (entry, source)], compression)
            with page.expect_file_chooser() as chooser:
                page.locator('#choose-rom').click()
            chooser.value.set_files(payload('fixture-zip-local-' + extension + '.zip', zip_bytes))
            prepared(page, 'demo-zip-test.' + extension)
            data = page.evaluate('RealN64.diagnostic()')
            assert data['phase'] == 'idle'
            assert data['local_selection']['canonical_sha256'] == SHA
            assert data['local_selection']['source_sha256'] == hashlib.sha256(source).hexdigest()
            assert data['local_selection']['archive_name'] == 'fixture-zip-local-' + extension + '.zip'
            assert data['local_selection']['archive_size'] == len(zip_bytes)
            assert data['local_selection']['archive_sha256'] == hashlib.sha256(zip_bytes).hexdigest()
            assert data['local_selection']['archive_entry'] == entry
            assert page.evaluate('!!window.EJS_emulator') is False
            page.locator('#launch-local').click()
            engine_boot(page)
            actual = page.evaluate('''async () => {
              const e = EJS_emulator, data = e.gameManager.FS.readFile(e.fileName);
              return {hash: [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
                .map(n => n.toString(16).padStart(2, '0')).join(''), file: e.fileName, url: e.config.gameUrl};
            }''')
            assert actual['hash'] == SHA and actual['url'].startswith('blob:')
            assert actual['file'].startswith('EMUPERSO_LOCAL_')
            assert not any('/homebrew/' in req['url'] for req in requests[beginning:] if req['url'].startswith(URL))
            active = page.evaluate('RealN64.diagnostic().active_rom')
            assert active['source'] == 'local-zip'
            for width in (390, 1280):
                page.set_viewport_size({'width': width, 'height': 1000})
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            page.screenshot(path=str(EVIDENCE / ('zip-' + extension + '.png')), full_page=True)
            ok('ZIP ' + extension.upper() + ' local : extraction puis démarrage réel', {
                'compression': compression, 'source_sha256': hashlib.sha256(source).hexdigest(),
                'canonical_core_sha256': actual['hash'], 'nested_path': True,
            })
            context.close()

        context, page = new_page()
        large_rom = bytearray(64 * 1024 * 1024)
        large_rom[:len(ROM)] = ROM
        large_sha = hashlib.sha256(large_rom).hexdigest()
        large_zip = archive([('synthetic-64m.z64', large_rom)])
        page.locator('#rom-file').set_input_files(payload('fixture-synthetic-64m.zip', large_zip))
        prepared(page, 'synthetic-64m.z64', timeout=90000)
        selection = page.evaluate('RealN64.diagnostic().local_selection')
        assert selection['size'] == 64 * 1024 * 1024
        assert selection['canonical_sha256'] == large_sha
        assert selection['source_sha256'] == large_sha
        assert selection['archive_sha256'] == hashlib.sha256(large_zip).hexdigest()
        assert selection['archive_size'] == len(large_zip)
        assert selection['archive_crc_verified'] is True
        assert page.locator('#launch-local').is_enabled()
        assert page.evaluate('RealN64.diagnostic().phase') == 'idle'
        assert page.evaluate('!!window.EJS_emulator') is False
        ok('Limite positive réelle : ZIP synthétique de 64 Mio préparé dans Chromium', {
            'uncompressed_bytes': len(large_rom), 'zip_bytes': len(large_zip),
            'canonical_sha256': large_sha, 'engine_started': False,
            'scope': 'MIT demo prefix padded with zeroes; validation/extraction only, not game compatibility',
        })
        del large_rom, large_zip
        context.close()

        context, page = new_page()
        multi = archive([('first.z64', ROM), ('folder/second.n64', byte_order(4))])
        page.locator('#rom-file').set_input_files(payload('fixture-multiple.zip', multi))
        expect(page.locator('#zip-choice-panel')).to_be_visible()
        assert page.evaluate('RealN64.diagnostic().local_selection') is None
        assert page.locator('#launch-local').is_disabled()
        assert page.evaluate('!!window.EJS_emulator') is False
        option = page.locator('#zip-entry option').filter(has_text='second.n64')
        assert option.count() == 1
        page.locator('#zip-entry').select_option(option.get_attribute('value'))
        page.locator('#zip-use').click()
        prepared(page, 'second.n64')
        assert page.evaluate('RealN64.diagnostic().local_selection.detected_format') == 'n64'
        expect(page.locator('#zip-choice-panel')).to_be_hidden()
        ok('Plusieurs ROM : choix explicite avant toute préparation et tout moteur', {
            'chosen': 'folder/second.n64', 'canonical_sha256': SHA,
        })

        page.locator('#rom-file').set_input_files(payload('fixture-cancel.zip', multi))
        expect(page.locator('#zip-choice-panel')).to_be_visible()
        page.locator('#zip-cancel').click()
        expect(page.locator('#zip-choice-panel')).to_be_hidden()
        assert page.evaluate('RealN64.diagnostic().local_selection') is None
        assert page.locator('#launch-local').is_disabled()
        page.locator('#rom-file').set_input_files(payload('fixture-after-cancel.zip', archive([('after-cancel.z64', ROM)])))
        prepared(page, 'after-cancel.z64')
        ok('Annulation de sélection puis nouvel import', {'selected_after_cancel': 'after-cancel.z64'})

        invalid = [
            ('fixture-malformed.zip', b'PK' + bytes(4094)),
            ('fixture-no-rom.zip', archive([('README.md', b'No ROM in this archive')])),
            ('fixture-traversal.zip', archive([('../escape.z64', ROM)])),
            ('fixture-bad-crc.zip', corrupt_crc(archive([('crc.z64', ROM)]))),
            ('fixture-oversized.zip', oversized_entry(archive([('huge.z64', ROM)]))),
            ('fixture-not-n64.zip', archive([('wrong.z64', bytes(4096))])),
        ]
        for name, content in invalid:
            page.locator('#rom-file').set_input_files(payload(name, content))
            expect(page.locator('#status')).to_have_class('error')
            assert page.locator('#launch-local').is_disabled()
            assert page.evaluate('RealN64.diagnostic().local_selection') is None
            assert page.evaluate('!!window.EJS_emulator') is False
        ok('Archives invalides refusées avant le moteur', {
            'cases': [name for name, _ in invalid], 'engine_loaded': False,
        })

        # The member filename is displayed using text, never parsed as markup.
        hostile = '<img src=x onerror=window.__zipBadName=1>.z64'
        page.locator('#rom-file').set_input_files(payload('fixture-hostile-name.zip', archive([(hostile, ROM)])))
        prepared(page, hostile)
        assert page.locator('#rom-name').inner_text() == hostile
        assert page.locator('#rom-name img').count() == 0
        assert page.evaluate('window.__zipBadName??null') is None
        with page.expect_download() as download:
            page.locator('#export').click()
        exported = json.loads(Path(download.value.path()).read_text())
        encoded = json.dumps(exported)
        assert exported['local_selection']['source'] == 'local-zip'
        assert base64.b64encode(ROM).decode() not in encoded
        assert base64.b64encode(multi).decode() not in encoded
        ok('Nom de membre traité comme texte et diagnostic sans contenu ROM/ZIP', {
            'canonical_sha256': exported['local_selection']['canonical_sha256'],
        })
        context.close()

        context, page = new_page()
        page.evaluate('''() => {
          const read = File.prototype.arrayBuffer;
          File.prototype.arrayBuffer = async function () {
            if (this.name.startsWith('slow')) await new Promise(resolve => setTimeout(resolve, 700));
            return read.call(this);
          };
        }''')
        page.locator('#rom-file').set_input_files(payload('slow-zip-local.zip', archive([('stale.z64', ROM)])))
        page.locator('#rom-file').set_input_files(payload('newest-zip-local.zip', archive([('newest.n64', byte_order(4))])))
        prepared(page, 'newest.n64')
        page.wait_for_timeout(800)
        assert page.evaluate('RealN64.diagnostic().local_selection.name').endswith('newest.n64')
        page.locator('#rom-file').set_input_files(payload('slow-reference-race.zip', archive([('stale-again.z64', ROM)])))
        page.locator('#start').click()
        engine_boot(page)
        page.wait_for_timeout(800)
        assert page.evaluate('RealN64.diagnostic().active_rom.source') == 'reference-demo'
        assert page.evaluate('RealN64.diagnostic().local_selection') is None
        ok('Lectures ZIP concurrentes et référence : aucun résultat tardif ne remplace le choix actif', {
            'latest_selection': 'newest.n64', 'final_source': 'reference-demo',
        })
        context.close()
        browser.close()

    assert not page_errors, page_errors
    http = [req for req in requests if req['url'].startswith(('http:', 'https:'))]
    assert all(req['method'] == 'GET' and req['body_bytes'] == 0 and req['url'].startswith(URL) for req in http), http
    assert not any('fixture-' in req['url'] or 'zip-local' in req['url'] or SHA in req['url'] for req in http)
    assert all(method == 'GET' and length == 0 for method, path, length in AuditHandler.server_requests)
    ok('Confidentialité ZIP : aucune donnée ni nom d’archive envoyé', {
        'browser_http_requests': len(http), 'server_requests': len(AuditHandler.server_requests),
        'private_rom_used': False,
    })
    report = {
        'schema': 'emuperso/zip-browser-tests/v1', 'results': results, 'page_errors': page_errors,
        'http': http, 'server_requests': AuditHandler.server_requests,
        'scope': 'Only project MIT demo, generated byte orders and invalid ZIP fixtures. No user ROM.',
    }
    (EVIDENCE / 'tests-zip-browser.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('TOTAL', len(results), 'contrôles ZIP navigateur', flush=True)
finally:
    server.shutdown()
    server.server_close()
