// Démos libres pour le lanceur Portables. Versions Git figées + empreintes Git SHA-1.
// Aucun jeu commercial ni BIOS. Les fichiers privés du visiteur ne sont jamais transférés.
// Git blob SHA-1 = SHA1("blob " + taille + "\0" + octets), vérifié avant le chargement.
const DEMOS = Object.freeze({
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

async function launchDemo(key) {
  if (loading || !Object.hasOwn(DEMOS, key)) return;
  loading = true;
  const demo = DEMOS[key];
  buttons.forEach(b => { b.disabled = true; });
  try {
    say('Téléchargement de ' + demo.title + ' depuis la source libre…');
    const response = await fetch(demo.url, { mode: 'cors', cache: 'force-cache' });
    if (!response.ok) throw new Error('Source inaccessible (HTTP ' + response.status + ').');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== demo.size) throw new Error('Taille différente de la version vérifiée. Aucun jeu ouvert.');
    say('Contrôle de l’intégrité de ' + demo.title + '…');
    if (!(await verifyGitBlob(bytes, demo.blob))) {
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
