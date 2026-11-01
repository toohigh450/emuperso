#!/usr/bin/env python3
"""Build a minimal Vercel static alpha from the pinned PS1 runtime.
No ROMs, BIOS, personal saves, cache or test data are included.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist'
LOCK = json.loads((ROOT / 'docs/runtime-lock.json').read_text(encoding='utf-8'))
FILES = (
    'index.html', 'engine.html', 'app.js', 'engine-session.mjs',
    'style.css', 'engine.css', 'cheat-catalog-psx.mjs',
    'cheat-controller.mjs', 'core-options.mjs', 'disc-file.mjs',
    'input-presets.mjs', 'input-profile.mjs', 'region-evidence.mjs',
    'save-store.mjs', 'session-controller.mjs', 'startup-error.mjs',
    'state-bundle.mjs', 'LICENSE', 'docs/runtime-lock.json',
    'docs/CANDIDATE-RC1.15.md'
)
DIRECTORIES = ('assets', 'data', 'cheats')
BANNED_SUFFIXES = {'.iso', '.bin', '.img', '.chd', '.pbp', '.cue',
                   '.zip', '.rar', '.7z', '.sav', '.srm', '.mcr',
                   '.mcd', '.state', '.bat', '.ps1'}

def copy_file(relative: str, expected: str | None = None):
    source = ROOT / relative
    if not source.is_file() or source.is_symlink() or not source.resolve().is_relative_to(ROOT.resolve()):
        raise ValueError('Source non valide : ' + relative)
    if expected is not None:
        h = hashlib.sha256(source.read_bytes()).hexdigest()
        if h != expected:
            raise ValueError('Intégrité runtime invalide : ' + relative)
    dst = OUT / relative
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, dst)

def main():
    if OUT.exists(): shutil.rmtree(OUT)
    OUT.mkdir()
    for name in FILES: copy_file(name)
    for dirname in DIRECTORIES:
        folder = ROOT / dirname
        for source in folder.rglob('*'):
            if source.is_symlink(): raise ValueError('Lien interdit dans ' + dirname)
            if source.is_file():
                relative = source.relative_to(ROOT)
                if source.suffix.lower() in BANNED_SUFFIXES:
                    raise ValueError('Fichier privé bloqué : ' + str(relative))
                copy_file(relative.as_posix())
    for name, expected in LOCK['files'].items():
        copy_file('vendor/' + name, expected)
    license_file = ROOT / 'vendor/LICENSE.EmulatorJS.txt'
    if license_file.exists(): copy_file('vendor/LICENSE.EmulatorJS.txt')
    manifest = {}
    for file in OUT.rglob('*'):
        if file.is_file():
            manifest[file.relative_to(OUT).as_posix()] = hashlib.sha256(file.read_bytes()).hexdigest()
    (OUT / 'ALPHA-MANIFEST.json').write_text(json.dumps({
        'project': 'EMUPERSO PS1', 'status': 'ALPHATEST - jeu réel non certifié',
        'source_branch': 'alpha/ps1-vercel-playable',
        'runtime': 'EmulatorJS 4.2.3 / PCSX ReARMed',
        'file_count': len(manifest), 'sha256_files': manifest
    }, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print('ALPHA WEB construite :', len(manifest), 'fichiers. ROMs personnelles non incluses.')

if __name__ == '__main__': main()
