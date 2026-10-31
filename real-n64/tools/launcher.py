#!/usr/bin/env python3
"""Prepare the isolated runtime, serve it, then open the local interface.

No user ROM is read here. The official runtime installer does all dependency
verification; it uses the network only when a required cached package is absent.
Windows calls this with the embedded interpreter, never a system Python.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import urllib.request
import webbrowser
from http.server import ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
# CPython's embedded _pth mode does not add the script directory automatically.
sys.path.insert(0, str(ROOT / 'tools'))
import fetch_runtime
import fetch_cheats
from serve import Handler

HEALTH_PATH = '/__n64lab_health'
APPLICATION = 'emuperso-real-n64'
LOG = logging.getLogger('n64-launcher')


def configure_logging() -> None:
    cache = ROOT / 'cache'
    if cache.is_symlink():
        raise ValueError('Le dossier cache ne doit pas etre un lien symbolique.')
    cache.mkdir(exist_ok=True)
    LOG.setLevel(logging.INFO)
    log_path = fetch_runtime.safe_target(cache, 'launcher.log')
    file_handler = logging.FileHandler(log_path, encoding='utf-8')
    file_handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(logging.Formatter('%(message)s'))
    LOG.addHandler(file_handler)
    LOG.addHandler(console)


def prepare(offline: bool) -> None:
    lock = fetch_runtime.load_lock()
    try:
        count = fetch_runtime.verify_install(ROOT / 'vendor', lock['files'])
        LOG.info('Moteur local deja pret : %s fichiers verifies.', count)
    except (OSError, ValueError):
        LOG.info('Preparation du moteur local. Le premier lancement necessite Internet.')
        count = fetch_runtime.install(lock, ROOT / 'cache', ROOT / 'vendor', offline)
        LOG.info('Preparation terminee : %s fichiers verifies.', count)
    try:
        count = fetch_cheats.install(offline=offline)
        LOG.info('Catalogue de cheats local verifie : %s fichiers. Aucun code active automatiquement.', count)
    except (OSError, ValueError, KeyError) as error:
        LOG.warning('Catalogue de cheats indisponible ; le jeu reste utilisable : %s', error)


def make_server(port: int, instance: str) -> ThreadingHTTPServer:
    class LauncherHandler(Handler):
        def do_GET(self):
            if self.path == HEALTH_PATH:
                body = json.dumps({'application': APPLICATION, 'instance': instance}).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                super().do_GET()

    class LocalServer(ThreadingHTTPServer):
        # Windows SO_REUSEADDR permits a second listener on an occupied port.
        # Claim this port exclusively, instead of accidentally serving requests
        # meant for a different app or an already running copy of this prototype.
        allow_reuse_address = os.name != 'nt'

        def server_bind(self):
            if os.name == 'nt':
                self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            super().server_bind()

    return LocalServer(('127.0.0.1', port), LauncherHandler)


def verify_ready(url: str, instance: str) -> None:
    # This request is strictly loopback. Do not pass it through an HTTP proxy.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(url + HEALTH_PATH, timeout=5) as response:
        data = json.load(response)
    if data != {'application': APPLICATION, 'instance': instance}:
        raise RuntimeError('Le serveur local ne correspond pas a cette session.')


def find_chrome() -> str | None:
    if os.name == 'nt':
        import winreg
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            try:
                with winreg.OpenKey(hive, r'SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe') as key:
                    path = winreg.QueryValue(key, None)
                    if Path(path).is_file():
                        return path
            except OSError:
                pass
        for variable, suffix in (
            ('PROGRAMFILES', 'Google/Chrome/Application/chrome.exe'),
            ('PROGRAMFILES(X86)', 'Google/Chrome/Application/chrome.exe'),
            ('LOCALAPPDATA', 'Google/Chrome/Application/chrome.exe'),
        ):
            base = os.environ.get(variable)
            if base and (Path(base) / suffix).is_file():
                return str(Path(base) / suffix)
    return shutil.which('chrome') or shutil.which('google-chrome') or shutil.which('chromium')


def open_interface(url: str) -> None:
    chrome = find_chrome()
    if chrome:
        subprocess.Popen([chrome, url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        LOG.info('Interface ouverte dans Chrome / Chromium.')
    elif webbrowser.open(url):
        LOG.info('Chrome introuvable : interface ouverte dans le navigateur par defaut.')
    else:
        LOG.warning('Ouverture automatique impossible. Adresse a ouvrir : %s', url)


def main() -> int:
    parser = argparse.ArgumentParser(description='Preparation et lancement automatiques du prototype local.')
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--port', type=int, default=8770)
    args = parser.parse_args()
    server = None
    thread = None
    try:
        configure_logging()
        if not 1 <= args.port <= 65535:
            raise ValueError('Le port doit etre compris entre 1 et 65535.')
        LOG.info('N64 Web - lancement local. Python %s : %s', sys.version.split()[0], sys.executable)
        prepare(args.offline)
        if args.prepare_only:
            LOG.info('Preparation et verification terminees.')
            return 0
        try:
            instance = secrets.token_hex(24)
            server = make_server(args.port, instance)
        except OSError as error:
            raise RuntimeError(f'Le port local {args.port} est indisponible. Si N64 Web est deja ouvert, utilisez sa fenetre existante. Aucun autre service ne sera arrete.') from error
        thread = threading.Thread(target=server.serve_forever, daemon=True, name='n64-local-http')
        thread.start()
        url = f'http://127.0.0.1:{args.port}'
        verify_ready(url, instance)
        LOG.info('PRET : %s/ - gardez cette fenetre ouverte. Ctrl+C pour arreter.', url)
        if not args.no_browser:
            try:
                open_interface(url + '/')
            except OSError as error:
                LOG.warning('Ouverture du navigateur impossible : %s. Ouvrez %s/', error, url)
        while thread.is_alive():
            thread.join(0.5)
        return 0
    except KeyboardInterrupt:
        LOG.info('Arret du serveur local.')
        return 0
    except Exception as error:
        if LOG.handlers:
            LOG.error('ECHEC : %s', error)
            LOG.debug('Detail', exc_info=True)
        else:
            print('ECHEC : ' + str(error), file=sys.stderr)
        return 1
    finally:
        if server is not None:
            if thread is not None and thread.is_alive():
                server.shutdown()
            server.server_close()


if __name__ == '__main__':
    raise SystemExit(main())
