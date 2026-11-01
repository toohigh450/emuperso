"""Local-only static server for the isolated real-engine trial, no project writes."""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlsplit,unquote
import argparse
ROOT=Path(__file__).resolve().parents[1]

# B05 (audit GPT RC-1.0) : liste blanche stricte des contenus servis.
# Seules les ressources web explicites sont autorisées. Les dossiers sensibles
# (roms, bios, saves, exports, diagnostics) sont TOUJOURS bloqués, même si
# l'utilisateur y copie des fichiers par erreur.
BLOCKED_DIRS = frozenset({'roms', 'bios', 'saves', 'cache', '.python', '__pycache__', 'exports', 'diagnostics'})
# Extensions web autorisées
ALLOWED_EXTENSIONS = frozenset({
    '.html', '.htm', '.js', '.mjs', '.css', '.json',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
    '.woff', '.woff2', '.ttf', '.otf',
    '.txt', '.md',
    '.wasm',  # Cœur EmulatorJS/PCSX
    '.data',  # Données EmulatorJS
})

def allowed_path(url,root=ROOT):
 path=unquote(urlsplit(url).path)
 parts=path.strip('/').split('/') if path.strip('/') else []
 if '\\' in path or ':' in path or any(ord(c)<32 for c in path):return False
 if any(p.startswith('.') or p in ('..','.') for p in parts):return False
 # B05 : bloquer explicitement les dossiers sensibles
 if parts and parts[0].lower() in BLOCKED_DIRS:return False
 if any(p.lower() in BLOCKED_DIRS for p in parts):return False
 # B05 : seuls les fichiers avec extension autorisée (ou répertoire racine)
 if parts:
  last = parts[-1]
  # Permettre l'accès à la racine et aux répertoires (pour index.html implicite)
  # mais le list_directory est désactivé (403), donc seuls les fichiers comptent
  if '.' in last:
   ext = '.' + last.rsplit('.', 1)[-1].lower()
   if ext not in ALLOWED_EXTENSIONS:return False
  else:
   # Pas d'extension : pourrait être un répertoire, vérifier qu'il n'est pas bloqué
   # (le listing est désactivé de toute façon)
   pass
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
