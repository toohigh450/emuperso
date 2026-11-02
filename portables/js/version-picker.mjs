// Choix de la version d'un jeu dans une archive qui en contient plusieurs (ZIP ou 7z), avant le démarrage.
// rankVersions est pur (testable) ; pickVersion affiche une fenêtre utilisable au doigt et au clavier.
import { parseRomName } from './romnames.mjs';

const REGION_ORDER = ['France', 'Europe', 'World', 'USA', 'Canada', 'Japon'];

/** Étiquettes lisibles d'un nom de fichier (région, langue, traduction, hack, prototype…). */
export function versionLabels(name) {
  const file = String(name).replace(/^.*[\\/]/, '');
  const i = { ...parseRomName(file) };
  // Notation des HackSets : [H.nom-1234] = hack, [T.Por-…] / [T+Fre…] = traduction, [!!] = vérifiée.
  const brackets = [...file.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1]);
  if (brackets.some((b) => /^H[.\s_-]|^h\d/.test(b))) i.hack = true;
  const tr = brackets.find((b) => /^T[.+-]?[A-Z][a-z]{2}/.test(b));
  if (tr && !i.translation) {
    i.translation = tr.replace(/^T[.+-]?/, '').slice(0, 3);
    i.frenchTranslation = /^Fre/i.test(i.translation);
    i.original = false;
  }
  if (brackets.includes('!!') || brackets.includes('!')) i.verified = true;
  const tags = [];
  if (i.regions.length) tags.push(i.regions.join(', '));
  if (i.frenchTranslation) tags.push('traduction française');
  else if (i.translation) tags.push(`traduction ${i.translation}`);
  if (i.langs.length && !i.translation) tags.push(i.langs.join(', '));
  if (i.revision) tags.push(`révision ${i.revision}`);
  if (i.verified) tags.push('version vérifiée');
  if (i.hack) tags.push('hack');
  if (i.proto) tags.push('prototype');
  if (i.beta) tags.push('bêta');
  if (i.bad) tags.push('mauvais dump');
  if (i.pirate) tags.push('pirate');
  if (i.trainer) tags.push('trainer');
  if (i.overdump) tags.push('surdump');
  if (i.alternate) tags.push('variante');
  return { title: i.title || file, tags, info: i };
}

/** Ordre conseillé : versions d'origine vérifiées, français et Europe/USA d'abord ; mauvais dumps à la fin. */
export function rankVersions(entries) {
  const score = (e) => {
    const { info: i } = versionLabels(e.name);
    let s = 0;
    if (i.bad || i.overdump) s += 100;
    if (i.pirate || i.trainer) s += 50;
    if (i.hack) s += 30;
    if (i.proto || i.beta) s += 20;
    if (i.translation && !i.frenchTranslation) s += 15;
    if (i.alternate) s += 5;
    if (!i.verified) s += 3;
    if (i.french) s -= 4;
    const r = Math.min(...i.regions.map((x) => { const k = REGION_ORDER.indexOf(x); return k < 0 ? REGION_ORDER.length : k; }), REGION_ORDER.length);
    return s + r;
  };
  return [...entries].map((e) => ({ ...e, score: score(e) })).sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
}

const fmt = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} Mio` : `${Math.round(n / 1024)} Kio`);

/**
 * Fenêtre de choix. entries : [{ name, size }]. Résout avec le nom choisi, ou null si annulé.
 */
export function pickVersion(entries, archiveName) {
  const ranked = rankVersions(entries);
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'version-picker';
    const head = document.createElement('div');
    head.className = 'vp-head';
    head.innerHTML = '<h2>Quelle version lancer ?</h2>';
    const sub = document.createElement('p');
    sub.className = 'muted small-text';
    sub.textContent = `${ranked.length} versions dans « ${String(archiveName).replace(/^.*[\\/]/, '')} ». La première est conseillée ; seule la version choisie est extraite.`;
    head.append(sub);
    const search = document.createElement('input');
    search.type = 'search'; search.placeholder = 'Filtrer (ex. USA, fr, hack)'; search.className = 'vp-search';
    search.hidden = ranked.length < 8;
    const list = document.createElement('ul');
    list.className = 'vp-list';
    const actions = document.createElement('div');
    actions.className = 'vp-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'btn'; cancel.textContent = 'Annuler';
    const go = document.createElement('button');
    go.type = 'button'; go.className = 'btn primary'; go.textContent = 'Démarrer cette version';
    actions.append(cancel, go);
    let chosen = ranked[0] ? ranked[0].name : null;
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      list.replaceChildren();
      ranked.forEach((e, idx) => {
        const { title, tags } = versionLabels(e.name);
        const hay = `${e.name} ${tags.join(' ')}`.toLowerCase();
        if (q && !q.split(/\s+/).every((w) => hay.includes(w))) return;
        const li = document.createElement('li');
        const label = document.createElement('label');
        const radio = document.createElement('input');
        radio.type = 'radio'; radio.name = 'vp'; radio.checked = e.name === chosen;
        radio.addEventListener('change', () => { chosen = e.name; });
        const text = document.createElement('span');
        const strong = document.createElement('strong');
        strong.textContent = title + (idx === 0 && !q ? ' — conseillée' : '');
        const small = document.createElement('small');
        small.className = 'muted';
        small.textContent = [tags.join(' · '), fmt(e.size)].filter(Boolean).join(' — ');
        const file = document.createElement('small');
        file.className = 'vp-file';
        file.textContent = e.name.replace(/^.*[\\/]/, '');
        text.append(strong, document.createElement('br'), small, document.createElement('br'), file);
        label.append(radio, text);
        label.addEventListener('dblclick', () => { chosen = e.name; finish(chosen); });
        li.append(label);
        list.append(li);
      });
    };
    const finish = (value) => { dialog.close(); dialog.remove(); resolve(value); };
    search.addEventListener('input', draw);
    cancel.addEventListener('click', () => finish(null));
    go.addEventListener('click', () => finish(chosen));
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    dialog.append(head, search, list, actions);
    document.body.append(dialog);
    draw();
    dialog.showModal();
  });
}
