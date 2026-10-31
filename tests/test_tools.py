import hashlib,importlib.util,json,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('verify_lab',ROOT/'tools/verify.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class ToolTests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);(self.root/'example.txt').write_bytes(b'SYNTHETIC TEST ONLY');self.hash=hashlib.sha256((self.root/'example.txt').read_bytes()).hexdigest()
 def tearDown(self):self.tmp.cleanup()
 def manifest(self,text):(self.root/'MANIFEST-SHA256.txt').write_text(text,encoding='utf-8')
 def test_valid_manifest(self):self.manifest(self.hash+'  example.txt\n');self.assertEqual(mod.verify(self.root),['example.txt'])
 def test_tampered_file(self):self.manifest('0'*64+'  example.txt\n');self.assertRaises(ValueError,mod.verify,self.root)
 def test_paths_and_case_duplicates(self):
  for name in ['../outside.txt','/etc/passwd','C:\\outside.txt','a/../example.txt','./example.txt','a//b.txt']:
   with self.subTest(name=name):self.manifest(self.hash+'  '+name+'\n');self.assertRaises(ValueError,mod.verify,self.root)
  self.manifest(self.hash+'  example.txt\n'+self.hash+'  EXAMPLE.txt\n');self.assertRaises(ValueError,mod.verify,self.root)
 def test_symlink_rejected(self):
  (self.root/'link.txt').symlink_to(self.root/'example.txt');self.manifest(self.hash+'  link.txt\n');self.assertRaises(ValueError,mod.verify,self.root)
 def test_empty_and_malformed(self):
  for text in ['', 'abc\n', 'x'*64+'  example.txt\n']:
   self.manifest(text);self.assertRaises(ValueError,mod.verify,self.root)
 def test_source_lock_excludes_moving_ui(self):
  d=json.loads((ROOT/'docs/source-candidate-lock.json').read_text());self.assertEqual(d['selection']['ui']['commit'],'478ef785f2766efedd4d5a71a102d47dcf0c9f54');self.assertFalse(d['engine_compilation_authorized']);self.assertTrue(d['unresolved'])
 def test_static_inventory_keeps_digits_and_conditions(self):
  d=json.loads((ROOT/'docs/candidate-source-inventory.json').read_text());self.assertTrue(any(e['candidate_path'].startswith('GLideN64/') for e in d['entries']));self.assertTrue(any(e['conditions_unevaluated'] for e in d['entries']));self.assertTrue(all(e['status']=='static_source_candidate_not_link_trace' for e in d['entries']))
 def test_no_engine_or_original_data_in_project(self):
  forbidden={'.wasm','.z64','.v64','.n64','.rom','.sav','.srm','.state','.cpp','.c','.exe'}
  for p in ROOT.rglob('*'):
   if p.is_file() and 'delivery' not in p.parts:self.assertNotIn(p.suffix.lower(),forbidden,str(p))
if __name__=='__main__':unittest.main(verbosity=2)
