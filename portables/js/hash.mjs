// Empreintes de jeux et identifiants d'espaces de sauvegarde.
// L'empreinte sert de clé : un jeu = une empreinte = un espace de sauvegarde, jamais partagé.

export function toHex(buffer) {
  const b = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < b.length; i++) out += b[i].toString(16).padStart(2, '0');
  return out;
}

/**
 * SHA-256 de tous les octets, y compris pour les grosses ROM DS.
 * Un échantillon ne distingue pas deux hacks modifiant une zone non échantillonnée.
 */
export async function fingerprint(bytes) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw new Error("Calcul d'empreinte indisponible (contexte non sécurisé). Ouvre la page via le lanceur.");
  return { algo: 'sha256', hex: toHex(await subtle.digest('SHA-256', bytes)) };
}

// SHA-256 par morceaux : crypto.subtle demande tout le fichier en mémoire, ce qu'un jeu PSP
// de 1,8 Go ne permet pas. Même résultat que subtle.digest (vérifié par les tests).
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export class Sha256 {
  constructor() {
    this.h = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    this.w = new Int32Array(64);
    this.buf = new Uint8Array(64);
    this.used = 0;
    this.length = 0;
  }
  block(b, p) {
    const w = this.w, h = this.h;
    for (let i = 0; i < 16; i++, p += 4) w[i] = (b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3];
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h[0], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7], bb = h[1];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (k + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + k) | 0;
  }
  update(bytes) {
    let p = 0;
    this.length += bytes.length;
    if (this.used) {
      const take = Math.min(64 - this.used, bytes.length);
      this.buf.set(bytes.subarray(0, take), this.used);
      this.used += take;
      p = take;
      if (this.used < 64) return this;
      this.block(this.buf, 0);
      this.used = 0;
    }
    for (; p + 64 <= bytes.length; p += 64) this.block(bytes, p);
    if (p < bytes.length) { this.buf.set(bytes.subarray(p), 0); this.used = bytes.length - p; }
    return this;
  }
  digest() {
    const bits = this.length * 8;
    const pad = new Uint8Array((this.used < 56 ? 56 : 120) - this.used + 8);
    pad[0] = 0x80;
    const view = new DataView(pad.buffer);
    view.setUint32(pad.length - 8, Math.floor(bits / 2 ** 32));
    view.setUint32(pad.length - 4, bits >>> 0);
    this.update(pad);
    const out = new Uint8Array(32);
    const v = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) v.setInt32(i * 4, this.h[i]);
    return out;
  }
}

/**
 * SHA-256 de tous les octets d'un fichier lu par morceaux de 8 Mio (jeux PSP).
 * onProgress(lus, total) est appelé après chaque morceau.
 */
export async function fingerprintBlob(blob, onProgress = () => {}) {
  const sha = new Sha256();
  const chunk = 8 * 1024 * 1024;
  for (let p = 0; p < blob.size; p += chunk) {
    sha.update(new Uint8Array(await blob.slice(p, p + chunk).arrayBuffer()));
    onProgress(Math.min(p + chunk, blob.size), blob.size);
  }
  return { algo: 'sha256', hex: toHex(sha.digest()) };
}

/** Identifiant d'espace de sauvegarde : console + cœur + empreinte. Le cœur en fait partie. */
export function saveSpaceId(systemId, coreId, hex) {
  return `${systemId}:${coreId}:${hex.slice(0, 32)}`;
}

/** Clé de jeu (indépendante du cœur) pour l'historique et les codes. */
export function gameKey(systemId, hex) {
  return `${systemId}:${hex.slice(0, 32)}`;
}

/** Entier positif stable dérivé d'un texte (FNV-1a 32 bits), pour EJS_gameID. */
export function numericId(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const id = h & 0x7fffffff;
  return id < 2 ? id + 2 : id;
}

export function slug(text) {
  const s = String(text || 'jeu')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (s || 'jeu').slice(0, 40);
}

/** Nom de jeu unique transmis à EmulatorJS (EJS_gameName). */
export function ejsGameName(title, coreId, hex) {
  return `rom-${hex}-${coreId}`;
}

/** Ancien nom conservé pour retrouver les sauvegardes des jeux déjà connus en 0.1. */
export function legacyEjsGameName(title, coreId, hex) {
  return `${slug(title)}-${hex.slice(0, 8)}-${coreId}`;
}
