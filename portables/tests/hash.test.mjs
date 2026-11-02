import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fingerprint, saveSpaceId, gameKey, numericId, slug, ejsGameName, legacyEjsGameName, toHex } from '../js/hash.mjs';

test('empreinte = SHA-256 du fichier complet', async () => {
  const data = new Uint8Array(5000).map((_, i) => (i * 7) & 0xff);
  const fp = await fingerprint(data);
  assert.equal(fp.algo, 'sha256');
  assert.equal(fp.hex, createHash('sha256').update(data).digest('hex'));
});

test('tous les octets participent à l’identité, même hors des anciens échantillons', async () => {
  const data = new Uint8Array(1000).map((_, i) => i & 0xff);
  const a = await fingerprint(data, 500, 100);
  assert.equal(a.algo, 'sha256');
  assert.equal(a.hex, createHash('sha256').update(data).digest('hex'));
  const modified = data.slice();
  modified[250] ^= 1;
  assert.notEqual((await fingerprint(modified, 500, 100)).hex, a.hex);
});

test('toHex', () => {
  assert.equal(toHex(new Uint8Array([0, 15, 255]).buffer), '000fff');
});

test('espace de sauvegarde : console, cœur et empreinte en font partie', () => {
  const hex = 'ab'.repeat(32);
  const a = saveSpaceId('nds', 'desmume2015', hex);
  const b = saveSpaceId('nds', 'melonds', hex);
  const c = saveSpaceId('gba', 'mgba', hex);
  assert.equal(new Set([a, b, c]).size, 3);
  assert.equal(gameKey('gba', hex), `gba:${'ab'.repeat(16)}`);
});

test('identifiant numérique stable, positif et distinct', () => {
  const x = numericId('gba:mgba:aaaa');
  assert.equal(x, numericId('gba:mgba:aaaa'));
  assert.ok(Number.isInteger(x) && x >= 2 && x <= 0x7fffffff);
  assert.notEqual(x, numericId('gba:mgba:aaab'));
});

test('slug et nom de jeu envoyé au moteur', () => {
  assert.equal(slug('Pokémon : Émeraude (France)'), 'pokemon-emeraude-france');
  assert.equal(slug(''), 'jeu');
  assert.equal(legacyEjsGameName('Zelda', 'mgba', 'deadbeef1234'), 'zelda-deadbeef-mgba');
  assert.equal(ejsGameName('Zelda', 'mgba', 'deadbeef1234'), 'rom-deadbeef1234-mgba');
  assert.equal(ejsGameName('renommé', 'mgba', 'deadbeef1234'), ejsGameName('Zelda', 'mgba', 'deadbeef1234'));
  assert.notEqual(ejsGameName('Zelda', 'mgba', 'deadbeef1234'), ejsGameName('Zelda', 'mgba', 'deadbeef5678'));
});
