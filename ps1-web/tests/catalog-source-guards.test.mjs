// Garde-fous sur le source du catalogue (régressions P1-A / P1-B, audit GPT RC-1.4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('P1-A : detectMod utilise titre brut (pas titleStem)', async () => {
  const src = await readFile(new URL('../cheat-catalog-psx.mjs', import.meta.url), 'utf8');
  // Ne doit PAS appeler detectMod(titleStem(...))
  assert.ok(!src.includes("detectMod(titleStem("),
    'detectMod ne doit pas recevoir titleStem (qui casse v6.1)');
  // Doit utiliser le titre brut ou stripDiscExtension
  assert.ok(src.includes("detectMod(stripDiscExtension(") || src.includes("detectMod(title"),
    'detectMod sur titre brut');
});

test('P1-B : tri candidats avec région du titre original', async () => {
  const src = await readFile(new URL('../cheat-catalog-psx.mjs', import.meta.url), 'utf8');
  // Ne doit PAS utiliser titleStem pour detectRegion dans le tri
  const triSection = src.slice(src.indexOf('P1 (audit GPT RC-1.3)'));
  assert.ok(!triSection.includes("detectRegion(titleStem("),
    'tri ne doit pas utiliser titleStem (qui supprime la région)');
});
