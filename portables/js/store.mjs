import { cheatIdentity } from './cheats.mjs';
import { fingerprint, numericId } from './hash.mjs';
import { saveSpaceId } from './hash.mjs';
import { SYSTEMS, DS_CORES } from './systems.mjs';

// Stockage local (IndexedDB) : historique des jeux, copies miroir des sauvegardes,
// fichiers de codes importés et associations choisies par l'utilisateur.
// Les sauvegardes « vivantes » appartiennent au moteur ; ici on garde une copie de sécurité
// versionnée (3 générations) qui n'écrase jamais silencieusement la précédente.

// Version 2 : ajout de « codes » (codes saisis et état activé, par jeu) et « states » (états de jeu, par espace).
// La montée de version crée seulement les magasins absents : aucune donnée existante n'est touchée.
export const BUCKETS = ['games', 'saves', 'cheatfiles', 'links', 'settings', 'bios', 'codes', 'states'];
export const DB_VERSION = 2;
export const STATE_SLOTS = 4;
export const SAVE_GENERATIONS = 3;
export const CHEAT_LIMITS = { fileBytes: 2 * 1024 * 1024, batchBytes: 32 * 1024 * 1024, batchFiles: 1000, totalBytes: 64 * 1024 * 1024, totalFiles: 5000 };

function checkedCheatMap(existing, entries, limits) {
  const next = new Map(existing);
  for (const entry of entries) {
    const key = `${entry.system}|${entry.path}`;
    const previous = next.get(key);
    next.set(key, { ...entry, reviewRequired: !!(entry.reviewRequired || previous && (previous.reviewRequired || previous.text !== entry.text)) });
  }
  const bytes = [...next.values()].reduce((sum, f) => sum + (f.byteSize ?? new TextEncoder().encode(f.text).length), 0);
  if (next.size > limits.totalFiles || bytes > limits.totalBytes) throw new Error('Budget total des codes dépassé (5000 fichiers / 64 Mio).');
  return next;
}

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
  async commitCheats(entries, limits) {
    this.data.set('cheatfiles', checkedCheatMap(this.data.get('cheatfiles'), entries, limits));
  }
  async rotateMirror(spaceId, entry) {
    const saves = this.data.get('saves');
    const head = saves.get(`${spaceId}#0`);
    if (head?.hash === entry.hash) return { changed: false, at: head.at };
    const next = new Map(saves);
    for (let g = SAVE_GENERATIONS - 1; g >= 1; g--) {
      const old = saves.get(`${spaceId}#${g - 1}`);
      if (old) next.set(`${spaceId}#${g}`, structuredClone(old));
      else next.delete(`${spaceId}#${g}`);
    }
    next.set(`${spaceId}#0`, structuredClone(entry));
    this.data.set('saves', next);
    return { changed: true, at: entry.at };
  }
  async claimNumericId(spaceId, preferred) {
    const settings = this.data.get('settings');
    const key = `engine-id:${spaceId}`;
    if (settings.has(key)) return settings.get(key);
    let id = preferred;
    while (settings.has(`engine-owner:${id}`) && settings.get(`engine-owner:${id}`) !== spaceId) id = id === 0x7fffffff ? 2 : id + 1;
    settings.set(`engine-owner:${id}`, spaceId);
    settings.set(key, id);
    return id;
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
        const req = indexedDB.open(this.name, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const b of BUCKETS) if (!db.objectStoreNames.contains(b)) db.createObjectStore(b);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB indisponible'));
        req.onblocked = () => reject(new Error('Mise à jour du stockage bloquée : ferme les autres onglets du lanceur puis recharge la page.'));
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
  async commitCheats(entries, limits) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cheatfiles', 'readwrite');
      const bucket = tx.objectStore('cheatfiles');
      let failure;
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(failure || tx.error || new Error('Import des codes annulé.'));
      const req = bucket.openCursor();
      const existing = new Map();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) { existing.set(cursor.key, cursor.value); cursor.continue(); return; }
        try {
          const next = checkedCheatMap(existing, entries, limits);
          for (const entry of entries) {
            const key = `${entry.system}|${entry.path}`;
            bucket.put(next.get(key), key);
          }
        } catch (err) { failure = err; tx.abort(); }
      };
    });
  }
  async rotateMirror(spaceId, entry) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('saves', 'readwrite');
      const bucket = tx.objectStore('saves');
      let result;
      const old = [];
      let pending = SAVE_GENERATIONS;
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Rotation de sauvegarde annulée.'));
      for (let g = 0; g < SAVE_GENERATIONS; g++) {
        const req = bucket.get(`${spaceId}#${g}`);
        req.onsuccess = () => {
          old[g] = req.result;
          if (--pending) return;
          if (old[0]?.hash === entry.hash) { result = { changed: false, at: old[0].at }; return; }
          for (let n = SAVE_GENERATIONS - 1; n >= 1; n--) {
            if (old[n - 1]) bucket.put(old[n - 1], `${spaceId}#${n}`);
            else bucket.delete(`${spaceId}#${n}`);
          }
          bucket.put(entry, `${spaceId}#0`);
          result = { changed: true, at: entry.at };
        };
      }
    });
  }
  async claimNumericId(spaceId, preferred) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      const bucket = tx.objectStore('settings');
      let id;
      tx.oncomplete = () => resolve(id);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Identifiant moteur non enregistré.'));
      const key = `engine-id:${spaceId}`;
      const existing = bucket.get(key);
      existing.onsuccess = () => {
        if (existing.result !== undefined) { id = existing.result; return; }
        const probe = (candidate) => {
          const ownerKey = `engine-owner:${candidate}`;
          const owner = bucket.get(ownerKey);
          owner.onsuccess = () => {
            if (owner.result !== undefined && owner.result !== spaceId) {
              probe(candidate === 0x7fffffff ? 2 : candidate + 1); return;
            }
            id = candidate;
            bucket.put(spaceId, ownerKey);
            bucket.put(id, key);
          };
        };
        probe(preferred);
      };
    });
  }

}

export class Store {
  constructor(adapter) {
    this.a = adapter;
    this.saveQueues = new Map();
    this.historyQueue = Promise.resolve();
  }

  // --- Historique des jeux ------------------------------------------------------
  async getGame(key) {
    return (await this.a.get('games', key)) || null;
  }
  recordGame(meta, now = Date.now()) {
    const task = this.historyQueue.catch(() => {}).then(() => this._recordGame(meta, now));
    this.historyQueue = task;
    return task;
  }
  async _recordGame(meta, now) {
    const prev = (await this.a.get('games', meta.gameKey)) || {};
    const entry = { ...prev, ...meta, historyVersion: 2, lastOpened: now, opens: (prev.opens || 0) + 1,
      legacyOpens: prev.legacyOpens ?? (prev.historyVersion === 2 ? 0 : prev.plays || 0),
      plays: prev.historyVersion === 2 ? prev.plays || 0 : 0, status: 'opened' };
    await this.a.put('games', meta.gameKey, entry);
    return entry;
  }
  recordLifecycle(key, event, now = Date.now()) {
    if (!['ready', 'started'].includes(event)) return Promise.reject(new Error('Événement historique inconnu.'));
    const task = this.historyQueue.catch(() => {}).then(async () => {
      const entry = await this.getGame(key);
      if (!entry) return;
      if (event === 'ready') { entry.readyCount = (entry.readyCount || 0) + 1; entry.lastReady = now; }
      else { entry.plays = (entry.plays || 0) + 1; entry.lastPlayed = now; }
      entry.status = event;
      await this.a.put('games', key, entry);
    });
    this.historyQueue = task;
    return task;
  }
  async listGames() {
    const keys = await this.a.keys('games');
    const all = [];
    for (const k of keys) all.push(await this.a.get('games', k));
    return all.filter(Boolean).sort((x, y) => (y.lastOpened || y.lastPlayed || 0) - (x.lastOpened || x.lastPlayed || 0));
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
    const entry = { bytes: new Uint8Array(bytes), hash, at: now, size: bytes.length };
    return this.a.rotateMirror(spaceId, entry);
  }
  async engineNumericId(spaceId, preferred = numericId(spaceId)) {
    if (!Number.isInteger(preferred) || preferred < 2 || preferred > 0x7fffffff) throw new Error('Identifiant moteur invalide.');
    return this.a.claimNumericId(spaceId, preferred);
  }
  async reserveHistoricalEngineIds() {
    const games = (await this.listGames()).sort((a, b) => a.gameKey.localeCompare(b.gameKey));
    for (const game of games) {
      if (!SYSTEMS[game.system] || !game.hash) continue;
      const cores = game.system === 'nds' ? Object.keys(DS_CORES) : [SYSTEMS[game.system].coreId];
      for (const core of cores) await this.engineNumericId(saveSpaceId(game.system, core, game.hash));
    }
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
  async prepareCheatFile({ system, path, name, text }) {
    const key = `${system}|${path}`;
    const encoded = new TextEncoder().encode(text);
    const byteSize = encoded.length;
    if (byteSize > CHEAT_LIMITS.fileBytes) throw new Error('Fichier de codes trop gros (maximum 2 Mio).');
    const identity = cheatIdentity(text);
    const contentSha256 = (await fingerprint(encoded)).hex;
    const previous = await this.a.get('cheatfiles', key);
    const previousHash = previous && (previous.contentSha256 || (await fingerprint(new TextEncoder().encode(previous.text))).hex);
    const reviewRequired = !!previous && (previous.reviewRequired || previousHash !== contentSha256);
    return { system, path, name, text, byteSize, romSha256: identity.sha256, identityDeclared: identity.declared, contentSha256, reviewRequired };
  }
  async importCheatFile(file) {
    const entry = await this.prepareCheatFile(file);
    await this.commitCheatFiles([entry]);
    const key = `${entry.system}|${entry.path}`;
    return key;
  }
  async commitCheatFiles(entries) {
    if (entries.length > CHEAT_LIMITS.batchFiles || entries.reduce((sum, f) => sum + f.byteSize, 0) > CHEAT_LIMITS.batchBytes) throw new Error('Lot de codes trop gros (1000 fichiers / 32 Mio).');
    await this.a.commitCheats(entries, CHEAT_LIMITS);
  }
  async listCheatFiles(system) {
    const keys = await this.a.keys('cheatfiles');
    const out = [];
    for (const k of keys) {
      if (!k.startsWith(`${system}|`)) continue;
      const v = await this.a.get('cheatfiles', k);
      if (v) out.push({ system: v.system, path: v.path, name: v.name, romSha256: v.romSha256, identityDeclared: v.identityDeclared, contentSha256: v.contentSha256, reviewRequired: v.reviewRequired });
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

  // --- Codes de triche par jeu (saisis à la main ou issus d'un .cht associé) -----
  // Chaque entrée : { id, name, code, enabled, origin: 'manuel' | 'fichier', format }.
  async getCodes(gameKey) {
    const v = await this.a.get('codes', gameKey);
    return v && Array.isArray(v.entries) ? v.entries : [];
  }
  async setCodes(gameKey, entries) {
    await this.a.put('codes', gameKey, { entries: entries.map((e) => ({ ...e })), at: Date.now() });
  }

  // --- États de jeu (save states), par espace de sauvegarde et par emplacement ----
  // Écraser un emplacement garde l'état précédent en copie « -avant » : rien n'est perdu en un clic.
  async putState(spaceId, slot, bytes, meta = {}, now = Date.now()) {
    if (!Number.isInteger(slot) || slot < 1 || slot > STATE_SLOTS) throw new Error('Emplacement d’état invalide.');
    const key = `${spaceId}#${slot}`;
    const previous = await this.a.get('states', key);
    if (previous) await this.a.put('states', `${key}-avant`, previous);
    const copy = new Uint8Array(bytes);
    await this.a.put('states', key, { bytes: copy, size: copy.length, at: now, ...meta });
  }
  async getState(spaceId, slot, previous = false) {
    return (await this.a.get('states', `${spaceId}#${slot}${previous ? '-avant' : ''}`)) || null;
  }
  async listStates(spaceId) {
    const out = [];
    for (let slot = 1; slot <= STATE_SLOTS; slot++) {
      const e = await this.a.get('states', `${spaceId}#${slot}`);
      const p = await this.a.get('states', `${spaceId}#${slot}-avant`);
      out.push({ slot, at: e?.at || null, size: e?.size || 0, previousAt: p?.at || null });
    }
    return out;
  }
  async deleteState(spaceId, slot) {
    await this.a.del('states', `${spaceId}#${slot}`);
    await this.a.del('states', `${spaceId}#${slot}-avant`);
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
