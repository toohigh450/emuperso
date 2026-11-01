// P1 cheats (mandat RC-1.13) : accepté = exécutable par PCSX ReARMed, pas seulement bien formé.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { codeSupport, codeValid, PCSX_TYPES } from '../cheat-controller.mjs';
import { makeHarness } from './helpers/app-harness.mjs';

const catalog = JSON.parse(readFileSync(new URL('../data/psx-catalog.json', import.meta.url), 'utf8'));

test('GameShark standard (types PCSX) accepté, y compris plusieurs instructions par ligne', () => {
  assert.equal(codeSupport('8009C6E4 03E7').ok, true);
  assert.equal(codeSupport('D009C6E4 0000\n3009C6E5 0063').ok, true);
  assert.equal(codeSupport('8009C6E4 03E7 8009C6E6 03E7').ok, true);
});

test('valeur 32 bits (DuckStation étendu) rejetée avec la raison', () => {
  const r = codeSupport('A7016A68 000E8020', 'DuckStation');
  assert.equal(r.ok, false); assert.equal(r.format, 'DuckStation (étendu)'); assert.match(r.reason, /32 bits/);
});

test('type d’instruction inconnu de PCSX rejeté, même au bon gabarit 8+4', () => {
  const r = codeSupport('A4052988 801E', 'DuckStation');
  assert.equal(r.ok, false); assert.match(r.reason, /A4 non géré/);
  assert.match(codeSupport('C0010000 0001\n80010000 0001').reason, /C0/);
});

test('slide (50) et copie (C2) : la ligne de données suivante n’est pas jugée comme instruction', () => {
  assert.equal(codeSupport('50000A02 0001\nA0010000 0000').ok, true);
  assert.equal(codeSupport('C2010000 0010\nA0020000 0000').ok, true);
  assert.equal(codeSupport('50000A02 0001\nA0010000 0000\nA0030000 0000').ok, false, 'la donnée ne couvre qu’une ligne');
});

test('Xploder et lignes non conformes rejetés avec raison', () => {
  assert.equal(codeSupport('$7AB5 0000', 'Xploder').format, 'Xploder');
  assert.match(codeSupport('8009C6E4 03E7 commentaire').reason, /non conforme/);
  assert.equal(codeValid(''), false);
});

test('catalogue réel : les 3 éditions de Gran Turismo 2 n’ont AUCUN code exécutable, chacun a sa raison', () => {
  const counts = {};
  for (const [title, codes] of Object.entries(catalog.byTitle)) {
    if (!/^Gran Turismo 2 \(/.test(title)) continue;
    counts[title] = codes.length;
    for (const c of codes) {
      const r = codeSupport(c.code, c.source);
      assert.equal(r.ok, false, `${title} / ${c.name}`);
      assert.ok(r.reason && r.reason.length > 10, `raison précise pour ${c.name}`);
    }
  }
  assert.deepEqual(counts, { 'Gran Turismo 2 (Europe)': 11, 'Gran Turismo 2 (Japan, Asia)': 21, 'Gran Turismo 2 (USA)': 20 });
});

test('catalogue réel : aucun code accepté ne contient de valeur 32 bits ni de type inconnu de PCSX', () => {
  let accepted = 0;
  for (const codes of Object.values(catalog.byTitle)) for (const c of codes) {
    if (!codeSupport(c.code, c.source).ok) continue;
    accepted++;
    const tokens = c.code.trim().split(/\s+/);
    for (let i = 0; i < tokens.length; i += 2) {
      assert.match(tokens[i + 1], /^[0-9a-f]{4}$/i);
      const t = tokens[i].slice(0, 2).toUpperCase();
      if (!PCSX_TYPES.has(t)) assert.ok(i > 0 && ['50', 'C2'].includes(tokens[i - 2].slice(0, 2).toUpperCase()), `${c.name} : ${t}`);
    }
  }
  assert.ok(accepted > 15000, `plusieurs milliers de codes restent acceptés (${accepted})`);
});

test('interface GT2 Europe : une ligne par code, provenance/format/état/raison, case non activable', async () => {
  const h = await makeHarness();
  await h.launch('Gran Turismo 2-PSX-PAL-CD1.chd');
  const v = h.view();
  const europe = v.candidates.find(c => c.title === 'Gran Turismo 2 (Europe)');
  assert.ok(europe, 'édition Europe proposée'); assert.equal(europe.count, 11);
  await h.ctl().chooseCandidate(europe.index);
  const rows = h.rows();
  assert.equal(rows.length, 11);
  for (const row of rows) {
    const text = row.text();
    assert.match(text, /Provenance : catalogue \(DuckStation\)/);
    assert.match(text, /Format : DuckStation \(étendu\)/);
    assert.match(text, /État : rejeté — /);
    assert.equal(row.children[0].rejected, true);
    assert.equal(row.children[0].disabled, true, 'case désactivée');
  }
  assert.ok(h.$('cheat-list').text().includes('Édition du catalogue : Gran Turismo 2 (Europe)'));
  assert.match(h.info(), /Aucun de ces codes n’est exécutable par PCSX ReARMed/);
  const calls = h.engine.calls.length;
  await h.toggleRow(0, true);
  assert.equal(h.engine.calls.length, calls, 'aucun appel moteur pour un code rejeté');
  assert.equal(h.engine.active.length, 0);
});

test('code manuel enregistré devenu non exécutable : conservé et affiché comme rejeté, jamais supprimé', async () => {
  const h = await makeHarness();
  h.disc('Jeu manuel.bin', { serial: 'SLUS-99998' });
  const store = () => h.idb.stores.get('emuperso-ps1-cheats-v1');
  await h.launch('Jeu manuel.bin', { serial: 'SLUS-99998' });
  store().set('SLUS-99998', [{ name: 'Ancien code', code: 'A4010000 0001' }, { name: 'Bon code', code: '80010000 0001' }]);
  await h.ctl().startSession({ name: 'Jeu manuel.bin', serial: 'SLUS-99998', canonical_sha256: 'e'.repeat(64) });
  const rows = h.rows().map(r => r.text());
  assert.ok(rows.some(t => /Ancien code.*rejeté — .*A4/.test(t)));
  assert.ok(rows.some(t => /Bon code.*État : désactivé/.test(t)));
  await h.ctl().addManual('Nouveau', '80020000 0002');
  assert.deepEqual(store().get('SLUS-99998').map(c => c.name), ['Ancien code', 'Bon code', 'Nouveau'], 'rien n’est perdu');
});
