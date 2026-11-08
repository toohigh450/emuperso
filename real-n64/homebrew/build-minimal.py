"""Experimental emulator-only ROM from unchanged libdragon application ELF."""
from pathlib import Path
import os,subprocess,hashlib,json
R=Path(__file__).resolve().parent
prefix=Path(os.environ['N64_INST']);tool=prefix/'bin/mips64-elf-'
def run(name,*args):subprocess.run([str(tool)+name,*map(str,args)],cwd=R,check=True)
b=R/'build-minimal';b.mkdir(exist_ok=True)
run('objcopy','-O','binary',R/'build/demo-emuperso.elf',b/'program.bin')
program=(b/'program.bin').read_bytes()
if len(program)%4: raise ValueError('program.bin doit être aligné sur 4 octets.')
run('gcc','-c','-x','assembler-with-cpp','-march=vr4300','-mabi=32',f'-DPROGRAM_BYTES={len(program)}',R/'minimal-boot.S','-o',b/'boot.o')
run('ld','-EB','-Ttext=0xa4000040','--entry=_boot',b/'boot.o','-o',b/'boot.elf')
run('objcopy','-O','binary','-j','.text',b/'boot.elf',b/'boot.bin')
boot=(b/'boot.bin').read_bytes()
if len(boot)>=4032: raise ValueError(f'boot.bin trop grand pour le secteur de démarrage ({len(boot)} >= 4032 octets).')
header=bytearray((R/'demo-emuperso.z64').read_bytes()[:64]);header[0x20:0x34]=b'EMUPERSO CPU BOOT'.ljust(20,b'\0');header[0x10:0x18]=bytes(8)
rom=bytes(header)+boot+bytes(4096-64-len(boot))+program
rom+=bytes((-len(rom))%2048)
p=R/'demo-emuperso-cpu.z64';p.write_bytes(rom)
info={'scope':'EXPERIMENTAL_EMULATOR_ONLY_8MIB_CPU_BOOT_NOT_CONSOLE_VALIDATED','rom':{'file':p.name,'bytes':len(rom),'sha256':hashlib.sha256(rom).hexdigest()},'source':'Unchanged Claude main.c linked by libdragon, flattened ELF; own MIT CPU bootstrap','boot':'8 MiB assumed, cleared by CPU, raw application copied from ROM; no RSP or physical memory training','crc':'Header CRC fields zero; this prototype targets the tested emulator only'}
(R/'cpu-build-info.json').write_text(json.dumps(info,indent=2)+'\n');print(json.dumps(info,indent=2))
