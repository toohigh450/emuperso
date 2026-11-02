#!/usr/bin/env python3
"""Prepare a self-contained, hash-verified N64 static candidate for browser testing.
All file paths are pulled from the exact local server allowlist.
No personal game files, saves, logs or caches enter the output.
Third-party redistribution source compliance must be reviewed independently.
"""
from __future__ import annotations
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'dist'
spec=importlib.util.spec_from_file_location('n64_allowlist', ROOT/'tools'/'serve.py')
if spec is None or spec.loader is None: raise RuntimeError('Politique manquante')
policy=importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)
allowlist=policy.public_file_manifest()
if not allowlist: raise RuntimeError('Liste blanche vide')
if OUT.exists(): shutil.rmtree(OUT)
OUT.mkdir()
result={}
for relative,expected in sorted(allowlist.items()):
    if '..' in Path(relative).parts or Path(relative).is_absolute():
        raise RuntimeError('Chemin interdit : '+relative)
    src=ROOT/relative
    if not src.is_file() or src.is_symlink() or not src.resolve().is_relative_to(ROOT.resolve()):
        raise RuntimeError('Fichier absent ou lien interdit : '+relative)
    content=src.read_bytes()
    digest=hashlib.sha256(content).hexdigest()
    if expected is not None and digest != expected:
        raise RuntimeError('Empreinte incorrecte : '+relative)
    dest=OUT/relative
    dest.parent.mkdir(parents=True,exist_ok=True)
    dest.write_bytes(content)
    result[relative]=digest
(OUT/'ALPHA-MANIFEST.json').write_text(json.dumps({
    'status':'EVALUATION ALPHA - JEU REEL NON VALIDE',
    'version':'EMUPERSO-N64-0.5.0-RC2',
    'third_party_compliance':'PENDING: see docs/REDISTRIBUTION-RC.md',
    'files':result
},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('N64 alpha:',len(result),'fichiers autorisés, SHA-256 valides')
