// Stockage local (IndexedDB) : historique des jeux, copies miroir des sauvegardes,
// fichiers de codes importés et associations choisies par l'utilisateur.
// Les sauvegardes « vivantes » appartiennent au moteur ; ici on garde une copie de sécurité
// versionnée (3 générations) qui n'écrase jamais silencieusement la précédente.

export const BUCKETS = ['games', 'saves', 'cheatfiles', 'links', 'settings', 'bios'];
export const SAVE_GENERATIONS = 3;

export class MemoryAdapter {
  constructor() {
    this.data = new Map(BUCKETS.map((b) => [b, new Map()]));
  }
  async get(bucket, key) {
    return this.data.get(bucket).get(key);
  }
  async put(bucket, key, value) {
    this.data.get(bucket).set(key, structuredClone(value));
  }
  async del(bucket, key) {
    this.data.get(bucket).delete(key);
  }
  async keys(bucket) {
    return [...this.data.get(bucket).keys()];
  }
}

export class IdbAdapter {
  constructor(name = 'emuperso-portables') {
    this.name = name;
    this.dbPromise = null;
  }
  open() {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.name, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const b of BUCKETS) if (!db.objectStoreNames.contains(b)) db.createObjectStore(b);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB indisponible'));
      });
    }
    return this.dbPromise;
  }
  async tx(bucket, mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(bucket, mode);
      const store = t.objectStore(bucket);
      const req = fn(store);
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  get(bucket, key) {
    return this.tx(bucket, 'readonly', (s) => s.get(key));
  }
  put(bucket, key, value) {
    return this.tx(bucket, 'readwrite', (s) => s.put(value, key));
  }
  del(bucket, key) {
    return this.tx(bucket, 'readwrite', (s) => s.delete(key));
  }
  keys(bucket) {
    return this.tx(bucket, 'readonly', (s) => s.getAllKeys());
  }
}

export class Store {
  constructor(adapter) {
    this.a = adapter;
    this.saveQueues = new Map();
  }

  // --- Historique des jeux ------------------------------------------------------
  async getGame(key) {
    return (await this.a.get('games', key)) || null;
  }
  async recordGame(meta, now = Date.now()) {
    const prev = (await this.a.get('games', meta.gameKey)) || {};
    const entry = { ...prev, ...meta, lastPlayed: now, plays: (prev.plays || 0) + 1 };
    await this.a.put('games', meta.gameKey, entry);
    return entry;
  }
  async listGames() {
    const keys = await this.a.keys('games');
    const all = [];
    for (const k of keys) all.push(await this.a.get('games', k));
    return all.filter(Boolean).sort((x, y) => (y.lastPlayed || 0) - (x.lastPlayed || 0));
  }
  async forgetGame(gameKey) {
    await this.a.del('games', gameKey);
  }

  // --- Copies miroir des sauvegardes (par espace de sauvegarde) -----------------
  /**
   * Enregistre une nouvelle version de la sauvegarde. L'ancienne est décalée, pas écrasée.
   * Une version identique (même empreinte) n'est pas dupliquée.
   */
  async mirrorSave(spaceId, bytes, hash, now = Date.now()) {
    const copy = new Uint8Array(bytes);
    const previous = this.saveQueues.get(spaceId) || Promise.resolve();
    const task = previous.catch(() => {}).then(() => this._mirrorSave(spaceId, copy, hash, now));
    this.saveQueues.set(spaceId, task);
    try { return await task; }
    finally { if (this.saveQueues.get(spaceId) === task) this.saveQueues.delete(spaceId); }
  }
  async _mirrorSave(spaceId, bytes, hash, now) {
    const head = await this.a.get('saves', `${spaceId}#0`);
    if (head && head.hash === hash) return { changed: false, at: head.at };
    for (let g = SAVE_GENERATIONS - 1; g >= 1; g--) {
      const older = await this.a.get('saves', `${spaceId}#${g - 1}`);
      if (older) await this.a.put('saves', `${spaceId}#${g}`, older);
    }
    const entry = { bytes: new Uint8Array(bytes), hash, at: now, size: bytes.length };
    await this.a.put('saves', `${spaceId}#0`, entry);
    return { changed: true, at: now };
  }
  async getMirrorSave(spaceId, generation = 0) {
    return (await this.a.get('saves', `${spaceId}#${generation}`)) || null;
  }
  async mirrorInfo(spaceId) {
    const out = [];
    for (let g = 0; g < SAVE_GENERATIONS; g++) {
      const e = await this.a.get('saves', `${spaceId}#${g}`);
      if (e) out.push({ generation: g, at: e.at, size: e.size, hash: e.hash });
    }
    return out;
  }
  /** Suppression explicite demandée par l'utilisateur uniquement. */
  async deleteMirror(spaceId) {
    for (let g = 0; g < SAVE_GENERATIONS; g++) await this.a.del('saves', `${spaceId}#${g}`);
  }

  // --- Fichiers de codes importés ----------------------------------------------
  async importCheatFile({ system, path, name, text }) {
    const key = `${system}|${path}`;
    const identity = cheatIdentity(text);
    await this.a.put('cheatfiles', key, { system, path, name, text, romSha256: identity.sha256, identityDeclared: identity.declared });
    return key;
  }
  async listCheatFiles(system) {
    const keys = await this.a.keys('cheatfiles');
    const out = [];
    for (const k of keys) {
      if (!k.startsWith(`${system}|`)) continue;
      const v = await this.a.get('cheatfiles', k);
      if (v) out.push({ system: v.system, path: v.path, name: v.name, romSha256: v.romSha256, identityDeclared: v.identityDeclared });
    }
    return out;
  }
  async getCheatFile(system, path) {
    return (await this.a.get('cheatfiles', `${system}|${path}`)) || null;
  }
  async countCheatFiles() {
    return (await this.a.keys('cheatfiles')).length;
  }
  async clearCheatFiles() {
    for (const k of await this.a.keys('cheatfiles')) await this.a.del('cheatfiles', k);
    for (const k of await this.a.keys('links')) await this.a.del('links', k);
  }

  // --- Association explicite jeu → fichier de codes -----------------------------
  async setCheatLink(gameKey, link) {
    if (link) await this.a.put('links', gameKey, link);
    else await this.a.del('links', gameKey);
  }
  async getCheatLink(gameKey) {
    return (await this.a.get('links', gameKey)) || null;
  }

  // --- Réglages et BIOS optionnels ---------------------------------------------
  async getSetting(key, fallback) {
    const v = await this.a.get('settings', key);
    return v === undefined ? fallback : v;
  }
  async setSetting(key, value) {
    await this.a.put('settings', key, value);
  }
  async setBios(name, bytes) {
    await this.a.put('bios', name, { bytes: new Uint8Array(bytes), at: Date.now() });
  }
  async getBios(name) {
    return (await this.a.get('bios', name)) || null;
  }
  async deleteBios(name) {
    await this.a.del('bios', name);
  }
}
import { cheatIdentity } from './cheats.mjs';

