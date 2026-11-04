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

    def test_css_local_assets_exist(self):
        text=(ROOT/'style.css').read_text(encoding='utf-8')
        for value in re.findall(r'url\([\"\']?([^\)\"\']+)',text):
            if not value.startswith(('data:','http:','https:')):
                # Les URL /bg/ appartiennent à la racine du portail assemblé,
                # et non au dossier /ps1-web/ ni à la racine du disque Windows.
                if value.startswith('/bg/'):
                    asset = ROOT.parent/'portail'/value.lstrip('/')
                else:
                    asset = ROOT/value
                self.assertTrue(asset.is_file(), 'Missing stylesheet asset: '+value)
