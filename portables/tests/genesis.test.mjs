import test from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEMS, analyzeRom, engineExtension, parseGenesis } from '../js/systems.mjs';
import { systemFromPath, buildCatalog } from '../js/catalog.mjs';
import { inferSystemFromPath } from '../js/cheats.mjs';

// Fixture synthétique uniquement : en-tête Mega Drive, pas de ROM commerciale.
// Elle valide le routage ; elle n'est pas un jeu exécutable.
function genesisHeader({ size = 0x20000, region = 'UE' } = {}) {
  const rom = new Uint8Array(size);
  const encode = (str, at) => rom.set(new TextEncoder().encode(str), at);
  encode('SEGA MEGA DRIVE ', 0x100);
  encode('EMUPERSO GENESIS TEST', 0x150);
  encode(region, 0x1f0);
  return rom;
}

test('Genesis : coeur officiel et limites distinctes de la 32X', () => {
  assert.equal(SYSTEMS.genesis.ejsCore, 'segaMD');
  assert.equal(SYSTEMS.genesis.coreId, 'genesis_plus_gx');
  assert.equal(SYSTEMS.genesis.maxBytes, 16 * 1024 * 1024);
});

test('Genesis : reconnaissance par extension et en-tête SEGA', () => {
  const rom = genesisHeader();
  const original = rom.slice();
  const a = analyzeRom('Road Rash II [USA][!!].md', rom);
  assert.equal(a.ok, true);
  assert.equal(a.system, 'genesis');
  assert.equal(a.headerOk, true);
  assert.equal(a.title, 'Road Rash II [USA][!!]');
  assert.match(a.cartridgeTitle, /EMUPERSO/);
  assert.match(a.region, /USA/);
  assert.match(a.region, /Europe/);
  assert.equal(engineExtension(a), 'md');
  assert.deepEqual(rom, original);
});

test('Genesis : extensions .smd et .gen conservées au moteur', () => {
  const rom = genesisHeader();
  assert.equal(engineExtension(analyzeRom('Jeu.smd', rom)), 'smd');
  assert.equal(engineExtension(analyzeRom('Jeu.gen', rom)), 'gen');
  const interleaved = analyzeRom('Jeu.smd', new Uint8Array(512 + 16384));
  assert.equal(interleaved.ok, true);
  assert.equal(interleaved.headerOk, false);
  assert.ok(interleaved.warnings.some(w => w.includes('SMD')));
});

test('Genesis : .bin ambigu accepté seulement avec un en-tête identifiable', () => {
  const recognized = analyzeRom('Road Rash II.bin', genesisHeader({ region: 'J' }));
  assert.equal(recognized.ok, true);
  assert.equal(recognized.system, 'genesis');
  assert.equal(engineExtension(recognized), 'md');
  assert.equal(recognized.region, 'Japon');
  assert.equal(analyzeRom('pas-un-jeu.bin', new Uint8Array(0x20000)).ok, false);
});

test('Genesis : petit fichier et 32X refusés proprement', () => {
  const small = analyzeRom('court.md', new Uint8Array(100));
  assert.equal(small.ok, false);
  assert.match(small.errors.join(' '), /trop petit/);
  const other = analyzeRom('Sega32X.32x', genesisHeader());
  assert.equal(other.ok, false);
  assert.match(other.errors.join(' '), /PicoDrive|32X/);
});

test('Genesis : titre du hack conservé même si le titre de cartouche est générique', () => {
  const analysis = analyzeRom('Sonic [H.MetalSonic].md', genesisHeader());
  assert.equal(analysis.title, 'Sonic [H.MetalSonic]');
  assert.equal(analysis.system, 'genesis');
});

test('Genesis : plafonds et avertissements honnêtes', () => {
  const big = analyzeRom('trop-gros.gen', genesisHeader({ size: 16 * 1024 * 1024 + 1 }));
  assert.equal(big.ok, false);
  assert.match(big.errors.join(' '), /trop gros/);
  const unknownHeader = analyzeRom('homebrew.md', new Uint8Array(0x20000));
  assert.equal(unknownHeader.ok, true);
  assert.equal(unknownHeader.headerOk, false);
  assert.ok(unknownHeader.warnings.some(w => w.includes('SEGA')));
});

test('Genesis : inventaire HackSet et dossier cheat distincts', () => {
  assert.equal(systemFromPath('Genesis Roms/Road Rash II.7z'), 'genesis');
  assert.equal(systemFromPath('Mega Drive/Sonic (USA).md'), 'genesis');
  assert.equal(inferSystemFromPath('Sega - Mega Drive - Genesis/Aladdin (USA).cht'), 'genesis');
  const files = [{ name: 'Road Rash II.7z', size: 1024, webkitRelativePath: 'HackSet-Genesis/Genesis Roms/Road Rash II.7z' }];
  const catalog = buildCatalog(files);
  assert.equal(catalog.entries.length, 1);
  assert.equal(catalog.entries[0].system, 'genesis');
  assert.equal(catalog.entries[0].archive, true);
  // L'archive .7z n'est pas décompressée par ce test et doit être extraite localement.
});

test('Genesis : parseGenesis expose un avertissement sans certifier une ROM invalide', () => {
  const out = parseGenesis(new Uint8Array(0x4000), 'md');
  assert.equal(out.headerOk, false);
  assert.equal(out.region, 'inconnue');
  assert.ok(out.warnings.length > 0);
});
