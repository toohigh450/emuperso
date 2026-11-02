import test from 'node:test';
import assert from 'node:assert/strict';
import { contentStartupError } from '../startup-error.mjs';
import { coreOptionKeys, coreOptionCurrent, findCoreOptionLine } from '../core-options.mjs';
test('native content failure is fatal, normal BIOS/shader warnings are not', () => {
  assert.ok(contentStartupError('[ERROR] [Content]: Failed to load content'));
  assert.ok(contentStartupError('[libretro ERROR] unsupported/invalid CD image: /synthetic.bin'));
  assert.equal(contentStartupError('[libretro INFO] No BIOS files found.'), null);
  assert.equal(contentStartupError('[ERROR] [GL]: none shader not supported, falling back to stock GLSL'), null);
});
test('pinned frontend option format exposes reported value, not guessed value', () => {
  const raw = 'pcsx_rearmed_region|auto; auto|NTSC|PAL\npcsx_rearmed_bios|HLE; auto|HLE';
  assert.deepEqual(coreOptionKeys(raw), ['pcsx_rearmed_region', 'pcsx_rearmed_bios']);
  assert.equal(coreOptionCurrent(raw, 'pcsx_rearmed_bios'), 'HLE');
  assert.equal(coreOptionCurrent(raw, 'pcsx_rearmed_pad1type'), null);
  assert.deepEqual(coreOptionKeys({ unexpected: true }), []);
  assert.equal(findCoreOptionLine({ unexpected: true }, 'pcsx_rearmed_pad1type'), null);
});
