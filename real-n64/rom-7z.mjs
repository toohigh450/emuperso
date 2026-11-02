// SPDX-License-Identifier: MIT
// Archives .7z de ROM N64, avec le décompresseur du moteur verrouillé (vendor/data/compression/extract7z.js,
// même SHA-256 que docs/runtime-lock.json). Premier passage : noms et tailles ; second : le seul fichier choisi.
import { prepareRomBytes, MAX_ROM_BYTES } from './rom-file.mjs';

export const EXTRACT7Z_SHA256 = '4ac9933b995a516cb6b3ca4027db860278372a20c21c405d93ceb1998498853a';
export const MAX_7Z_BYTES = 96 * 1024 * 1024;
const ROM = /\.(z64|n64|v64)$/i;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

let workerUrl = null;
async function workerSource() {
  if (workerUrl) return workerUrl;
  const r = await fetch('vendor/data/compression/extract7z.js', { cache: 'no-store' });
  if (!r.ok) fail('E_7Z_RUNTIME', 'Décompresseur 7z absent du moteur local.');
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (hex(await crypto.subtle.digest('SHA-256', bytes)) !== EXTRACT7Z_SHA256) fail('E_7Z_RUNTIME', 'Décompresseur 7z non conforme à l’empreinte verrouillée.');
  workerUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/javascript' }));
  return workerUrl;
}

function run(bytes, keep, signal) {
  return workerSource().then((url) => new Promise((resolve, reject) => {
    const worker = new Worker(url), entries = [], kept = {};
    const stop = (error) => { clearTimeout(timer); worker.terminate(); error ? reject(error) : resolve({ entries, kept }); };
    const timer = setTimeout(() => stop(Object.assign(new Error('Archive 7z trop longue à lire ou endommagée.'), { code: 'E_7Z_TIMEOUT' })), 120000);
    signal?.addEventListener('abort', () => stop(Object.assign(new Error('Lecture annulée.'), { code: 'E_ABORT' })), { once: true });
    worker.onerror = () => stop(Object.assign(new Error('Archive 7z illisible.'), { code: 'E_7Z_READ' }));
    worker.onmessage = (e) => {
      const m = e.data;
      if (m?.t === 2 && m.file && !m.file.endsWith('/')) {
        const size = m.data?.byteLength ?? 0;
        if (ROM.test(m.file)) entries.push({ id: entries.length, name: m.file, size });
        if (keep(m.file, size)) kept[m.file] = new Uint8Array(m.data);
      }
      if (m?.t === 1) stop();
    };
    worker.postMessage(bytes);
  }));
}

/** Lit une archive : { archive: { name, bytes }, entries: [{ id, name, size }] } ; garde le fichier s'il est seul. */
export async function read7zFile(file, { signal } = {}) {
  if (file.size > MAX_7Z_BYTES) fail('E_7Z_SIZE', 'Archive 7z trop grosse (96 Mio au plus).');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { entries, kept } = await run(bytes, (n, size) => ROM.test(n) && size <= MAX_ROM_BYTES, signal);
  if (!entries.length) fail('E_7Z_EMPTY', 'Aucune ROM .z64, .n64 ou .v64 dans cette archive 7z.');
  // Une seule ROM, ou toutes petites : déjà en mémoire ; sinon le second passage ne garde que la choisie.
  const total = Object.values(kept).reduce((n, b) => n + b.length, 0);
  return { archive: { name: file.name, bytes, kept: total <= 128 * 1024 * 1024 ? kept : {} }, entries };
}

export async function prepare7zRom(archive, id, { signal } = {}, entries) {
  const entry = entries.find((e) => e.id === id) || fail('E_7Z_ENTRY', 'ROM choisie introuvable dans l’archive.');
  const data = archive.kept[entry.name] || (await run(archive.bytes, (n) => n === entry.name, signal)).kept[entry.name];
  if (!data) fail('E_7Z_ENTRY', 'ROM choisie introuvable dans l’archive.');
  return prepareRomBytes(data, entry.name.replace(/^.*[\\/]/, ''), 'local-7z');
}
