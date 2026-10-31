from pathlib import Path
import sys,tempfile,unittest,json,hashlib
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
if __name__=='__main__':unittest.main(verbosity=2)
