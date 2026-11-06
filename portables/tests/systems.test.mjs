import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRom, crc16Modbus, regionFromGameCode, extensionOf, stemOf, gameCubeIdFromHead, engineExtension } from '../js/systems.mjs';
import { makeGb, makeGba, makeNds, makeGc } from './helpers.mjs';

test('CRC16 MODBUS : vecteur de référence', () => {
  const data = new TextEncoder().encode('123456789');
  assert.equal(crc16Modbus(data, 0, data.length), 0x4b37);
});

test('extensions et noms', () => {
  assert.equal(extensionOf('Jeu.GBA'), 'gba');
  assert.equal(extensionOf('sans-extension'), '');
  assert.equal(stemOf('C:\\roms\\Pokemon (USA).gba'), 'Pokemon (USA)');
});

test('Game Boy : en-tête valide', () => {
  const r = analyzeRom('mon-jeu.gb', makeGb({ title: 'TETRIS' }));
  assert.equal(r.ok, true);
  assert.equal(r.system, 'gb');
  assert.equal(r.title, 'TETRIS');
  assert.equal(r.headerOk, true);
  assert.equal(r.region, 'Hors Japon');
});

test('Game Boy Color : l\'en-tête l\'emporte sur l\'extension', () => {
  const r = analyzeRom('jeu.gb', makeGb({ cgb: 0xc0 }));
  assert.equal(r.system, 'gbc');
  assert.ok(r.warnings.some((w) => w.includes('l\'en-tête est retenu')));
});

test('Game Boy : somme de contrôle fausse = avertissement, pas blocage', () => {
  const r = analyzeRom('x.gb', makeGb({ badChecksum: true }));
  assert.equal(r.ok, true);
  assert.equal(r.headerOk, false);
  assert.ok(r.warnings.length > 0);
});

test('Game Boy : taille différente de celle annoncée', () => {
  const rom = makeGb({ size: 65536 }).subarray(0, 32768 + 100);
  const r = analyzeRom('x.gb', rom);
  assert.ok(r.warnings.some((w) => w.includes('Taille inattendue')));
});

test('GBA : en-tête valide, code de jeu et région', () => {
  const r = analyzeRom('x.gba', makeGba({ title: 'METROID', code: 'AMTP', version: 1 }));
  assert.equal(r.ok, true);
  assert.equal(r.system, 'gba');
  assert.equal(r.code, 'AMTP');
  assert.equal(r.region, 'Europe');
  assert.equal(r.version, 1);
  assert.equal(r.headerOk, true);
});

test('GBA : somme de contrôle fausse signalée', () => {
  const r = analyzeRom('x.gba', makeGba({ badChecksum: true }));
  assert.equal(r.ok, true);
  assert.equal(r.headerOk, false);
});

test('GBA : trop gros', () => {
  const big = makeGba({ size: 33 * 1024 * 1024 });
  const r = analyzeRom('x.gba', big);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /trop gros/);
});

test('DS : en-tête valide', () => {
  const r = analyzeRom('x.nds', makeNds({ title: 'MARIO', code: 'ABCJ' }));
  assert.equal(r.ok, true);
  assert.equal(r.system, 'nds');
  assert.equal(r.region, 'Japon');
  assert.equal(r.headerOk, true);
});

test('DS : CRC faux = avertissement', () => {
  const r = analyzeRom('x.nds', makeNds({ badCrc: true }));
  assert.equal(r.ok, true);
  assert.equal(r.headerOk, false);
});

test('DS : jeu DSi seulement = refusé', () => {
  const r = analyzeRom('x.nds', makeNds({ unit: 3 }));
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /DSi/);
});

test('DS : DSi amélioré (unité 2) accepté', () => {
  assert.equal(analyzeRom('x.nds', makeNds({ unit: 2 })).ok, true);
});

test('fichier vide, trop petit, extension inconnue', () => {
  assert.equal(analyzeRom('x.gba', new Uint8Array(0)).ok, false);
  assert.equal(analyzeRom('x.gba', new Uint8Array(10)).ok, false);
  assert.equal(analyzeRom('x.gb', new Uint8Array(10)).ok, false);
  assert.equal(analyzeRom('x.nds', new Uint8Array(10)).ok, false);
  const r = analyzeRom('x.exe', new Uint8Array(1000));
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /non reconnu/);
});

test('extension douteuse (.bin) acceptée seulement si l\'en-tête est reconnu', () => {
  assert.equal(analyzeRom('x.bin', makeGba()).system, 'gba');
  assert.equal(analyzeRom('x.rom', makeNds()).system, 'nds');
  assert.equal(analyzeRom('x.bin', makeGb({ cgb: 0x80 })).system, 'gbc');
  assert.equal(analyzeRom('x.bin', new Uint8Array(5000)).ok, false);
});

test('régions', () => {
  assert.equal(regionFromGameCode('ABCE'), 'USA');
  assert.equal(regionFromGameCode('ABCF'), 'France');
  assert.equal(regionFromGameCode('ABC?'), 'inconnue');
  assert.equal(regionFromGameCode(''), 'inconnue');
});

test('le titre retombe sur le nom de fichier si l\'en-tête est vide', () => {
  const r = analyzeRom('Mon jeu perso.gba', makeGba({ title: '' }));
  assert.equal(r.title, 'Mon jeu perso');
});

test('les octets ne sont jamais modifiés', () => {
  const rom = makeGba();
  const copy = rom.slice();
  analyzeRom('x.gba', rom);
  assert.deepEqual(rom, copy);
});

test('GameCube : en-tête disque reconnu et identifiant lu', () => {
  const rom = makeGc({ gameId: 'GPVE01' });
  const r = analyzeRom('Pikmin 2.iso', rom);
  assert.equal(r.ok, true);
  assert.equal(r.system, 'gamecube');
  assert.equal(r.gameId, 'GPVE01');
  assert.equal(r.code, 'GPVE01');
  assert.equal(engineExtension(r), 'iso');
  const bin = analyzeRom('dump.bin', makeGc({ gameId: 'ABCD01' }));
  assert.equal(bin.ok, true);
  assert.equal(bin.system, 'gamecube');
  assert.equal(bin.gameId, 'ABCD01');
  assert.equal(engineExtension(bin), 'iso');
  assert.equal(r.headerOk, true);
  assert.equal(r.format, 'ISO');
  assert.equal(gameCubeIdFromHead(rom), 'GPVE01');
});

test('GameCube : mauvaise magie = refus', () => {
  const r = analyzeRom('x.iso', makeGc({ badMagic: true }));
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /En-tête GameCube absent/);
});

test('GameCube : DOL et RVZ acceptés avec avertissement, ZIP non analysé ici', () => {
  const dol = analyzeRom('swiss.dol', new Uint8Array(787720));
  assert.equal(dol.ok, true);
  assert.equal(dol.system, 'gamecube');
  assert.equal(dol.format, 'DOL');
  assert.equal(dol.headerOk, false);
  const rvz = analyzeRom('x.rvz', new Uint8Array(1024));
  assert.equal(rvz.ok, true);
  assert.equal(rvz.format, 'RVZ');
  assert.ok(rvz.warnings.some((w) => w.includes('RVZ')));
});
