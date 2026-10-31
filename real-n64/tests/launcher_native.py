"""Real loopback checks of the shared launcher; Windows bootstrap has its own CI."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import launcher

results = []


def passed(name, proof):
    results.append({'name': name, 'result': 'RÉUSSI', 'proof': proof})
    print('RÉUSSI :', name)


launcher.prepare(True)
passed('Préparation locale hors ligne', '39 assets vérifiés ; aucun téléchargement de ROM.')
server = launcher.make_server(0, 'native-test-token')
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
base = f'http://127.0.0.1:{server.server_port}'
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
try:
    launcher.verify_ready(base, 'native-test-token')
    try:
        launcher.verify_ready(base, 'wrong-token')
        raise AssertionError('Wrong token accepted')
    except RuntimeError:
        pass
    passed('Identité de session', 'Vraie requête HTTP ; jeton correct accepté, jeton erroné refusé.')

    with opener.open(base + '/') as response:
        assert 'Choisir une ROM' in response.read().decode()
        assert response.headers['Cross-Origin-Opener-Policy'] == 'same-origin'
        assert response.headers['Cross-Origin-Embedder-Policy'] == 'require-corp'
    with opener.open(base + '/rom-file.mjs') as response:
        assert response.headers.get_content_type() == 'text/javascript'
    with opener.open(base + '/homebrew/fallback-open/demo-emuperso-open.z64') as response:
        assert hashlib.sha256(response.read()).hexdigest() == 'f18280a16c83721bdd56564701d505f96346784f36168402e5431b12499e2252'
    passed('Interface et démo', 'HTTP 200, bouton import, MIME mjs, COOP/COEP et hash démo MIT.')

    for method in ('GET', 'HEAD'):
        for path in ('/cache/launcher.log', '/.python/python.exe', '/.git/config', '/%2e%2e/README.md'):
            try:
                opener.open(urllib.request.Request(base + path, method=method))
                raise AssertionError('Protected path accepted')
            except urllib.error.HTTPError as error:
                assert error.code == 403
    try:
        opener.open(urllib.request.Request(base + '/', method='POST', data=b'test'))
        raise AssertionError('Upload accepted')
    except urllib.error.HTTPError as error:
        assert error.code == 501
    passed('Protection HTTP', '8 GET/HEAD refusés 403 ; POST refusé 501.')

    try:
        other = launcher.make_server(server.server_port, 'foreign')
        other.server_close()
        raise AssertionError('Port stolen')
    except OSError:
        pass
    launcher.verify_ready(base, 'native-test-token')
    passed('Second lancement', 'Deuxième bind refusé ; première instance toujours accessible.')
finally:
    server.shutdown()
    server.server_close()
    thread.join(2)

with tempfile.TemporaryDirectory() as folder:
    root = Path(folder)
    (root / 'cache').mkdir()
    original = root / 'original.txt'
    original.write_text('protected test original')
    (root / 'cache/launcher.log').symlink_to(original)
    with mock.patch.object(launcher, 'ROOT', root):
        try:
            launcher.configure_logging()
            raise AssertionError('Symlink accepted')
        except ValueError:
            pass
    assert original.read_text() == 'protected test original'
passed('Journal sans traversée de lien', 'Lien refusé avant écriture ; fichier témoin inchangé.')

(ROOT / 'evidence/launcher-native-results.json').write_text(json.dumps({
    'schema': 'emuperso/native-launcher-tests/v1', 'platform': sys.platform,
    'tests': results,
    'non_testes': ['Bootstrap Windows : CI séparée', 'PC de Karl', 'Jeux commerciaux'],
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'TOTAL : {len(results)} RÉUSSI')
