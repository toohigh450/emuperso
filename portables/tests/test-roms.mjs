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
