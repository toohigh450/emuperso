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
        repo=ROOT.parent
        for value in re.findall(r'url\([\"\']?([^\)\"\']+)',text):
            if value.startswith(('data:','http:','https:')): continue
            # Les URL absolues (« /bg/x ») désignent la racine du site déployé, où
            # build-portail.mjs copie les fonds depuis portail/. On accepte donc
            # l'asset local à ps1-web, à la racine du dépôt ou dans portail/.
            rel=value.lstrip('/')
            candidates=[ROOT/value, ROOT/rel, repo/rel, repo/'portail'/rel, repo/'dist'/rel]
            self.assertTrue(any(p.is_file() for p in candidates), 'Missing stylesheet asset: '+value)
