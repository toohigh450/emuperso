"""Package the local laboratory and evidence only. No core/toolchain build or network."""
from pathlib import Path
import hashlib, zipfile, json
from verify import verify
ROOT=Path(__file__).resolve().parents[1]
def main():
 required=['N64-Web-Lab-Phase1A.html','docs/Rapport-Phase1A.html','evidence/tests-unitaires.txt','evidence/tests-outils.txt','evidence/tests-navigateur.txt','evidence/tests-revision.txt','evidence/tests-rendu-journal.txt','evidence/tests-summary.json','evidence/verification-exports-Q1.json','evidence/controle-documentaire.txt','evidence/preservation-references.json','docs/FICHIERS-MODIFIES.json']
 for name in required:
  if not (ROOT/name).is_file():raise ValueError('Livrable manquant : '+name)
 summary=json.loads((ROOT/'evidence/tests-summary.json').read_text())
 if summary['candidate_executed']['failed_final']!=0:raise ValueError('Tests finaux non réussis.')
 for name,expected in summary['artifact_sha256'].items():
  if hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=expected:raise ValueError('Composant différent de la version testée : '+name)
 if not json.loads((ROOT/'evidence/verification-exports-Q1.json').read_text())['integrity_valid']:raise ValueError('Exports Q1 non validés.')
 excluded={'delivery','__pycache__','.git','node_modules'}
 files=sorted(p for p in ROOT.rglob('*') if p.is_file() and not set(p.relative_to(ROOT).parts)&excluded and p.name!='MANIFEST-SHA256.txt' and p.suffix!='.pyc')
 forbidden={'.wasm','.z64','.v64','.n64','.rom','.sav','.srm','.state','.cpp','.c','.exe'}
 for p in files:
  if p.is_symlink() or p.suffix.lower() in forbidden:raise ValueError('Fichier exclu : '+str(p))
 manifest=''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.relative_to(ROOT).as_posix()+'\n' for p in files)
 (ROOT/'MANIFEST-SHA256.txt').write_text(manifest,encoding='utf-8');verify(ROOT)
 out=ROOT/'delivery';out.mkdir(exist_ok=True);archive=out/'N64-Web-Lab-Phase1A-1.0.2-candidate.zip';prefix='N64-Web-Lab-Phase1A/'
 with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
  for p in files+[ROOT/'MANIFEST-SHA256.txt']:z.write(p,prefix+p.relative_to(ROOT).as_posix())
 with zipfile.ZipFile(archive) as z:
  if z.testzip() is not None:raise ValueError('CRC ZIP invalide.')
  for line in manifest.splitlines():
   expected,name=line.split('  ',1)
   if hashlib.sha256(z.read(prefix+name)).hexdigest()!=expected:raise ValueError('SHA ZIP invalide : '+name)
 digest=hashlib.sha256(archive.read_bytes()).hexdigest();(out/(archive.name+'.sha256')).write_text(digest+'  '+archive.name+'\n',encoding='utf-8')
 proof=f'RÉUSSI — {len(files)} fichiers + manifeste, empreintes SHA-256 et CRC ZIP vérifiés.\nRÉUSSI — Aucun moteur Wasm, ROM, état ou sauvegarde originale dans les fichiers livrés.\nSHA-256 ZIP : {digest}\nTaille : {archive.stat().st_size} octets.\nLe manifeste exclut sa propre empreinte et les archives de livraison ; l’archive est couverte par sa .sha256 externe.\n'
 (out/'VERIFICATION-LIVRAISON.txt').write_text(proof,encoding='utf-8');print(proof)
if __name__=='__main__':main()
