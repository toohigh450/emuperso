import test from 'node:test';
import assert from 'node:assert/strict';
import { PAD, RP, buttonMap, computePadInputs, normalizePad, pickPad, touchLayout, PAD_PROFILES } from '../js/input-profiles.mjs';
import { SYSTEMS } from '../js/systems.mjs';

const pad = (pressed = [], axes = [0, 0, 0, 0]) => ({
  connected: true, mapping: 'standard', id: 'Xbox 360 Controller (STANDARD GAMEPAD)', axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
});
const on = (out) => Object.entries(out).filter(([, v]) => v).map(([k, v]) => [Number(k), v]);

test('Chaque console du lanceur a ses deux profils ; Natif laisse la main au moteur', () => {
  for (const sys of Object.keys(SYSTEMS)) {
    assert.ok(buttonMap(sys, 'authentique'), sys);
    assert.ok(buttonMap(sys, 'confort').length > buttonMap(sys, 'authentique').length, sys);
    assert.equal(buttonMap(sys, 'natif'), null);
  }
  assert.deepEqual(Object.keys(PAD_PROFILES), ['authentique', 'confort', 'natif']);
});

test('Start et Select toujours accessibles, quelle que soit la console', () => {
  for (const sys of Object.keys(SYSTEMS)) for (const profile of ['authentique', 'confort']) {
    const out = computePadInputs(sys, pad([PAD.start, PAD.back]), { profile });
    assert.equal(out[RP.START], 1, `${sys} ${profile}`);
    assert.equal(out[RP.SELECT], 1, `${sys} ${profile}`);
  }
});

test('Positions d’origine : NES B/A, SNES losange, Genesis A-B-C, PSP ✕ ○ □ △', () => {
  assert.deepEqual(on(computePadInputs('nes', pad([PAD.bottom]), { profile: 'authentique' })), [[RP.B, 1]]);
  assert.deepEqual(on(computePadInputs('nes', pad([PAD.right]), { profile: 'authentique' })), [[RP.A, 1]]);
  assert.deepEqual(on(computePadInputs('snes', pad([PAD.left]), { profile: 'authentique' })), [[RP.Y, 1]]);
  assert.deepEqual(on(computePadInputs('snes', pad([PAD.top]), { profile: 'authentique' })), [[RP.X, 1]]);
  // Genesis Plus GX : A = Y, B = B, C = A (EmulatorJS).
  assert.deepEqual(on(computePadInputs('genesis', pad([PAD.left, PAD.bottom, PAD.right]), { profile: 'authentique' })), [[RP.B, 1], [RP.Y, 1], [RP.A, 1]]);
  // PSP : ✕ = B, ○ = A, □ = Y, △ = X.
  assert.deepEqual(on(computePadInputs('psp', pad([PAD.bottom, PAD.right, PAD.left, PAD.top]), { profile: 'authentique' })), [[RP.B, 1], [RP.Y, 1], [RP.A, 1], [RP.X, 1]]);
});

test('Confort : stick gauche → croix (seuil), doublons ; Authentique : le stick ne pilote pas la croix', () => {
  assert.deepEqual(on(computePadInputs('nes', pad([], [-0.9, 0]), { profile: 'confort' })), [[RP.LEFT, 1]]);
  assert.deepEqual(on(computePadInputs('nes', pad([], [0.3, 0]), { profile: 'confort' })), []);
  assert.deepEqual(on(computePadInputs('nes', pad([], [-0.9, 0]), { profile: 'authentique' })), []);
  assert.deepEqual(on(computePadInputs('nes', pad([PAD.left]), { profile: 'confort' })), [[RP.B, 1]]);
  assert.deepEqual(on(computePadInputs('gba', pad([PAD.LT]), { profile: 'confort' })), [[RP.L, 1]]);
  assert.deepEqual(on(computePadInputs('gba', pad([PAD.LT]), { profile: 'authentique' })), []);
});

test('PSP : stick gauche analogique avec zone morte, jamais converti en croix', () => {
  const out = computePadInputs('psp', pad([], [1, 0]), { profile: 'confort', deadzone: 0.2 });
  assert.equal(out[16], 0x7fff);
  assert.equal(out[RP.RIGHT], 0);
  assert.deepEqual(on(computePadInputs('psp', pad([], [0.1, 0.1]), { profile: 'confort', deadzone: 0.2 })), []);
  const half = computePadInputs('psp', pad([], [0, -0.6]), { profile: 'authentique', deadzone: 0.2 });
  assert.ok(Math.abs(half[19] - 0.5 * 0x7fff) <= 1, `moitié de course : ${half[19]}`);
});

test('Aucune manette : tout relâché ; préférence pour la disposition « standard »', () => {
  assert.equal(on(computePadInputs('snes', null, {})).length, 0);
  const odd = { connected: true, mapping: '', id: 'autre' };
  const std = pad();
  assert.equal(pickPad([null, odd, std]), std);
  assert.equal(pickPad([odd]), odd);
  assert.equal(pickPad([{ connected: false, mapping: 'standard' }]), null);
});

test('Réglages bornés et valeurs par défaut', () => {
  assert.deepEqual(normalizePad({}), { profile: 'confort', deadzone: 0.25, hideTouch: true, touchSize: 1, touchOpacity: 0.85, touchOffsets: {} });
  assert.deepEqual(normalizePad({ profile: 'x', deadzone: 5, touchSize: 0.1, touchOpacity: 2, hideTouch: false }), { profile: 'confort', deadzone: 0.6, hideTouch: false, touchSize: 0.6, touchOpacity: 1, touchOffsets: {} });
  // Positions des boutons : clés connues seulement, valeurs bornées.
  assert.deepEqual(normalizePad({ touchOffsets: { b_a: [12.4, -900], left: [5, 5], 'x;y': [1, 1], right: ['a', 1] } }).touchOffsets, { b_a: [12, -600], left: [5, 5] });
});

test('Commandes tactiles PSP : ✕ ○ □ △, stick analogique, croix, L/R, Start/Select', () => {
  const layout = touchLayout('psp');
  assert.deepEqual(layout.filter((b) => b.type === 'button').map((b) => [b.text, b.input_value]).sort(), [['L', 10], ['R', 11], ['Select', 2], ['Start', 3], ['□', 1], ['○', 8], ['△', 9], ['✕', 0]].sort());
  assert.ok(layout.some((b) => b.type === 'zone' && b.joystickInput && b.inputValues.join() === '16,17,18,19'));
  assert.ok(layout.some((b) => b.type === 'dpad' && b.inputValues.join() === '4,5,6,7'));
  assert.equal(touchLayout('snes'), null);
});

// --- Codes chargés automatiquement --------------------------------------------------
test('Codes automatiques : même disque (PSP), même titre entre noms No-Intro et GoodTools', async () => {
  const { findCheatCandidates, titleKey } = await import('../js/cheat-autoload.mjs');
  const { baseTitle } = await import('../js/cheats.mjs');
  assert.equal(titleKey('Sonic The Hedgehog [USA][Europe][!].md'), titleKey('Sonic The Hedgehog (USA, Europe).cht'));
  assert.equal(titleKey('Legend of Zelda, The - A Link to the Past (USA).sfc'), titleKey('The Legend of Zelda - A Link to the Past (USA).cht'));
  assert.equal(baseTitle('Sonic The Hedgehog [USA][Europe][!].md'), baseTitle('Sonic The Hedgehog (USA, Europe).cht'));
  const names = ['Sonic The Hedgehog (Japan, Korea).cht', 'Sonic The Hedgehog (USA, Europe).cht', 'Sonic The Hedgehog (World) (Action Replay).cht', 'Sonic The Hedgehog 2 (World).cht', 'Sonic Spinball (USA).cht'];
  const found = findCheatCandidates('genesis', 'Sonic The Hedgehog [USA][Europe][!].md', null, names);
  assert.equal(found[0], 'Sonic The Hedgehog (USA, Europe).cht');
  assert.ok(!found.includes('Sonic The Hedgehog 2 (World).cht'));
  assert.deepEqual(findCheatCandidates('psp', 'Bust A Move Ghost.cso', 'ULES-00233', ['Bust A Move Ghost [ULES-00233].cht', 'Autre [ULUS-10041].cht']), ['Bust A Move Ghost [ULES-00233].cht']);
  assert.deepEqual(findCheatCandidates('psp', 'x.cso', null, ['Bust A Move Ghost [ULES-00233].cht']), []);
});

test('Codes automatiques : un fichier sans code utilisable (« Rumbles », Action Replay refusés) n’est pas importé', async () => {
  const { autoloadCheats } = await import('../js/cheat-autoload.mjs');
  const files = {
    '3 Ninjas Kick Back (USA).cht': 'cheats = 1\ncheat0_desc = "Vies infinies"\ncheat0_code = "7E0D5A09"\ncheat0_enable = false\n',
    '3 Ninjas Kick Back (Rumbles).cht': 'cheats = 1\ncheat0_desc = "Rumble on energy loss"\ncheat0_code = ""\ncheat0_handler = "1"\n',
    '3 Ninjas Kick Back (USA) (Action Replay).cht': 'cheats = 2\ncheat0_desc = "Score"\ncheat0_code = "7E081B??"\ncheat1_desc = "x"\ncheat1_code = "2000.00"\n',
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = decodeURIComponent(String(url));
    if (u.endsWith('catalogue.json')) return { ok: true, json: async () => ({ 'Nintendo - Super Nintendo Entertainment System': Object.keys(files) }) };
    const name = Object.keys(files).find((n) => u.endsWith(n));
    return name ? { ok: true, text: async () => files[name] } : { ok: false };
  };
  const committed = [];
  const store = { listCheatFiles: async () => [], prepareCheatFile: async (f) => f, commitCheatFiles: async (list) => { committed.push(...list); } };
  try {
    const r = await autoloadCheats({ store, system: 'snes', romName: '3 Ninjas Kick Back (U) [!].smc', base: 'http://test/rumbles/' });
    assert.deepEqual(r.imported, ['3 Ninjas Kick Back (USA).cht']);
    assert.deepEqual(committed.map((f) => f.name), ['3 Ninjas Kick Back (USA).cht']);
  } finally { globalThis.fetch = realFetch; }
});

// --- Choix de version dans une archive ------------------------------------------------
test('Versions d’une archive : vérifiée et Europe/USA d’abord, hacks et mauvais dumps à la fin', async () => {
  const { rankVersions, versionLabels } = await import('../js/version-picker.mjs');
  const names = ['Gunstar Heroes [Japan][Sample][April][1993][!!].md', 'Gunstar Heroes [USA][GoodSet][T+Fre_Terminus].bin', 'zz_Gunstar Heroes [Europe][GoodSet][o1].bin',
    'Gunstar Heroes [USA][!!].md', 'Gunstar Heroes [Europe][!].md', 'Gunstar Heroes [Japan][!!].md', 'Gunstar Heroes [USA][T.Spa-Ful-Wave-3344].md'];
  const ranked = rankVersions(names.map((name) => ({ name, size: 1048576 }))).map((e) => e.name);
  assert.equal(ranked[0], 'Gunstar Heroes [Europe][!].md');
  assert.ok(ranked.indexOf('Gunstar Heroes [USA][GoodSet][T+Fre_Terminus].bin') < ranked.indexOf('Gunstar Heroes [USA][T.Spa-Ful-Wave-3344].md'));
  assert.equal(ranked.at(-1), 'zz_Gunstar Heroes [Europe][GoodSet][o1].bin');
  assert.deepEqual(versionLabels('Gunstar Heroes [USA][GoodSet][T+Fre_Terminus].bin').tags.slice(0, 2), ['USA', 'traduction française']);
});

test('Notation des HackSets : [H.…] hack, [T.Por-…] traduction, [!!] vérifiée', async () => {
  const { versionLabels, rankVersions } = await import('../js/version-picker.mjs');
  assert.ok(versionLabels('Sonic The Hedgehog [Japan][Europe][Korea][H.dr_robotnik_in_sonic_the_hedgehog-4995].md').tags.includes('hack'));
  assert.ok(versionLabels('Sonic The Hedgehog [Japan][Europe][Korea][T.Por-Ful-Green-5968].md').tags.includes('traduction Por'));
  assert.ok(versionLabels('Sonic The Hedgehog [Japan][Europe][Korea][!!].md').tags.includes('version vérifiée'));
  const ranked = rankVersions(['Sonic The Hedgehog [Japan][Europe][Korea][H.sonic_1_character_pak-5619].md', 'Sonic The Hedgehog [Japan][Europe][Korea][!!].md'].map((name) => ({ name, size: 1 })));
  assert.equal(ranked[0].name, 'Sonic The Hedgehog [Japan][Europe][Korea][!!].md');
});

test('BIOS rangés avec les jeux : message clair au lieu de « fichier trop petit », en fin de liste des versions', async () => {
  const { isBiosName, analyzeRom, BIOS_MESSAGE } = await import('../js/systems.mjs');
  const { rankVersions, versionLabels } = await import('../js/version-picker.mjs');
  for (const n of ['[BIOS] Nintendo Game Boy Boot ROM [World][Rev 1][!].gb', 'Super Wild Card V2.8CC 06-08-94 BIOS [h2].smc', 'Tri-Star Super 8 BIOS (NES-SNES Adapter) (V1.1).smc', 'bios7.bin', 'gba_bios.bin']) {
    assert.equal(isBiosName(n), true, n);
  }
  for (const n of ['Biosphere (USA).nes', 'Super Mario World (USA).sfc', 'Robot Boot Camp (USA).gba']) assert.equal(isBiosName(n), false, n);
  assert.deepEqual(analyzeRom('[BIOS] Nintendo Game Boy Boot ROM [World][Rev 1][!].gb', new Uint8Array(256)).errors, [BIOS_MESSAGE]);
  const ranked = rankVersions([{ name: '[BIOS] Nintendo Game Boy Boot ROM [World][!].gb', size: 256 }, { name: 'Tetris [World][!].gb', size: 32768 }]);
  assert.equal(ranked[0].name, 'Tetris [World][!].gb');
  assert.equal(versionLabels('[BIOS] Nintendo Game Boy Boot ROM [World][!].gb').tags[0], 'BIOS, pas un jeu');
});

test('Arcade : romset .zip confié tel quel, BIOS arcade refusé, nom court conseillé', async () => {
  const { analyzeArcade, ARCADE_CORE_ORDER } = await import('../js/systems.mjs');
  const zip = new Uint8Array([0x50, 0x4b, 3, 4, ...new Array(40).fill(0)]);
  const ok = analyzeArcade('xxmissio.zip', zip);
  assert.equal(ok.ok, true);
  assert.equal(ok.system, 'arcade');
  assert.equal(ok.code, 'xxmissio');
  assert.equal(analyzeArcade('neogeo.zip', zip).ok, false);
  assert.equal(analyzeArcade('xxmissio.7z', zip).ok, false);
  assert.equal(analyzeArcade('pas-un-zip.zip', new Uint8Array(40)).ok, false);
  assert.equal(analyzeArcade('Super Mario (USA).zip', zip).warnings.length, 1);
  assert.deepEqual(ARCADE_CORE_ORDER, ['mame2003_plus', 'fbneo']);
});
