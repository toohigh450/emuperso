// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { repairCue } from '../cue-repair.mjs';

const cue = (a, b) => `FILE "${a}" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\nFILE "${b}" BINARY\n  TRACK 02 AUDIO\n    INDEX 00 00:00:00\n    INDEX 01 00:02:00\n`;

test('cue : piste 1 renommée sans « (Track 1) » (pack Hyperspin, 3Xtreme)', () => {
  const r = repairCue(cue('3Xtreme (USA) (Track 1).bin', '3Xtreme (USA) (Track 2).bin'), ['3Xtreme (USA).bin', '3Xtreme (USA) (Track 2).bin', '3Xtreme (USA).cue']);
  assert.deepEqual(r.map, { '3Xtreme (USA) (Track 1).bin': '3Xtreme (USA).bin' });
  assert.match(r.text, /^FILE "3Xtreme \(USA\)\.bin" BINARY$/m);
  assert.match(r.text, /^FILE "3Xtreme \(USA\) \(Track 2\)\.bin" BINARY$/m);
});

test('cue : ponctuation perdue dans le nom des fichiers (100% Star → 100 Star)', () => {
  const r = repairCue(cue('100% Star (Europe) (Track 1).bin', '100% Star (Europe) (Track 2).bin'), ['100 Star (Europe).bin', '100 Star (Europe) (Track 2).bin']);
  assert.deepEqual(r.map, { '100% Star (Europe) (Track 1).bin': '100 Star (Europe).bin', '100% Star (Europe) (Track 2).bin': '100 Star (Europe) (Track 2).bin' });
});

test('cue : rien à faire quand toutes les pistes existent', () => {
  assert.equal(repairCue(cue('A (Track 1).bin', 'A (Track 2).bin'), ['A (Track 1).bin', 'A (Track 2).bin']), null);
});

test('cue : une seule piste manquante et un seul fichier libre, même si les noms diffèrent', () => {
  const r = repairCue('FILE "Disc.bin" BINARY\n  TRACK 01 MODE2/2352\n', ['SLUS_000.01.bin', 'readme.txt']);
  assert.deepEqual(r.map, { 'Disc.bin': 'SLUS_000.01.bin' });
});

test('cue : correspondance ambiguë → aucune modification', () => {
  assert.equal(repairCue(cue('Jeu (Track 1).bin', 'Jeu (Track 2).bin'), ['X.bin', 'Y.bin', 'Z.bin']), null);
});
