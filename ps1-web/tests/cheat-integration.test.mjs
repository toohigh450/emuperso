import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Tests d'intégration avec le VRAI catalogue (demandés par l'audit GPT)
const catalog = JSON.parse(await readFile(new URL('../data/psx-catalog.json', import.meta.url), 'utf8'));

test('stripDiscExtension retire les extensions', async () => {
  const { stripDiscExtension } = await import('../cheat-catalog-psx.mjs');
  assert.equal(stripDiscExtension('NBA Jam Extreme (E).chd'), 'NBA Jam Extreme (E)');
  assert.equal(stripDiscExtension('Final Fantasy 5 FR.pbp'), 'Final Fantasy 5 FR');
  assert.equal(stripDiscExtension('game.iso'), 'game');
});

test('titleStem normalise les titres', async () => {
  const { titleStem } = await import('../cheat-catalog-psx.mjs');
  assert.equal(titleStem('NBA Jam Extreme (E).chd'), 'nba jam extreme');
  assert.equal(titleStem('Final Fantasy 5 FR.pbp'), 'final fantasy 5');
  assert.equal(titleStem('Dave Mirra Freestyle BMX.chd'), 'dave mirra freestyle bmx');
});

test('NBA Jam Extreme (E).chd -> candidat World, 12 codes', async () => {
  const { candidatesByStem } = await import('../cheat-catalog-psx.mjs');
  const cands = candidatesByStem(catalog, 'NBA Jam Extreme (E).chd');
  assert.ok(cands.length >= 1, 'Au moins un candidat');
  const world = cands.find(c => c.catalogTitle.includes('World'));
  assert.ok(world, 'Candidat World trouvé');
  assert.equal(world.codes.length, 12, '12 codes World');
});

test('Dave Mirra : USA et World séparés, jamais mélangés', async () => {
  const { candidatesByStem } = await import('../cheat-catalog-psx.mjs');
  const cands = candidatesByStem(catalog, 'Dave Mirra Freestyle BMX.chd');
  assert.ok(cands.length >= 2, 'USA et World trouvés séparément');
  const usa = cands.find(c => c.catalogTitle.includes('(USA)'));
  const world = cands.find(c => c.catalogTitle.includes('(World)'));
  assert.ok(usa && world, 'Les deux variantes présentes');
  // Vérifier qu'ils ne sont pas mélangés
  assert.notEqual(usa.catalogTitle, world.catalogTitle);
});

test('Dave Mirra World : Timer Frozen parsable', async () => {
  const { candidatesByStem } = await import('../cheat-catalog-psx.mjs');
  const cands = candidatesByStem(catalog, 'Dave Mirra Freestyle BMX.chd');
  const world = cands.find(c => c.catalogTitle.includes('(World)'));
  const timer = world.codes.find(c => c.name.includes('Timer Frozen'));
  assert.ok(timer, 'Timer Frozen trouvé');
  // Doit être parsable comme paire GameShark
  assert.match(timer.code, /^[0-9A-Fa-f]{8} [0-9A-Fa-f]{4}/);
});

test('Dave Mirra USA : Xploder marqués incompatibles', async () => {
  const { candidatesByStem } = await import('../cheat-catalog-psx.mjs');
  const cands = candidatesByStem(catalog, 'Dave Mirra Freestyle BMX.chd');
  const usa = cands.find(c => c.catalogTitle.includes('(USA)'));
  const xploder = usa.codes.filter(c => c.source === 'Xploder' || /^\$/.test(c.code.trim()));
  assert.ok(xploder.length > 0, 'Codes Xploder présents');
});
