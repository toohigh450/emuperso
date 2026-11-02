"""Optional catalog installer: real local copies and tamper/path checks, no ROM."""
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fetch_cheats', ROOT / 'tools/fetch_cheats.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'docs').mkdir()
        shutil.copyfile(ROOT / 'docs/cheat-catalog-lock.json', self.root / 'docs/cheat-catalog-lock.json')
        self.lock = json.loads((self.root / 'docs/cheat-catalog-lock.json').read_text())
        self.patch = mock.patch.object(installer, 'ROOT', self.root)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def seed_cache(self):
        for asset in self.lock['assets']:
            dest = self.root / 'cache/cheats' / asset['file']
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / 'vendor/cheats' / asset['file'], dest)

    def test_fresh_offline_from_verified_cache_and_reuse(self):
        self.seed_cache()
        self.assertEqual(installer.install(offline=True), 2)
        self.assertEqual(installer.install(verify_only=True), 2)
        for asset in self.lock['assets']:
            self.assertEqual((self.root / 'vendor/cheats' / asset['file']).read_bytes(), (ROOT / 'vendor/cheats' / asset['file']).read_bytes())

    def test_missing_offline_never_downloads_or_creates_vendor(self):
        with mock.patch.object(installer.urllib.request, 'urlopen', side_effect=AssertionError('No network allowed')):
            with self.assertRaises(FileNotFoundError): installer.install(offline=True)
        self.assertFalse((self.root / 'vendor').exists())

    def test_tampered_second_asset_refuses_before_any_install(self):
        self.seed_cache()
        target = self.root / 'cache/cheats/COPYING.GPL-2.txt'
        data = bytearray(target.read_bytes()); data[0] ^= 1; target.write_bytes(data)
        with self.assertRaises(ValueError): installer.install(offline=True)
        self.assertFalse((self.root / 'vendor').exists())

    def test_symlink_vendor_refused(self):
        self.seed_cache()
        outside = self.root / 'outside'; outside.mkdir()
        (self.root / 'vendor').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError): installer.install(offline=True)
        self.assertEqual(list(outside.iterdir()), [])

    def test_wrong_source_path_refused(self):
        self.seed_cache()
        self.lock['assets'][0]['source_path'] = '../unexpected'
        (self.root / 'docs/cheat-catalog-lock.json').write_text(json.dumps(self.lock))
        with self.assertRaises(ValueError): installer.install(offline=True)


if __name__ == '__main__':
    unittest.main(verbosity=2)
