#!/usr/bin/env python3
from pathlib import Path
import os,subprocess,hashlib,json
R=Path(__file__).resolve().parent
prefix=Path(os.environ.get('N64_INST',str(R.parent.parent/'cache/toolchain/opt/libdragon')))
tool=prefix/'bin/mips64-elf-'
b=R/'build';b.mkdir(exist_ok=True)
def run(name,*args):subprocess.run([str(tool)+name,*map(str,args)],cwd=R,check=True)
flags=['-march=vr4300','-mabi=32','-mno-abicalls','-fno-pic','-G0','-Os','-ffreestanding','-nostdlib','-fno-builtin','-fno-stack-protector','-fno-tree-loop-distribute-patterns']
run('gcc',*flags,'-c','start.S','-o',b/'start.o')
run('gcc',*flags,'-c','main.c','-o',b/'main.o')
run('ld','-EB','-T','link.ld','-Map='+str(b/'app.map'),b/'start.o',b/'main.o','-o',b/'app.elf')
run('objcopy','-O','binary',b/'app.elf',b/'app.bin')
program=(b/'app.bin').read_bytes();program+=bytes((-len(program))%4)
run('gcc','-c','-x','assembler-with-cpp','-march=vr4300','-mabi=32',f'-DPROGRAM_BYTES={len(program)}','boot.S','-o',b/'boot.o')
run('ld','-EB','-Ttext=0xa4000040','--entry=_boot',b/'boot.o','-o',b/'boot.elf')
run('objcopy','-O','binary','-j','.text',b/'boot.elf',b/'boot.bin')
boot=(b/'boot.bin').read_bytes()
if len(boot)>4032: raise ValueError(f'boot.bin trop grand pour le secteur de démarrage ({len(boot)} > 4032 octets).')
header=bytearray(64);header[:4]=bytes.fromhex('80371240');header[4:8]=(15).to_bytes(4,'big');header[8:12]=(0x80000400).to_bytes(4,'big');header[0x20:0x34]=b'EMUPERSO OPEN DEMO'.ljust(20,b' ');header[0x3e]=ord('E')
rom=bytes(header)+boot+bytes(4096-64-len(boot))+program;rom+=bytes((-len(rom))%2048)
p=R/'demo-emuperso-open.z64';p.write_bytes(rom)
info={'scope':'FREESTANDING_REAL_N64_CODE_EMULATOR_ONLY_8MIB_CPU_BOOT','rom':{'file':p.name,'bytes':len(rom),'sha256':hashlib.sha256(rom).hexdigest(),'header_hex':rom[:4].hex()},'source':'New freestanding C port of MIT Claude demo behavior; no libdragon runtime linked. VI timings from libdragon Unlicense, elementary font by Codex.','compiled':True,'tested_browser':'PENDING','libraries_linked':[],'bootstrap':'Own MIT CPU loader, no physical RDRAM training, no RSP','notes':['Audio and SI input need independent real-engine verification.','Physical-console and hardware Gamepad not validated.']}
(R/'build-info.json').write_text(json.dumps(info,indent=2)+'\n');print(json.dumps(info,indent=2))
