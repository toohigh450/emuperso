"""Fresh, scoped Linux CI evidence for real-browser RC benches.

Never deploys or uploads. Only named JSON/TXT/PNG outputs are copied into the
artifact scope; pre-existing source evidence is backed up and restored exactly.
Run --self-test for offline helper regressions without Chromium or a server.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
PASS, FAIL, UNTESTABLE = 'RÉUSSI', 'ÉCHOUÉ', 'NON TESTABLE'
MAX_REPORT_BYTES = 32 * 1024 * 1024
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_LOG_BYTES = 8 * 1024 * 1024
ROM_SHA = 'f18280a16c83721bdd56564701d505f96346784f36168402e5431b12499e2252'


@dataclass(frozen=True)
class Report:
    name: str
    groups: int
    schema: str | None = None


@dataclass(frozen=True)
class Bench:
    name: str
    script: str
    report: Report
    timeout: int
    extras: tuple[str, ...] = ()
    nested: tuple[Report, ...] = ()


BENCHES = (
    Bench('engine-real', 'browser_real.py', Report('browser-real-results.json', 7), 180,
          ('boot.png', 'boot-ocr.png', 'animation.png', 'keyboard-A.png', 'keyboard-A-ocr.png',
           'keyboard-B.png', 'keyboard-B-ocr.png', 'interface-real.png', 'failure-real.png', 'runtime-diagnostic.json')),
    Bench('rom-import', 'browser_import.py', Report('tests-import-browser.json', 9), 150,
          ('import-z64.png', 'import-n64.png', 'import-v64.png')),
    Bench('zip-import', 'browser_zip.py', Report('tests-zip-browser.json', 10, 'emuperso/zip-browser-tests/v1'), 150,
          ('zip-z64.png', 'zip-n64.png', 'zip-v64.png')),
    Bench('vault', 'browser_save_store.py', Report('tests-save-store-browser.json', 18, 'emuperso/save-store-browser-tests/v1'), 150),
    Bench('legacy-native', 'browser_legacy_battery.py', Report('tests-legacy-battery-browser.json', 7, 'emuperso/legacy-battery-browser-tests/v1'), 90),
    Bench('native-roundtrip', 'probe_native_roundtrip.py', Report('probe-native-roundtrip.json', 5, 'emuperso/native-roundtrip-probe/v1'), 180,
          ('native-roundtrip.png',)),
    Bench('ram-identification', 'probe_ram_identification_rc.py', Report('tests-ram-identification-rc-browser.json', 3, 'emuperso/ram-identification-rc-tests/v1'), 180),
    Bench('restore-independent', 'probe_restore_rc.py', Report('probe-restore-rc.json', 3, 'emuperso/restore-independent-probe/v1'), 120),
    Bench('restore-regressions', 'browser_restore_rc.py', Report('tests-restore-rc-browser.json', 9, 'emuperso/restore-rc-browser-tests/v1'), 360,
          ('restore-rc-final.png', 'restore-rc-failure.png')),
    Bench('restore-guards', 'browser_restore_guards_rc.py', Report('tests-restore-guards-rc-browser.json', 4, 'emuperso/restore-guards-rc-browser-tests/v1'), 180),
    Bench('hub-full', 'browser_hub.py', Report('tests-hub-browser.json', 17, 'emuperso/hub-browser-tests/v1'), 420,
          ('hub-first.png', 'hub-animation.png', 'hub-final.png', 'hub-failure.png', 'hub-failure-diagnostic.json')),
    Bench('web-https-review', 'browser_web_rc.py', Report('tests-web-rc-browser.json', 8, 'emuperso/web-private-https-tests/v1'), 720,
          ('web-rc-interface.png', 'restore-rc-final.png', 'restore-rc-failure.png'),
          (Report('tests-web-rc-restoration.json', 9, 'emuperso/restore-rc-browser-tests/v1'),)),
)


def utc():
    return datetime.now(timezone.utc).isoformat()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path: Path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def valid_name(name: str):
    if Path(name).name != name or '/' in name or '\\' in name or name in ('', '.', '..'):
        raise ValueError('Evidence names must be fixed, flat basenames: ' + repr(name))
    if Path(name).suffix.lower() not in ('.json', '.txt', '.png'):
        raise ValueError('Only scoped JSON/TXT/PNG evidence is allowed: ' + name)


def json_data(data: bytes):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate JSON key: ' + key)
            result[key] = value
        return result
    def bad_constant(value):
        raise ValueError('Non-finite JSON value: ' + value)
    return json.loads(data.decode('utf-8-sig'), object_pairs_hook=pairs, parse_constant=bad_constant)


def verify_report(path: Path, report: Report):
    if not path.is_file() or path.is_symlink():
        raise ValueError('No fresh regular report: ' + report.name)
    if path.stat().st_size > MAX_REPORT_BYTES:
        raise ValueError('Report exceeds the evidence size limit: ' + report.name)
    data = json_data(path.read_bytes())
    if not isinstance(data, dict) or (report.schema is not None and data.get('schema') != report.schema):
        raise ValueError('Unexpected schema in ' + report.name)
    rows = data.get('results')
    if not isinstance(rows, list) or len(rows) != report.groups:
        raise ValueError(f'{report.name}: expected {report.groups} groups, observed ' + str(len(rows) if isinstance(rows, list) else 'no results array'))
    if any(not isinstance(row, dict) or row.get('status') != PASS for row in rows):
        raise ValueError('A failed or non-testable group exists in ' + report.name)
    return {'name': report.name, 'schema': data.get('schema'), 'groups': len(rows), 'sha256': sha(path.read_bytes())}


def copy_fresh(source: Path, destination: Path):
    valid_name(source.name)
    if source.is_symlink() or not source.is_file():
        raise ValueError('Fresh evidence is not a regular file: ' + source.name)
    suffix = source.suffix.lower()
    limit = MAX_IMAGE_BYTES if suffix == '.png' else MAX_REPORT_BYTES
    if source.stat().st_size > limit:
        raise ValueError('Fresh evidence is too large: ' + source.name)
    data = source.read_bytes()
    if suffix == '.json':
        json_data(data)
    elif suffix == '.png' and not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Expected PNG evidence, not arbitrary bytes: ' + source.name)
    elif suffix == '.txt':
        data.decode('utf-8')
    destination.write_bytes(data)
    return {'path': destination.name, 'source_name': source.name, 'bytes': len(data), 'sha256': sha(data)}


def process_identity(pid: int):
    try:
        fields = Path('/proc', str(pid), 'stat').read_text().rpartition(')')[2].split()
        return int(fields[1]), fields[19]  # parent PID and process start ticks
    except (OSError, ValueError, IndexError):
        return None


def descendants(pid: int):
    observed = {}
    for item in Path('/proc').iterdir():
        if item.name.isdigit():
            identity = process_identity(int(item.name))
            if identity:
                observed[int(item.name)] = identity
    owned, pending = {}, [pid]
    while pending:
        parent = pending.pop()
        for child, identity in observed.items():
            if identity[0] == parent and child not in owned:
                owned[child] = identity[1]
                pending.append(child)
    return owned


def stop_owned_process(process):
    # A browser may create its own process group. Capture only descendants of
    # this test process; recheck start ticks so a reused PID is never targeted.
    owned = descendants(process.pid)
    if process.poll() is None:
        identity = process_identity(process.pid)
        if identity:
            owned[process.pid] = identity[1]
    for sig in (signal.SIGTERM, signal.SIGKILL):
        for pid, started in reversed(tuple(owned.items())):
            identity = process_identity(pid)
            if identity and identity[1] == started:
                try:
                    os.kill(pid, sig)
                except ProcessLookupError:
                    pass
        if process.poll() is None:
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                continue
    if process.poll() is None:
        raise RuntimeError('Owned test process could not be stopped.')


def run_process(command, cwd: Path, env, timeout, stdout: Path, stderr: Path):
    with stdout.open('wb') as out, stderr.open('wb') as err:
        process = subprocess.Popen(command, cwd=cwd, env=env, stdout=out, stderr=err, start_new_session=True)
        timed_out = False
        try:
            code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            stop_owned_process(process)
            code = process.returncode
        finally:
            if process.poll() is None:
                stop_owned_process(process)
    return {'exit_code': code, 'timed_out': timed_out, 'timeout_seconds': timeout}


class Harness:
    def __init__(self, root=ROOT, budget_seconds=1080, quiet=False):
        self.root = Path(root)
        self.evidence = self.root / 'evidence'
        self.cache = self.root / 'cache/linux-browser-rc'
        self.scope = self.evidence / 'linux-browser-rc'
        for directory in (self.root, self.evidence, self.root / 'cache', self.cache, self.scope):
            if directory.is_symlink():
                raise ValueError('CI evidence/cache directories cannot be symlinks: ' + str(directory))
        self.cache.mkdir(parents=True, exist_ok=True)
        self.evidence.mkdir(parents=True, exist_ok=True)
        if self.scope.is_symlink():
            raise ValueError('Artifact evidence scope cannot be a symlink.')
        if self.scope.exists():
            self.scope.rename(self.cache / ('prior-evidence-' + uuid.uuid4().hex))
        self.scope.mkdir()
        self.budget_seconds = budget_seconds
        self.deadline = time.monotonic() + budget_seconds
        self.started = utc()
        self.environment = None
        self.results = []
        self.quiet = quiet
        self.env = os.environ.copy()
        self.env.update(PYTHONUTF8='1', PYTHONUNBUFFERED='1')

    def trim_log(self, path: Path):
        data = path.read_bytes()
        if len(data) > MAX_LOG_BYTES:
            backup = self.cache / (uuid.uuid4().hex + '-' + path.name)
            backup.write_bytes(data)
            marker = b'\n[Scoped log truncated; full output retained in the ignored CI cache.]\n'
            data = data[:MAX_LOG_BYTES // 2] + marker + data[-MAX_LOG_BYTES // 2:]
        # A malformed subprocess message must not turn its byte stream into
        # undecodable or arbitrary binary artifact content.
        path.write_text(data.decode('utf-8', errors='replace'), encoding='utf-8')

    def run(self, spec: Bench):
        valid_name(spec.name + '.evidence.json')
        started = utc()
        remaining = self.deadline - time.monotonic()
        result = {'name': spec.name, 'script': spec.script, 'status': FAIL,
                  'expected_groups': spec.report.groups, 'started_utc': started,
                  'generated_on_this_runner': False, 'reports': [], 'files': [], 'cleanup_errors': []}
        if remaining < 5:
            result.update(status=UNTESTABLE, proof='Global browser-test budget exhausted; this bench was not run.', finished_utc=utc())
            self.results.append(result)
            write_json(self.scope / (spec.name + '.evidence.json'), result)
            return result
        names = tuple(dict.fromkeys((spec.report.name,) + spec.extras + tuple(item.name for item in spec.nested)))
        for name in names:
            valid_name(name)
        prior, cleared = {}, set()
        backup = self.cache / ('prior-source-' + spec.name + '-' + uuid.uuid4().hex)
        stdout = self.scope / (spec.name + '.stdout.txt')
        stderr = self.scope / (spec.name + '.stderr.txt')
        try:
            for name in names:
                source = self.evidence / name
                if source.is_symlink() or (source.exists() and not source.is_file()):
                    raise ValueError('Source evidence must be a regular file: ' + name)
                if source.exists():
                    data, stat = source.read_bytes(), source.stat()
                    backup.mkdir(parents=True, exist_ok=True)
                    (backup / name).write_bytes(data)
                    prior[name] = (data, stat.st_atime_ns, stat.st_mtime_ns)
                    source.unlink()
                else:
                    prior[name] = None
                cleared.add(name)
            script = self.root / 'tests' / spec.script
            if script.name != spec.script or not script.is_file() or script.is_symlink():
                raise ValueError('Fixed benchmark script is missing: ' + spec.script)
            outcome = run_process([sys.executable, '-X', 'utf8', '-u', str(script)], self.root, self.env,
                                  min(spec.timeout, max(1, int(remaining))), stdout, stderr)
            result.update(outcome)
            if outcome['timed_out']:
                raise TimeoutError('Browser bench exceeded its bounded timeout: ' + spec.name)
            if outcome['exit_code'] != 0:
                raise RuntimeError('Browser bench returned exit code ' + str(outcome['exit_code']))
            reports = [verify_report(self.evidence / spec.report.name, spec.report)]
            reports += [verify_report(self.evidence / nested.name, nested) for nested in spec.nested]
            result.update(status=PASS, reports=reports, generated_on_this_runner=True)
        except Exception as error:
            result['proof'] = type(error).__name__ + ': ' + str(error)
        finally:
            for name in names:
                source = self.evidence / name
                try:
                    if name in cleared and source.is_file():
                        result['files'].append(copy_fresh(source, self.scope / (spec.name + '--' + name)))
                except Exception as error:
                    result['cleanup_errors'].append('Fresh evidence copy ' + name + ': ' + str(error))
                try:
                    if name in prior:
                        original = prior[name]
                        if original is not None:
                            data, atime, mtime = original
                            source.write_bytes(data)
                            os.utime(source, ns=(atime, mtime))
                        elif name in cleared and source.exists():
                            source.unlink()
                except Exception as error:
                    result['cleanup_errors'].append('Prior evidence restoration ' + name + ': ' + str(error) + '; retained backup: ' + str(backup))
            for log in (stdout, stderr):
                if log.exists():
                    try:
                        self.trim_log(log)
                    except Exception as error:
                        result['cleanup_errors'].append('Scoped log cleanup: ' + str(error))
            if result['cleanup_errors']:
                result['status'] = FAIL
            result['finished_utc'] = utc()
            self.results.append(result)
            write_json(self.scope / (spec.name + '.evidence.json'), result)
        if not self.quiet:
            print(result['status'] + ' — ' + spec.name + ' (' + str(spec.report.groups) + ' expected groups)', flush=True)
        return result

    def finish(self, specs=BENCHES):
        succeeded = len(self.results) == len(specs) and all(item['status'] == PASS for item in self.results)
        report = {'schema': 'emuperso/linux-browser-rc-tests/v1', 'status': PASS if succeeded else FAIL,
                  'started_utc': self.started, 'finished_utc': utc(), 'environment': self.environment,
                  'budget_seconds': self.budget_seconds, 'expected_benches': len(specs),
                  'expected_groups': sum(item.report.groups for item in specs),
                  'nested_expected_groups': sum(nested.groups for item in specs for nested in item.nested),
                  'tests': self.results, 'tested_on_karl_pc': False,
                  'scope': 'Linux CI with pinned Chrome for Testing, actual N64 core, repository MIT ROM and synthetic data only. Private staged HTTPS is not a public deployment.',
                  'not_testable': ['Karl Windows/Chrome device', 'physical gamepad and speakers', 'commercial games and every cheat', 'publicly deployed URL without Karl publication GO']}
        write_json(self.scope / 'results.json', report)
        return succeeded


def preflight(scope: Path, env):
    # Run the observed-browser check in a bounded subprocess, so a browser launch
    # stall cannot prevent a final harness error report indefinitely.
    code = '''import json,os,platform,sys
from importlib.metadata import version
from pathlib import Path
from playwright.sync_api import sync_playwright
assert sys.platform.startswith('linux'), sys.platform
assert version('playwright')=='1.62.0'
assert version('pillow')=='12.3.0'
with sync_playwright() as pw:
 executable=os.environ.get('CHROMIUM_PATH') or pw.chromium.executable_path
 browser=pw.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox'])
 observed=browser.version
 browser.close()
assert observed.startswith('151.'), observed
metadata={'schema':'emuperso/linux-browser-environment/v1','python':{'executable':sys.executable,'version':sys.version,'platform':platform.platform()},'packages':{'playwright':version('playwright'),'pillow':version('pillow')},'chromium':{'executable':executable,'version':observed},'rom_sha256':''' + repr(ROM_SHA) + ''','tested_on_karl_pc':False,'public_deployment':False}
Path(sys.argv[1]).write_text(json.dumps(metadata,ensure_ascii=True,indent=2)+'\\n',encoding='utf-8')
print('Observed Linux runner with Chrome for Testing '+observed)
'''
    outcome = run_process([sys.executable, '-X', 'utf8', '-u', '-c', code, str(scope / 'environment.json')], ROOT, env,
                          90, scope / 'environment-preflight.stdout.txt', scope / 'environment-preflight.stderr.txt')
    if outcome['timed_out'] or outcome['exit_code'] != 0:
        raise RuntimeError('Linux browser preflight failed: ' + json.dumps(outcome))
    metadata = json_data((scope / 'environment.json').read_bytes())
    return metadata


class HarnessTests(unittest.TestCase):
    """Offline helper tests: no browser, socket, ROM or existing project evidence."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='n64-ci-harness-fixture-')
        self.root = Path(self.temp.name)
        (self.root / 'tests').mkdir()
        self.harness = Harness(self.root, budget_seconds=30, quiet=True)
        self.report = Report('fresh.json', 2, 'synthetic/helper/v1')
        self.spec = Bench('synthetic', 'fixture.py', self.report, 3, ('fresh.png',))
        self.old_report, self.old_image = b'prior report bytes\r\n', b'prior image bytes'
        (self.root / 'evidence/fresh.json').write_bytes(self.old_report)
        (self.root / 'evidence/fresh.png').write_bytes(self.old_image)

    def tearDown(self):
        self.temp.cleanup()

    def script(self, suffix=''):
        report = {'schema': self.report.schema, 'results': [{'status': PASS}, {'status': PASS}]}
        content = 'from pathlib import Path\nimport json\np=Path("evidence")\n'
        content += 'p.joinpath("fresh.json").write_text(' + repr(json.dumps(report)) + ',encoding="utf-8")\n'
        content += 'p.joinpath("fresh.png").write_bytes(bytes.fromhex("89504e470d0a1a0a")+b"synthetic PNG fixture only")\n'
        (self.root / 'tests/fixture.py').write_text(content + suffix, encoding='utf-8')

    def assert_preserved(self):
        self.assertEqual((self.root / 'evidence/fresh.json').read_bytes(), self.old_report)
        self.assertEqual((self.root / 'evidence/fresh.png').read_bytes(), self.old_image)

    def test_fresh_success_and_old_proof_bytes_restored(self):
        self.script()
        result = self.harness.run(self.spec)
        self.assertEqual(result['status'], PASS)
        self.assertEqual(len(result['files']), 2)
        self.assert_preserved()

    def test_stale_success_report_is_never_reused(self):
        (self.root / 'tests/fixture.py').write_text('pass\n')
        result = self.harness.run(self.spec)
        self.assertEqual(result['status'], FAIL)
        self.assertIn('fresh regular report', result['proof'])
        self.assertEqual(result['files'], [])
        self.assert_preserved()

    def test_nonzero_exit_cannot_be_overridden_by_a_success_report(self):
        self.script('raise SystemExit(7)\n')
        result = self.harness.run(self.spec)
        self.assertEqual(result['status'], FAIL)
        self.assertEqual(result['exit_code'], 7)
        self.assert_preserved()

    def test_timeout_stops_the_owned_child_and_preserves_source(self):
        self.script('import time\ntime.sleep(30)\n')
        spec = Bench(self.spec.name, self.spec.script, self.report, 0.1, self.spec.extras)
        result = self.harness.run(spec)
        self.assertTrue(result['timed_out'])
        self.assertEqual(result['status'], FAIL)
        self.assert_preserved()

    def test_copy_failure_does_not_skip_later_source_restorations(self):
        self.script()
        original = copy_fresh
        def fail_first(source, destination):
            if source.name == 'fresh.json':
                raise OSError('controlled evidence copy fault')
            return original(source, destination)
        with patch(__name__ + '.copy_fresh', fail_first):
            result = self.harness.run(self.spec)
        self.assertEqual(result['status'], FAIL)
        self.assertTrue(result['cleanup_errors'])
        self.assert_preserved()

    def test_schema_group_count_and_test_status_are_all_required(self):
        for data in [
            {'schema': 'wrong', 'results': [{'status': PASS}, {'status': PASS}]},
            {'schema': self.report.schema, 'results': [{'status': PASS}]},
            {'schema': self.report.schema, 'results': [{'status': UNTESTABLE}, {'status': PASS}]},
        ]:
            self.script()
            text = (self.root / 'tests/fixture.py').read_text()
            text += 'p.joinpath("fresh.json").write_text(' + repr(json.dumps(data)) + ',encoding="utf-8")\n'
            (self.root / 'tests/fixture.py').write_text(text)
            result = self.harness.run(self.spec)
            self.assertEqual(result['status'], FAIL)
            self.assert_preserved()

    def test_restore_failure_keeps_disk_backup_and_continues_other_restorations(self):
        self.script()
        target = self.root / 'evidence/fresh.json'
        original = Path.write_bytes
        def fail_one_restore(path, data):
            if path == target and data == self.old_report:
                raise OSError('controlled prior-proof restoration failure')
            return original(path, data)
        with patch.object(Path, 'write_bytes', fail_one_restore):
            result = self.harness.run(self.spec)
        self.assertEqual(result['status'], FAIL)
        self.assertEqual((self.root / 'evidence/fresh.png').read_bytes(), self.old_image)
        backups = list(self.harness.cache.glob('prior-source-*/fresh.json'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), self.old_report)

    def test_budget_exhaustion_is_not_testable_and_never_a_pass(self):
        self.harness.deadline = time.monotonic() - 1
        result = self.harness.run(self.spec)
        self.assertEqual(result['status'], UNTESTABLE)
        self.assertFalse(self.harness.finish((self.spec,)))
        self.assert_preserved()

    def test_nested_report_is_required_independently_of_outer_success(self):
        self.script()
        nested = Report('nested.json', 1, 'synthetic/nested/v1')
        spec = Bench(self.spec.name, self.spec.script, self.report, 3, self.spec.extras, (nested,))
        result = self.harness.run(spec)
        self.assertEqual(result['status'], FAIL)
        self.assertIn('nested.json', result['proof'])
        self.assert_preserved()

    def test_preflight_helper_source_compiles_without_running_a_browser(self):
        def inspect_command(command, cwd, env, timeout, stdout, stderr):
            self.assertEqual(command[4], '-c')
            compile(command[5], '<synthetic-preflight-compile-only>', 'exec')
            self.assertEqual(timeout, 90)
            Path(command[-1]).write_text('{"schema":"SYNTHETIC_COMPILE_TEST_ONLY"}', encoding='utf-8')
            return {'exit_code': 0, 'timed_out': False}
        with patch(__name__ + '.run_process', inspect_command):
            result = preflight(self.harness.scope, {})
        self.assertEqual(result['schema'], 'SYNTHETIC_COMPILE_TEST_ONLY')

    def test_source_evidence_directory_cannot_redirect_into_another_project(self):
        isolated = self.root / 'another-fixture-root'
        outside = self.root / 'untouched-synthetic-project'
        isolated.mkdir(); outside.mkdir()
        sentinel = outside / 'original-proof.json'
        sentinel.write_bytes(b'untouched synthetic proof')
        (isolated / 'evidence').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            Harness(isolated)
        self.assertEqual(sentinel.read_bytes(), b'untouched synthetic proof')
        self.assertFalse((isolated / 'cache').exists())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--budget-seconds', type=int, default=1080)
    args = parser.parse_args()
    if args.self_test:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(HarnessTests)
        return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1
    if not 60 <= args.budget_seconds <= 1200:
        parser.error('Browser-test budget must be between 60 and 1200 seconds.')
    harness = Harness(budget_seconds=args.budget_seconds)
    try:
        harness.environment = preflight(harness.scope, harness.env)
        harness.env['CHROMIUM_PATH'] = harness.environment['chromium']['executable']
        for spec in BENCHES:
            harness.run(spec)
    except Exception as error:
        harness.results.append({'name': 'Linux browser harness', 'status': FAIL,
                                'proof': type(error).__name__ + ': ' + str(error), 'generated_on_this_runner': False})
    finally:
        success = harness.finish()
    return 0 if success else 1


if __name__ == '__main__':
    raise SystemExit(main())
