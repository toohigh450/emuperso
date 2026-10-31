export class LabError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'LabError'; this.code = code; this.details = details; }
}
export const labAssert = (ok, code, message, details) => { if (!ok) throw new LabError(code, message, details); };
export const copy = value => structuredClone(value);
export function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); for (const item of Object.values(value)) freeze(item); } return value; }
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  labAssert(value && Object.getPrototypeOf(value) === Object.prototype, 'E_SCHEMA', 'Objet JSON simple requis.');
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
export async function digest(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : canonical(value));
  let result;
  try { result = await globalThis.crypto.subtle.digest('SHA-256', bytes); }
  catch { throw new LabError('E_CRYPTO', 'SHA-256 indisponible ; aucun remplacement faible.'); }
  return [...new Uint8Array(result)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function exactKeys(value, keys) { labAssert(value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).sort().join('|') === [...keys].sort().join('|'), 'E_SCHEMA', 'Champs de schéma inattendus.'); }
export function bounded(value, max = 4096) { labAssert(canonical(value).length <= max, 'E_SIZE', 'Objet trop volumineux.'); return value; }
export const systemClock = { monotonic: () => performance.now(), utc: () => new Date().toISOString() };
export class ManualClock {
  constructor() { this.ms = 0; }
  monotonic() { return this.ms; }
  utc() { return new Date(1700000000000 + this.ms).toISOString(); }
  advance(ms) { labAssert(Number.isFinite(ms) && ms >= 0, 'E_CLOCK', 'Avancement monotone invalide.'); this.ms += ms; }
}
export function abortError(signal) { if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new LabError('E_ABORTED', 'Opération annulée.'); }
export function sleep(ms, signal) {
  abortError(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    function cancel() { clearTimeout(timer); reject(signal.reason ?? new LabError('E_ABORTED', 'Annulé.')); }
    signal?.addEventListener('abort', cancel, { once: true });
  });
}
