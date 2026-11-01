"""F1: real HTTP requests against an isolated synthetic application directory.

The only real ROM copied is this repository's MIT demo. Files called private are
new sentinel fixtures, never a user's ROM, save or diagnostic. No external host.
"""
from __future__ import annotations

import hashlib
import http.client
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from serve import DEMO_PATH, DEMO_SHA256, Handler, PUBLIC_FILES, allowed_path, public_file_manifest, test_handler


class ServerAllowlistTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='n64-server-allowlist-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for name, contents in {
            'index.html': b'<!doctype html><title>Public application fixture</title>',
            'app.js': b'export const fixture = 1;',
            'rom-file.mjs': b'export const fixture = 2;',
            'README-FR.md': b'Public synthetic guide',
        }.items():
            (self.root / name).write_bytes(contents)
        for name in (DEMO_PATH, 'vendor/data/loader.js'):
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
        self.request_count = 0
        self.start_server(Handler)

    def start_server(self, base):
        class FixtureHandler(base):
            document_root = self.root
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), FixtureHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)

    def stop_server(self):
        if self.server is not None:
            self.server.shutdown()
            self.server.server_close()
            self.thread.join(timeout=3)
            self.server = None

    def request(self, method, path, body=None):
        self.request_count += 1
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        try:
            connection.request(method, path, body=body)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_public_get_head_and_headers(self):
        """Application et MIME publics valides ; GET/HEAD, COOP/COEP/CORP et nosniff."""
        for path, name in [('/', 'index.html'), ('/index.html', 'index.html'), ('/app.js?v=5', 'app.js'), ('/rom-file.mjs', 'rom-file.mjs')]:
            data = (self.root / name).read_bytes()
            for method in ('GET', 'HEAD'):
                status, headers, received = self.request(method, path)
                self.assertEqual(status, 200, (method, path))
                self.assertEqual(received, data if method == 'GET' else b'')
                self.assertEqual(int(headers['Content-Length']), len(data))
                self.assertEqual(headers['Cross-Origin-Opener-Policy'], 'same-origin')
                self.assertEqual(headers['Cross-Origin-Embedder-Policy'], 'require-corp')
                self.assertEqual(headers['Cross-Origin-Resource-Policy'], 'same-origin')
                self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
                if name.endswith('.mjs'):
                    self.assertEqual(headers['Content-Type'], 'text/javascript')

    def test_private_files_exist_but_are_never_served(self):
        """ROM, ZIP, états, natifs, diagnostics et outils présents refusés en GET/HEAD."""
        private = b'PRIVATE-CONTENT-NEVER-HTTP-6e9932'
        names = ['private.z64', 'private.n64', 'private.v64', 'private.ZIP', 'private.sav',
                 'private.srm', 'private.state', 'diagnostic.json', 'project.log',
                 'docs/diagnostic.json', 'assets/private.zip', 'vendor/data/other.z64',
                 'vendor/data/cores/private.data', 'homebrew/private.z64',
                 'homebrew/fallback-open/personal.srm', 'tools/launcher.py',
                 'evidence/tests-hub-browser.json', '.git/config', '.python/python.exe',
                 'cache/private.zip', 'tests/save-store-browser.html']
        for name in names:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(private)
            for method in ('GET', 'HEAD'):
                status, _, body = self.request(method, '/' + name)
                self.assertEqual(status, 403, (method, name))
                self.assertNotIn(private, body)
                if method == 'HEAD':
                    self.assertEqual(body, b'')

    def test_traversal_and_encoded_aliases(self):
        """Traversées, double encodage, NUL, ADS Windows, barres inverses et alias refusés."""
        paths = ['/../index.html', '/%2e%2e/index.html', '/%252e%252e/index.html',
                 '/docs/../index.html', '/docs/%2e%2e/index.html', '/%2e/index.html',
                 '/%2findex.html', '/index.html/', '/index.html/private.z64',
                 '/index.html%00.zip', '/index.html%3asecret', '/C:%5cWindows',
                 '/docs%5c..%5cindex.html', '/%69%256edex.html', '/index.html%7f',
                 'http://foreign.example/index.html', '/%FF', '/%ZZ']
        for path in paths:
            for method in ('GET', 'HEAD'):
                status, _, _ = self.request(method, path)
                self.assertEqual(status, 403, (method, path))

    def test_no_directory_listing_or_implicit_index(self):
        """Aucune liste de dossier ni index implicite dans un dossier non autorisé."""
        (self.root / 'docs').mkdir(exist_ok=True)
        (self.root / 'docs/index.html').write_text('PRIVATE DIRECTORY INDEX')
        for path in ('/docs', '/docs/', '/vendor/', '/homebrew/', '/tests/'):
            for method in ('GET', 'HEAD'):
                self.assertEqual(self.request(method, path)[0], 403, (method, path))

    def test_only_owned_demo_rom_matches_hash(self):
        """Seule la ROM MIT attendue est servie ; son remplacement est refusé même en HEAD."""
        status, _, data = self.request('GET', '/' + DEMO_PATH)
        self.assertEqual(status, 200)
        self.assertEqual(hashlib.sha256(data).hexdigest(), DEMO_SHA256)
        (self.root / DEMO_PATH).write_bytes(b'PRIVATE REPLACEMENT OF AUTHORIZED ROM PATH')
        for method in ('GET', 'HEAD'):
            status, _, data = self.request(method, '/' + DEMO_PATH)
            self.assertEqual(status, 403)
            self.assertNotIn(b'PRIVATE REPLACEMENT', data)

    def test_pinned_runtime_integrity(self):
        """Ressource moteur exacte acceptée ; altération refusée avant tout octet."""
        path = 'vendor/data/loader.js'
        expected = (self.root / path).read_bytes()
        self.assertEqual(self.request('GET', '/' + path)[2], expected)
        (self.root / path).write_bytes(expected + b'//synthetic change')
        for method in ('GET', 'HEAD'):
            self.assertEqual(self.request(method, '/' + path)[0], 403)

    def test_allowed_symlink_file_is_refused(self):
        """Un lien symbolique à un nom public est refusé, même vers un fichier interne."""
        target = self.root / 'app.js'
        target.unlink()
        internal = self.root / 'private.txt'
        internal.write_bytes(b'PRIVATE SYMLINK TARGET')
        try:
            target.symlink_to(internal)
        except (OSError, NotImplementedError) as error:
            self.skipTest('Création de lien non disponible : ' + str(error))
        for method in ('GET', 'HEAD'):
            self.assertEqual(self.request(method, '/app.js')[0], 403)
        self.assertFalse(allowed_path('/app.js', self.root))

    def test_allowed_parent_symlink_is_refused(self):
        """Lien de dossier à un chemin public refusé ; aucune sortie de racine."""
        folder = self.root / 'vendor'
        shutil.rmtree(folder)
        external = self.root / 'external'
        (external / 'data').mkdir(parents=True)
        shutil.copyfile(ROOT / 'vendor/data/loader.js', external / 'data/loader.js')
        try:
            folder.symlink_to(external, target_is_directory=True)
        except (OSError, NotImplementedError) as error:
            self.skipTest('Création de lien non disponible : ' + str(error))
        for method in ('GET', 'HEAD'):
            self.assertEqual(self.request(method, '/vendor/data/loader.js')[0], 403)

    def test_missing_public_file_is_404(self):
        """Un fichier public absent est signalé 404 sans ouvrir un autre chemin."""
        for method in ('GET', 'HEAD'):
            self.assertEqual(self.request(method, '/engine.html')[0], 404)
        (self.root / 'app.js').unlink()
        (self.root / 'app.js').mkdir()
        self.assertEqual(self.request('GET', '/app.js')[0], 403)

    @unittest.skipUnless(hasattr(os, 'mkfifo'), 'FIFO indisponible sur cette plateforme')
    def test_non_regular_file_does_not_block(self):
        """Un FIFO placé au nom public ne bloque pas et est refusé."""
        (self.root / 'app.js').unlink()
        os.mkfifo(self.root / 'app.js')
        for method in ('GET', 'HEAD'):
            self.assertEqual(self.request(method, '/app.js')[0], 403)

    def test_no_upload_or_mutation_methods(self):
        """POST, PUT, PATCH, DELETE et OPTIONS ne créent ni ne modifient de fichier."""
        before = {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        for method in ('POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'):
            self.assertEqual(self.request(method, '/app.js', b'SYNTHETIC MUTATION')[0], 501)
        after = {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.assertEqual(before, after)

    def test_test_fixture_opt_in_is_code_only(self):
        """Pages de test privées en production ; seule la fixture choisie est ouverte explicitement."""
        name = 'tests/save-store-browser.html'
        (self.root / 'tests').mkdir()
        (self.root / name).write_bytes(b'EXPLICIT SYNTHETIC TEST PAGE')
        self.assertEqual(self.request('GET', '/' + name + '?test=1')[0], 403)
        self.assertEqual(self.request('GET', '/' + name + '?mode=test')[0], 403)
        self.stop_server()
        self.start_server(test_handler(name))
        self.assertEqual(self.request('GET', '/' + name)[0], 200)
        self.assertEqual(self.request('HEAD', '/tests/legacy-battery-browser.html')[0], 403)
        self.assertEqual(Handler.extra_files, frozenset())
        for extra in ('private.z64', 'tools/launcher.py', 'tests/arbitrary.html'):
            with self.assertRaises(ValueError):
                test_handler(extra)

    def test_manifest_is_exact_and_not_caller_mutable(self):
        """Liste publique exacte et copie de manifeste sans extension implicite ni fixture."""
        manifest = public_file_manifest()
        self.assertEqual(set(manifest), set(PUBLIC_FILES))
        self.assertEqual(manifest[DEMO_PATH], DEMO_SHA256)
        self.assertNotIn('assets/goku-vegeta-fusions.png', manifest)
        self.assertFalse(any(name.startswith(('tools/', 'tests/', 'evidence/', 'cache/')) for name in manifest))
        self.assertEqual([name for name in manifest if name.lower().endswith(('.z64', '.n64', '.v64', '.zip', '.sav', '.srm', '.state'))], [DEMO_PATH])
        manifest['private.z64'] = None
        self.assertNotIn('private.z64', public_file_manifest())


if __name__ == '__main__':
    records = []
    class EvidenceResult(unittest.TextTestResult):
        def addSuccess(self, test):
            super().addSuccess(test)
            records.append({'test': test.id(), 'status': 'RÉUSSI', 'proof': test.shortDescription(), 'http_requests': test.request_count})
        def addSkip(self, test, reason):
            super().addSkip(test, reason)
            records.append({'test': test.id(), 'status': 'NON TESTABLE', 'proof': reason})
        def addFailure(self, test, error):
            super().addFailure(test, error)
            records.append({'test': test.id(), 'status': 'ÉCHOUÉ', 'proof': self._exc_info_to_string(error, test)})
        def addError(self, test, error):
            super().addError(test, error)
            records.append({'test': test.id(), 'status': 'ÉCHOUÉ', 'proof': self._exc_info_to_string(error, test)})
    result = unittest.TextTestRunner(verbosity=2, resultclass=EvidenceResult).run(unittest.defaultTestLoader.loadTestsFromTestCase(ServerAllowlistTests))
    report = {'schema': 'emuperso/server-allowlist-tests/v1', 'results': records, 'scope': 'Real loopback HTTP; own MIT ROM copy and new synthetic private sentinel files. No original private ROM/save/diagnostic.'}
    (ROOT / 'evidence/server-allowlist-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    raise SystemExit(0 if result.wasSuccessful() else 1)
