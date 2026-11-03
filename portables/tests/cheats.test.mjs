import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCht, normalizeName, baseTitle, deviceLabel, matchCheatFiles, inferSystemFromPath, toEjsCheats } from '../js/cheats.mjs';

const SAMPLE = [
  'cheats = 3',
  '',
  'cheat0_desc = "Enable Code (Must Be On)"',
  'cheat0_code = "00007358+000A+100092B8+0007"',
  'cheat0_enable = false',
  '',
  'cheat1_desc = "Infinite Lives"',
  'cheat1_code = "32003C08+0009"',
  'cheat1_enable = true',
  '',
  'cheat2_desc = "Vide"',
  'cheat2_code = ""',
].join('\r\n');

test('lecture d\'un .cht (fins de ligne Windows, guillemets, codes à « + », code vide ignoré)', () => {
  const c = parseCht(SAMPLE);
  assert.equal(c.length, 2);
  assert.deepEqual(c[0], { desc: 'Enable Code (Must Be On)', code: '00007358+000A+100092B8+0007' });
  assert.equal(c[1].code, '32003C08+0009');
});

test('lecture : texte vide ou illisible = liste vide', () => {
  assert.deepEqual(parseCht(''), []);
  assert.deepEqual(parseCht('n importe quoi\n=== rien'), []);
});

test('normalisation des noms et appareils de triche', () => {
  assert.equal(normalizeName('007 - NightFire (USA, Europe) (Code Breaker).cht'), '007 - nightfire (usa, europe)');
  assert.equal(deviceLabel('007 - NightFire (USA, Europe) (Code Breaker).cht'), 'Code Breaker');
  assert.equal(deviceLabel('Zelda (USA) (GameShark).cht'), 'GameShark');
  assert.equal(deviceLabel('Zelda (USA).cht'), '');
  assert.equal(baseTitle('Zelda (Europe) (Rev 1) (Action Replay).cht'), 'zelda');
});

test('association : même nom = exact ; autre région/version = jamais exact', () => {
  const files = [
    { path: 'a', name: 'Pokemon - Emerald Version (USA, Europe) (Code Breaker).cht' },
    { path: 'b', name: 'Pokemon - Emerald Version (USA, Europe) (GameShark).cht' },
    { path: 'c', name: 'Pokemon - Emerald Version (Japan) (Code Breaker).cht' },
    { path: 'd', name: 'Pokemon - Ruby Version (USA, Europe) (Code Breaker).cht' },
  ];
  const m = matchCheatFiles('Pokemon - Emerald Version (USA, Europe).gba', files);
  assert.deepEqual(m.exact.map((f) => f.path), ['a', 'b']);
  assert.deepEqual(m.sameTitle.map((f) => f.path), ['c']);
});

test('association : même titre malgré la ponctuation ou « The » (GoodTools contre No-Intro)', () => {
  const files = [
    { path: 'a', name: 'A.S.P. - Air Strike Patrol (USA).cht' },
    { path: 'b', name: 'Legend of Zelda, The - A Link to the Past (USA).cht' },
    { path: 'c', name: 'A.S.P. 2 (USA).cht' },
  ];
  assert.deepEqual(matchCheatFiles('A.S.P. Air Strike Patrol (U).smc', files).sameTitle.map((f) => f.path), ['a']);
  assert.deepEqual(matchCheatFiles('The Legend of Zelda - A Link to the Past (U) [!].smc', files).sameTitle.map((f) => f.path), ['b']);
});

test('association : titre tronqué dans une archive HackSet → titre de l’archive, étiquettes de la version', async () => {
  const { archiveCheatName, matchCheatFiles: match } = await import('../js/cheats.mjs');
  assert.equal(archiveCheatName('Aero the Acro-B2 [Europe][!].md', 'Aero the Acro-Bat 2.7z'), 'Aero the Acro-Bat 2 [Europe][!].md');
  assert.equal(archiveCheatName('6-P [USA][!].md', '6-Pak.7z'), '6-Pak [USA][!].md');
  // Même titre (ponctuation ou « The » près) ou pas d'archive : rien à changer.
  assert.equal(archiveCheatName('Addams Family [USA][Europe][!].md', 'Addams Family, The.7z'), null);
  assert.equal(archiveCheatName('Sonic.md', null), null);
  const alt = archiveCheatName('Aero the Acro-B2 [Europe][!].md', 'Aero the Acro-Bat 2.7z');
  assert.deepEqual(match(alt, [{ path: 'a', name: 'Aero the Acro-Bat 2 (Europe).cht' }]).sameTitle.map((f) => f.path), ['a']);
});

test('association : même titre, la même région que la ROM proposée en premier', () => {
  const files = [{ path: 'eu', name: 'Addams Family, The (Europe) (En,Fr,De).cht' }, { path: 'jp', name: 'Addams Family, The (Japan).cht' }, { path: 'us', name: 'Addams Family, The (USA).cht' }];
  assert.equal(matchCheatFiles('Addams Family, The (U) [!].smc', files).sameTitle[0].path, 'us');
  assert.equal(matchCheatFiles('Addams Family, The (E) [!].smc', files).sameTitle[0].path, 'eu');
});

test('association : rien si la ROM a été renommée sans titre commun', () => {
  const m = matchCheatFiles('jeu.gba', [{ path: 'a', name: 'Zelda (USA).cht' }]);
  assert.equal(m.exact.length, 0);
  assert.equal(m.sameTitle.length, 0);
});

test('console déduite du dossier', () => {
  assert.equal(inferSystemFromPath('cht/Nintendo - Game Boy Advance/Jeu.cht'), 'gba');
  assert.equal(inferSystemFromPath('cht/Nintendo - Game Boy Color/Jeu.cht'), 'gbc');
  assert.equal(inferSystemFromPath('cht/Nintendo - Game Boy/Jeu.cht'), 'gb');
  assert.equal(inferSystemFromPath('cht/Nintendo - Nintendo DS/Jeu.cht'), 'nds');
  assert.equal(inferSystemFromPath('mes-codes/nds/Jeu.cht'), 'nds');
  assert.equal(inferSystemFromPath('Jeu.cht'), null);
  assert.equal(inferSystemFromPath('cht/Sega - Mega Drive/Jeu.cht'), null);
});

test('format EJS_cheats : paires [nom, code]', () => {
  assert.deepEqual(toEjsCheats([{ desc: 'A', code: '1' }, { desc: '', code: '2' }, { desc: 'X', code: '' }]), [['A', '1'], ['Code 2', '2']]);
});
