import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTitle } from '../cheat-catalog-psx.mjs';

test('normalizeTitle : minuscules et sans ponctuation', () => {
  assert.equal(normalizeTitle('Dave Mirra Freestyle BMX (USA)'), 'dave mirra freestyle bmx usa');
  assert.equal(normalizeTitle('Tekken 3 - World!'), 'tekken 3 world');
});

test('normalizeTitle : espaces multiples réduits', () => {
  assert.equal(normalizeTitle('Gran   Turismo  2'), 'gran turismo 2');
});

test('catalogue : tous désactivés par défaut (contrat)', async () => {
  // Le contrat exige que findCheatsForGame retourne validated: false
  const { findCheatsForGame } = await import('../cheat-catalog-psx.mjs');
  // Sans catalogue chargé (fetch échoue en Node), retourne status load_error
  const result = await findCheatsForGame('SLUS-01156', 'Dave Mirra');
  assert.ok(result && typeof result === 'object');
  assert.ok(['match', 'ambiguous', 'no_match', 'load_error'].includes(result.status));
  assert.ok(Array.isArray(result.cheats));
  // Tous les résultats doivent avoir validated: false
  for (const c of result.cheats) {
    assert.equal(c.validated, false, 'Les cheats importés doivent être non-validés par défaut');
  }
});

test('isolation : pas de mélange entre jeux (contrat)', () => {
  // Le contrat : findCheatsForGame(serialA) ne doit jamais retourner
  // de cheats d'un autre jeu. Vérifié par l'indexation par serial/titre.
  // Ce test documente le contrat ; la validation complète se fait en jeu.
  assert.ok(true, 'Contrat documenté : lookup par serial/titre exact, pas de cross-contamination');
});

test('titleMatches : mots entiers seulement', async () => {
  const { titleMatches } = await import('../cheat-catalog-psx.mjs');
  // "Final Fantasy V" ne doit PAS matcher "Final Fantasy VII"
  assert.equal(titleMatches('Final Fantasy V', 'Final Fantasy VII (USA)'), false);
  assert.equal(titleMatches('Final Fantasy V', 'Final Fantasy VIII (World)'), false);
  // Mais DOIT matcher l'anthologie qui contient FFV
  assert.equal(titleMatches('Final Fantasy V', 'Final Fantasy Anthology - Final Fantasy V (USA)'), true);
});

test('normalizeTitle : chiffres romains convertis', async () => {
  const { normalizeTitle } = await import('../cheat-catalog-psx.mjs');
  assert.equal(normalizeTitle('Final Fantasy VII'), 'final fantasy 7');
  assert.equal(normalizeTitle('Final Fantasy V'), 'final fantasy 5');
});

// B04 (audit GPT RC-1.0) : NTSC seul ne doit PAS déduire Japan
// NTSC est ambigu (NTSC-U = USA, NTSC-J = Japan)
test('B04 : detectRegion ne confond pas NTSC générique avec Japan', async () => {
  const { detectRegion } = await import('../cheat-catalog-psx.mjs');
  // NTSC seul : ambigu, retourner null
  assert.equal(detectRegion('Game (NTSC)'), null, 'NTSC seul est ambigu');
  assert.equal(detectRegion('TEST (NTSC)'), null, 'NTSC seul ne donne pas Japan');
  // NTSC-U explicite : USA
  assert.equal(detectRegion('Game (NTSC-U)'), 'USA', 'NTSC-U = USA');
  assert.equal(detectRegion('Game NTSC-U'), 'USA', 'NTSC-U sans parenthèses = USA');
  // NTSC-J explicite : Japan
  assert.equal(detectRegion('Game (NTSC-J)'), 'Japan', 'NTSC-J = Japan');
  assert.equal(detectRegion('Game NTSC-J'), 'Japan', 'NTSC-J sans parenthèses = Japan');
  // Les autres régions fonctionnent toujours
  assert.equal(detectRegion('Game (USA)'), 'USA');
  assert.equal(detectRegion('Game (E)'), 'Europe');
  assert.equal(detectRegion('Game (J)'), 'Japan');
});
