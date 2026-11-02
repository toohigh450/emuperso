// SPDX-License-Identifier: MIT
// Byte integrity does not establish the corresponding source or its licence.
const HASH = /^[a-f0-9]{64}$/;
export function sriValue(hash) {
  if (typeof hash !== 'string' || !HASH.test(hash)) throw new Error('Empreinte de ressource absente ou invalide.');
  return 'sha256-' + btoa(String.fromCharCode(...hash.match(/../g).map(byte => parseInt(byte, 16))));
}
export async function verifyRuntimeBytes(input, expected, resource) {
  if (!HASH.test(expected ?? '')) throw Object.assign(new Error('Ressource moteur non autorisée : ' + resource), { code: 'E_RUNTIME_UNPINNED' });
  const bytes = ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const actual = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== expected) throw Object.assign(new Error('Ressource moteur altérée ou de mauvaise version : ' + resource + '. Le démarrage est annulé.'), { code: 'E_RUNTIME_INTEGRITY' });
  return actual;
}
