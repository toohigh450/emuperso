// SPDX-License-Identifier: MIT
// Parser/integration code is original. The separately downloaded catalog is GPL2+.
import { sha256 } from './rom-file.mjs';

const MAX_TEXT = 2 * 1024 * 1024;
const SAFE_TYPES = new Set(['80', '81', 'A0', 'A1', 'D0', 'D1', 'D2', 'D3', '50']);
let catalogPromise = null;
function assert(ok, message) { if (!ok) throw new Error(message); }
function freeze(value) { return Object.freeze(value); }
async function readExactAsset(response, size) {
  assert(Number.isSafeInteger(size) && size > 0 && size <= MAX_TEXT, 'Taille de catalogue invalide.');
  const length = response.headers?.get?.('content-length');
  if (length !== null && length !== undefined) assert(Number(length) === size, 'Taille annoncée du catalogue incorrecte.');
  const output = new Uint8Array(size), reader = response.body?.getReader?.();
  if (!reader) {
    const buffer = await response.arrayBuffer();
    assert(buffer.byteLength === size, 'Catalogue tronqué ou trop volumineux.');
    return buffer;
  }
  let written = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      assert(written + value.byteLength <= size, 'Lecture du catalogue arrêtée : taille dépassée.');
      output.set(value, written); written += value.byteLength;
    }
    assert(written === size, 'Catalogue tronqué.');
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return output.buffer;
}

export function romCheatIdentity(bytes) {
  assert(bytes instanceof Uint8Array && bytes.length >= 64, 'En-tête N64 absent pour identifier les cheats.');
  assert(bytes[0] === 0x80 && bytes[1] === 0x37 && bytes[2] === 0x12 && bytes[3] === 0x40, 'La ROM doit être normalisée en Z64.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hex = (number, width) => number.toString(16).padStart(width, '0').toUpperCase();
  const crc1 = hex(view.getUint32(0x10, false), 8), crc2 = hex(view.getUint32(0x14, false), 8);
  const country = hex(bytes[0x3e], 2), revision = bytes[0x3f];
  const internal_name = new TextDecoder('ascii').decode(bytes.subarray(0x20, 0x34)).replace(/[\x00-\x1f\x7f]/g, '').trim();
  return freeze({ key: `${crc1}-${crc2}-C:${country}`, crc1, crc2, country, revision, internal_name,
    matching_scope: 'CRC1/CRC2 déclarés dans l’en-tête et région ; pas une authentification cryptographique de la ROM.' });
}

function parseOptions(text) {
  const options = [], seen = new Set();
  let cursor = 0;
  const pattern = /([0-9a-f]{4}):"((?:\\.|[^"\\])*)"/igy;
  while (cursor < text.length) {
    pattern.lastIndex = cursor;
    const match = pattern.exec(text);
    if (!match) return null;
    const value = match[1].toUpperCase();
    if (!seen.has(value)) {
      seen.add(value);
      options.push(freeze({ value, label: match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\').slice(0, 1024) }));
    }
    if (options.length > 4096) return null;
    cursor = pattern.lastIndex;
    if (cursor < text.length) { if (text[cursor] !== ',') return null; cursor++; }
  }
  return options.length ? freeze(options) : null;
}

function finishCheat(cheat) {
  const parsed = [], optionSets = [];
  let reason = null;
  for (const raw of cheat.raw_lines) {
    const match = /^([0-9a-f]{8})\s+([0-9a-f]{4}|\?{4})(?:\s+(.*))?$/i.exec(raw);
    if (!match) { reason = 'Syntaxe de code non prise en charge.'; continue; }
    const address = match[1].toUpperCase(), value = match[2].toUpperCase(), tail = (match[3] ?? '').trim();
    if (!SAFE_TYPES.has(address.slice(0, 2))) reason = 'Code spécial, de démarrage ou bouton GameShark non pris en charge dans ce menu.';
    if (value === '????' && tail) {
      const options = parseOptions(tail);
      if (!options) reason = 'Liste de paramètres non prise en charge.';
      else optionSets.push(options);
    } else if (value !== '????' && tail) reason = 'Syntaxe de code non prise en charge.';
    parsed.push(`${address} ${value}`);
  }
  const parameterized = parsed.some(line => line.endsWith('????'));
  let options = freeze([]);
  if (parameterized) {
    if (!optionSets.length) reason = 'Ce code nécessite un paramètre sans liste de valeurs sûre.';
    else {
      options = optionSets[0];
      if (optionSets.some(set => JSON.stringify(set) !== JSON.stringify(options))) reason = 'Ce code nécessite plusieurs paramètres distincts.';
    }
  }
  if (!parsed.length || parsed.length > 256) reason = 'Nombre de lignes de code invalide.';
  return freeze({ id: cheat.id, name: cheat.name, description: cheat.description.join('\n'),
    code: !parameterized && !reason ? parsed.join('+') : null,
    code_template: parsed.join('+'), raw_lines: freeze(cheat.raw_lines.slice()), options,
    parameterized, supported: !reason, unsupported_reason: reason,
    verified: false, enabled: false,
    warning: 'Code communautaire non testé sur cette ROM ; activer volontairement et conserver une sauvegarde saine séparée.' });
}

export function parseMupenCheats(text) {
  assert(typeof text === 'string' && text.length <= MAX_TEXT, 'Catalogue de cheats trop volumineux ou invalide.');
  const games = [];
  let game = null, cheat = null;
  const flushCheat = () => { if (cheat && game) game.cheats.push(finishCheat(cheat)); cheat = null; };
  const flushGame = () => { flushCheat(); if (game) games.push(freeze({ ...game, cheats: freeze(game.cheats) })); game = null; };
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    if (!raw.trim() || raw.startsWith('//')) continue;
    if (raw.startsWith('crc ')) {
      flushGame();
      const key = raw.slice(4).trim().toUpperCase();
      assert(/^[0-9A-F]{8}-[0-9A-F]{8}-C:[0-9A-F]{2}$/.test(key), 'Identité de jeu invalide dans le catalogue.');
      assert(games.length < 2048, 'Trop de jeux dans le catalogue.');
      game = { id: games.length, key, name: key, cheats: [] };
    } else if (raw.startsWith('gn ') && game) game.name = raw.slice(3).trim().slice(0, 512);
    else if (/^\s+cn /.test(raw) && game) {
      flushCheat();
      assert(game.cheats.length < 2048, 'Trop de cheats dans un jeu.');
      cheat = { id: `${game.id}:${game.cheats.length}`, name: raw.trim().slice(3).slice(0, 512), description: [], raw_lines: [] };
    } else if (/^\s+cd /.test(raw) && cheat) cheat.description.push(raw.trim().slice(3).slice(0, 8192));
    else if (cheat && /^\s{2}/.test(raw)) cheat.raw_lines.push(raw.trim().slice(0, 65536));
    else throw new Error('Ligne de catalogue non reconnue.');
  }
  flushGame();
  assert(games.length > 0, 'Catalogue vide.');
  return freeze({ schema: 'emuperso/cheats/v1', games: freeze(games), game_count: games.length,
    unique_rom_keys: new Set(games.map(item => item.key)).size,
    cheat_count: games.reduce((sum, item) => sum + item.cheats.length, 0),
    supported_count: games.reduce((sum, item) => sum + item.cheats.filter(cheat => cheat.supported).length, 0),
    verified: false });
}

export function resolveCheatCode(cheat, value = null) {
  assert(cheat?.supported === true, cheat?.unsupported_reason || 'Cheat non pris en charge.');
  if (!cheat.parameterized) return cheat.code;
  assert(cheat.options.some(option => option.value === value), 'Choisissez une valeur proposée pour ce cheat.');
  return cheat.code_template.replaceAll('????', value);
}

export function validateManualCheat(code) {
  assert(typeof code === 'string' && code.length > 0 && code.length <= 65536, 'Saisissez un code GameShark N64.');
  const lines = code.trim().toUpperCase().split(/[+\r\n]+/).map(line => line.trim()).filter(Boolean);
  assert(lines.length > 0 && lines.length <= 64, 'Un cheat manuel doit contenir entre 1 et 64 lignes.');
  return lines.map(line => {
    const match = /^([0-9A-F]{8})\s+([0-9A-F]{4})$/.exec(line);
    assert(match && SAFE_TYPES.has(match[1].slice(0, 2)), 'Code attendu : 8 chiffres hexadécimaux puis 4 ; types spéciaux ou paramètres non pris en charge.');
    return match[1] + ' ' + match[2];
  }).join('+');
}

export async function loadCheatCatalog({ fetcher = globalThis.fetch, reload = false } = {}) {
  if (reload) catalogPromise = null;
  if (!catalogPromise) catalogPromise = (async () => {
    const lockResponse = await fetcher('docs/cheat-catalog-lock.json', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    assert(lockResponse.ok, 'Le verrou du catalogue de cheats est absent.');
    const lock = await lockResponse.json();
    assert(lock.schema === 'emuperso/cheat-catalog-lock/v1', 'Verrou des cheats invalide.');
    const asset = lock.assets.find(item => item.file === 'mupencheat.txt');
    assert(asset && asset.bytes <= MAX_TEXT && /^[0-9a-f]{64}$/.test(asset.sha256), 'Empreinte du catalogue invalide.');
    const response = await fetcher('vendor/cheats/mupencheat.txt', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    assert(response.ok, 'Catalogue local absent : relancez DEMARRER-N64 pour le préparer.');
    const buffer = await readExactAsset(response, asset.bytes);
    assert(buffer.byteLength === asset.bytes && await sha256(buffer) === asset.sha256, 'Catalogue de cheats altéré : chargement refusé.');
    const catalog = parseMupenCheats(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
    assert(catalog.game_count === lock.upstream_game_blocks && catalog.cheat_count === lock.upstream_cheat_entries, 'Catalogue de cheats incomplet.');
    return freeze({ ...catalog, provenance: freeze({ repository: lock.repository, commit: lock.commit, license: lock.license, sha256: asset.sha256 }) });
  })();
  try { return await catalogPromise; }
  catch (error) { catalogPromise = null; throw error; }
}

export async function lookupCheats(identity, { catalog = null, variantId = null, ...options } = {}) {
  catalog ??= await loadCheatCatalog(options);
  const key = typeof identity === 'string' ? identity : identity?.key;
  assert(/^[0-9A-F]{8}-[0-9A-F]{8}-C:[0-9A-F]{2}$/.test(key ?? ''), 'Identité de ROM invalide.');
  const matches = catalog.games.filter(game => game.key === key);
  let game = matches.length === 1 ? matches[0] : null;
  if (variantId !== null) {
    // HTML select values are strings; catalogue IDs are integer indices.
    const chosen = typeof variantId === 'string' && /^(0|[1-9]\d*)$/.test(variantId) ? Number(variantId) : variantId;
    assert(Number.isSafeInteger(chosen) && chosen >= 0, 'Identifiant de variante invalide.');
    game = matches.find(item => item.id === chosen) ?? null;
  }
  return freeze({ identity, key, game, matches: freeze(matches), cheats: game?.cheats ?? freeze([]),
    ambiguous: matches.length > 1 && !game, found: matches.length > 0,
    exact_header_match: matches.length > 0, verified_for_rom: false,
    warning: 'Correspondance d’en-tête uniquement. Les codes du catalogue ne sont pas certifiés pour votre fichier.' });
}
