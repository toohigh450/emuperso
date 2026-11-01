import re, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class Delivery(unittest.TestCase):
    def test_relative_module_imports_exist(self):
        checked=[]
        for source in [*ROOT.glob('*.mjs'),*ROOT.glob('*.js'),*(ROOT/'tests').rglob('*.mjs')]:
            for spec in re.findall(r"(?:from\s*|import\s*\()\s*['\"](\.[^'\"]+)['\"]",source.read_text(encoding='utf-8')):
                checked.append(spec)
                self.assertTrue((source.parent/spec).is_file(),f'{source.relative_to(ROOT)} imports missing {spec}')
        self.assertGreater(len(checked),20)
