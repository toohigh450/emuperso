"""Real-browser proof of both RAM-identification paths, own MIT ROM only.

The test forces the research helper's native-state path even if normal 180 ms
samples happened to observe both framebuffer parities. It does not change or
simulate a native load API, memory snapshot, timer or frame counter. Its temporary
8-byte marker occupies unused RAM in our diagnostic ROM and is removed again.
This corrects a test-identification issue, not a diagnosis of Karl's Windows PC.
"""
from pathlib import Path
import json
import os
import sys
import threading
from http.server import ThreadingHTTPServer

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from serve import Handler

PORT = 18883
URL = f'http://127.0.0.1:{PORT}/'
SHA = 'f18280a16c83721bdd56564701d505f96346784f36168402e5431b12499e2252'
PHYSICAL = 0x10010
results, page_errors = [], []


def record(name, proof, status='RÉUSSI'):
    results.append({'test': name, 'status': status, 'proof': proof})
    print(status + ' — ' + name, flush=True)


def validate_native_proof(found):
    proof = found['native_proof']
    assert found['identification_method'] == 'native-state-nonce'
    assert proof['heap_base'] == found['base'] and proof['physical_address'] == PHYSICAL
    assert proof['byte_count'] == 8 and len(proof['nonce']) == len(proof['original']) == 8
    assert proof['nonce'] != proof['original']
    assert proof['native_before'] == proof['original']
    assert proof['positive_matches'] and proof['positive_echo'] == proof['nonce']
    assert proof['restoration_matches']
    assert proof['restored_native'] == proof['restored_heap'] == proof['original']
    for observation in (proof['positive_frames'], proof['restoration_frames']):
        assert observation['after'] - observation['before'] >= 2
        assert observation['delta'] == observation['after'] - observation['before']
    return proof


# This independent observer calls the actual unmodified native getState first,
# then reads its newly serialized bytes. It never manufactures a snapshot.
INSTALL_OBSERVER = r'''() => {
  const gm=EJS_emulator.gameManager,p=window.__ramAutomatic,physical=0x10010;
  const rom=gm.FS.readFile(EJS_emulator.fileName),normal=rom.slice(0x1000,0x1040),swapped=normal.slice();
  for(let i=0;i<normal.length;i+=4)swapped.set(normal.slice(i,i+4).reverse(),i);
  const state=gm.getState(),regions=[];
  for(const [wordSwapped,pattern]of [[false,normal],[true,swapped]]){
    for(let i=0;i<=state.length-pattern.length;i+=4){
      const base=i-0x400;
      if(base>=0&&base+0x800000<=state.length&&state[i]===pattern[0]&&pattern.every((v,j)=>state[i+j]===v))
        regions.push({base,wordSwapped,pattern:Array.from(pattern)});
    }
  }
  if(regions.length!==1)throw Error('Independent native RAM region is ambiguous');
  const region=regions[0],index=(address,swapped)=>swapped?address^3:address;
  const readHeap=()=>Array.from({length:8},(_,i)=>gm.Module.HEAPU8[p.base+index(physical+i,p.wordSwapped)]);
  const readNative=bytes=>{
    if(region.base+0x800000>bytes.length||!region.pattern.every((v,j)=>bytes[region.base+0x400+j]===v))
      throw Error('Independent native snapshot RAM layout changed');
    return Array.from({length:8},(_,i)=>bytes[region.base+index(physical+i,region.wordSwapped)]);
  };
  const original=readHeap(),nativeBefore=readNative(state);
  if(!original.every((v,i)=>v===nativeBefore[i]))throw Error('Original live/native bytes differ');
  const fixture=[0x10,0x23,0x45,0x67,0x89,0xab,0xcd,0xef];
  window.__ramInitialOriginal=original;
  window.__ramRestoreInitial=()=>original.forEach((v,i)=>{
    gm.Module.HEAPU8[p.base+index(physical+i,p.wordSwapped)]=v;
  });
  fixture.forEach((v,i)=>{gm.Module.HEAPU8[p.base+index(physical+i,p.wordSwapped)]=v;});
  window.__ramOriginalGetState=gm.getState;
  window.__ramNativeObservations=[];
  gm.getState=function(...args){
    const bytes=window.__ramOriginalGetState.apply(this,args);
    window.__ramNativeObservations.push({frame:this.getFrameNum(),bytes:readNative(bytes)});
    return bytes;
  };
  window.__ramReadIndependent=()=>{
    const native=readNative(gm.getState());return{heap:readHeap(),native,frame:gm.getFrameNum()};
  };
  return {original,native_before:nativeBefore,fixture,prepared:window.__ramReadIndependent(),state_region:region.base};
}'''


server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
browser = page = None
fixture = None
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True,
            args=['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        page = browser.new_page(viewport={'width':1280, 'height':1000})
        page.on('pageerror', lambda error: page_errors.append(str(error)))
        page.goto(URL)
        page.locator('#start').click()
        page.wait_for_function("()=>RealN64.diagnostic().phase==='started'&&EJS_emulator.gameManager.getFrameNum()>10", timeout=60000)
        page.evaluate('(function(){'+(ROOT/'tests/own_demo_ram_probe.js').read_text(encoding='utf-8')+'\n})()')
        automatic = page.evaluate('async()=>{window.__ramAutomatic=await findOwnDemoRam();return __ramAutomatic}')
        assert automatic['rom_sha256'] == SHA and automatic['base'] > 0
        if automatic['identification_method'] == 'framebuffer-alternation':
            assert 0xA0100000 in automatic['pointers'] and 0xA0140000 in automatic['pointers']
        else:
            validate_native_proof(automatic)
        record('Identification automatique de la RAM du vrai cœur, limitée à la ROM MIT du dépôt', automatic)

        fixture = page.evaluate(INSTALL_OBSERVER)
        assert fixture['prepared']['heap'] == fixture['prepared']['native'] == fixture['fixture']
        forced = page.evaluate('async()=>{window.__ramForced=await findOwnDemoRam({forceNativeProof:true});return __ramForced}')
        proof = validate_native_proof(forced)
        assert proof['forced'] is True
        assert forced['rom_sha256'] == SHA
        assert forced['base'] == automatic['base'] and forced['wordSwapped'] == automatic['wordSwapped']
        after = page.evaluate('()=>window.__ramReadIndependent()')
        assert after['heap'] == after['native'] == fixture['fixture']
        observations = page.evaluate('window.__ramNativeObservations')
        positive = next(i for i,row in enumerate(observations) if row['bytes'] == proof['nonce'])
        restored = next(i for i,row in enumerate(observations) if i>positive and row['bytes'] == fixture['fixture'] and row['frame']>=observations[positive]['frame']+2)
        record('Fallback forcé : huit octets vus dans une vraie capture native puis retirés de la capture suivante', {
            'automatic_base':automatic['base'], 'forced_base':forced['base'], 'method':forced['identification_method'],
            'proof':proof, 'independent_native_observations':observations,
            'positive_observation_index':positive, 'restored_observation_index':restored,
            'after_heap_and_native':after,
        })

        final = page.evaluate('''async()=>{
          window.__ramRestoreInitial();
          const gm=EJS_emulator.gameManager,before=gm.getFrameNum(),deadline=performance.now()+4000;
          while(gm.getFrameNum()<before+2&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,30));
          if(gm.getFrameNum()<before+2)throw Error('No real frames while checking final cleanup');
          return {...window.__ramReadIndependent(),frame_before:before};
        }''')
        assert final['heap'] == final['native'] == fixture['original']
        assert final['frame'] - final['frame_before'] >= 2
        assert not page_errors, page_errors
        record('Octets initiaux rétablis dans la RAM et une nouvelle capture native, sans compteur simulé', final)
        page.evaluate('()=>{EJS_emulator.gameManager.getState=window.__ramOriginalGetState;}')
        browser.close(); browser = None
except Exception as error:
    record('Preuve de sonde RAM interrompue', str(error), status='ÉCHOUÉ')
    raise
finally:
    if page is not None:
        try:
            page.evaluate('()=>{window.__ramRestoreInitial?.();if(window.__ramOriginalGetState)EJS_emulator.gameManager.getState=window.__ramOriginalGetState;}')
        except Exception:
            pass
    if browser is not None:
        try: browser.close()
        except Exception: pass
    server.shutdown(); server.server_close()
    report = {'schema':'emuperso/ram-identification-rc-tests/v1','results':results,'page_errors':page_errors,
        'scope':'Actual core, repository MIT diagnostic ROM and temporary unused-RAM marker only. Forced research-helper fallback, no emulation/API/frame mocks. Not a diagnosis or a test of Karl PC.',
        'sampling_issue':'Six observations separated by 180 ms can alias double-buffer parity; missing observed alternation is not proof that native-state identification failed.'}
    (ROOT/'evidence/tests-ram-identification-rc-browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
