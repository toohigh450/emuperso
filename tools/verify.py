"""Read-only SHA-256 verification of the delivered laboratory, rejects escaping paths."""
from pathlib import Path, PurePosixPath
import argparse, hashlib, re

def verify(root, manifest=None):
 root=Path(root).resolve();manifest=Path(manifest) if manifest else root/'MANIFEST-SHA256.txt';records=[];seen=set()
 for number,line in enumerate(manifest.read_text(encoding='utf-8').splitlines(),1):
  match=re.fullmatch(r'([a-f0-9]{64})  (.+)',line)
  if not match:raise ValueError(f'Ligne de manifeste invalide : {number}')
  expected,name=match.groups();parts=PurePosixPath(name)
  if parts.is_absolute() or '\\' in name or ':' in name or any(p in ('','.','..') for p in name.split('/')) or any(ord(c)<32 for c in name):raise ValueError('Chemin interdit dans le manifeste.')
  if name.casefold() in seen:raise ValueError('Chemin dupliqué, y compris en casse Windows.')
  seen.add(name.casefold());target=root.joinpath(*parts.parts)
  if not target.resolve().is_relative_to(root):raise ValueError('Chemin hors du dossier.')
  current=root
  for part in parts.parts:
   current=current/part
   if current.is_symlink():raise ValueError('Lien symbolique interdit.')
  if not target.is_file():raise ValueError('Fichier manquant : '+name)
  actual=hashlib.sha256(target.read_bytes()).hexdigest()
  if actual!=expected:raise ValueError('Empreinte différente : '+name)
  records.append(name)
 if not records:raise ValueError('Manifeste vide.')
 return records
if __name__=='__main__':
 parser=argparse.ArgumentParser(description='Vérifie les fichiers listés, sans écrire ni exécuter de code.');parser.add_argument('root',nargs='?',default=str(Path(__file__).resolve().parents[1]));args=parser.parse_args()
 try:print(f'RÉUSSI — {len(verify(args.root))} fichiers vérifiés SHA-256. Le manifeste doit provenir d’une source de confiance.')
 except (ValueError,OSError) as error:parser.exit(1,'ÉCHOUÉ — '+str(error)+'\n')
