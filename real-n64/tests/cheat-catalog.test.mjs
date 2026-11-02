import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { romCheatIdentity, parseMupenCheats, lookupCheats, resolveCheatCode, loadCheatCatalog, validateManualCheat } from '../cheat-catalog.mjs';

const fixture = `// synthetic parser tests; no commercial ROM or cheat data
crc 12345678-90ABCDEF-C:50
gn Test PAL
 cn Simple
  cd Test description
  80000040 0001
 cn Parameter
  80000041 ???? 0001:"One",0002:"Two, quoted \\"value\\""
 cn Shared parameter
  80000042 ????
  80000043 ???? 0001:"One",0002:"Two"
 cn Special unsupported
  F1000040 0001
crc 11111111-22222222-C:45
gn Test NTSC
 cn Other game
  80000040 0002
`;
const catalog = parseMupenCheats(fixture);

test('Canonical ROM identity uses header CRC/country/revision, not filename', () => {
  const bytes = new Uint8Array(4096); bytes.set([0x80,0x37,0x12,0x40]);
  new DataView(bytes.buffer).setUint32(0x10, 0x12345678); new DataView(bytes.buffer).setUint32(0x14, 0x90abcdef);
  bytes[0x3e] = 0x50; bytes[0x3f] = 2;
  const result = romCheatIdentity(bytes);
  assert.equal(result.key, '12345678-90ABCDEF-C:50'); assert.equal(result.revision, 2);
  assert.throws(() => romCheatIdentity(bytes.subarray(0,32)));
  bytes[0] = 0; assert.throws(() => romCheatIdentity(bytes));
});

test('Complete parser lists all cheats, notes unsupported code and enables nothing', () => {
  assert.equal(catalog.game_count, 2); assert.equal(catalog.cheat_count, 5);
  assert.equal(catalog.games[0].cheats[0].description, 'Test description');
  for (const cheat of catalog.games.flatMap(game => game.cheats)) { assert.equal(cheat.enabled, false); assert.equal(cheat.verified, false); }
  assert.equal(catalog.games[0].cheats[3].supported, false);
  assert.throws(() => resolveCheatCode(catalog.games[0].cheats[3]));
});

test('Only exact CRC/country gets a match, missing ROM does not reuse previous codes', async () => {
  const matched = await lookupCheats('12345678-90ABCDEF-C:50', { catalog });
  assert.equal(matched.game.name, 'Test PAL'); assert.equal(matched.cheats.length, 4);
  const absent = await lookupCheats('12345678-90ABCDEF-C:45', { catalog });
  assert.equal(absent.game, null); assert.equal(absent.cheats.length, 0); assert.equal(absent.found, false);
  assert.equal(matched.verified_for_rom, false);
});

test('Parameter resolution uses an offered value and supports shared placeholders', () => {
  assert.equal(catalog.games[0].cheats[1].options[1].label, 'Two, quoted "value"');
  assert.equal(resolveCheatCode(catalog.games[0].cheats[1], '0002'), '80000041 0002');
  const cheat = catalog.games[0].cheats[2];
  assert.equal(resolveCheatCode(cheat, '0002'), '80000042 0002+80000043 0002');
  assert.throws(() => resolveCheatCode(cheat)); assert.throws(() => resolveCheatCode(cheat, 'FFFF'));
  assert.equal(resolveCheatCode(catalog.games[0].cheats[0]), '80000040 0001');
});

test('Ambiguous header keys require explicit variant selection', async () => {
  const duplicate = parseMupenCheats('crc 12345678-90ABCDEF-C:50\ngn First\n cn One\n  80000040 0001\ncrc 12345678-90ABCDEF-C:50\ngn Second\n cn Two\n  80000040 0002\n');
  const result = await lookupCheats('12345678-90ABCDEF-C:50', { catalog: duplicate });
  assert.equal(result.ambiguous, true); assert.equal(result.cheats.length, 0);
  const chosen = await lookupCheats('12345678-90ABCDEF-C:50', { catalog: duplicate, variantId: 1 });
  assert.equal(chosen.game.name, 'Second'); assert.equal(chosen.cheats[0].code, '80000040 0002');
  const fromSelect = await lookupCheats('12345678-90ABCDEF-C:50', { catalog: duplicate, variantId: '1' });
  assert.equal(fromSelect.game.id, chosen.game.id);
  assert.equal((await lookupCheats('12345678-90ABCDEF-C:50', { catalog: duplicate, variantId: '0' })).game.name, 'First');
  for (const invalid of ['1x', '', '01', -1, true, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(lookupCheats('12345678-90ABCDEF-C:50', { catalog: duplicate, variantId: invalid }));
  }
});

test('Manual codes normalize only allowed hex lines; empty, oversized and executable text refused', () => {
  assert.equal(validateManualCheat(' 80000040 000a\n81000042 0100 '), '80000040 000A+81000042 0100');
  assert.equal(validateManualCheat('80000040 0001+80000041 0002'), '80000040 0001+80000041 0002');
  for (const code of ['', 'alert(1)', '80000040 ????', 'F1000040 0001', Array(65).fill('80000040 0001').join('\n')]) assert.throws(() => validateManualCheat(code));
});

test('Names stay data, result objects immutable, malformed input rejected', () => {
  const data = parseMupenCheats('crc 12345678-90ABCDEF-C:50\ngn <img src=x>\n cn <script>evil</script>\n  80000040 0001\n');
  assert.equal(data.games[0].name, '<img src=x>'); assert.equal(data.games[0].cheats[0].name, '<script>evil</script>');
  assert(Object.isFrozen(data)); assert(Object.isFrozen(data.games[0].cheats[0]));
  assert.throws(() => parseMupenCheats('crc filename.n64\n')); assert.throws(() => parseMupenCheats('x'.repeat(2*1024*1024+1)));
});

test('Pinned source hash, full entry counts and known ambiguous key are verified locally', async () => {
  const lock = JSON.parse(readFileSync(new URL('../docs/cheat-catalog-lock.json', import.meta.url)));
  const bytes = readFileSync(new URL('../vendor/cheats/mupencheat.txt', import.meta.url));
  assert.equal(bytes.length, lock.assets[0].bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), lock.assets[0].sha256);
  const complete = parseMupenCheats(bytes.toString('utf8'));
  assert.equal(complete.game_count, 558); assert.equal(complete.unique_rom_keys, 556); assert.equal(complete.cheat_count, 9238);
  const duplicate = await lookupCheats('503EA760-E1300E96-C:50', { catalog: complete });
  assert.equal(duplicate.ambiguous, true); assert.equal(duplicate.matches.length, 3);
});

test('Browser loader fetches only fixed local URLs, verifies source hash and rejects corruption', async () => {
  const lock = readFileSync(new URL('../docs/cheat-catalog-lock.json', import.meta.url));
  const source = readFileSync(new URL('../vendor/cheats/mupencheat.txt', import.meta.url));
  const calls = [];
  const fetcher = async url => { calls.push(url); return new Response(url.startsWith('docs/') ? lock : source); };
  const loaded = await loadCheatCatalog({ reload: true, fetcher });
  assert.equal(loaded.cheat_count, 9238); assert.deepEqual(calls, ['docs/cheat-catalog-lock.json', 'vendor/cheats/mupencheat.txt']);
  await assert.rejects(loadCheatCatalog({ reload: true, fetcher: async url => new Response(url.startsWith('docs/') ? lock : Buffer.alloc(source.length)) }));
});
