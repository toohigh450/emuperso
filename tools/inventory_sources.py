"""Optional public-document research. Never evaluates Makefiles, compiles, clones or runs cores.
Uses the inherited proxy/CA settings. Not needed to open the offline laboratory.
"""
from pathlib import Path
import concurrent.futures, hashlib, json, re, urllib.request
ROOT=Path(__file__).resolve().parents[1]
REPO='EmulatorJS/mupen64plus-libretro-nx'
COMMIT='4a3925d2861f17719586dffb178c1dd5339d3a68'
VAR=r'[A-Z_][A-Z0-9_]*'
def read(path):
 url=f'https://raw.githubusercontent.com/{REPO}/{COMMIT}/{path}'
 return urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'N64-Web-Lab-license-documentation'}),timeout=20).read()
def main():
 common=read('Makefile.common').decode();variables={'ROOT_DIR':'.','LIBRETRO_DIR':'./libretro'}
 for line in common.splitlines():
  m=re.match(r'^('+VAR+r')\s*[:?+]?=\s*(\$\(ROOT_DIR\)/[^\s]+)\s*$',line)
  if m:variables[m[1]]=m[2]
 def resolve(value):
  for _ in range(10):
   updated=re.sub(r'\$\(('+VAR+r')\)',lambda m:variables.get(m[1],m[0]),value)
   if updated==value:break
   value=updated
  return value.removeprefix('./')
 entries=[];stack=[]
 for i,line in enumerate(common.splitlines(),1):
  if re.match(r'^\s*(ifeq|ifneq|ifdef|ifndef)\b',line):stack.append(line.strip())
  elif line.strip().startswith('else') and stack:stack[-1]='ELSE of '+stack[-1]
  elif line.strip()=='endif' and stack:stack.pop()
  for token in re.findall(r'\$\('+VAR+r'\)/[A-Za-z0-9_./-]+\.(?:c|cpp|cc|S|asm)\b',line):entries.append({'line':i,'expression':token,'candidate_path':resolve(token),'conditions_unevaluated':stack.copy(),'status':'static_source_candidate_not_link_trace'})
 (ROOT/'docs/candidate-source-inventory.json').write_text(json.dumps({'repo':REPO,'commit':COMMIT,'recipe':'Makefile.common','recipe_sha256':hashlib.sha256(common.encode()).hexdigest(),'warning':'Conservative literal-path inventory only. Variables expanded for path labels, not build conditions. Wildcards/generated/includes may add files. Not actual linked files; no Makefile or compiler executed.','variables_for_path_expansion_only':variables,'entries':entries},ensure_ascii=False,indent=2),encoding='utf-8')
 existing_path=ROOT/'docs/license-header-samples.json'
 existing=json.loads(existing_path.read_text()) if existing_path.exists() else [];known={r['path'] for r in existing}
 paths=[]
 for prefix in ['libretro/','mupen64plus-core/src/device/r4300/','mupen64plus-core/src/main/','mupen64plus-rsp-hle/','custom/','GLideN64/src/','libretro-common/']:
  candidates=[e['candidate_path'] for e in entries if e['candidate_path'].startswith(prefix) and '$' not in e['candidate_path']]
  paths.extend(candidates[:3])
 def audit(path):
  try:
   raw=read(path);head=raw.decode(errors='replace')[:7000];grant='NOASSERTION'
   if 'either version 2' in head and 'any later version' in head and 'Lesser General Public' not in head:grant='GPL-2.0-or-later (header wording observed; file only)'
   return {'path':path,'repo':REPO,'commit':COMMIT,'url':f'https://raw.githubusercontent.com/{REPO}/{COMMIT}/{path}','sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'spdx_explicit':re.findall(r'SPDX-License-Identifier:\s*([^\r\n*]+)',head),'observed_header_grant':grant,'copyright_lines':[x.strip(' /*') for x in head.splitlines() if 'copyright' in x.lower()][:5],'status':'header_sample_only_no_distribution_conclusion'}
  except Exception as e:return {'path':path,'status':'unresolved','error':str(e)}
 new=list(concurrent.futures.ThreadPoolExecutor(max_workers=6).map(audit,[p for p in dict.fromkeys(paths) if p not in known]))
 existing_path.write_text(json.dumps(existing+new,ensure_ascii=False,indent=2),encoding='utf-8')
 print('Static expressions:',len(entries),'unique paths:',len({e['candidate_path'] for e in entries}),'sampled headers:',len(existing+new))
 for r in new:print(r['path'],r.get('observed_header_grant',r.get('error')))
if __name__=='__main__':main()
