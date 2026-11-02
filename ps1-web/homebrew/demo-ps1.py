#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Original EMUPERSO PS1 diagnostic homebrew. No commercial software or BIOS.
Generate a minimal ISO 9660 disc from a tiny PS-X EXE in pure Python stdlib.
The ROM program is original MIPS instructions that clear the PS1 GPU red.
"""
from __future__ import annotations
import hashlib
from pathlib import Path
import struct
import sys

SECTOR = 2048
SECTORS = 64
ROOT_LBA, CNF_LBA, EXE_LBA = 20, 21, 22

def both16(n: int) -> bytes:
    return struct.pack('<H', n) + struct.pack('>H', n)

def both32(n: int) -> bytes:
    return struct.pack('<I', n) + struct.pack('>I', n)

def directory_record(lba: int, size: int, ident: bytes, is_dir: bool=False) -> bytes:
    # ISO9660 directory record, including a padding octet for even-length names.
    length = 33 + len(ident) + (1 if len(ident) % 2 == 0 else 0)
    rec = bytearray(length)
    rec[0] = length
    rec[2:10] = both32(lba)
    rec[10:18] = both32(size)
    rec[18:25] = bytes((126, 11, 1, 19, 0, 0, 0))  # 2026-11-01 19:00 UTC
    rec[25] = 2 if is_dir else 0
    rec[28:32] = both16(1)
    rec[32] = len(ident)
    rec[33:33 + len(ident)] = ident
    return bytes(rec)

def build_exe() -> bytes:
    # This exact instruction sequence was already exercised by the PS1 RC-1.15
    # synthetic native-core Chromium tests (browser_real.py).
    exe = bytearray(65536)
    exe[:8] = b'PS-X EXE'
    for offset, value in {0x10:0x80010000, 0x18:0x80010000,
                          0x1c:len(exe)-2048, 0x30:0x801fff00}.items():
        struct.pack_into('<I', exe, offset, value)
    # GP1 reset / enable display / set display mode.
    # GP0 fills 320x240 with solid red; MIPS then loops forever.
    words = [
        0x3c081f80, 0x35081814, 0xad000000, 0x3c090300, 0xad090000,
        0x3c090800, 0x35290001, 0xad090000, 0x2508fffc,
        0x3c090200, 0x352900ff, 0xad090000, 0xad000000,
        0x3c0900f0, 0x35290140, 0xad090000, 0x08004010, 0x00000000
    ]
    for index, word in enumerate(words):
        struct.pack_into('<I', exe, 2048 + index * 4, word)
    return bytes(exe)

def build_iso() -> bytes:
    iso = bytearray(SECTORS * SECTOR)
    def sector(number: int, data: bytes):
        if len(data) > SECTOR:
            raise ValueError('Le secteur ISO est trop grand')
        iso[number * SECTOR:number * SECTOR + len(data)] = data
    exe = build_exe()
    cnf = b'BOOT = cdrom:\\DEMO.EXE;1\r\nTCB = 4\r\nEVENT = 10\r\nSTACK = 801fff00\r\n'
    # Volume descriptor: primary at sector 16, terminator at sector 17.
    pvd = bytearray(SECTOR)
    pvd[0:7] = b'\x01CD001\x01'
    pvd[8:40] = b'PLAYSTATION'.ljust(32, b' ')
    pvd[40:72] = b'EMUPERSO_PS1_DEMO'.ljust(32, b' ')
    pvd[80:88] = both32(SECTORS)
    pvd[120:124] = both16(1)
    pvd[124:128] = both16(1)
    pvd[128:132] = both16(SECTOR)
    pvd[132:140] = both32(10)  # ISO9660 path table, root only.
    struct.pack_into('<I', pvd, 140, 18)
    struct.pack_into('>I', pvd, 148, 19)
    pvd[156:190] = directory_record(ROOT_LBA, SECTOR, b'\x00', True)
    pvd[190:318] = b'EMUPERSO OPEN SOURCE DIAGNOSTIC'.ljust(128, b' ')
    pvd[574:702] = b'EMUPERSO PS1 HOMEBREW'.ljust(128, b' ')
    pvd[702:739] = b'EMUPERSO'.ljust(37, b' ')
    pvd[813:830] = b'2026110119000000\x00'
    pvd[830:847] = b'2026110119000000\x00'
    pvd[847:864] = b'0000000000000000\x00'
    pvd[864:881] = b'0000000000000000\x00'
    pvd[881] = 1
    sector(16, pvd)
    terminator = bytearray(SECTOR)
    terminator[0:7] = b'\xffCD001\x01'
    sector(17, terminator)
    # Single root directory path table entries, type L and M.
    sector(18, b'\x01\x00' + struct.pack('<I',ROOT_LBA) + struct.pack('<H',1) + b'\x00\x00')
    sector(19, b'\x01\x00' + struct.pack('>I',ROOT_LBA) + struct.pack('>H',1) + b'\x00\x00')
    entries = b''.join([
        directory_record(ROOT_LBA,SECTOR,b'\x00',True),
        directory_record(ROOT_LBA,SECTOR,b'\x01',True),
        directory_record(CNF_LBA,len(cnf),b'SYSTEM.CNF;1'),
        directory_record(EXE_LBA,len(exe),b'DEMO.EXE;1')
    ])
    sector(ROOT_LBA, entries)
    sector(CNF_LBA, cnf)
    iso[EXE_LBA * SECTOR:EXE_LBA * SECTOR + len(exe)] = exe
    return bytes(iso)

def main():
    if len(sys.argv) != 2:
        raise SystemExit('Usage: demo-ps1.py output.iso')
    data = build_iso()
    destination = Path(sys.argv[1])
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    print('PS1 original homebrew ISO9660:',len(data),'octets; SHA256',hashlib.sha256(data).hexdigest())

if __name__ == '__main__':
    main()
