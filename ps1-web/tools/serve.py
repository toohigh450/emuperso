"""Local-only static server for the isolated real-engine trial, no project writes."""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlsplit,unquote
import argparse
import json
ROOT=Path(__file__).resolve().parents[1]

# B05 (audit GPT RC-1.0, renforcé RC-1.1, corrigé RC-1.3) : liste blanche stricte.
# P0 (audit GPT RC-1.2) : vendor/ doit être servi fichier par fichier depuis
# docs/runtime-lock.json, sinon EmulatorJS ne charge pas (403 sur emulator.js).
BLOCKED_DIRS = frozenset({'roms', 'bios', 'saves', 'cache', '.python', '__pycache__', 'exports', 'diagnostics', 'private', 'personal', 'tools', 'tests'})
# Répertoires dont le contenu PEUT être servi (whitelist explicite)
# Note : 'vendor' est traité séparément (fichier par fichier depuis le lock)
ALLOWED_DIRS = frozenset({'assets', 'data', 'cheats', 'docs'})
# Extensions web autorisées (pour les fichiers à la racine et dans ALLOWED_DIRS)
ALLOWED_EXTENSIONS = frozenset({
    '.html', '.htm', '.js', '.mjs', '.css', '.json',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
    '.woff', '.woff2', '.ttf', '.otf',
    '.txt', '.md',
    '.wasm',  # Cœur EmulatorJS/PCSX
    '.data',  # Données EmulatorJS
    '.bat',   # Lanceur Windows (téléchargement)
})

def _vendor_files(root=ROOT):
    """Retourne l'ensemble des chemins vendor/ autorisés depuis runtime-lock.json.
    Chargé à chaque requête (pas de liste figée) car le lock peut s'enrichir
    au premier lancement via prepare()."""
    try:
        lock_path = root / 'docs' / 'runtime-lock.json'
        lock = json.loads(lock_path.read_text(encoding='utf-8'))
        files = lock.get('files', {})
        # Les clés sont comme 'data/src/emulator.js' (relatif à vendor/)
        return frozenset(files.keys())
    except Exception:
        return frozenset()

def _is_vendor_allowed(parts, root=ROOT):
    """Vérifie si un chemin /vendor/... est dans la whitelist du lock."""
    # parts[0] == 'vendor', le reste est le chemin relatif
    if len(parts) < 2:
        return False
    relative = '/'.join(parts[1:])
    # Normaliser : pas de .., pas de chemin absolu
    if '..' in parts or relative.startswith('/'):
        return False
    allowed = _vendor_files(root)
    if relative not in allowed:
        return False
    # Vérifier que le fichier résolu reste sous root/vendor/ (anti-traversal)
    # et n'est pas un symlink (sécurité)
    try:
        full = root.joinpath(*parts).resolve()
        vendor_root = (root / 'vendor').resolve()
        if not full.is_relative_to(vendor_root):
            return False
        # Refuser les symlinks
        if full.is_symlink() or any(p.is_symlink() for p in full.parents if p != vendor_root and vendor_root in p.parents):
            # Vérification simplifiée : le fichier final ne doit pas être un lien
            if (root.joinpath(*parts)).is_symlink():
                return False
        return full.is_file()
    except Exception:
        return False

def allowed_path(url,root=ROOT):
 path=unquote(urlsplit(url).path)
 parts=path.strip('/').split('/') if path.strip('/') else []
 if '\\' in path or ':' in path or any(ord(c)<32 for c in path):return False
 if any(p.startswith('.') or p in ('..','.') for p in parts):return False
 # B05 : bloquer explicitement les dossiers sensibles (n'importe où dans le chemin)
 # Exception : 'vendor' est autorisé mais filtré fichier par fichier ci-dessous
 if any(p.lower() in BLOCKED_DIRS for p in parts):return False
 # P0 (RC-1.3) : vendor/ servi fichier par fichier depuis runtime-lock.json
 # Sans ça, EmulatorJS ne charge pas (403 sur emulator.js = régression B05)
 if parts and parts[0].lower() == 'vendor':
  return _is_vendor_allowed(parts, root)
 # B05-RC-1.1 : whitelist par chemins
 # - Racine (/) : autorisée (pour index.html)
 # - Fichier à la racine : extension doit être autorisée
 # - Sous-répertoire : doit être dans ALLOWED_DIRS, ET l'extension autorisée
 if not parts:
  return True  # Racine /
 if len(parts) == 1:
  # Fichier à la racine
  last = parts[0]
  if '.' in last:
   ext = '.' + last.rsplit('.', 1)[-1].lower()
   if ext not in ALLOWED_EXTENSIONS:return False
  # Pas d'extension à la racine : refuser (pas de listing de toute façon)
  else:return False
 else:
  # Sous-répertoire : vérifier qu'il est dans la whitelist
  topdir = parts[0].lower()
  if topdir not in ALLOWED_DIRS:return False
  # Vérifier l'extension du fichier final
  last = parts[-1]
  if '.' in last:
   ext = '.' + last.rsplit('.', 1)[-1].lower()
   if ext not in ALLOWED_EXTENSIONS:return False
  else:return False  # Pas d'extension dans un sous-dossier : refuser
 return root.joinpath(*parts).resolve().is_relative_to(root.resolve())
class Handler(SimpleHTTPRequestHandler):
 extensions_map={**SimpleHTTPRequestHandler.extensions_map,'.mjs':'text/javascript'}
 def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
 def end_headers(self):
  self.send_header('Cross-Origin-Opener-Policy','same-origin')
  self.send_header('Cross-Origin-Embedder-Policy','require-corp')
  self.send_header('Cross-Origin-Resource-Policy','same-origin')
  self.send_header('Cache-Control','no-store')
  super().end_headers()
 def do_GET(self):
  if not allowed_path(self.path):self.send_error(403);return
  super().do_GET()
 def do_HEAD(self):
  if not allowed_path(self.path):self.send_error(403);return
  super().do_HEAD()
 def list_directory(self,path):self.send_error(403,'Directory listing disabled');return None
 def log_message(self,format,*args):pass
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8771);args=p.parse_args()
 print(f'PS1 réel : http://127.0.0.1:{args.port}/ — Ctrl+C pour arrêter',flush=True)
 ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
