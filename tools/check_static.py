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
  f=ROOT/name;p=Inspect();p.feed(f.read_text());assert len(p.ids)==len(set(p.ids));assert not p.remote;assert p.scripts==scripts
  for ref in p.links:
   q=urlsplit(ref)
   if q.scheme:continue
   if not q.path:
    if q.fragment:assert q.fragment in p.ids,(name,ref)
   else:assert (f.parent/unquote(q.path)).exists(),(name,ref)
  lines.append('RÉUSSI — '+name+' : IDs uniques, liens présents, ressources autonomes.')
 app=ROOT/'N64-Web-Lab-Phase1A.html';before=hashlib.sha256(app.read_bytes()).hexdigest();subprocess.run(['python',str(ROOT/'tools/build.py')],check=True);assert hashlib.sha256(app.read_bytes()).hexdigest()==before
 assert '__testJournalClass' not in app.read_text();assert base64.b64encode((ROOT/'assets/goku-vegeta-transformations.png').read_bytes()).decode() in app.read_text()
 summary=json.loads((ROOT/'evidence/tests-summary.json').read_text())
 for name,digest in summary['artifact_sha256'].items():assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest,name
 for f in ROOT.rglob('*.json'):json.loads(f.read_text())
 lines+=['RÉUSSI — Reconstruction déterministe et composants identiques à ceux testés.','RÉUSSI — Décor intégré byte pour byte ; aucun point d’accès Journal réservé au test dans le HTML livré.','RÉUSSI — Métadonnées JSON lisibles ; rapport sans script.']
 proof.write_text('\n'.join(lines)+'\n');print('\n'.join(lines))
if __name__=='__main__':main()
