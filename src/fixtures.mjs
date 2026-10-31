import { canonical, copy, digest, exactKeys, freeze, labAssert, isHash } from './common.mjs';
export const FIXTURE_SCHEMA = 'n64lab/synthetic-fixture/v1';
export async function makeFixture(name = 'PAL-A', region = 'PAL') {
  labAssert(['PAL', 'NTSC'].includes(region) && /^[A-Za-z0-9_-]{1,40}$/.test(name), 'E_FIXTURE', 'Fixture invalide.');
  const content = { schema: FIXTURE_SCHEMA, name, region, synthetic: true, data: 'TEXT FIXTURE ONLY - NO ROM OR N64 MACHINE CODE' };
  return freeze({ content, sha256: await digest(content), bytes: new TextEncoder().encode(canonical(content)).length });
}
export async function validateFixture(fixture) {
  exactKeys(fixture, ['content', 'sha256', 'bytes']);
  exactKeys(fixture.content, ['schema', 'name', 'region', 'synthetic', 'data']);
  const c = fixture.content;
  labAssert(c.schema === FIXTURE_SCHEMA && c.synthetic === true && ['PAL', 'NTSC'].includes(c.region) && typeof c.name === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(c.name) && c.data === 'TEXT FIXTURE ONLY - NO ROM OR N64 MACHINE CODE', 'E_FIXTURE', 'Seules les fixtures textuelles synthétiques du laboratoire sont admises.');
  labAssert(isHash(fixture.sha256) && await digest(c) === fixture.sha256 && fixture.bytes === new TextEncoder().encode(canonical(c)).length, 'E_INTEGRITY', 'Intégrité de fixture invalide.');
  return freeze(copy(fixture));
}
