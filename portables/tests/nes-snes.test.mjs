import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRom, parseNes, parseSnes, engineExtension, snesChecksum } from '../js/systems.mjs';
import { parseCheatCode, decodeNesGameGenie, encodeNesGameGenie, decodeSnesGameGenie, encodeSnesGameGenie, describeCode } from '../js/codes.mjs';
import { parseRomName, variantKey, variantLabel } from '../js/romnames.mjs';
import { inferSystemFromPath } from '../js/cheats.mjs';
import { makeNesTestRom, makeSnesTestRom } from './test-roms.mjs';

function ines({ prg = 1, chr = 1, f6 = 0, f7 = 0, extra = [] } = {}) {
  const h = new Uint8Array(16 + prg * 16384 + chr * 8192);
  h.set([0x4e, 0x45, 0x53, 0x1a, prg, chr, f6, f7, ...extra]);
  return h;
}

test('NES : iNES, carte MMC3 et pile', () => {
  const r = analyzeRom('Jeu (USA).nes', ines({ prg: 2, chr: 2, f6: 0x42, f7: 0x00 }));
  assert.equal(r.ok, true);
  assert.equal(r.system, 'nes');
  assert.equal(r.mapper, 4);
  assert.match(r.mapperName, /MMC3/);
  assert.equal(r.battery, true);
  assert.equal(r.format, 'iNES');
  assert.equal(engineExtension(r), 'nes');
});

test('NES : NES 2.0, numéro de carte étendu et PAL', () => {
  const rom = ines({ f6: 0x10, f7: 0x08, extra: [0x01, 0, 0, 0, 0x01] });
  const p = parseNes(rom);
  assert.equal(p.format, 'NES 2.0');
  assert.equal(p.mapper, 0x101);
  assert.equal(p.timing, 'PAL');
});

test('NES : en-tête « DiskDude! » sali, octet 7 ignoré', () => {
  const rom = ines({ f6: 0x10, f7: 0x44 });
  rom.set([0x44, 0x69, 0x73, 0x6b, 0x44, 0x75, 0x64, 0x65, 0x21], 7);
  const p = parseNes(rom);
  assert.equal(p.mapper, 1);
  assert.ok(p.warnings.some((w) => w.includes('ancien ou modifié')));
});

test('NES : taille différente de l’en-tête signalée', () => {
  const r = analyzeRom('x.nes', ines().subarray(0, 16 + 16384));
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.includes('Taille inattendue')));
});

test('NES : UNIF avec nom de carte', () => {
  const name = new TextEncoder().encode('NES-NROM-256\0');
  const rom = new Uint8Array(32 + 8 + name.length);
  rom.set([0x55, 0x4e, 0x49, 0x46]);
  rom.set([0x4d, 0x41, 0x50, 0x52, name.length, 0, 0, 0], 32);
  rom.set(name, 40);
  const r = analyzeRom('jeu.unf', rom);
  assert.equal(r.ok, true);
  assert.equal(r.format, 'UNIF');
  assert.equal(r.mapperName, 'UNIF NES-NROM-256');
  assert.equal(engineExtension(r), 'unf');
});

test('NES : fichier sans en-tête refusé avec un message clair', () => {
  const r = analyzeRom('x.nes', new Uint8Array(40000));
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /iNES absent/);
});

test('Formats incompatibles : FDS, NSF, patch IPS', () => {
  for (const [n, re] of [['jeu.fds', /disksys/], ['musique.nsf', /pas un jeu/], ['traduction.ips', /patch/i]]) {
    const r = analyzeRom(n, new Uint8Array(100));
    assert.equal(r.ok, false);
    assert.match(r.errors[0], re);
  }
});

test('SNES : ROM d’essai LoROM, somme de contrôle, pile et région', () => {
  const r = analyzeRom('test.sfc', makeSnesTestRom());
  assert.equal(r.ok, true, r.errors.join());
  assert.equal(r.system, 'snes');
  assert.equal(r.layout, 'LoROM');
  assert.equal(r.title, 'EMUPERSO TEST COULEUR');
  assert.equal(r.headerOk, true);
  assert.equal(r.battery, true);
  assert.equal(r.region, 'USA');
  assert.equal(r.video, 'NTSC');
  assert.equal(engineExtension(r), 'sfc');
});

test('SNES : en-tête de copieur de 512 octets conservé et signalé', () => {
  const base = makeSnesTestRom();
  const rom = new Uint8Array(512 + base.length);
  rom.set(base, 512);
  const r = analyzeRom('test.smc', rom);
  assert.equal(r.ok, true);
  assert.equal(r.copierHeader, true);
  assert.equal(r.headerOk, true);
  assert.equal(engineExtension(r), 'smc');
});

test('SNES : HiROM européenne (PAL) et puce SA-1 / ST018 / Super FX', () => {
  const rom = new Uint8Array(0x10000);
  const h = 0xffc0;
  rom.set(new TextEncoder().encode('HIROM EUROPE TEST    '), h);
  rom[h + 0x15] = 0x21; rom[h + 0x17] = 0x06; rom[h + 0x19] = 0x02;
  rom[h + 0x3c] = 0x00; rom[h + 0x3d] = 0x80;
  const fix = () => {
    rom[h + 0x1c] = 0xff; rom[h + 0x1d] = 0xff; rom[h + 0x1e] = 0; rom[h + 0x1f] = 0;
    const s = snesChecksum(rom); const c = s ^ 0xffff;
    rom[h + 0x1e] = s & 0xff; rom[h + 0x1f] = s >> 8; rom[h + 0x1c] = c & 0xff; rom[h + 0x1d] = c >> 8;
  };
  fix();
  let p = parseSnes(rom);
  assert.equal(p.layout, 'HiROM');
  assert.equal(p.video, 'PAL');
  assert.equal(p.region, 'Europe');
  assert.equal(p.checksumOk, true);
  rom[h + 0x16] = 0x35; fix();
  assert.equal(parseSnes(rom).chip, 'sa1');
  rom[h + 0x16] = 0x13; fix();
  assert.equal(parseSnes(rom).chip, 'superfx');
  rom[h + 0x16] = 0xf5; rom[h - 1] = 0x02; fix();
  p = parseSnes(rom);
  assert.equal(p.chip, 'st018');
  assert.match(p.errors[0], /ST018/);
});

test('SNES : fichier quelconque refusé', () => {
  const r = analyzeRom('x.sfc', new Uint8Array(65536).fill(0xaa));
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /introuvable/);
});

test('ROM d’essai NES : en-tête valide avec pile', () => {
  const r = analyzeRom('test.nes', makeNesTestRom());
  assert.equal(r.ok, true);
  assert.equal(r.mapper, 0);
  assert.equal(r.battery, true);
  assert.equal(r.headerOk, true);
});

test('Game Genie NES : SXIOPO = $91D9 ← $AD (référence connue)', () => {
  assert.deepEqual(decodeNesGameGenie('SXIOPO'), { address: 0x91d9, value: 0xad, compare: null });
  const p = parseCheatCode('nes', ' sxiopo ');
  assert.equal(p.ok, true);
  assert.equal(p.code, 'SXIOPO');
  assert.match(describeCode(p), /\$91D9 ← \$AD/);
});

test('Game Genie NES : encodage et décodage réciproques (6 et 8 lettres)', () => {
  for (const [a, v, c] of [[0x8100, 0x2a, null], [0xffff, 0xff, null], [0x8000, 0, null], [0x9234, 0x56, 0x78], [0xc0de, 0x01, 0xfe]]) {
    const code = encodeNesGameGenie(a, v, c);
    assert.equal(code.length, c === null ? 6 : 8);
    assert.deepEqual(decodeNesGameGenie(code), { address: a, value: v, compare: c });
  }
});

test('Game Genie SNES : encodage et décodage réciproques', () => {
  for (const [a, v] of [[0x008100, 0xe0], [0x7e0dbe, 0x05], [0xc0ffee, 0x42], [0x000000, 0x00], [0xffffff, 0xff]]) {
    const code = encodeSnesGameGenie(a, v);
    assert.match(code, /^[DF4709156BC8A23E]{4}-[DF4709156BC8A23E]{4}$/);
    assert.deepEqual(decodeSnesGameGenie(code), { address: a, value: v, compare: null });
  }
});

test('Codes NES : formats bruts et Pro Action Rocky, combinaisons et refus', () => {
  assert.equal(parseCheatCode('nes', '0300:16').ok, true);
  assert.equal(parseCheatCode('nes', '91d9?ad:a5').code, '91D9?AD:A5');
  assert.equal(parseCheatCode('nes', 'SXIOPO + 0300:16').code, 'SXIOPO+0300:16');
  assert.equal(parseCheatCode('nes', '0123ABCD').parts[0].format, 'Pro Action Rocky');
  const bad = parseCheatCode('nes', 'C2AF-3D07');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /n’est pas un code NES/);
  assert.equal(parseCheatCode('nes', '').ok, false);
});

test('Codes SNES : Game Genie, PAR, brut converti, conditionnel et refus', () => {
  assert.equal(parseCheatCode('snes', 'c2af-3d07').code, 'C2AF-3D07');
  assert.equal(parseCheatCode('snes', '7E0DBE05').parts[0].address, 0x7e0dbe);
  assert.equal(parseCheatCode('snes', '7e0dbe:05').code, '7E0DBE05');
  assert.equal(parseCheatCode('snes', '7E0DBE=03?05').parts[0].compare, 3);
  assert.equal(parseCheatCode('snes', 'SXIOPO').ok, false);
  assert.equal(parseCheatCode('gba', 'quelconque 1234').unchecked, true);
});

test('Noms de ROM : No-Intro, GoodTools, traductions et hacks', () => {
  let n = parseRomName('Ultimate Air Combat (Europe) (En,Fr,De).zip');
  assert.deepEqual(n.regions, ['Europe']);
  assert.equal(n.french, true);
  assert.equal(n.original, true);
  n = parseRomName('1942 [Japan][USA][GoodSet][T+Fre1.0_ks151].nes');
  assert.deepEqual(n.regions, ['Japon', 'USA']);
  assert.equal(n.frenchTranslation, true);
  assert.equal(n.original, false);
  n = parseRomName('ABC Monday Night Football (U) [h1I][f1].smc');
  assert.deepEqual(n.regions, ['USA']);
  assert.equal(n.hack, true);
  n = parseRomName('Foo (UE) [b1].smc');
  assert.deepEqual(n.regions, ['USA', 'Europe']);
  assert.equal(n.bad, true);
  n = parseRomName('Mario (Japan) (Rev 1) (Proto).nes');
  assert.equal(n.revision, '1');
  assert.equal(n.proto, true);
  assert.match(variantLabel(n), /prototype/);
  assert.equal(parseRomName('Zelda (F) [!].smc').french, true);
});

test('Noms de ROM : regroupement des variantes', () => {
  assert.equal(variantKey('Legend of Zelda, The'), variantKey('The Legend of Zelda'));
  assert.equal(variantKey('Pokémon'), variantKey('Pokemon'));
});

test('Fichiers .cht libretro : dossiers NES et SNES reconnus', () => {
  assert.equal(inferSystemFromPath('cht/Nintendo - Nintendo Entertainment System/Super Mario Bros. (World).cht'), 'nes');
  assert.equal(inferSystemFromPath('cht/Nintendo - Super Nintendo Entertainment System/Super Metroid (USA).cht'), 'snes');
  assert.equal(inferSystemFromPath('cht/Nintendo - Game Boy Advance/x.cht'), 'gba');
});

test('SNES : Cx4 (sous-type $10) reconnu, et en-tête ExHiROM préféré à la copie vide', () => {
  const fix = (rom, h) => {
    rom[h + 0x1c] = 0xff; rom[h + 0x1d] = 0xff; rom[h + 0x1e] = 0; rom[h + 0x1f] = 0;
    const s = snesChecksum(rom); const c = s ^ 0xffff;
    rom[h + 0x1e] = s & 0xff; rom[h + 0x1f] = s >> 8; rom[h + 0x1c] = c & 0xff; rom[h + 0x1d] = c >> 8;
  };
  const lo = new Uint8Array(0x80000);
  const h = 0x7fc0;
  lo.set(new TextEncoder().encode('MEGAMAN X2           '), h);
  lo[h + 0x15] = 0x20; lo[h + 0x16] = 0xf3; lo[h - 1] = 0x10; lo[h + 0x17] = 0x0b; lo[h + 0x19] = 0x01; lo[h + 0x3d] = 0x80;
  fix(lo, h);
  const p = parseSnes(lo);
  assert.equal(p.chip, 'cx4');
  assert.deepEqual(p.errors, []);
  const ex = new Uint8Array(0x600000);
  for (const base of [0xffc0, 0x40ffc0]) {
    ex.set(new TextEncoder().encode('TALES OF PHANTASIA   '), base);
    ex[base + 0x15] = 0x35; ex[base + 0x17] = 0x0d; ex[base + 0x3d] = 0x80;
    ex[base + 0x1c] = 0xff; ex[base + 0x1d] = 0xff;
  }
  fix(ex, 0x40ffc0);
  const e = parseSnes(ex);
  assert.equal(e.layout, 'ExHiROM');
  assert.equal(e.checksumOk, true);
});
