// ROM d'essai NES et SNES écrites pour ce projet (aucun jeu commercial).
// Elles affichent une couleur de fond unie qui dépend :
//   - d'un octet de ROM (adresse COLOR_ROM) : un code Game Genie qui le remplace change la couleur ;
//   - d'un octet de RAM (adresse COLOR_RAM), prioritaire s'il n'est pas nul : un code RAM change la couleur.
// Au démarrage, elles incrémentent aussi un compteur en mémoire sauvegardée (pile) : la sauvegarde
// normale du jeu peut ainsi être vérifiée octet par octet après rechargement.

function assemble(origin, parts) {
  // parts : octets, { label } ou { rel: label } (branche 8 bits) ou { abs: label } (adresse 16 bits).
  const labels = {};
  let pc = origin;
  for (const p of parts) {
    if (typeof p === 'number') pc++;
    else if (p.label) labels[p.label] = pc;
    else if (p.rel) pc++;
    else if (p.abs) pc += 2;
  }
  const out = [];
  pc = origin;
  for (const p of parts) {
    if (typeof p === 'number') { out.push(p); pc++; }
    else if (p.label) continue;
    else if (p.rel) {
      const d = labels[p.rel] - (pc + 1);
      if (d < -128 || d > 127) throw new Error('branche trop longue');
      out.push(d & 0xff); pc++;
    } else if (p.abs) { out.push(labels[p.abs] & 0xff, labels[p.abs] >> 8); pc += 2; }
  }
  return { bytes: out, labels };
}

// --- NES : NROM-128 avec pile (PRG-RAM $6000) ----------------------------------------
export const NES_TEST = { colorRom: 0x8100, colorRam: 0x0300, sram: 0x6000, base: 0x12, gg: 0x2a, ram: 0x16 };

export function makeNesTestRom({ base = NES_TEST.base } = {}) {
  const { bytes, labels } = assemble(0x8000, [
    0x78, 0xd8, 0xa2, 0xff, 0x9a, // sei, cld, ldx #$ff, txs
    0xa9, 0x00, 0x8d, 0x00, 0x20, 0x8d, 0x01, 0x20, // NMI et rendu coupés
    0x8d, 0x00, 0x03, // RAM $0300 = 0
    0xee, 0x00, 0x60, // inc $6000 : compteur de démarrages en mémoire sauvegardée
    { label: 'w1' }, 0x2c, 0x02, 0x20, 0x10, { rel: 'w1' },
    { label: 'w2' }, 0x2c, 0x02, 0x20, 0x10, { rel: 'w2' },
    { label: 'loop' }, 0x2c, 0x02, 0x20, 0x10, { rel: 'loop' },
    0xa9, 0x3f, 0x8d, 0x06, 0x20, 0xa9, 0x00, 0x8d, 0x06, 0x20, // v = $3F00
    0xad, 0x00, 0x03, 0xd0, { rel: 'use' }, // lda $0300 ; bne use
    0xad, 0x00, 0x81, // lda $8100
    { label: 'use' }, 0x8d, 0x07, 0x20, // palette[0] = couleur
    0xa9, 0x3f, 0x8d, 0x06, 0x20, 0xa9, 0x00, 0x8d, 0x06, 0x20, // v revient à $3F00
    0x4c, { abs: 'loop' },
    { label: 'rti' }, 0x40,
  ]);
  const prg = new Uint8Array(16384);
  prg.set(bytes, 0);
  prg[0x100] = base;
  const vec = (off, addr) => { prg[off] = addr & 0xff; prg[off + 1] = addr >> 8; };
  vec(0x3ffa, labels.rti); vec(0x3ffc, 0x8000); vec(0x3ffe, labels.rti);
  const header = new Uint8Array([0x4e, 0x45, 0x53, 0x1a, 1, 1, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // pile = bit 1
  const rom = new Uint8Array(16 + 16384 + 8192);
  rom.set(header, 0);
  rom.set(prg, 16);
  return rom;
}

// --- SNES : LoROM 32 Kio, SRAM 2 Kio avec pile ---------------------------------------
export const SNES_TEST = { colorRom: 0x008100, colorRam: 0x7e0100, sram: 0x700000, base: 0x1f, gg: 0xe0, ram: 0x03 };

export function makeSnesTestRom({ base = SNES_TEST.base, title = 'EMUPERSO TEST COULEUR' } = {}) {
  const { bytes, labels } = assemble(0x8000, [
    0x78, 0x18, 0xfb, // sei, clc, xce (mode natif, A et X restent sur 8 bits)
    0xa9, 0x80, 0x8d, 0x00, 0x21, // écran éteint
    0x9c, 0x00, 0x42, // NMI coupée
    0xa9, 0x00, 0x8f, 0x00, 0x01, 0x7e, // RAM $7E0100 = 0
    0xaf, 0x00, 0x00, 0x70, 0x1a, 0x8f, 0x00, 0x00, 0x70, // SRAM $700000 += 1
    { label: 'loop' }, 0xad, 0x10, 0x42, 0x10, { rel: 'loop' }, // attendre le retour vertical ($4210)
    0x9c, 0x21, 0x21, // CGADD = 0
    0xaf, 0x00, 0x01, 0x7e, 0xd0, { rel: 'use' }, // lda $7E0100 ; bne use
    0xaf, 0x00, 0x81, 0x00, // lda $008100
    { label: 'use' }, 0x8d, 0x22, 0x21, 0x8d, 0x22, 0x21, // couleur 0 = v | v<<8
    0xa9, 0x0f, 0x8d, 0x00, 0x21, // écran allumé
    0x80, { rel: 'loop' },
    { label: 'rti' }, 0x40,
  ]);
  const rom = new Uint8Array(32768);
  rom.set(bytes, 0);
  rom[0x100] = base;
  const h = 0x7fc0;
  const name = title.padEnd(21, ' ').slice(0, 21);
  for (let i = 0; i < 21; i++) rom[h + i] = name.charCodeAt(i);
  rom[h + 0x15] = 0x20; // LoROM, SlowROM
  rom[h + 0x16] = 0x02; // ROM + RAM + pile
  rom[h + 0x17] = 0x05; // 32 Kio
  rom[h + 0x18] = 0x01; // 2 Kio de SRAM
  rom[h + 0x19] = 0x01; // USA
  rom[h + 0x1a] = 0x00;
  rom[h + 0x1b] = 0x00;
  const vec = (off, addr) => { rom[off] = addr & 0xff; rom[off + 1] = addr >> 8; };
  for (const off of [0x7fe4, 0x7fe6, 0x7fe8, 0x7fea, 0x7fee, 0x7ff4, 0x7ff8, 0x7ffa, 0x7ffe]) vec(off, labels.rti);
  vec(0x7ffc, 0x8000);
  // Somme de contrôle : calculée avec complément provisoire 0xFFFF / somme 0.
  rom[h + 0x1c] = 0xff; rom[h + 0x1d] = 0xff; rom[h + 0x1e] = 0; rom[h + 0x1f] = 0;
  let sum = 0;
  for (const b of rom) sum = (sum + b) & 0xffff;
  rom[h + 0x1e] = sum & 0xff; rom[h + 0x1f] = sum >> 8;
  const comp = sum ^ 0xffff;
  rom[h + 0x1c] = comp & 0xff; rom[h + 0x1d] = comp >> 8;
  return rom;
}

/** Couleur BGR555 → RVB 8 bits, telle que la ROM SNES l'écrit (octet répété). */
export function snesColor(v) {
  const c = (v | (v << 8)) & 0x7fff;
  const x = (n) => Math.round((n & 31) * 255 / 31);
  return [x(c), x(c >> 5), x(c >> 10)];
}

// --- Game Boy : MBC1 + RAM + pile, compteur de démarrages en $A000 --------------------
// La RAM d'une cartouche neuve peut valoir $FF : elle est alors ramenée à 0 avant l'incrément.
export function makeGbTestRom({ variant = 0 } = {}) {
  const rom = new Uint8Array(32768);
  rom.set([0x00, 0xc3, 0x50, 0x01], 0x100); // nop ; jp $0150
  rom.set([0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 0x00, 0x0b], 0x104); // début du logo (détection)
  const title = 'MIGRATION';
  for (let i = 0; i < title.length; i++) rom[0x134 + i] = title.charCodeAt(i);
  rom[0x147] = 0x03; // MBC1 + RAM + pile
  rom[0x148] = 0x00; // 32 Kio
  rom[0x149] = 0x02; // 8 Kio de RAM
  rom[0x14a] = 0x01;
  rom[0x14c] = variant; // version : une autre variante = une autre empreinte
  let x = 0;
  for (let i = 0x134; i <= 0x14c; i++) x = (x - rom[i] - 1) & 0xff;
  rom[0x14d] = x;
  rom.set([
    0xf3, // di
    0x31, 0xfe, 0xff, // ld sp,$FFFE
    0x3e, 0x0a, 0xea, 0x00, 0x00, // RAM de cartouche activée
    0x21, 0x00, 0xa0, // ld hl,$A000
    0x7e, 0xfe, 0xff, 0x20, 0x01, 0xaf, // ld a,(hl) ; cp $FF ; jr nz,+1 ; xor a
    0x3c, 0x77, // inc a ; ld (hl),a
    0x18, 0xfe, // boucle
  ], 0x150);
  return rom;
}

// --- Game Boy Advance : SRAM, compteur de démarrages en $0E000000 ---------------------
export function makeGbaTestRom({ variant = 0 } = {}) {
  const rom = new Uint8Array(0x8000);
  const word = (off, v) => { rom[off] = v & 0xff; rom[off + 1] = (v >>> 8) & 0xff; rom[off + 2] = (v >>> 16) & 0xff; rom[off + 3] = v >>> 24; };
  word(0x00, 0xea00002e); // b $080000C0
  rom.set([0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21], 0x04); // début du logo (détection)
  const ascii = (off, s) => { for (let i = 0; i < s.length; i++) rom[off + i] = s.charCodeAt(i); };
  ascii(0xa0, 'MIGRATION');
  ascii(0xac, 'AMGE');
  ascii(0xb0, '01');
  rom[0xb2] = 0x96;
  rom[0xbc] = variant;
  let c = 0;
  for (let i = 0xa0; i <= 0xbc; i++) c = (c - rom[i]) & 0xff;
  rom[0xbd] = (c - 0x19) & 0xff;
  [
    0xe3a0040e, // mov r0,#0x0E000000
    0xe5d01000, // ldrb r1,[r0]
    0xe35100ff, // cmp r1,#0xFF
    0x03a01000, // moveq r1,#0
    0xe2811001, // add r1,r1,#1
    0xe5c01000, // strb r1,[r0]
    0xeafffffe, // boucle
  ].forEach((v, i) => word(0xc0 + i * 4, v));
  ascii(0x100, 'SRAM_V113'); // type de sauvegarde lu par mGBA
  return rom;
}
