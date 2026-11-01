#!/usr/bin/env python3
"""Offline, exact-file packaging for private Web and Windows RC review.

This tool never downloads, starts a server, uploads, deploys or changes a release
gate. The source tree is trusted developer input; ZIP hashes establish integrity,
not the identity of an untrusted archive's author. Public distribution remains
blocked by the separately reviewed licensing/approval record.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = '0.5.0-RC1'
DEMO = 'homebrew/fallback-open/demo-emuperso-open.z64'
DEMO_SHA = 'f18280a16c83721bdd56564701d505f96346784f36168402e5431b12499e2252'
MANIFEST = 'MANIFEST-SHA256.txt'
METADATA = 'CANDIDATE-REVUE-PRIVEE.json'
MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES = 512, 64 * 1024 * 1024, 128 * 1024 * 1024
PRIVATE_SUFFIXES = frozenset({'.z64', '.n64', '.v64', '.zip', '.sav', '.srm', '.state',
                              '.eep', '.fla', '.mpk', '.pak'})
PRIVATE_PARTS = frozenset({'.git', '.python', 'cache', 'delivery', 'evidence'})
WINDOWS_EXTRA_FILES = (
    'lancer.bat', 'tools/launch-windows.ps1', 'tools/launcher.py',
    'tools/fetch_runtime.py', 'tools/fetch_cheats.py', 'tools/serve.py',
    'tools/package_rc.py', 'docs/SAVE-STORE-CONTRACT.md',
    'docs/RESTORE-INDEPENDENT-RC.md',
    'docs/portable-python-lock.json', 'docs/WEB-RC.md', 'assets/README.md',
    'homebrew/fallback-open/main.c', 'homebrew/fallback-open/start.S',
    'homebrew/fallback-open/boot.S', 'homebrew/fallback-open/link.ld',
    'homebrew/fallback-open/build.py', 'homebrew/fallback-open/README.md',
    'homebrew/fallback-open/LIBDRAGON-UNLICENSE.txt',
)


class DistributionError(ValueError):
    """The candidate cannot be packaged without weakening its guarantees."""


@dataclass(frozen=True)
class PackageResult:
    kind: str
    archive: Path
    sha256: str
    files: tuple[str, ...]


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _name(name: str) -> str:
    if (not isinstance(name, str) or not name or '\\' in name or ':' in name
            or '%' in name or any(ord(c) < 32 or ord(c) == 127 for c in name)):
        raise DistributionError('Nom de ressource non sûr.')
    p = PurePosixPath(name)
    if p.is_absolute() or str(p) != name or any(x in ('', '.', '..') for x in p.parts):
        raise DistributionError('Chemin de ressource non sûr : ' + name)
    if any(x.startswith('.') or x in PRIVATE_PARTS for x in p.parts):
        raise DistributionError('Dossier privé refusé : ' + name)
    if p.suffix.lower() in PRIVATE_SUFFIXES and name not in (DEMO, 'real-n64/' + DEMO):
        raise DistributionError('ROM, archive ou sauvegarde privée refusée : ' + name)
    return name


def _read(root: Path, name: str, expected: str | None = None) -> bytes:
    _name(name)
    root = Path(root).absolute()
    if root.is_symlink():
        raise DistributionError('La racine source ne doit pas être un lien.')
    path = root
    for part in PurePosixPath(name).parts:
        path = path / part
        if path.is_symlink() or (hasattr(path, 'is_junction') and path.is_junction()):
            raise DistributionError('Lien refusé dans les sources : ' + name)
    try:
        if not path.resolve().is_relative_to(root.resolve()):
            raise DistributionError('Ressource hors du projet : ' + name)
        flags = os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
        descriptor = os.open(path, flags)
        with os.fdopen(descriptor, 'rb') as source:
            details = os.fstat(source.fileno())
            if not stat.S_ISREG(details.st_mode) or details.st_size > MAX_FILE_BYTES:
                raise DistributionError('Ressource non régulière ou trop grande : ' + name)
            data = source.read(MAX_FILE_BYTES + 1)
    except OSError as error:
        raise DistributionError('Ressource nécessaire absente ou inaccessible : ' + name) from error
    if len(data) > MAX_FILE_BYTES:
        raise DistributionError('Ressource trop grande : ' + name)
    if expected is not None and _sha(data) != expected:
        raise DistributionError('Empreinte de ressource incorrecte : ' + name)
    if name == DEMO and _sha(data) != DEMO_SHA:
        raise DistributionError('La démo ne correspond pas à la ROM MIT autorisée.')
    return data


def _policy(root: Path) -> dict[str, str | None]:
    # Import only our developer-owned policy module. It enumerates exact names
    # and pinned dependency hashes, never files found by a directory walk.
    _read(root, 'tools/serve.py')
    spec = importlib.util.spec_from_file_location('emuperso_rc_server_policy', root / 'tools/serve.py')
    if spec is None or spec.loader is None:
        raise DistributionError('Politique du serveur introuvable.')
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
        manifest = module.public_file_manifest()
    except (OSError, ValueError, KeyError, AttributeError) as error:
        raise DistributionError('Politique des fichiers publics invalide.') from error
    if not isinstance(manifest, dict) or not manifest or len(manifest) > MAX_FILES:
        raise DistributionError('Liste publique invalide.')
    for name, digest in manifest.items():
        _name(name)
        if digest is not None and (not isinstance(digest, str) or len(digest) != 64
                                   or any(c not in '0123456789abcdef' for c in digest)):
            raise DistributionError('Empreinte publique invalide : ' + name)
    if manifest.get(DEMO) != DEMO_SHA:
        raise DistributionError('La politique ne verrouille pas la démo MIT.')
    return manifest


def _gate(root: Path, for_publication: bool) -> dict:
    try:
        gate = json.loads(_read(root, 'docs/redistribution-rc.json'))
    except (ValueError, UnicodeError) as error:
        raise DistributionError('Dossier de redistribution absent ou invalide.') from error
    if not isinstance(gate, dict):
        raise DistributionError('Dossier de redistribution invalide.')
    if for_publication:
        approval = gate.get('approval_record')
        blockers = gate.get('blockers', [])
        approved = (gate.get('publication_allowed') is True
                    and gate.get('karl_publication_go') is True
                    and isinstance(approval, dict) and approval.get('approved_by') == 'Karl'
                    and isinstance(approval.get('reference'), str) and bool(approval['reference'].strip())
                    and isinstance(blockers, list)
                    and all(isinstance(item, dict) and item.get('status') in ('CLOSED', 'RESOLVED') for item in blockers))
        if not approved:
            raise DistributionError('PUBLICATION REFUSÉE : F6 et/ou le GO final de Karl restent ouverts. Aucun accord n’a été créé par le packageur.')
    return gate


def _json(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode('utf-8')


def _metadata(kind: str, files: dict[str, bytes], gate: dict, for_publication: bool) -> bytes:
    snapshot = {name: _sha(data) for name, data in sorted(files.items())}
    return _json({
        'schema': 'emuperso/private-rc-package/v1', 'version': VERSION, 'target': kind,
        'status': 'REVUE-PRIVEE-NON-PUBLIEE', 'publication_command_requested': for_publication,
        'publication_allowed': gate.get('publication_allowed') is True,
        'karl_publication_go': gate.get('karl_publication_go') is True,
        'licensing_gate': gate.get('gate', 'UNESTABLISHED'),
        'runtime_redistribution_clearance': 'F6 STOP tant que sources/recettes/notices non établies',
        'built_utc': datetime.now(timezone.utc).isoformat(),
        'source_snapshot_sha256': _sha(_json(snapshot)),
        'scope': 'Démo MIT et ressources explicites seulement ; aucune ROM commerciale, sauvegarde ou diagnostic utilisateur.',
        'public_url_test': 'NON TESTABLE : aucun déploiement ni URL publique autorisés par cette opération.',
        'contains_runtime': kind == 'web',
        'packaging_network_downloads': False,
        'first_launch_network_downloads': kind == 'windows',
        'manifest_excludes_itself': True,
    })


def _guide(kind: str) -> bytes:
    start = ('Extraire tout le ZIP puis double-cliquer <strong>DEMARRER-N64.bat</strong>. '
             'Le premier lancement télécharge Python portable et le moteur officiels ; aucun compte, '
             'installation manuelle de Python ou droit administrateur requis.' if kind == 'windows' else
             'Répertoire statique de revue : servir son contenu avec les en-têtes fournis dans '
             '<code>_headers</code>. Il contient le vrai moteur figé pour les tests locaux. '
             'Ne pas déployer ni téléverser ce bundle dans un artefact public avant levée de F6 et GO de Karl.')
    return ('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>EMUPERSO N64 — revue privée ' + VERSION + '</title><style>body{font:17px/1.65 system-ui;max-width:900px;margin:40px auto;padding:0 24px;background:#101722;color:#edf4fa}code{overflow-wrap:anywhere}</style>'
            '<h1>EMUPERSO N64 ' + VERSION + ' — ' + kind.upper() + '</h1>'
            '<p><strong>REVUE PRIVÉE · NON PUBLIÉE · F6 STOP</strong></p><p>' + start + '</p>'
            '<p>La préparation de cette archive n’a pas publié de site ou de téléchargement. '
            'Le fonctionnement sur une adresse publique et sur le PC de Karl reste une validation séparée.</p>'
            '<p>Import .z64/.n64/.v64/.zip dans le navigateur, sans téléversement. La seule ROM fournie '
            'est notre démo MIT. Aucune compatibilité universelle de jeux N64 ni absence de bugs n’est garantie.</p>'
            '<p>Conserver des exports des sauvegardes importantes. Les données IndexedDB dépendent de '
            'l’origine et du port : Windows localhost et le futur site ne partagent pas automatiquement leurs sauvegardes.</p>'
            '<p>Le manifeste SHA-256 couvre les autres fichiers de l’archive. Ces empreintes vérifient '
            'les octets, sans authentifier l’auteur d’un ZIP reçu d’un tiers.</p></html>\n').encode('utf-8')


WEB_HEADERS = '''/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff
  Cache-Control: no-store
  Content-Security-Policy: default-src 'self'; connect-src 'self' blob:; script-src 'self' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; media-src 'self' data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'

/vendor/data/compression/libunrar.wasm
  Content-Type: application/wasm
'''


def _write(kind: str, root: Path, output_dir: Path, files: dict[str, bytes], gate: dict,
           for_publication: bool) -> PackageResult:
    for name in files:
        _name(name)
    files['LISEZ-MOI-REVUE-PRIVEE.html'] = _guide(kind)
    files[METADATA] = _metadata(kind, files, gate, for_publication)
    if len(files) + 1 > MAX_FILES or sum(map(len, files.values())) > MAX_TOTAL_BYTES:
        raise DistributionError('Assemblage trop volumineux.')
    files[MANIFEST] = ''.join(_sha(data) + '  ' + name + '\n' for name, data in sorted(files.items())).encode('utf-8')
    root, output_dir = root.resolve(), Path(output_dir).absolute()
    if (output_dir.resolve() == root or root.is_relative_to(output_dir.resolve())
            or (output_dir.resolve().is_relative_to(root) and not output_dir.resolve().is_relative_to(root / 'delivery'))):
        raise DistributionError('La sortie doit être séparée des sources, ou située dans delivery/.')
    for parent in (output_dir, *output_dir.parents):
        if parent.is_symlink() or (hasattr(parent, 'is_junction') and parent.is_junction()):
            raise DistributionError('Lien refusé dans le dossier de livraison.')
    output_dir.mkdir(parents=True, exist_ok=True)
    archive = output_dir / ('EMUPERSO-N64-' + VERSION + '-' + kind.upper() + '-REVUE-PRIVEE.zip')
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix='.n64-rc-', suffix='.zip', dir=output_dir, delete=False) as handle:
            temporary = Path(handle.name)
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
            for name, data in sorted(files.items()):
                item = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                item.compress_type = zipfile.ZIP_DEFLATED
                item.external_attr = (stat.S_IFREG | 0o644) << 16
                bundle.writestr(item, data, compresslevel=9)
        verify_archive(temporary)
        sidecar = archive.with_suffix('.zip.sha256')
        if archive.is_symlink() or sidecar.is_symlink():
            raise DistributionError('Lien refusé à la place d’une livraison.')
        os.replace(temporary, archive)
        digest = _sha(archive.read_bytes())
        with tempfile.NamedTemporaryFile(prefix='.n64-sha-', dir=output_dir, delete=False) as handle:
            checksum_temp = Path(handle.name)
            handle.write((digest + '  ' + archive.name + '\n').encode('utf-8'))
        try:
            os.replace(checksum_temp, sidecar)
        finally:
            checksum_temp.unlink(missing_ok=True)
        return PackageResult(kind, archive, digest, tuple(sorted(files)))
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def build_web(root: Path = ROOT, output_dir: Path | None = None, *, for_publication: bool = False) -> PackageResult:
    root = Path(root).absolute()
    gate = _gate(root, for_publication)
    policy = _policy(root)
    files = {name: _read(root, name, digest) for name, digest in sorted(policy.items())}
    files['_headers'] = WEB_HEADERS.encode('utf-8')
    files['PUBLIC-FILES.json'] = _json({'schema': 'emuperso/web-public-files/v1',
                                      'files': {name: _sha(data) for name, data in sorted(files.items())},
                                      'source_policy': 'tools/serve.py public_file_manifest()',
                                      'deployment_authorized': False})
    return _write('web', root, output_dir or root / 'delivery/rc-0.5.0', files, gate, for_publication)


def build_windows(root: Path = ROOT, output_dir: Path | None = None, *, for_publication: bool = False) -> PackageResult:
    root = Path(root).absolute()
    gate = _gate(root, for_publication)
    policy = _policy(root)
    files = {'real-n64/' + name: _read(root, name, digest)
             for name, digest in sorted(policy.items()) if not name.startswith('vendor/')}
    for name in WINDOWS_EXTRA_FILES:
        files['real-n64/' + name] = _read(root, name)
    files['DEMARRER-N64.bat'] = _read(root.parent, 'DEMARRER-N64.bat')
    return _write('windows', root, output_dir or root / 'delivery/rc-0.5.0', files, gate, for_publication)


def _archive_bytes(path: Path) -> bytes:
    try:
        with Path(path).open('rb') as handle:
            data = handle.read(MAX_TOTAL_BYTES + 1)
    except OSError as error:
        raise DistributionError('Archive de candidate inaccessible.') from error
    if len(data) > MAX_TOTAL_BYTES:
        raise DistributionError('Archive de candidate trop volumineuse.')
    return data


def verify_archive(path: Path) -> dict:
    data = _archive_bytes(path)
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            items = archive.infolist()
            names = [item.filename for item in items]
            if (not names or len(names) > MAX_FILES or len(names) != len(set(names))
                    or sum(item.file_size for item in items) > MAX_TOTAL_BYTES):
                raise DistributionError('ZIP vide, dupliqué ou trop volumineux.')
            for item in items:
                _name(item.filename)
                mode = item.external_attr >> 16
                if (item.is_dir() or item.flag_bits & 1 or item.file_size > MAX_FILE_BYTES
                        or (stat.S_IFMT(mode) and not stat.S_ISREG(mode))):
                    raise DistributionError('Entrée de livraison refusée : ' + item.filename)
            manifest = archive.read(MANIFEST).decode('utf-8')
            if len(manifest.splitlines()) > MAX_FILES:
                raise DistributionError('Manifeste trop volumineux.')
            expected = {}
            for line in manifest.splitlines():
                digest, name = line.split('  ', 1)
                _name(name)
                if (name in expected or name == MANIFEST or len(digest) != 64
                        or any(c not in '0123456789abcdef' for c in digest)):
                    raise DistributionError('Manifeste invalide.')
                expected[name] = digest
            if set(expected) != set(names) - {MANIFEST}:
                raise DistributionError('Le manifeste ne couvre pas exactement le ZIP.')
            for name, digest in expected.items():
                payload = archive.read(name)
                if _sha(payload) != digest:
                    raise DistributionError('Empreinte du ZIP incorrecte : ' + name)
                if name in (DEMO, 'real-n64/' + DEMO) and _sha(payload) != DEMO_SHA:
                    raise DistributionError('ROM autre que la démo MIT refusée.')
            metadata = json.loads(archive.read(METADATA))
            if (not isinstance(metadata, dict) or metadata.get('status') != 'REVUE-PRIVEE-NON-PUBLIEE'
                    or metadata.get('target') not in ('web', 'windows')):
                raise DistributionError('Métadonnées de candidate invalides.')
            if metadata['target'] == 'windows' and any('vendor' in PurePosixPath(name).parts for name in names):
                raise DistributionError('Le ZIP Windows ne doit pas embarquer vendor/.')
            return {'status': 'RÉUSSI', 'target': metadata['target'], 'files': len(names),
                    'sha256': _sha(data), 'metadata': metadata}
    except DistributionError:
        raise
    except (OSError, zipfile.BadZipFile, KeyError, UnicodeError, ValueError) as error:
        raise DistributionError('Archive de candidate invalide ou incomplète.') from error


def extract_verified(path: Path, destination: Path) -> Path:
    """Extract our verified candidate into a new directory, never overwrite data."""
    verified = verify_archive(path)
    data = _archive_bytes(path)
    if _sha(data) != verified['sha256']:
        raise DistributionError('Archive modifiée après sa vérification.')
    destination = Path(destination).absolute()
    if destination.exists() or destination.is_symlink():
        raise DistributionError('Le dossier d’extraction doit être nouveau.')
    for parent in destination.parents:
        if parent.is_symlink() or (hasattr(parent, 'is_junction') and parent.is_junction()):
            raise DistributionError('Lien refusé dans le chemin d’extraction.')
    destination.mkdir(parents=True, exist_ok=False)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for item in archive.infolist():
            target = destination.joinpath(*PurePosixPath(item.filename).parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as handle:
                handle.write(archive.read(item))
    return destination


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Préparer les deux candidates privées, sans réseau ni publication.')
    parser.add_argument('--target', choices=('web', 'windows', 'both'), default='both')
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--for-publication', action='store_true', help='Vérifier les portes F6/Karl ; ne publie rien et ne crée aucun accord.')
    args = parser.parse_args(argv)
    try:
        for name, builder in (('windows', build_windows), ('web', build_web)):
            if args.target in (name, 'both'):
                result = builder(args.root, args.output, for_publication=args.for_publication)
                print(json.dumps({'target': name, 'archive': str(result.archive), 'sha256': result.sha256,
                                  'files': len(result.files), 'status': 'REVUE-PRIVEE-NON-PUBLIEE'}, ensure_ascii=False))
        return 0
    except DistributionError as error:
        print('REFUS : ' + str(error))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
