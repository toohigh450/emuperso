"""Local-only static server for the isolated real-engine trial, no project writes."""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlsplit,unquote
import argparse
ROOT=Path(__file__).resolve().parents[1]
def allowed_path(url,root=ROOT):
 path=unquote(urlsplit(url).path)
 parts=path.strip('/').split('/') if path.strip('/') else []
 if '\\' in path or ':' in path or any(ord(c)<32 for c in path):return False
 if any(p.startswith('.') or p in ('..','.') for p in parts):return False
 if parts and parts[0] in ('cache','.python'):return False
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
 p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8770);args=p.parse_args()
 print(f'N64 réel : http://127.0.0.1:{args.port}/ — Ctrl+C pour arrêter',flush=True)
 ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
