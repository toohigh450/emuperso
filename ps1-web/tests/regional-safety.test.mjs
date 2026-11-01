import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheatController } from '../cheat-controller.mjs';
import * as regions from '../cheat-catalog-psx.mjs';
import { regionEvidence } from '../region-evidence.mjs';
const code = { name: 'Synthetic', code: '80010000 0001' };
const tags = ['En,Fr,Es', 'En,Fr,Es,Pt-BR', 'En,Fr,Es,zh-Hans-CN',
  'En,Fr,Es,Pt-419', 'En,Fr,Es,fil-PH', 'En,Fr,Es,yue-Hant-HK', 'En,Fr,Es,cmn-Hans-CN'];
function harness({ ambiguous = false, catalogTitle = 'Demo (Europe)' } = {}) {
  const engine = { active: [], calls: [], fail: false, setCheats(list) {
    this.calls.push(structuredClone(list));
    if (this.fail) throw new Error('injected failure');
    this.active = structuredClone(list);
  } };
  const store = { get: async () => null, set: async () => {} };
  const catalog = {
    find: async () => ambiguous
      ? { status: 'ambiguous', candidates: [{ catalogTitle, codes: [code] }] }
      : { status: 'match', catalogTitle, cheats: [code] },
    load: async () => ({ bySerial: { 'SLES-00001': [code] }, byTitle: { [catalogTitle]: [code] }, serialMap: { 'SLES-00001': catalogTitle } }),
  };
  const ctl = createCheatController({ getEngine: () => engine, catalog, regions,
    stores: { cheats: store, editions: store } });
  return { ctl, engine };
}
for (const tag of tags) {
  test(`P0 restore/toggle/serial + positive control: ${tag}`, async () => {
    const name = `Demo (${tag}).chd`, { ctl, engine } = harness();
    assert.equal(regions.detectRegion(name), null);
    await ctl.startSession({ name, canonical_sha256: 'a'.repeat(64) }, [code]);
    assert.equal(engine.active.length, 0); assert.equal(engine.calls.length, 0);
    assert.equal(ctl.view().pending, 1);
    await ctl.toggle(0, true);
    assert.equal(engine.calls.length, 0);
    await ctl.applySerial('SLES-00001');
    assert.equal(engine.active.length, 0);
    const calls = engine.calls.length;
    await ctl.toggle(0, true);
    assert.equal(engine.calls.length, calls, 'manual serial cannot bypass gate');
    engine.fail = true;
    await ctl.confirmRegion();
    assert.equal(ctl.view().engineSync, 'unknown');
    assert.equal(engine.active.length, 0);
    assert.ok(ctl.view().region, 'confirmation reopens on error');
    await ctl.toggle(0, true);
    assert.equal(engine.active.length, 0);
    engine.fail = false;
    await ctl.disableAll();
    await ctl.toggle(0, true);
    await ctl.confirmRegion();
    assert.equal(engine.active.length, 1, 'positive control detects actual adapter injection');
    await ctl.startSession({ name, canonical_sha256: 'a'.repeat(64) }, [code]);
    // startSession contract: caller supplies a new empty engine realm.
    // Explicitly clear the instrumented realm to model that boundary.
    engine.active = [];
    assert.equal(ctl.view().applied, 0, 'prior confirmation never carries into a new session');
    assert.ok(ctl.view().region);
  });
  test(`P0 edition choice remains pending: ${tag}`, async () => {
    const { ctl, engine } = harness({ ambiguous: true });
    await ctl.startSession({ name: `Demo (${tag}).chd` }, [code]);
    await ctl.chooseCandidate(0);
    assert.equal(engine.active.length, 0);
    assert.equal(ctl.view().pending, 1);
    await ctl.confirmRegion();
    assert.equal(engine.active.length, 1, 'positive edition control');
  });
}
test('metadata evidence: languages, mixed groups, conflicting regions, title words', () => {
  for (const text of ['Demo (En,Fr,Es,future-extension)', 'Demo (EU,FR)', 'Demo FR', 'The Last of US']) {
    // A title word can look like a suffix, but never verifies an edition.
    assert.equal(regionEvidence(text).editionVerified, false);
  }
  assert.equal(regions.detectRegion('Demo (EU,FR)'), null);
  assert.equal(regions.detectRegion('Demo (USA) (Europe)'), null);
  assert.equal(regions.detectRegion('Demo (USA) (En,Fr,Es,fil-PH)'), 'USA');
  assert.deepEqual(regions.detectRegions('Demo (US,EU)'), ['USA', 'Europe']);
  assert.equal(regions.detectRegion('Demo (US,EU)'), null);
  assert.equal(regions.regionsCompatible('Europe', ['World']), false);
});
test('unknown catalogue region also requires explicit acknowledgement', async () => {
  const { ctl, engine } = harness({ catalogTitle: 'Demo' });
  await ctl.startSession({ name: 'Demo (Europe).chd' }, [code]);
  assert.equal(engine.calls.length, 0); assert.ok(ctl.view().region);
});
test('name recognition preserves disc/revision separation from edition evidence', () => {
  for (const filename of ['Gran Turismo 2-PSX-PAL-CD1.chd', 'Gran Turismo 2-PSX-PAL-CD2.chd',
    'Gran Turismo 2-PSX-NTSC-U-Disc2.chd', 'Gran Turismo 2 (Europe) (Rev 1) (Disc 2).bin',
    'Gran Turismo 2 (En,Fr,Es,cmn-Hans-CN).chd']) {
    assert.equal(regions.titleStem(filename), 'gran turismo 2');
    assert.equal(regionEvidence(filename).editionVerified, false);
  }
  assert.equal(regions.titleStem('Spider-Man-PSX-PAL-CD1.chd'), 'spider man');
  assert.equal(regions.titleStem('X-Men-PSX-NTSC-J-CD2.chd'), '10 men');
});
