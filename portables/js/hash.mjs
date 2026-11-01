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
