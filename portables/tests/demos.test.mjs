import test from 'node:test';
import assert from 'node:assert/strict';

test('Démos : chaque bouton a une entrée, chaque ROM locale correspond à son empreinte', async () => {
  const { readFile } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const src = await readFile(new URL('../js/demos.mjs', import.meta.url), 'utf8');
  const keys = [...html.matchAll(/data-portable-demo="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.includes('nes') && keys.includes('snes'));
  for (const key of keys) assert.ok(src.includes(`  ${key}: {`) || src.includes(`  '${key}': {`), `démo sans entrée : ${key}`);
  for (const m of src.matchAll(/filename: '([^']+)', size: (\d+),\s*sha256: '([0-9a-f]{64})',\s*url: 'demos\/([^']+)'/g)) {
    const bytes = await readFile(new URL(`../demos/${m[4]}`, import.meta.url));
    assert.equal(bytes.length, Number(m[2]), m[4]);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), m[3], m[4]);
  }
});
