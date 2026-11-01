// SPDX-License-Identifier: MIT
// Harnais de test : exécute le VRAI app.js (pas une réplique) dans Node.
//
// - Faux DOM minimal (éléments créés à la demande, clic/changement simulables).
// - Faux IndexedDB en mémoire.
// - Moteur instrumenté : enregistre chaque setCheats(), peut échouer à la demande
//   (échec avant toute application, ou en milieu de liste) comme le vrai moteur.
// - Vrai catalogue data/psx-catalog.json et vraies fonctions de région.
// - Les modules lourds (lecture de disque, sauvegardes, session) sont remplacés par
//   des doublures ; le code testé est app.js + cheat-controller.mjs + le catalogue.
//
// L'invariant central que les tests vérifient : ce que l'interface affiche comme
// actif == ce que le moteur contient réellement.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as catalogModule from '../../cheat-catalog-psx.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

class FakeEl {
  constructor(id, tagName = 'DIV') {
    this.id = id; this.tagName = tagName.toUpperCase(); this.textContent = ''; this.value = '';
    this.checked = false; this.disabled = false; this.hidden = false; this.children = []; this.style = {};
    this.isConnected = true; this.files = []; this.type = '';
    this._classes = new Set();
    this.classList = {
      toggle: (name, force) => { const on = force ?? !this._classes.has(name); on ? this._classes.add(name) : this._classes.delete(name); return on; },
      add: name => this._classes.add(name), remove: name => this._classes.delete(name), contains: name => this._classes.has(name),
    };
  }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; }
  set innerHTML(html) { this._html = html; this.textContent = String(html).replace(/<[^>]*>/g, ''); }
  get innerHTML() { return this._html ?? ''; }
  querySelectorAll(selector) {
    const wanted = selector.toUpperCase(), out = [];
    const walk = node => { for (const child of node.children ?? []) { if (child instanceof FakeEl) { if (child.tagName === wanted) out.push(child); walk(child); } } };
    walk(this); return out;
  }
  // Texte visible d'un sous-arbre (pour retrouver un bouton par son libellé).
  text() { return this.textContent + this.children.map(c => (c instanceof FakeEl ? c.text() : String(c))).join(''); }
  find(predicate) {
    const out = [];
    const walk = node => { for (const child of node.children ?? []) { if (child instanceof FakeEl) { if (predicate(child)) out.push(child); walk(child); } } };
    walk(this); return out;
  }
  setAttribute() {} click() { return this.onclick?.(); }
}

function fakeIndexedDB() {
  const stores = new Map();
  return {
    stores,
    open(name) {
      const request = {};
      queueMicrotask(() => {
        const existed = stores.has(name);
        if (!existed) stores.set(name, new Map());
        const data = stores.get(name);
        const db = {
          createObjectStore() {},
          transaction() { return { objectStore: () => ({
            get: key => { const q = {}; queueMicrotask(() => { q.result = data.get(key); q.onsuccess?.(); }); return q; },
            put: (value, key) => { const q = {}; queueMicrotask(() => { data.set(key, JSON.parse(JSON.stringify(value))); q.result = key; q.onsuccess?.(); }); return q; },
          }) }; },
          close() {},
        };
        request.result = db;
        if (!existed) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
}

/** Moteur instrumenté, calqué sur le contrat réel de engine-session.mjs setCheats(). */
export function createFakeEngine() {
  const engine = {
    active: [],          // codes réellement présents dans le moteur
    calls: [],           // historique des appels setCheats(list)
    // fail(call_number, list) -> false | 'empty' | 'unchanged'
    //  'empty'     : échec en milieu de liste, le moteur fait resetCheat() => vide
    //  'unchanged' : resetCheat() lui-même échoue => le moteur garde son état précédent
    fail: () => false,
    setCheats(list) {
      engine.calls.push(list.map(c => ({ ...c })));
      const mode = engine.fail(engine.calls.length, list);
      if (mode === 'unchanged') throw new Error('MOTEUR: resetCheat a échoué (test)');
      if (mode === 'empty') { engine.active = []; throw new Error('MOTEUR: setCheat a échoué en milieu de liste (test)'); }
      engine.active = list.map(c => c.code);
    },
    captureBattery: () => null, captureState: () => new Uint8Array(0),
    pause: async () => {}, play: async () => {}, resumeAudio: async () => {},
    inputStatus: () => ({ mode: 'native' }), snapshot: () => ({}),
  };
  return engine;
}

export async function makeHarness({ appPath = 'app.js', catalogFile = 'data/psx-catalog.json' } = {}) {
  const elements = new Map();
  const getEl = (id, tag) => { if (!elements.has(id)) elements.set(id, new FakeEl(id, tag)); return elements.get(id); };
  const document = { getElementById: id => getEl(id), createElement: tag => new FakeEl(null, tag) };
  const idb = fakeIndexedDB();
  const win = {};
  const confirms = [];
  const h = { elements, $: id => getEl(id), idb, confirms, engines: [], answerConfirm: true };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).includes('psx-catalog.json')) { const text = readFileSync(ROOT + catalogFile, 'utf8'); return { ok: true, status: 200, text: async () => text }; }
    throw new Error('fetch inattendu en test : ' + url);
  };
  h.restoreFetch = () => { globalThis.fetch = realFetch; };

  // --- Doublures des modules lourds ---
  let preparedByName = new Map();
  class FakeSessionController {
    constructor() { this.current = null; this.candidate = null; }
    async prepare(prepared) {
      const engine = createFakeEngine(); if (h.nextEngineSetup) h.nextEngineSetup(engine);
      h.engines.push(engine);
      return { id: h.engines.length, frame: { isConnected: true }, api: engine, engine, identity: { game: prepared.metadata.name }, batteryIdentity: { game: prepared.metadata.name }, input: { analog: 'off', stickToDpad: false, deadzone: 0.2, native: false }, prepared };
    }
    async start(candidate) { this.current = candidate; h.engine = candidate.engine; }
    async dispose() {}
    diagnostic() { return {}; }
  }
  class FakeSaveStore {
    async load() { const e = new Error('vide'); e.code = 'E_EMPTY'; throw e; }
    async put() { return { revision: 1 }; } async list() { return []; }
  }
  const mods = {
    './disc-file.mjs': { prepareDisc: async file => preparedByName.get(file.name) },
    './save-store.mjs': { SaveStore: FakeSaveStore, makeStateEnvelope: async () => ({}) },
    './state-bundle.mjs': { packStateBundle: () => new Uint8Array(0), unpackStateBundle: () => ({ state: null, battery: null }) },
    './session-controller.mjs': { SessionController: FakeSessionController },
    './input-profile.mjs': { normalizeInput: cfg => cfg ?? { analog: 'off', stickToDpad: false, deadzone: 0.2, native: false } },
    './input-presets.mjs': { PROFILES: {}, DEFAULT_PROFILE_ID: 'default', resolveProfile: () => null },
    // Copie modifiable du vrai catalogue : h.findOverride permet de simuler un catalogue défaillant.
    './cheat-catalog-psx.mjs': { ...catalogModule, findCheatsForGame: (...args) => (h.findOverride ?? catalogModule.findCheatsForGame)(...args) },
  };
  // Modules réels éventuellement requis par la version refactorée d'app.js.
  h.mods = mods;
  mods['./cheat-controller.mjs'] = await import('../../cheat-controller.mjs').catch(() => undefined);

  const source = readFileSync(ROOT + appPath, 'utf8')
    .replace(/^import\s*\{([^}]*)\}\s*from\s*'(\.\/[^']+)';?/gm, (_, names, spec) => `const {${names.replace(/\s+as\s+/g, ': ')}} = __mods['${spec}'];`)
    .replace(/await import\('(\.\/[^']+)'\)/g, "__mods['$1']");
  const fn = new AsyncFunction('document', 'window', 'indexedDB', 'confirm', '__mods', 'location', 'console', source);
  const quietConsole = { ...console, warn: () => {}, log: () => {} };
  await fn(document, win, idb, msg => { confirms.push(msg); return h.answerConfirm; }, mods, { search: '' }, quietConsole);

  h.window = win;
  h.disc = (name, { serial = null, sha = null } = {}) => {
    const metadata = { name, serial, canonical_sha256: sha ?? ('f'.repeat(60) + String(name.length).padStart(4, '0')), size: 1000, detected_format: 'bin', notes: [] };
    preparedByName.set(name, { metadata, file: { name } });
    return name;
  };
  /** Choisit un disque puis le lance, par les vrais gestionnaires du DOM. */
  h.launch = async (name, opts) => {
    if (!preparedByName.has(name)) h.disc(name, opts);
    const input = h.$('disc-file'); input.files = [{ name }];
    await input.onchange(); await h.$('launch').onclick();
  };
  h.ctl = () => win.__cheatController;
  h.view = () => win.__cheatController.view();
  h.info = () => h.$('cheat-info').textContent;
  h.note = () => h.$('save-note').textContent;
  h.status = () => h.$('status').textContent;
  h.boxes = () => h.$('cheat-list').querySelectorAll('input');
  h.rows = () => h.$('cheat-list').children.filter(c => c instanceof FakeEl && c.tagName === 'LABEL');
  /** Libellés cochés dans l'interface. */
  h.uiChecked = () => h.rows().filter(r => r.children[0].checked).map(r => r.text().trim());
  h.buttons = () => h.$('cheat-list').find(e => e.tagName === 'BUTTON');
  h.button = label => h.buttons().find(b => b.text().includes(label));
  h.toggleRow = async (index, on) => { const box = h.boxes()[index]; box.checked = on; await box.onchange(); };
  return h;
}
