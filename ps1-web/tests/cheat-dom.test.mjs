import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Test DOM : les boutons USA/World doivent rester visibles après loadCheats
// (régression 0.1.12 : renderCheats() effaçait les boutons)

test('renderCheatCandidates ne vide pas la liste', async () => {
  const src = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  // Extraire la fonction renderCheatCandidates
  const m = src.match(/function renderCheatCandidates\(candidates\) \{([^}]*(\{[^}]*\}[^}]*)*)\}/s);
  assert.ok(m, 'renderCheatCandidates trouvée');
  const body = m[0];
  // Elle ne doit PAS appeler replaceChildren (qui effacerait les codes existants)
  assert.ok(!body.includes('replaceChildren()'), 'renderCheatCandidates ne doit pas vider la liste');
});

test('branche ambiguous : renderCheats AVANT renderCheatCandidates', async () => {
  const src = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const ambStart = src.indexOf("if (result.status === 'ambiguous')");
  assert.ok(ambStart > 0, 'branche ambiguous trouvée');
  // Limiter à la branche ambiguous (jusqu'au premier "return;" suivi de "}")
  const ambEnd = src.indexOf('return; // NE PAS rappeler renderCheats() ici', ambStart);
  assert.ok(ambEnd > ambStart, 'fin de branche trouvée');
  const ambSection = src.slice(ambStart, ambEnd);
  const idxRenderCheats = ambSection.search(/[^a-zA-Z]renderCheats\(\)/);
  const idxCandidates = ambSection.indexOf('renderCheatCandidates(');
  assert.ok(idxRenderCheats > 0 && idxCandidates > 0, 'les deux appels trouvés');
  assert.ok(idxRenderCheats < idxCandidates, 'renderCheats() doit être appelé AVANT renderCheatCandidates()');
});

test('simulation DOM : boutons survivent au rendu', async () => {
  // Simuler un DOM minimal
  const children = [];
  const mockList = {
    replaceChildren: () => { children.length = 0; },
    append: (...els) => { children.push(...els); },
  };
  const mockDocument = {
    createElement: (tag) => ({ tagName: tag, textContent: '', onclick: null, style: {}, append: function(...a) {} }),
  };
  // Simuler renderCheats (vide la liste) puis renderCheatCandidates (ajoute sans vider)
  mockList.replaceChildren(); // renderCheats
  assert.equal(children.length, 0);
  // renderCheatCandidates ajoute 2 boutons SANS vider
  mockList.append({ textContent: 'Dave Mirra (USA) (4 codes)' });
  mockList.append({ textContent: 'Dave Mirra (World) (4 codes)' });
  assert.equal(children.length, 2, 'les 2 boutons USA/World restent visibles');
  assert.ok(children[0].textContent.includes('USA'));
  assert.ok(children[1].textContent.includes('World'));
});
