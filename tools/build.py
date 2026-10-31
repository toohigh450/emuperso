"""Bundle ONLY our JavaScript laboratory sources. Never invokes an emulator build."""
from pathlib import Path
import re, hashlib, base64
ROOT=Path(__file__).resolve().parents[1]
ORDER=['common.mjs','journal.mjs','fixtures.mjs','storage.mjs','simulator.mjs','controller.mjs','latest-result.mjs','ui.mjs']
def bundle():
 parts=['"use strict";\n(()=>{']
 for name in ORDER:
  source=(ROOT/'src'/name).read_text(encoding='utf-8')
  source=re.sub(r'^import .*?;\n','',source,flags=re.M)
  source=re.sub(r'^export (?=(?:async )?(?:class|function|const|let)\b)','',source,flags=re.M)
  assert not re.search(r'^import |^export ',source,flags=re.M),name
  parts.append('\n// LOCAL LAB MODULE: '+name+'\n'+source)
 parts.append('})();')
 script='\n'.join(parts)
 image_data='data:image/png;base64,'+base64.b64encode((ROOT/'assets/goku-vegeta-transformations.png').read_bytes()).decode()
 style=(ROOT/'src/style.css').read_text(encoding='utf-8').replace('/*HERO_DATA*/',image_data)
 html=(ROOT/'src/interface.html').read_text(encoding='utf-8').replace('/*STYLES*/',style).replace('/*BUNDLE*/',script)
 assert '</script>' not in script.lower()
 (ROOT/'N64-Web-Lab-Phase1A.html').write_text(html,encoding='utf-8')
 print('Local JS laboratory bundled:',len(html.encode()),'bytes. No engine compiled.')
if __name__=='__main__':bundle()
