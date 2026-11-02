"""Tests HTTP pour tools/serve.py — P0 (audit GPT RC-1.2) et B05.

Vérifie que :
1. Les fichiers vendor/ du lock sont servis (200)
2. Les fichiers vendor/ hors lock sont bloqués (403)
3. Les dossiers sensibles sont bloqués (403) en GET et HEAD
4. Les fichiers non listés sont bloqués même avec extension autorisée
"""
import json
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from serve import Handler, ROOT
from http.server import ThreadingHTTPServer


class TestServeHTTP(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Créer une structure de test temporaire
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)

        # docs/runtime-lock.json avec 2 fichiers vendor
        (cls.root / 'docs').mkdir(parents=True)
        lock = {'files': {
            'data/src/emulator.js': {'sha256': 'abc'},
            'data/emulator.css': {'sha256': 'def'},
        }}
        (cls.root / 'docs' / 'runtime-lock.json').write_text(json.dumps(lock))

        # vendor/ avec fichiers du lock + un fichier hors lock
        (cls.root / 'vendor' / 'data' / 'src').mkdir(parents=True)
        (cls.root / 'vendor' / 'data' / 'src' / 'emulator.js').write_text('// emulator')
        (cls.root / 'vendor' / 'data' / 'emulator.css').write_text('/* css */')
        (cls.root / 'vendor' / 'data' / 'evil.js').write_text('// not in lock')

        # Fichiers normaux
        (cls.root / 'index.html').write_text('<html></html>')
        (cls.root / 'data').mkdir()
        (cls.root / 'data' / 'psx-catalog.json').write_text('{}')

        # Dossiers sensibles
        (cls.root / 'roms').mkdir()
        (cls.root / 'roms' / 'game.chd').write_text('fake')
        (cls.root / 'private').mkdir()
        (cls.root / 'private' / 'token.json').write_text('secret')

        # Démarrer le serveur sur un port aléatoire
        # On monkey-patche ROOT pour utiliser notre tmp
        # Note: allowed_path a root=ROOT comme défaut évalué à la définition,
        # on doit patcher les deux
        import serve
        cls._orig_root = serve.ROOT
        serve.ROOT = cls.root
        # Patcher le défaut de allowed_path aussi
        cls._orig_defaults = serve.allowed_path.__defaults__
        serve.allowed_path.__defaults__ = (cls.root,)
        # Patcher _vendor_files aussi (utilise root=ROOT par défaut)
        cls._orig_vendor_defaults = serve._vendor_files.__defaults__
        serve._vendor_files.__defaults__ = (cls.root,)

        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.thread.join(timeout=5)
        import serve
        serve.ROOT = cls._orig_root
        serve.allowed_path.__defaults__ = cls._orig_defaults
        serve._vendor_files.__defaults__ = cls._orig_vendor_defaults
        cls.tmp.cleanup()

    def _get(self, path):
        conn = HTTPConnection('127.0.0.1', self.port, timeout=5)
        conn.request('GET', path)
        resp = conn.getresponse()
        status = resp.status
        conn.close()
        return status

    def _head(self, path):
        conn = HTTPConnection('127.0.0.1', self.port, timeout=5)
        conn.request('HEAD', path)
        resp = conn.getresponse()
        status = resp.status
        conn.close()
        return status

    def test_vendor_lock_200(self):
        """P0: fichiers vendor du lock → 200"""
        self.assertEqual(self._get('/vendor/data/src/emulator.js'), 200)
        self.assertEqual(self._get('/vendor/data/emulator.css'), 200)

    def test_vendor_not_in_lock_403(self):
        """P0: fichier vendor hors lock → 403"""
        self.assertEqual(self._get('/vendor/data/evil.js'), 403)

    def test_sensitive_dirs_403(self):
        """B05: dossiers sensibles → 403 en GET et HEAD"""
        for path in ['/roms/game.chd', '/bios/x.bin', '/saves/s.json']:
            self.assertEqual(self._get(path), 403, f'GET {path}')
            self.assertEqual(self._head(path), 403, f'HEAD {path}')

    def test_private_dir_403(self):
        """B05-RC-1.3: /private/ même avec .json → 403"""
        self.assertEqual(self._get('/private/token.json'), 403)
        self.assertEqual(self._head('/private/token.json'), 403)

    def test_normal_files_200(self):
        """Fichiers normaux → 200"""
        self.assertEqual(self._get('/index.html'), 200)
        self.assertEqual(self._get('/data/psx-catalog.json'), 200)
        self.assertEqual(self._head('/index.html'), 200)


if __name__ == '__main__':
    unittest.main()
