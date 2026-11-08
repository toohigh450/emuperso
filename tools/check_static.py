"""Check current standalone HTML/report and tested artifacts, no engine or network."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit,unquote
import base64,hashlib,json,subprocess
ROOT=Path(__file__).resolve().parents[1]
class Inspect(HTMLParser):
 def __init__(self):super().__init__();self.ids=[];self.links=[];self.remote=[];self.scripts=0
 def handle_starttag(self,t,a):
  d=dict(a)
  if 'id' in d:self.ids.append(d['id'])
  if t=='script':self.scripts+=1
  if t=='a' and 'href' in d:self.links.append(d['href'])
  if t in ('script','img','link','iframe','audio','video'):
   for k in ('src','href'):
    if d.get(k,'').startswith(('http:','https:','//')):self.remote.append(d[k])
def main():
 proof=ROOT/'evidence/controle-documentaire.txt';proof.write_text('Vérification en cours ; résultat non acquis.\n');lines=[]
 for name,scripts in [('N64-Web-Lab-Phase1A.html',1),('docs/Rapport-Phase1A.html',0)]:
  f=ROOT/name;p=Inspect();p.feed(f.read_text())
  if len(p.ids)!=len(set(p.ids)): raise ValueError(f'IDs dupliqués dans {name}')
  if p.remote: raise ValueError(f'Ressources distantes dans {name} : {p.remote}')
  if p.scripts!=scripts: raise ValueError(f'{name} : {p.scripts} scripts, {scripts} attendus')
  for ref in p.links:
   q=urlsplit(ref)
   if q.scheme:continue
   if not q.path:
    if q.fragment:
     if q.fragment not in p.ids: raise ValueError(f'Ancre absente dans {name} : {ref}')
   else:
    if not (f.parent/unquote(q.path)).exists(): raise ValueError(f'Lien mort dans {name} : {ref}')
  lines.append('RÉUSSI — '+name+' : IDs uniques, liens présents, ressources autonomes.')
 app=ROOT/'N64-Web-Lab-Phase1A.html';before=hashlib.sha256(app.read_bytes()).hexdigest();subprocess.run(['python',str(ROOT/'tools/build.py')],check=True)
 if hashlib.sha256(app.read_bytes()).hexdigest()!=before: raise ValueError('La reconstruction ne reproduit pas le HTML livré.')
 if '__testJournalClass' in app.read_text(): raise ValueError('Point d’accès Journal de test présent dans le HTML livré.')
 if base64.b64encode((ROOT/'assets/goku-vegeta-transformations.png').read_bytes()).decode() not in app.read_text(): raise ValueError('Décor non intégré byte pour byte.')
 summary=json.loads((ROOT/'evidence/tests-summary.json').read_text())
 for name,digest in summary['artifact_sha256'].items():
  if hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=digest: raise ValueError(f'Empreinte d’artefact non conforme : {name}')
 for f in ROOT.rglob('*.json'):json.loads(f.read_text())
 lines+=['RÉUSSI — Reconstruction déterministe et composants identiques à ceux testés.','RÉUSSI — Décor intégré byte pour byte ; aucun point d’accès Journal réservé au test dans le HTML livré.','RÉUSSI — Métadonnées JSON lisibles ; rapport sans script.']
 proof.write_text('\n'.join(lines)+'\n');print('\n'.join(lines))
if __name__=='__main__':main()
