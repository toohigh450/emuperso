#!/usr/bin/env python3
"""Prepare a pinned Linux x86_64 toolchain and libdragon in the ignored local cache.
No root install; no ROM download; never changes the original Lab or demo-n64.
"""
from pathlib import Path
import argparse,hashlib,json,os,platform,subprocess,urllib.request
HERE=Path(__file__).resolve().parent
DEFAULT_CACHE=HERE.parent/'cache'
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 return h.hexdigest()
def run(argv,**kwargs):
 print('+ '+' '.join(map(str,argv)),flush=True)
 subprocess.run(list(map(str,argv)),check=True,**kwargs)
def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--cache',type=Path,default=DEFAULT_CACHE)
 parser.add_argument('--jobs',type=int,default=2)
 args=parser.parse_args()
 if platform.system()!='Linux' or platform.machine() not in ('x86_64','amd64'):raise SystemExit('Linux x86_64 requis ; utiliser WSL2/Docker ou le workflow autorisé.')
 if not 1<=args.jobs<=32:raise SystemExit('jobs doit être compris entre 1 et 32.')
 lock=json.loads((HERE/'toolchain-lock.json').read_text())
 cache=args.cache.resolve();cache.mkdir(parents=True,exist_ok=True)
 archive=cache/'toolchain.deb';expected=lock['toolchain_deb']['sha256']
 if not archive.is_file() or sha(archive)!=expected:
  temp=archive.with_suffix('.deb.partial')
  request=urllib.request.Request(lock['toolchain_deb']['url'],headers={'User-Agent':'N64-Web-emuperso-build/1'})
  with urllib.request.urlopen(request,timeout=180) as response,temp.open('wb') as output:
   while block:=response.read(1024*1024):output.write(block)
  if sha(temp)!=expected:raise SystemExit('SHA-256 du toolchain reçu non conforme ; archive non utilisée.')
  temp.replace(archive)
 extracted=cache/'toolchain';extracted.mkdir(exist_ok=True)
 run(['dpkg-deb','-x',archive,extracted])
 prefix=extracted/'opt/libdragon';compiler=prefix/'bin/mips64-elf-gcc'
 if not compiler.is_file():raise SystemExit('Préfixe toolchain inattendu.')
 run([compiler,'--version'])
 sdk=cache/'libdragon';commit=lock['libdragon']['commit']
 if not sdk.exists():run(['git','clone','--no-checkout',lock['libdragon']['repository'],sdk])
 status=subprocess.check_output(['git','-C',str(sdk),'status','--porcelain','--untracked-files=no'],text=True)
 if status.strip():raise SystemExit('Source SDK suivie modifiée ; refus de l’écraser.')
 run(['git','-C',sdk,'fetch','--depth','1','origin',commit])
 run(['git','-C',sdk,'checkout','--detach',commit])
 actual=subprocess.check_output(['git','-C',str(sdk),'rev-parse','HEAD'],text=True).strip()
 if actual!=commit:raise SystemExit('Révision SDK inattendue.')
 env=os.environ.copy();env['N64_INST']=str(prefix)
 run(['make','install-mk'],cwd=sdk,env=env)
 run(['make',f'-j{args.jobs}','libdragon','tools'],cwd=sdk,env=env)
 run(['make','install','tools-install'],cwd=sdk,env=env)
 print('Préfixe prêt. Compiler la copie homebrew avec :')
 print('N64_INST='+str(prefix)+' ./build.sh')
if __name__=='__main__':main()
