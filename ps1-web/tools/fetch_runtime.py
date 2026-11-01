#!/usr/bin/env python3
"""Install pinned official EmulatorJS npm assets, without npm or lifecycle scripts.
Only whitelisted regular tar members are read. No extractall, symlinks, engines
built, ROM downloaded, Git operation or public deployment. Inputs are hash locked.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / 'docs' / 'runtime-lock.json'
MAX_DOWNLOAD = 16 * 1024 * 1024
MAX_UNPACKED = 24 * 1024 * 1024

def relative_path(name: str) -> Path:
    if (not isinstance(name, str) or not name or '\\' in name or ':' in name
        or PurePosixPath(name).is_absolute()
        or any(p in ('', '.', '..') for p in name.split('/'))
        or any(ord(c) < 32 for c in name)):
        raise ValueError('Chemin relatif interdit : ' + repr(name))
    return Path(*name.split('/'))

def safe_target(base: Path, name: str) -> Path:
    target = base / relative_path(name)
    if base.is_symlink():
        raise ValueError('Racine symbolique interdite.')
    cursor = base
    for part in relative_path(name).parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise ValueError('Lien symbolique interdit : ' + str(cursor))
    if not target.resolve().is_relative_to(base.resolve()):
        raise ValueError('Chemin hors de la destination.')
    return target

def digest_file(path: Path, algorithm='sha256') -> str:
    h = hashlib.new(algorithm)
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def check_package(path: Path, package: dict) -> None:
    if path.is_symlink() or not path.is_file():
        raise ValueError('Paquet absent ou symbolique : ' + str(path))
    if path.stat().st_size != package['bytes']:
        raise ValueError('Taille du paquet non conforme : ' + path.name)
    if digest_file(path) != package['sha256']:
        raise ValueError('SHA-256 du paquet non conforme : ' + path.name)
    actual = 'sha512-' + base64.b64encode(bytes.fromhex(digest_file(path, 'sha512'))).decode('ascii')
    if actual != package['npm_integrity']:
        raise ValueError('Intégrité SHA-512 npm non conforme : ' + path.name)

def obtain_package(cache: Path, package: dict, offline: bool) -> Path:
    path = safe_target(cache, package['cache_filename'])
    if path.exists():
        check_package(path, package)
        return path
    if offline:
        raise FileNotFoundError('Mode hors ligne : paquet manquant ' + str(path))
    if package['bytes'] > MAX_DOWNLOAD:
        raise ValueError('Paquet trop volumineux.')
    url = package['url']
    if not url.startswith('https://registry.npmjs.org/@emulatorjs/'):
        raise ValueError('Origine de paquet non autorisée.')
    cache.mkdir(parents=True, exist_ok=True)
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(prefix='runtime-', suffix='.part', dir=cache, delete=False) as out:
            tmp_path = Path(out.name)
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'emuperso-runtime-installer/1'}), timeout=60) as response:
                total = 0
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > package['bytes'] or total > MAX_DOWNLOAD:
                        raise ValueError('Téléchargement plus grand que le paquet verrouillé.')
                    out.write(chunk)
        check_package(tmp_path, package)
        os.replace(tmp_path, path)
        tmp_path = None
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)
    return path

def read_whitelist(path: Path, package: dict, expected: dict) -> dict[str, bytes]:
    wanted = package['members']
    if not wanted:
        raise ValueError('Liste blanche vide.')
    result = {}
    seen = set()
    unpacked = 0
    with tarfile.open(path, 'r:gz') as archive:
        for member in archive:
            # Validate every member, even if not installed; never follow a link.
            relative_path(member.name)
            folded = member.name.casefold()
            if folded in seen:
                raise ValueError('Entrée archive dupliquée : ' + member.name)
            seen.add(folded)
            if not (member.isfile() or member.isdir()) or member.issym() or member.islnk():
                raise ValueError('Type de membre archive interdit : ' + member.name)
            unpacked += member.size
            if unpacked > MAX_UNPACKED or member.size > MAX_UNPACKED:
                raise ValueError('Archive décompressée trop volumineuse.')
            if member.name not in wanted:
                continue
            destination = wanted[member.name]
            relative_path(destination)
            if not member.isfile():
                raise ValueError('Fichier régulier requis : ' + member.name)
            source = archive.extractfile(member)
            if source is None:
                raise ValueError('Contenu membre absent.')
            content = source.read(member.size + 1)
            if len(content) != member.size or hashlib.sha256(content).hexdigest() != expected[destination]:
                raise ValueError('SHA-256 du fichier extrait invalide : ' + destination)
            result[destination] = content
    if set(result) != set(wanted.values()):
        raise ValueError('Fichier de la liste blanche manquant.')
    return result

def verify_install(vendor: Path, expected: dict) -> int:
    for name, digest in expected.items():
        path = safe_target(vendor, name)
        if not path.is_file() or digest_file(path) != digest:
            raise ValueError('Asset absent ou altéré : ' + name)
    return len(expected)

def install(lock: dict, cache: Path, vendor: Path, offline=False) -> int:
    expected = lock['files']
    prepared = {}
    for package in lock['packages']:
        path = obtain_package(cache, package, offline)
        contents = read_whitelist(path, package, expected)
        if set(contents) & set(prepared):
            raise ValueError('Destination dupliquée entre paquets.')
        prepared.update(contents)
    if set(prepared) != set(expected):
        raise ValueError('Liste d’assets incohérente dans le verrou.')
    # Validate all paths and hashes before writing any installed asset.
    for name in prepared:
        safe_target(vendor, name)
    vendor.mkdir(parents=True, exist_ok=True)
    for name, content in prepared.items():
        target = safe_target(vendor, name)
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = None
        try:
            with tempfile.NamedTemporaryFile(prefix='.runtime-', dir=target.parent, delete=False) as out:
                temp = Path(out.name)
                out.write(content)
            os.replace(temp, target)
            temp = None
        finally:
            if temp is not None:
                temp.unlink(missing_ok=True)
    return verify_install(vendor, expected)

def load_lock() -> dict:
    lock = json.loads(LOCK.read_text(encoding='utf-8'))
    if lock.get('schema') != 'emuperso/runtime-lock/v1' or not lock.get('files'):
        raise ValueError('Verrou runtime invalide.')
    seen = set()
    for name, digest in lock['files'].items():
        relative_path(name)
        if name.casefold() in seen or not re.fullmatch('[a-f0-9]{64}', digest):
            raise ValueError('Entrée verrou dupliquée ou hash invalide.')
        seen.add(name.casefold())
    return lock

def main() -> int:
    parser = argparse.ArgumentParser(description='Installe les assets officiels verrouillés de la démo, sans npm. Python 3.10+.')
    parser.add_argument('--cache-dir', type=Path, default=ROOT / 'cache')
    parser.add_argument('--offline', action='store_true', help='Paquets déjà présents uniquement ; aucun réseau.')
    parser.add_argument('--verify-only', action='store_true', help='Vérifie les assets existants sans téléchargement ni écriture.')
    args = parser.parse_args()
    try:
        lock = load_lock()
        vendor = ROOT / 'vendor'
        count = verify_install(vendor, lock['files']) if args.verify_only else install(lock, args.cache_dir, vendor, args.offline)
        print(f'RÉUSSI — {count} assets runtime vérifiés SHA-256 (EmulatorJS {lock["emulatorjs_version"]}, pcsx_rearmed).')
        if not args.verify_only:
            print('Runtime installé localement. Aucun npm install, script de paquet ou ROM téléchargé. Assets moteur gitignored ; ne pas publier sans obligations de sources résolues.')
        return 0
    except (OSError, ValueError, KeyError, tarfile.TarError) as error:
        print('ÉCHOUÉ — ' + str(error), file=sys.stderr)
        return 1
if __name__ == '__main__':
    raise SystemExit(main())
