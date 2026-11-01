// Archives .rar/.zip/.7z (mandat Karl) : reconnaissance par signature, décompression laissée au
// moteur, fermeture du jeu en cours avec accord et garde-fou mémoire avant le lancement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDisc, validateDescriptor, archiveKind, MAX_BYTES } from '../disc-file.mjs';
import { makeHarness } from './helpers/app-harness.mjs';

const SIG = { rar4: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00], rar5: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00],
  zip: [0x50, 0x4b, 0x03, 0x04], '7z': [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] };
const archive = (sig, size = 200 * 1024) => { const b = new Uint8Array(size); b.set(sig, 0); return b; };

test('signatures : RAR4, RAR5, ZIP, 7z reconnus comme le moteur ; le reste non', () => {
  assert.equal(archiveKind(archive(SIG.rar4)), 'rar');
  assert.equal(archiveKind(archive(SIG.rar5)), 'rar');
  assert.equal(archiveKind(archive(SIG.zip)), 'zip');
  assert.equal(archiveKind(archive(SIG['7z'])), '7z');
  assert.equal(archiveKind(archive([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x02])), null, 'version RAR inconnue');
  assert.equal(archiveKind(new Uint8Array(16)), null);
});

test('archive acceptée : empreinte de l’archive, pas de série, remarque explicite', async () => {
  const r = await prepareDisc(new File([archive(SIG.rar5)], 'Skullmonkeys (USA) [SLUS-00601].rar'));
  assert.equal(r.metadata.detected_format, 'rar');
  assert.equal(r.metadata.serial, null);
  assert.match(r.metadata.canonical_sha256, /^[a-f0-9]{64}$/);
  assert.match(r.metadata.notes.join(' '), /décompressée en mémoire par le moteur/);
});

test('extension et contenu discordants : refus clair, sans deviner', async () => {
  await assert.rejects(prepareDisc(new File([archive(SIG.zip)], 'jeu.rar')), e => e.code === 'E_FORMAT' && /renommez-le en \.zip/.test(e.message));
  await assert.rejects(prepareDisc(new File([new Uint8Array(200 * 1024)], 'jeu.7z')), { code: 'E_FORMAT' });
});

test('plafond de 900 Mio maintenu pour tous les formats, PBP compris, avec la raison mesurée', () => {
  assert.equal(validateDescriptor({ name: 'jeu.rar', size: MAX_BYTES }), 'rar');
  assert.throws(() => validateDescriptor({ name: 'Chrono Cross FR.pbp', size: 1027869548 }), e => e.code === 'E_SIZE' && /980 Mio/.test(e.message) && /un fichier par disque/.test(e.message));
  assert.throws(() => validateDescriptor({ name: 'jeu.rar', size: MAX_BYTES + 1 }), { code: 'E_SIZE' });
  assert.throws(() => validateDescriptor({ name: 'jeu.cue', size: 1e6 }), e => /archive \.rar\/\.zip\/\.7z/.test(e.message));
});

test('archive pendant un jeu : accord demandé ; refus => le jeu en cours reste ouvert', async () => {
  const h = await makeHarness();
  await h.launch('Crash Bandicoot (USA).bin');
  const engine = h.engine;
  h.answerConfirm = false;
  await h.launch('Rollcage (USA).rar');
  assert.match(h.confirms.at(-1), /archive.*fermé AVANT le lancement/s);
  assert.match(h.status(), /Lancement annulé : le jeu en cours reste ouvert/);
  assert.equal(h.engine, engine); assert.equal(h.closed ?? 0, 0);
  assert.equal(h.$('current').textContent, 'Crash Bandicoot (USA).bin');
});

test('archive pendant un jeu : accord => ancien jeu fermé d’abord, puis lancement', async () => {
  const h = await makeHarness();
  await h.launch('Crash Bandicoot (USA).bin');
  const old = h.engine;
  await h.launch('Rollcage (USA).rar');
  assert.equal(h.closed, 1, 'fermeture explicite avant le lancement');
  assert.notEqual(h.engine, old);
  assert.equal(h.$('current').textContent, 'Rollcage (USA).rar');
  const log = JSON.parse(h.$('log').textContent).map(e => e.type);
  assert.ok(log.indexOf('session.closed.for_archive') < log.lastIndexOf('launch.done'));
});

test('garde-fou mémoire : refus explicite si l’onglet ne peut pas décompresser l’archive', async () => {
  const h = await makeHarness();
  const desc = Object.getOwnPropertyDescriptor(performance, 'memory');
  Object.defineProperty(performance, 'memory', { configurable: true, value: { jsHeapSizeLimit: 4096 * 1048576, usedJSHeapSize: 2000 * 1048576 } });
  try {
    // 663 Mio (la plus grosse archive de Karl) × 4,5 > 0,9 × 4 096 − 2 000 Mio disponibles.
    h.disc('Gros jeu (USA).rar', { size: 663 * 1048576 });
    await h.launch('Gros jeu (USA).rar');
    assert.match(h.status(), /Mémoire de l’onglet insuffisante.*Rechargez la page/);
    assert.equal(h.engine ?? null, null, 'aucun moteur créé');
    const check = JSON.parse(h.$('log').textContent).find(e => e.type === 'archive.memory.check');
    assert.ok(check.data.need_mib > check.data.free_mib);
  } finally { desc ? Object.defineProperty(performance, 'memory', desc) : delete performance.memory; }
});
