from pathlib import Path
import sys,tempfile,unittest,json,hashlib,importlib.util,subprocess
R=Path(__file__).resolve().parents[1];sys.path.insert(0,str(R/'tools'))
from serve import allowed_path
class Tests(unittest.TestCase):
 def test_paths(self):
  for p in ['/%2e%2e/README.md','/.git/config','/cache/toolchain.deb','/C:\\Windows','/x%00y','/%2egit/config']:
   self.assertFalse(allowed_path(p),p)
  for p in ['/','/vendor/data/loader.js','/homebrew/fallback-open/demo-emuperso-open.z64']:
   self.assertTrue(allowed_path(p),p)
 def test_symlink(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'out').symlink_to('/etc');self.assertFalse(allowed_path('/out/passwd',root))
 def test_rom_header_and_hash(self):
  for p in [R/'homebrew/build-info.json',R/'homebrew/emulator-build-info.json',R/'homebrew/cpu-build-info.json',R/'homebrew/fallback-open/build-info.json']:
   j=json.loads(p.read_text());rom=p.parent/j['rom']['file'];b=rom.read_bytes();self.assertEqual(b[:4],bytes.fromhex('80371240'));self.assertEqual(hashlib.sha256(b).hexdigest(),j['rom']['sha256'])
 def test_originals_preserved(self):
  baseline=json.loads((R/'evidence/baseline-protected.json').read_text())
  for n,h in baseline['files'].items():self.assertEqual(hashlib.sha256((R.parent/n).read_bytes()).hexdigest(),h,n)
 def test_fresh_sdk_checkout_and_dirty_guard(self):
  spec=importlib.util.spec_from_file_location('sdk_setup',R/'homebrew/setup-toolchain.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);upstream=root/'upstream';upstream.mkdir();subprocess.run(['git','init',str(upstream)],check=True,capture_output=True);(upstream/'test.txt').write_text('test SDK only')
   subprocess.run(['git','-C',str(upstream),'add','test.txt'],check=True)
   subprocess.run(['git','-C',str(upstream),'-c','user.name=N64 test','-c','user.email=n64-test@example.invalid','commit','-m','synthetic SDK fixture'],check=True,capture_output=True)
   sha=subprocess.check_output(['git','-C',str(upstream),'rev-parse','HEAD'],text=True).strip();target=root/'checkout'
   module.checkout_sdk(target,str(upstream),sha);self.assertEqual((target/'test.txt').read_text(),'test SDK only')
   (target/'test.txt').write_text('local change');self.assertRaises(SystemExit,module.checkout_sdk,target,str(upstream),sha);self.assertEqual((target/'test.txt').read_text(),'local change')
if __name__=='__main__':unittest.main(verbosity=2)
