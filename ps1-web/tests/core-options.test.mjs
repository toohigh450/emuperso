// Recherche tolérante de l'option pcsx_rearmed_pad1type (mandat §6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { findCoreOptionLine, coreOptionLists } from '../core-options.mjs';

test('format « clé; description|v1|v2 »', () => {
  const opts = 'webgl2Enabled; WebGL2|enabled|disabled\npcsx_rearmed_pad1type; Controller Type|standard|analog|dualshock';
  assert.ok(findCoreOptionLine(opts, 'pcsx_rearmed_pad1type'));
  assert.equal(coreOptionLists(opts, 'pcsx_rearmed_pad1type', 'analog').listed, true);
  assert.equal(coreOptionLists(opts, 'pcsx_rearmed_pad1type', 'negcon').listed, false);
});

test('format « clé|v1|v2 » sans description', () => {
  const opts = 'pcsx_rearmed_pad1type|standard|analog|dualshock';
  assert.equal(coreOptionLists(opts, 'pcsx_rearmed_pad1type', 'dualshock').listed, true);
});

test('espaces en tête et clé proche ne créent pas de faux positif', () => {
  const opts = '   pcsx_rearmed_pad1type = analog\npcsx_rearmed_pad2type; P2|standard';
  assert.ok(findCoreOptionLine(opts, 'pcsx_rearmed_pad1type'));
  assert.equal(findCoreOptionLine(opts, 'pcsx_rearmed_pad1type').startsWith('pcsx_rearmed_pad1type'), true);
  assert.equal(coreOptionLists(opts, 'pcsx_rearmed_pad2type', 'standard').listed, true);
});

test('option absente => found:false (message « introuvable » légitime)', () => {
  const opts = 'webgl2Enabled; WebGL2|enabled|disabled';
  assert.equal(findCoreOptionLine(opts, 'pcsx_rearmed_pad1type'), null);
  assert.equal(coreOptionLists(opts, 'pcsx_rearmed_pad1type', 'standard').found, false);
});
