#!/usr/bin/env python3
"""Prepare a pinned optional upstream cheat catalog, never ROMs or user saves.

The original GPL2+ catalog and complete GPL text stay together in ignored vendor.
No conversion, eval, package installation or lifecycle scripts are performed.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from fetch_runtime import safe_target


def verify(path: Path, asset: dict) -> None:
    if path.is_symlink() or not path.is_file():
        raise ValueError('Catalogue absent ou symbolique : ' + str(path))
    if path.stat().st_size != asset['bytes'] or hashlib.sha256(path.read_bytes()).hexdigest() != asset['sha256']:
        raise ValueError('Catalogue ou licence altérés : ' + path.name)


def install(offline=False, verify_only=False) -> int:
    lock = json.loads((ROOT / 'docs/cheat-catalog-lock.json').read_text(encoding='utf-8'))
    if lock.get('schema') != 'emuperso/cheat-catalog-lock/v1' or len(lock.get('assets', [])) != 2:
        raise ValueError('Verrou de cheats invalide.')
    prepared = []
    allowed_sources = {'mupencheat.txt': 'data/mupencheat.txt', 'COPYING.GPL-2.txt': 'doc/gpl-license'}
    for asset in lock['assets']:
        if asset['file'] not in allowed_sources or asset['source_path'] != allowed_sources[asset['file']] or not 0 < asset['bytes'] <= 2 * 1024 * 1024:
            raise ValueError('Fichier de catalogue interdit.')
        expected_url = f'https://raw.githubusercontent.com/mupen64plus/mupen64plus-core/{lock["commit"]}/{asset["source_path"]}'
        if asset['url'] != expected_url or len(lock['commit']) != 40:
            raise ValueError('Origine du catalogue non autorisée.')
        target = safe_target(ROOT / 'vendor', 'cheats/' + asset['file'])
        if target.exists():
            verify(target, asset)
            prepared.append((target, None))
            continue
        if verify_only:
            raise FileNotFoundError('Catalogue non préparé : ' + asset['file'])
        source = safe_target(ROOT / 'cache', 'cheats/' + asset['file'])
        if not source.exists():
            if offline:
                raise FileNotFoundError('Catalogue absent en mode hors ligne : ' + asset['file'])
            source.parent.mkdir(parents=True, exist_ok=True)
            temp = None
            try:
                with tempfile.NamedTemporaryFile(prefix='cheats-', suffix='.part', dir=source.parent, delete=False) as output:
                    temp = Path(output.name)
                    with urllib.request.urlopen(asset['url'], timeout=45) as response:
                        size = 0
                        while data := response.read(128 * 1024):
                            size += len(data)
                            if size > asset['bytes']:
                                raise ValueError('Catalogue téléchargé trop volumineux.')
                            output.write(data)
                verify(temp, asset)
                os.replace(temp, source)
                temp = None
            finally:
                if temp is not None:
                    temp.unlink(missing_ok=True)
        verify(source, asset)
        prepared.append((target, source))
    for target, source in prepared:
        if source is not None:
            target.parent.mkdir(parents=True, exist_ok=True)
            temp = None
            try:
                with tempfile.NamedTemporaryFile(prefix='.cheats-', dir=target.parent, delete=False) as output:
                    temp = Path(output.name)
                    output.write(source.read_bytes())
                os.replace(temp, target)
                temp = None
            finally:
                if temp is not None:
                    temp.unlink(missing_ok=True)
    return len(prepared)


def main() -> int:
    parser = argparse.ArgumentParser(description='Prépare le catalogue communautaire officiel de cheats ; aucune ROM.')
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    try:
        count = install(args.offline, args.verify_only)
        print(f'RÉUSSI — {count} fichiers de catalogue/licence vérifiés ; codes communautaires non testés sur vos jeux.')
        return 0
    except (OSError, ValueError, KeyError) as error:
        print('Catalogue de cheats indisponible : ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
