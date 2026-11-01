"""Offline candidate packaging regressions; synthetic private data only.

The source fixture is built from explicit package paths. Its temporary report is
labelled synthetic when the live RC report has not been written yet. No real ROM
other than the repository's owned MIT demo, personal save, profile or network is
used by this suite.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import package_rc as package


def sha(data):
    return hashlib.sha256(data).hexdigest()


class DistributionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = tempfile.TemporaryDirectory(prefix='n64-rc-owned-package-fixture-')
        cls.template = Path(cls.base.name) / 'real-n64'
        cls.template.mkdir()
        policy = package._policy(ROOT)
        names = set(policy) | set(package.WINDOWS_EXTRA_FILES)
        for name in sorted(names):
            source, target = ROOT / name, cls.template / name
            target.parent.mkdir(parents=True, exist_ok=True)
            if name == 'docs/RC-0.5.0.html' and not source.exists():
                target.write_text('<!doctype html><title>SYNTHETIC PACKAGING FIXTURE ONLY</title>\n')
            else:
                target.write_bytes(source.read_bytes())
        (cls.template.parent / 'DEMARRER-N64.bat').write_bytes((ROOT.parent / 'DEMARRER-N64.bat').read_bytes())

    @classmethod
    def tearDownClass(cls):
        cls.base.cleanup()

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='n64-rc-owned-distribution-')
        self.base = Path(self.temporary.name)
        self.root = self.base / 'source/real-n64'
        shutil.copytree(self.template, self.root)
        (self.root.parent / 'DEMARRER-N64.bat').write_bytes((self.template.parent / 'DEMARRER-N64.bat').read_bytes())
        self.output = self.base / 'output'

    def tearDown(self):
        self.temporary.cleanup()

    def test_two_private_archives_exact_manifests_and_separate_layouts(self):
        windows = package.build_windows(self.root, self.output)
        web = package.build_web(self.root, self.output)
        for result in (windows, web):
            verified = package.verify_archive(result.archive)
            self.assertEqual(verified['status'], 'RÉUSSI')
            self.assertEqual(result.sha256, sha(result.archive.read_bytes()))
            self.assertIn(result.sha256, result.archive.with_suffix('.zip.sha256').read_text())
            with zipfile.ZipFile(result.archive) as archive:
                meta = json.loads(archive.read(package.METADATA))
                self.assertEqual(meta['status'], 'REVUE-PRIVEE-NON-PUBLIEE')
                self.assertFalse(meta['publication_allowed'])
                self.assertFalse(meta['packaging_network_downloads'])
                self.assertEqual(meta['first_launch_network_downloads'], result.kind == 'windows')
                self.assertIn('NON TESTABLE', meta['public_url_test'])
        with zipfile.ZipFile(windows.archive) as archive:
            self.assertIn('DEMARRER-N64.bat', archive.namelist())
            self.assertIn('real-n64/tools/launch-windows.ps1', archive.namelist())
            self.assertNotIn('index.html', archive.namelist())
            self.assertFalse(any('vendor' in Path(name).parts for name in archive.namelist()))
        with zipfile.ZipFile(web.archive) as archive:
            self.assertIn('index.html', archive.namelist())
            self.assertIn('vendor/data/cores/mupen64plus_next-wasm.data', archive.namelist())
            self.assertNotIn('DEMARRER-N64.bat', archive.namelist())
            headers = archive.read('_headers').decode()
            self.assertIn('Cross-Origin-Opener-Policy: same-origin', headers)
            self.assertIn('Cross-Origin-Embedder-Policy: require-corp', headers)
            self.assertIn('Content-Security-Policy:', headers)

    def test_intruders_never_enter_either_archive(self):
        sentinel = b'SYNTHETIC PRIVATE SENTINEL - not a commercial ROM or original save'
        intruders = ['private-game.z64', 'private-game.N64', 'private-game.v64',
                     'private-game.zip', 'personal.sav', 'personal.srm', 'personal.state',
                     'diagnostic.json', 'docs/private-report.html',
                     'assets/goku-vegeta-fusions.png', 'vendor/data/private-diagnostic.json',
                     'vendor/cheats/private-catalog.txt', 'cache/secret.txt',
                     '.python/private.txt', 'evidence/diagnostic.json', 'delivery/private.zip']
        for name in intruders:
            p = self.root / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(sentinel)
        for builder in (package.build_windows, package.build_web):
            result = builder(self.root, self.output)
            with zipfile.ZipFile(result.archive) as archive:
                for item in archive.infolist():
                    self.assertNotIn(sentinel, archive.read(item), item.filename)
                roms = [n for n in archive.namelist() if Path(n).suffix.lower() in ('.z64', '.n64', '.v64')]
                expected = package.DEMO if result.kind == 'web' else 'real-n64/' + package.DEMO
                self.assertEqual(roms, [expected])
                self.assertEqual(sha(archive.read(expected)), package.DEMO_SHA)

    def test_tampered_pinned_banner_refused_and_previous_zip_preserved(self):
        original = package.build_windows(self.root, self.output)
        before = original.archive.read_bytes()
        asset = self.root / 'assets/emuperso-banner.png'
        asset.write_bytes(asset.read_bytes() + b'fault')
        for builder in (package.build_windows, package.build_web):
            with self.assertRaisesRegex(package.DistributionError, 'Empreinte'):
                builder(self.root, self.output)
        self.assertEqual(original.archive.read_bytes(), before)

    def test_windows_builds_without_dependencies_web_refuses_missing_or_corrupt_runtime(self):
        core = self.root / 'vendor/data/cores/mupen64plus_next-wasm.data'
        core.write_bytes(core.read_bytes() + b'fault')
        with self.assertRaisesRegex(package.DistributionError, 'Empreinte'):
            package.build_web(self.root, self.output)
        shutil.rmtree(self.root / 'vendor')
        windows = package.build_windows(self.root, self.output)
        self.assertTrue(windows.archive.is_file())
        with self.assertRaisesRegex(package.DistributionError, 'absente'):
            package.build_web(self.root, self.output)

    def test_publication_gate_cannot_be_approved_by_command_or_partial_flags(self):
        gate_path = self.root / 'docs/redistribution-rc.json'
        before = gate_path.read_bytes()
        for builder in (package.build_windows, package.build_web):
            with self.assertRaisesRegex(package.DistributionError, 'PUBLICATION REFUSÉE'):
                builder(self.root, self.output, for_publication=True)
        self.assertFalse(self.output.exists())
        self.assertEqual(gate_path.read_bytes(), before)
        gate = json.loads(before)
        gate['publication_allowed'] = True
        gate_path.write_text(json.dumps(gate))
        with self.assertRaisesRegex(package.DistributionError, 'PUBLICATION REFUSÉE'):
            package.build_web(self.root, self.output, for_publication=True)
        gate['karl_publication_go'] = True
        gate['blockers'] = []
        gate_path.write_text(json.dumps(gate))
        with self.assertRaisesRegex(package.DistributionError, 'PUBLICATION REFUSÉE'):
            package.build_web(self.root, self.output, for_publication=True)
        self.assertNotIn('approval_record', json.loads(gate_path.read_text()))

    def test_publication_cli_returns_failure_without_output_or_gate_mutation(self):
        gate = self.root / 'docs/redistribution-rc.json'
        before = gate.read_bytes()
        result = subprocess.run([sys.executable, '-B', str(ROOT / 'tools/package_rc.py'),
                                 '--root', str(self.root), '--output', str(self.output),
                                 '--for-publication'], capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('PUBLICATION REFUSÉE', result.stdout)
        self.assertFalse(self.output.exists())
        self.assertEqual(gate.read_bytes(), before)

    def test_source_symlink_and_private_rom_added_to_lock_are_refused(self):
        outside = self.base / 'synthetic-private.txt'
        outside.write_text('private synthetic content')
        app = self.root / 'app.js'
        app.unlink()
        try:
            app.symlink_to(outside)
        except (NotImplementedError, OSError):
            self.skipTest('Symbolic links unavailable in this test environment')
        with self.assertRaisesRegex(package.DistributionError, 'Lien'):
            package.build_web(self.root, self.output)
        app.unlink()
        app.write_bytes((self.template / 'app.js').read_bytes())
        lock_path = self.root / 'docs/runtime-lock.json'
        lock = json.loads(lock_path.read_text())
        lock['files']['private.z64'] = sha(b'private synthetic data')
        lock_path.write_text(json.dumps(lock))
        with self.assertRaisesRegex(package.DistributionError, 'privée refusée'):
            package.build_web(self.root, self.output)

    def test_fresh_windows_extract_imports_bootstrap_without_runtime_or_system_install(self):
        windows = package.build_windows(self.root, self.output)
        extracted = package.extract_verified(windows.archive, self.base / "N64 d'Karl-épreuve")
        project = extracted / 'real-n64'
        self.assertFalse((project / 'vendor').exists())
        self.assertFalse((project / '.python').exists())
        self.assertIn('real-n64\\lancer.bat', (extracted / 'DEMARRER-N64.bat').read_text())
        self.assertIn('launch-windows.ps1', (project / 'lancer.bat').read_text())
        code = ('import sys,json;from pathlib import Path;'
                'p=Path.cwd();sys.path.insert(0,str(p/"tools"));'
                'import launcher,fetch_runtime,fetch_cheats,serve;'
                'assert launcher.ROOT==p and fetch_runtime.ROOT==p;'
                'assert "index.html" in serve.PUBLIC_FILES;'
                'print(json.dumps({"root":str(p),"runtime_files":len(fetch_runtime.load_lock()["files"])}))')
        result = subprocess.run([sys.executable, '-I', '-B', '-c', code], cwd=project,
                                capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['runtime_files'], 39)
        self.assertFalse((project / 'vendor').exists())

    def test_manifest_corruption_duplicates_and_path_traversal_refused_before_extraction(self):
        result = package.build_windows(self.root, self.output)
        with zipfile.ZipFile(result.archive) as source:
            files = {name: source.read(name) for name in source.namelist()}
        files['real-n64/app.js'] += b'\n// controlled tamper'
        corrupt = self.base / 'corrupt.zip'
        with zipfile.ZipFile(corrupt, 'w') as target:
            for name, data in files.items():
                target.writestr(name, data)
        destination = self.base / 'refused-extraction'
        with self.assertRaisesRegex(package.DistributionError, 'Empreinte'):
            package.extract_verified(corrupt, destination)
        self.assertFalse(destination.exists())
        traversal = self.base / 'traversal.zip'
        with zipfile.ZipFile(traversal, 'w') as target:
            target.writestr('../escaped.json', b'controlled synthetic path')
        with self.assertRaises(package.DistributionError):
            package.extract_verified(traversal, destination)
        self.assertFalse((self.base / 'escaped.json').exists())
        self.assertFalse(destination.exists())
        duplicate = self.base / 'duplicate.zip'
        with zipfile.ZipFile(duplicate, 'w') as target:
            target.writestr('same.json', b'first')
            with self.assertWarns(UserWarning):
                target.writestr('same.json', b'second')
        with self.assertRaises(package.DistributionError):
            package.verify_archive(duplicate)

    def test_output_cannot_replace_sources_existing_extraction_or_follow_checksum_link(self):
        with self.assertRaisesRegex(package.DistributionError, 'séparée'):
            package.build_windows(self.root, self.root)
        result = package.build_windows(self.root, self.output)
        existing = self.base / 'existing'
        existing.mkdir()
        sentinel = existing / 'keep.txt'
        sentinel.write_text('keep')
        with self.assertRaisesRegex(package.DistributionError, 'nouveau'):
            package.extract_verified(result.archive, existing)
        self.assertEqual(sentinel.read_text(), 'keep')
        sidecar = result.archive.with_suffix('.zip.sha256')
        sidecar.unlink()
        try:
            sidecar.symlink_to(sentinel)
        except (NotImplementedError, OSError):
            self.skipTest('Symbolic links unavailable in this test environment')
        before = result.archive.read_bytes()
        with self.assertRaisesRegex(package.DistributionError, 'Lien'):
            package.build_windows(self.root, self.output)
        self.assertEqual(sentinel.read_text(), 'keep')
        self.assertEqual(result.archive.read_bytes(), before)


if __name__ == '__main__':
    unittest.main(verbosity=2)
