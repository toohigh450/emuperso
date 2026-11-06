// Démos libres pour le lanceur. Aucun jeu commercial ni BIOS. Les fichiers privés du visiteur ne sont jamais transférés.
// GB/GBC/GBA/DS : versions Git figées chez l'auteur, Git blob SHA-1 = SHA1("blob " + taille + "\0" + octets).
// NES/SNES : copies hébergées avec le site (licences zlib et MIT dans demos/), contrôle SHA-256.
// Toutes les empreintes sont vérifiées avant de passer la ROM au lanceur.
const DEMOS = Object.freeze({
  nes: {
    title: 'Snake (openNES)', filename: 'opennes-snake.nes', size: 24592,
    sha256: '71792a9b4e4db52fb60df4633400301fac8f244f802b88d336b58e079c75acc7',
    url: 'demos/opennes-snake.nes'
  },
  snes: {
    title: 'Neon Breaker (OpenSNES)', filename: 'opensnes-breakout.sfc', size: 262144,
    sha256: 'ea5c46832f7a1c71c00c1dc2f92b34da19477ca97bd5a993971fa2b6df2a05ec',
    url: 'demos/opensnes-breakout.sfc'
  },
  'snes-shmup': {
    title: 'Shmup (OpenSNES)', filename: 'opensnes-shmup.sfc', size: 262144,
    sha256: '772da03b812a29298969c6cbdb2ce7e268b4adea95ba0c9bfc1f44d98eab0861',
    url: 'demos/opensnes-shmup.sfc'
  },
  'snes-sa1': {
    title: 'Étoiles SA-1 (OpenSNES)', filename: 'opensnes-sa1-starfield.sfc', size: 262144,
    sha256: '16e47092f08bfa9bdc21b75325852e33a64f1ff85076c595628e6171439c1169',
    url: 'demos/opensnes-sa1-starfield.sfc'
  },
  'snes-dsp1': {
    title: 'Sol DSP-1 (OpenSNES)', filename: 'opensnes-dsp1-ground.sfc', size: 262144,
    sha256: 'b9eb22c0bbcd5ad0448048377ad893ffd9f90cf4fa7df9646ecc60d2f220c753',
    url: 'demos/opensnes-dsp1-ground.sfc'
  },
  gb: {
    title: 'Libbet', filename: 'libbet.gb', size: 32768,
    blob: '73ccbad40caa3abf83457fb7145a200438c1194b',
    url: 'https://raw.githubusercontent.com/mxmgorin/oxgbc/7ef5a8aeeb6813dbf80963b96a39bd5220e63fdd/crates/web/assets/libbet.gb'
  },
  gbc: {
    title: 'Geometrix', filename: 'geometrix.gbc', size: 32768,
    blob: 'b1d0241fcb28e950b460047e008defdcc217c417',
    url: 'https://raw.githubusercontent.com/mxmgorin/oxgbc/7ef5a8aeeb6813dbf80963b96a39bd5220e63fdd/crates/web/assets/geometrix.gbc'
  },
  gba: {
    title: '@rkanoid', filename: 'arkanoid-demo.gba', size: 183248,
    blob: '33951fd6dfaedaad12763ad7fdd8dae418d5d8c3',
    url: 'https://raw.githubusercontent.com/benoror/gbadev/b61cb1e8d6646789c833522a7d3d64adda27581a/public/roms/%40rkanoid%20MODERN%20-%20RECOMPILED.gba'
  },
  nds: {
    title: 'Pong-NDS', filename: 'Pong-NDS.nds', size: 2472960,
    blob: 'dda8c65e7f4cd36f0c54cc70fedbdd04032ca203',
    url: 'https://raw.githubusercontent.com/Chi-Iroh/Pong-NDS/dfabbdde030b9fb2c72af968c98485dcde81855f/Pong-NDS.nds'
  },
  gamecube: {
    title: 'Swiss (homebrew GameCube)', filename: 'swiss_r2073.dol', size: 787720,
    sha256: '5553ad6641716ea7d1ceb155490f18485096e3ffe25617f1901c6c0500e2fa75',
    url: 'demos/swiss_r2073.dol'
  }
});

const status = document.getElementById('demoStatus');
const buttons = [...document.querySelectorAll('[data-portable-demo]')];
let loading = false;

function say(message, error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
}

async function verifyGitBlob(bytes, sha) {
  const prefix = new TextEncoder().encode('blob ' + bytes.byteLength + '\0');
  const payload = new Uint8Array(prefix.length + bytes.byteLength);
  payload.set(prefix);
  payload.set(bytes, prefix.length);
  const digest = await crypto.subtle.digest('SHA-1', payload);
  const actual = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
  return actual === sha;
}

async function verifySha256(bytes, sha) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('') === sha;
}

async function launchDemo(key) {
  if (loading || !Object.hasOwn(DEMOS, key)) return;
  loading = true;
  const demo = DEMOS[key];
  buttons.forEach(b => { b.disabled = true; });
  try {
    say('Téléchargement de ' + demo.title + (demo.sha256 ? '…' : ' depuis la source libre…'));
    const response = await fetch(demo.url, demo.sha256 ? { cache: 'no-cache' } : { mode: 'cors', cache: 'force-cache' });
    if (!response.ok) throw new Error('Source inaccessible (HTTP ' + response.status + ').');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== demo.size) throw new Error('Taille différente de la version vérifiée. Aucun jeu ouvert.');
    say('Contrôle de l’intégrité de ' + demo.title + '…');
    if (!(await (demo.sha256 ? verifySha256(bytes, demo.sha256) : verifyGitBlob(bytes, demo.blob)))) {
      throw new Error('Empreinte différente : téléchargement refusé. Aucun jeu ouvert.');
    }
    const input = document.getElementById('romInput');
    if (!input || typeof DataTransfer !== 'function') {
      throw new Error('Ce navigateur ne permet pas de transmettre la démo au lanceur.');
    }
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], demo.filename, { type: 'application/octet-stream' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    say(demo.title + ' : ROM vérifiée et remise au lanceur. Si un autre jeu est ouvert, confirme son remplacement.');
  } catch (error) {
    say('Impossible de charger ' + demo.title + ' : ' + (error.message || String(error)), true);
  } finally {
    buttons.forEach(b => { b.disabled = false; });
    loading = false;
  }
}

for (const button of buttons) {
  button.addEventListener('click', () => { void launchDemo(button.dataset.portableDemo); });
}
