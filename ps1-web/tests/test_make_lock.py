import base64, hashlib, io, json, logging, shutil, sys, tarfile, tempfile, unittest
from pathlib import Path
TOOLS = Path(__file__).resolve().parents[1] / 'tools'; sys.path.insert(0, str(TOOLS))
import make_lock, fetch_runtime

def fake_tgz():
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode='w:gz') as tar:
        for name, body in {'package/pcsx_rearmed-wasm.data': b'core', 'package/pcsx_rearmed-legacy-wasm.data': b'legacy',
                           'package/reports/pcsx_rearmed.json': b'{}', 'package/package.json': b'{}'}.items():
            info = tarfile.TarInfo(name); info.size = len(body); tar.addfile(info, io.BytesIO(body))
    return out.getvalue()

class MakeLock(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()); (self.tmp / 'docs').mkdir()
        lock = json.loads((TOOLS.parent / 'docs' / 'runtime-lock.json').read_text())
        lock['status'] = 'a-generer'
        lock['packages'] = [p for p in lock['packages'] if p['name'] != make_lock.NAME]
        lock['files'] = {k: v for k, v in lock['files'].items() if not k.startswith('data/cores/')}
        (self.tmp / 'docs' / 'runtime-lock.json').write_text(json.dumps(lock))
        originals = (make_lock.ROOT, make_lock.LOCK, make_lock._get)
        self.addCleanup(lambda: (setattr(make_lock, 'ROOT', originals[0]), setattr(make_lock, 'LOCK', originals[1]), setattr(make_lock, '_get', originals[2])))
        make_lock.ROOT = self.tmp; make_lock.LOCK = self.tmp / 'docs' / 'runtime-lock.json'
        self.data = fake_tgz(); integrity = 'sha512-' + base64.b64encode(hashlib.sha512(self.data).digest()).decode()
        self.integrity = integrity; self.good = True
        def get(url, limit):
            if url.endswith('/4.2.3'): return json.dumps({'dist': {'tarball': 'https://registry.npmjs.org/x.tgz', 'integrity': integrity if self.good else 'sha512-AAAA'}}).encode()
            return self.data
        make_lock._get = get
    def tearDown(self): shutil.rmtree(self.tmp)
    def test_offline_refuse(self):
        with self.assertRaises(RuntimeError): make_lock.ensure(True, logging.getLogger('t'))
    def test_integrity_mismatch(self):
        self.good = False
        with self.assertRaises(ValueError): make_lock.ensure(False, logging.getLogger('t'))
        self.assertEqual(json.loads(make_lock.LOCK.read_text())['status'], 'a-generer')
    def test_generation_et_lecture_liste_blanche(self):
        make_lock.ensure(False, logging.getLogger('t')); lock = json.loads(make_lock.LOCK.read_text())
        self.assertEqual(lock['status'], 'genere-au-premier-lancement'); self.assertEqual(len(lock['packages']), 2)
        self.assertEqual(lock['files']['data/cores/pcsx_rearmed-wasm.data'], hashlib.sha256(b'core').hexdigest())
        self.assertNotIn('data/cores/package.json', lock['files'])
        pkg = lock['packages'][1]; fetch_runtime.check_package(self.tmp / 'cache' / pkg['cache_filename'], pkg)
        got = fetch_runtime.read_whitelist(self.tmp / 'cache' / pkg['cache_filename'], pkg, lock['files']); self.assertEqual(len(got), 3)
        before = make_lock.LOCK.read_text(); make_lock.ensure(True, logging.getLogger('t')); self.assertEqual(before, make_lock.LOCK.read_text())
unittest.main() if __name__ == '__main__' else None
