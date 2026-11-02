'use strict';
// Independent diagnostics only: no game session, ROM data, localStorage or save database access.
const el = id => document.getElementById(id);
const results = [];
const project = location.hostname.includes('n64') ? 'N64' : location.hostname.includes('ps1') ? 'PS1' : 'EMUPERSO';
const add = (label, ok, detail) => {
  results.push({ label, ok, detail });
  const li = document.createElement('li');
  li.textContent = (ok ? '✅ ' : '⚠️ ') + label + ' — ' + detail;
  el('checks').append(li);
  updateReport();
};
function updateReport() {
  const notes = el('notes').value.trim();
  const lines = [
    'EMUPERSO — ALPHATEST', 'Projet : ' + project,
    'Adresse : ' + location.origin,
    'Date : ' + new Date().toISOString(),
    'Navigateur : ' + navigator.userAgent,
    'Données vérifiées : ressources du site et capacités du navigateur uniquement',
    ...results.map(x => (x.ok ? '[OK] ' : '[À VÉRIFIER] ') + x.label + ': ' + x.detail),
    '', 'ESSAI HUMAIN :', notes || '(notes non fournies)',
    '', 'Aucune ROM ni sauvegarde jointe.'
  ];
  el('report').value = lines.join('\n');
}
async function head(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const r = await fetch(path, {method:'HEAD', cache:'no-store', signal:controller.signal});
    return {ok:r.ok, status:r.status, type:r.headers.get('content-type') || 'non précisé'};
  } catch (e) {return {ok:false, status:String(e.name || 'échec'),type:'indisponible'};}
  finally {clearTimeout(timeout);}
}
async function checkSite() {
  results.length=0; el('checks').replaceChildren();
  el('check').disabled=true; el('status').textContent='Vérification en cours…';
  try {
    add('WebAssembly', typeof WebAssembly === 'object', typeof WebAssembly === 'object' ? 'pris en charge' : 'absent');
    const gl=document.createElement('canvas').getContext('webgl2');
    add('WebGL2', !!gl, gl ? 'pris en charge' : 'absent ou désactivé');
    add('Sauvegardes navigateur (IndexedDB)', 'indexedDB' in window, 'indexedDB' in window ? 'API présente (écriture non testée)' : 'API absente');
    add('Manettes (Gamepad API)', !!navigator.getGamepads, navigator.getGamepads ? 'API présente (manette physique non testée)' : 'API absente');
    add('Isolation navigateur', !!self.crossOriginIsolated, self.crossOriginIsolated ? 'active' : 'non active (à vérifier si nécessaire)');
    const r=await fetch('ALPHA-MANIFEST.json', {cache:'no-store'});
    if (!r.ok) throw new Error('Manifeste HTTP ' + r.status);
    const manifest=await r.json();
    const files=manifest.sha256_files || manifest.files || {};
    const names=Object.keys(files);
    add('Manifeste de l’alpha', names.length > 10, names.length + ' fichiers référencés');
    const core=names.find(x=>x.startsWith('vendor/data/cores/') && x.endsWith('-wasm.data')) ||
      names.find(x=>x.startsWith('vendor/data/cores/') && x.endsWith('.data'));
    const checks=['index.html','vendor/data/loader.js','vendor/data/src/emulator.js',core].filter(Boolean);
    for (const name of checks) {
      const h=await head(name);
      add('Ressource ' + name, h.ok, 'HTTP ' + h.status + ' / ' + h.type);
    }
    el('status').textContent='Terminé. Les ressources accessibles ne garantissent pas qu’un jeu démarre : joue et note ton résultat.';
  } catch (e) {
    add('Diagnostic réseau', false, String(e.message || e));
    el('status').textContent='Certaines vérifications ont échoué. Copie le rapport pour aider au diagnostic.';
  } finally {el('check').disabled=false;updateReport();}
}
el('check').addEventListener('click',checkSite);
el('notes').addEventListener('input',updateReport);
el('copy').addEventListener('click',async()=>{
  updateReport();
  try{if(!navigator.clipboard?.writeText) throw new Error('Copie automatique indisponible');
    await navigator.clipboard.writeText(el('report').value);
    el('status').textContent='Rapport copié ! Colle-le sur Discord.';
  }catch{
    el('report').focus();el('report').select();
    el('status').textContent='Sélectionne « Copier » sur le texte du rapport pour le partager.';
  }
});
updateReport();
