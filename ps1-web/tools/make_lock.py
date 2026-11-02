#!/usr/bin/env python3
"""Verrouille le coeur PS1 (@emulatorjs/core-pcsx_rearmed) au PREMIER lancement.
Le cadre EmulatorJS garde les empreintes deja verrouillees du modele N64. Pour le coeur PS1, le SHA-512 est
verifie contre le registre npm puis le SHA-256 de chaque fichier est calcule ici : confiance au premier telechargement."""
from __future__ import annotations
import base64, hashlib, io, json, re, tarfile, urllib.request
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / 'docs' / 'runtime-lock.json'
NAME, VERSION, MAX = '@emulatorjs/core-pcsx_rearmed', '4.2.3', 16 * 1024 * 1024

def _get(url: str, limit: int) -> bytes:
    if not url.startswith('https://registry.npmjs.org/'):
        raise ValueError('Origine non autorisee : ' + url)
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'emuperso-ps1-lock/1'}), timeout=60) as r:
        data = r.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Telechargement plus grand que la limite.')
    return data

def ensure(offline: bool, log) -> None:
    lock = json.loads(LOCK.read_text(encoding='utf-8'))
    if lock.get('status') != 'a-generer':
        return
    if offline:
        raise RuntimeError('Le coeur PS1 doit etre verrouille : le premier lancement necessite Internet.')
    log.info('Premier lancement : telechargement et verrouillage du coeur PS1 (registre npm).')
    dist = json.loads(_get(f'https://registry.npmjs.org/{NAME}/{VERSION}', 1 << 20))['dist']
    data = _get(dist['tarball'], MAX)
    if 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode() != dist['integrity']:
        raise ValueError('SHA-512 du coeur different de celui du registre npm.')
    members, files = {}, {}
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tar:
        for m in tar:
            if m.isfile() and (re.fullmatch(r'package/[A-Za-z0-9_.-]+\.data', m.name) or re.fullmatch(r'package/reports/[A-Za-z0-9_.-]+\.json', m.name)):
                dest = 'data/cores/' + m.name[len('package/'):]
                members[m.name] = dest; files[dest] = hashlib.sha256(tar.extractfile(m).read()).hexdigest()
    if not any(d.endswith('-wasm.data') for d in files):
        raise ValueError('Aucun fichier de coeur .data dans le paquet : ' + ', '.join(sorted(files)))
    cache = ROOT / 'cache'; cache.mkdir(exist_ok=True)
    (cache / 'core-pcsx_rearmed-4.2.3.tgz').write_bytes(data)
    lock['packages'].append({'name': NAME, 'version': VERSION, 'url': dist['tarball'], 'cache_filename': 'core-pcsx_rearmed-4.2.3.tgz',
        'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'npm_integrity': dist['integrity'], 'members': members})
    lock['files'].update(files); lock['status'] = 'genere-au-premier-lancement'
    lock['trust_note'] = 'Coeur PS1 verrouille au premier telechargement (SHA-512 npm verifie). A relire avant toute publication.'
    LOCK.write_text(json.dumps(lock, indent=1, ensure_ascii=False), encoding='utf-8')
    log.info('Coeur PS1 verrouille : %d fichiers (%s).', len(files), ', '.join(sorted(files)))
