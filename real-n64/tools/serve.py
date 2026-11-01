"""Loopback static server exposing an exact application allowlist only.

User ROMs/saves are browser data, never HTTP resources. The sole served ROM is
the repository's MIT diagnostic homebrew, with its expected content hash. Files
added beside the app are private by default, regardless of their extension.
"""
from __future__ import annotations

import argparse
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import stat
from types import MappingProxyType
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
DEMO_PATH = 'homebrew/fallback-open/demo-emuperso-open.z64'
DEMO_SHA256 = 'f18280a16c83721bdd56564701d505f96346784f36168402e5431b12499e2252'

# Exact names, never suffix rules, globbing or a directory walk. This is also
# the source of truth for creating a separate public static distribution.
APP_FILES = frozenset({
    'index.html', 'app.js', 'style.css', 'engine.html', 'engine.css',
    'engine-session.mjs', 'session-controller.mjs', 'native-state.mjs', 'runtime-integrity.mjs', 'rom-file.mjs',
    'zip-rom.mjs', 'save-store.mjs', 'state-bundle.mjs', 'legacy-battery.mjs',
    'cheat-catalog.mjs', 'README-FR.md', 'LICENSE',
    'docs/runtime-lock.json', 'docs/cheat-catalog-lock.json',
    'docs/RC-0.5.0.html', 'docs/THIRD-PARTY.md',
    'assets/emuperso-banner.png',
    'docs/REDISTRIBUTION-RC.md', 'docs/redistribution-rc.json',
    'docs/licenses/README.md',
    'docs/licenses/EmulatorJS-4.2.3-GPL-3.0.txt',
    'docs/licenses/Mupen64Plus-container-GPL-2.0.txt',
    'docs/licenses/Socket.IO-4.8.1-MIT.txt',
    'docs/licenses/nipplejs-MIT.txt', 'docs/licenses/UnRAR-license.txt',
    'docs/licenses/CPython-3.12.10-LICENSE.txt',
    'homebrew/fallback-open/build-info.json', 'homebrew/fallback-open/LICENSE',
})
TEST_FILES = frozenset({
    'tests/save-store-browser.html', 'tests/legacy-battery-browser.html',
})


def _relative_name(name: str) -> bool:
    return (isinstance(name, str) and bool(name) and not name.startswith('/')
            and not any(character in name for character in ('\\', ':', '%'))
            and all(part and not part.startswith('.') for part in name.split('/'))
            and not any(ord(character) < 32 or ord(character) == 127 for character in name))


def _public_manifest() -> dict[str, str | None]:
    manifest = {name: None for name in APP_FILES}
    manifest[DEMO_PATH] = DEMO_SHA256
    manifest['assets/emuperso-banner.png'] = '99a180b2a9ca480c405a939cc8d3f79893a1a32de47579b88740ca3ff4e6aa9d'
    lock = json.loads((ROOT / 'docs/runtime-lock.json').read_text(encoding='utf-8'))
    for relative, digest in lock['files'].items():
        if not _relative_name(relative) or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
            raise ValueError('Le manifeste du moteur contient un chemin ou une empreinte invalide.')
        manifest['vendor/' + relative] = digest
    catalog = json.loads((ROOT / 'docs/cheat-catalog-lock.json').read_text(encoding='utf-8'))
    for asset in catalog['assets']:
        name, digest = asset['file'], asset['sha256']
        if '/' in name or not _relative_name(name) or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
            raise ValueError('Le manifeste du catalogue contient un chemin ou une empreinte invalide.')
        manifest['vendor/cheats/' + name] = digest
    return manifest


_PUBLIC_MANIFEST = MappingProxyType(_public_manifest())
PUBLIC_FILES = frozenset(_PUBLIC_MANIFEST)


def public_file_manifest() -> dict[str, str | None]:
    """Return exact public paths and pinned hashes; no local file enumeration."""
    return dict(_PUBLIC_MANIFEST)


def _request_name(url: str) -> str | None:
    try:
        parsed = urlsplit(url)
        if parsed.scheme or parsed.netloc or parsed.fragment:
            return None
        path = unquote(parsed.path, encoding='utf-8', errors='strict')
    except (ValueError, UnicodeError):
        return None
    if not path.startswith('/'):
        return None
    name = 'index.html' if path == '/' else path[1:]
    return name if _relative_name(name) else None


def _safe_target(name: str, root: Path) -> Path | None:
    root = Path(root)
    target = root
    # Reject links even if they resolve inside the root: the allowlist authorizes
    # these files themselves, not aliases to another file or directory.
    for component in name.split('/'):
        target = target / component
        if target.is_symlink() or (hasattr(target, 'is_junction') and target.is_junction()):
            return None
    try:
        return target if target.resolve().is_relative_to(root.resolve()) else None
    except (OSError, RuntimeError):
        return None


def allowed_path(url: str, root: Path = ROOT, extra_files: frozenset[str] = frozenset()) -> bool:
    name = _request_name(url)
    return (name is not None and (name in PUBLIC_FILES or name in extra_files)
            and _safe_target(name, root) is not None)


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript'}
    document_root = ROOT
    extra_files: frozenset[str] = frozenset()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(self.document_root), **kwargs)

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def send_head(self):
        # GET and HEAD share exactly the same authorization and integrity path.
        # Never call SimpleHTTPRequestHandler's implicit directory/index logic.
        name = _request_name(self.path)
        if name is None or (name not in PUBLIC_FILES and name not in self.extra_files):
            self.send_error(403, 'Ressource non publique')
            return None
        target = _safe_target(name, self.document_root)
        if target is None:
            self.send_error(403, 'Lien ou chemin refuse')
            return None
        file = None
        try:
            # No-follow protects the final component on platforms supporting
            # it; non-blocking open prevents a misplaced FIFO from hanging a
            # request before its type can be rejected by fstat.
            flags = os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
            descriptor = os.open(target, flags)
            try:
                file = os.fdopen(descriptor, 'rb')
            except BaseException:
                os.close(descriptor)
                raise
            details = os.fstat(file.fileno())
            if not stat.S_ISREG(details.st_mode):
                raise ValueError('Ressource non reguliere')
            digest = _PUBLIC_MANIFEST.get(name)
            if digest is not None and hashlib.file_digest(file, 'sha256').hexdigest() != digest:
                raise ValueError('Empreinte de ressource publique incorrecte')
            file.seek(0)
            # Check again before returning any bytes if a parent/link changed
            # between resolution and open. The already-open handle is served.
            if _safe_target(name, self.document_root) is None:
                raise ValueError('Chemin modifie pendant la lecture')
        except (ValueError, OSError) as error:
            if file is not None:
                file.close()
            self.send_error(404 if isinstance(error, FileNotFoundError) else 403,
                            'Ressource absente' if isinstance(error, FileNotFoundError) else 'Ressource refusee')
            return None
        self.send_response(200)
        self.send_header('Content-Type', self.guess_type(str(target)))
        self.send_header('Content-Length', str(details.st_size))
        self.send_header('Last-Modified', self.date_time_string(details.st_mtime))
        self.end_headers()
        return file

    def list_directory(self, path):
        self.send_error(403, 'Liste des fichiers interdite')
        return None

    def log_message(self, format, *args):
        pass


def test_handler(*files: str) -> type[Handler]:
    """Explicit, code-only fixture server; production has no test URL/flag.

    Only the two known synthetic HTML benches can be opted into. The production
    Handler and Windows launcher never call this factory.
    """
    paths = frozenset(files)
    if not paths or not paths <= TEST_FILES:
        raise ValueError('Page de test non autorisee')

    class TestHandler(Handler):
        extra_files = paths

    return TestHandler


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8770)
    args = parser.parse_args()
    print(f'N64 réel : http://127.0.0.1:{args.port}/ — Ctrl+C pour arrêter', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
