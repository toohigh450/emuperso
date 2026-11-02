// Lecture des étiquettes des noms de ROM (No-Intro, GoodTools, jeux de hacks).
// Module pur, sans accès aux octets : sert au catalogue et à l'inventaire.
// Les étiquettes décrivent ce que le nom annonce, pas ce que le fichier contient vraiment.

const NO_INTRO_REGIONS = {
  usa: 'USA', europe: 'Europe', japan: 'Japon', world: 'Monde', france: 'France', germany: 'Allemagne',
  spain: 'Espagne', italy: 'Italie', korea: 'Corée', china: 'Chine', asia: 'Asie', australia: 'Australie',
  brazil: 'Brésil', sweden: 'Suède', netherlands: 'Pays-Bas', canada: 'Canada', taiwan: 'Taïwan',
  'hong kong': 'Hong Kong', russia: 'Russie', scandinavia: 'Scandinavie', uk: 'Royaume-Uni',
};
// Codes GoodTools d'une seule lettre ou combinés : (U) (E) (J) (JU) (UE) (F) (G)…
const GOOD_LETTERS = { U: 'USA', E: 'Europe', J: 'Japon', F: 'France', G: 'Allemagne', S: 'Espagne', I: 'Italie', K: 'Corée', C: 'Chine', A: 'Australie', B: 'Brésil', W: 'Monde', H: 'Pays-Bas' };
const GOOD_WORDS = { Sw: 'Suède', Nl: 'Pays-Bas', HK: 'Hong Kong', Unk: null };
const LANGS = new Set(['En', 'Fr', 'De', 'Es', 'It', 'Nl', 'Sv', 'Pt', 'Ja', 'Zh', 'Ko', 'Da', 'No', 'Fi', 'Pl', 'Ru']);
// Régions qui impliquent le français dans le nom, en l'absence de liste de langues.
const FRENCH_REGIONS = new Set(['France', 'Canada']);
export const REGION_FILTERS = { usa: 'USA', europe: 'Europe', japon: 'Japon' };

export function parseRomName(fileName) {
  const stem = String(fileName || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  const groups = [...stem.matchAll(/[\(\[]([^\)\]]*)[\)\]]/g)].map((m) => ({ kind: m[0][0], text: m[1].trim() }));
  const title = stem.replace(/\s*[\(\[].*$/, '').trim() || stem;
  const out = {
    title, regions: [], langs: [], translation: null, frenchTranslation: false,
    verified: false, bad: false, hack: false, proto: false, beta: false, pirate: false,
    alternate: false, overdump: false, trainer: false, fixed: false, unlicensed: false, homebrew: false, revision: null,
  };
  const regions = new Set();
  const langs = new Set();
  for (const { kind, text } of groups) {
    const parts = text.split(/\s*,\s*/);
    let regionGroup = false;
    for (const part of parts) {
      const nk = NO_INTRO_REGIONS[part.toLowerCase()];
      if (nk) { regions.add(nk); regionGroup = true; }
      if (LANGS.has(part)) langs.add(part);
    }
    if (!regionGroup && kind === '(') {
      if (/^[UEJFGSIKCABWH]{1,4}$/.test(text)) for (const ch of text) regions.add(GOOD_LETTERS[ch]);
      else if (text in GOOD_WORDS && GOOD_WORDS[text]) regions.add(GOOD_WORDS[text]);
    }
    if (/^proto(type)?\b/i.test(text)) out.proto = true;
    if (/^(beta|sample|demo|preview)\b/i.test(text)) out.beta = true;
    if (/hack/i.test(text)) out.hack = true;
    if (/^unl$/i.test(text)) out.unlicensed = true;
    if (/^pd$/i.test(text) || /homebrew|aftermarket/i.test(text)) out.homebrew = true;
    const rev = /^(?:rev\s*([0-9a-z.]+)|v(\d+(?:\.\d+)*)|prg\s*(\d))$/i.exec(text);
    if (rev) out.revision = rev[1] || rev[2] || rev[3];
    if (kind === '[') {
      if (text === '!') out.verified = true;
      else if (/^b\d*(\s|$)/.test(text)) out.bad = true;
      else if (/^h\d/.test(text) || /^h$/.test(text) || /^hI/.test(text)) out.hack = true;
      else if (/^p\d*(\s|$)/.test(text)) out.pirate = true;
      else if (/^a\d*(\s|$)/.test(text)) out.alternate = true;
      else if (/^o\d*(\s|$)/.test(text)) out.overdump = true;
      else if (/^t\d*(\s|$)/.test(text)) out.trainer = true;
      else if (/^f\d*(\s|$)/.test(text)) out.fixed = true;
      // [T+Fre1.0_auteur] traduction récente, [T-Fre] ancienne
      const tr = /^T[+-]([A-Z][a-z]{2})/.exec(text);
      if (tr) {
        out.translation = tr[1];
        if (tr[1] === 'Fre') out.frenchTranslation = true;
      }
    }
  }
  if (out.frenchTranslation) langs.add('Fr');
  if (!langs.size && [...regions].some((r) => FRENCH_REGIONS.has(r))) langs.add('Fr');
  out.regions = [...regions].filter(Boolean);
  out.langs = [...langs];
  out.french = out.langs.includes('Fr');
  out.original = !(out.hack || out.translation || out.proto || out.beta || out.bad || out.pirate || out.overdump || out.trainer);
  return out;
}

/** Clé de regroupement des variantes d'un même jeu (titre sans étiquettes, casse et ponctuation ignorées). */
export function variantKey(title) {
  return String(title || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(.*), (the|a|an|le|la|les|l')$/, '$2 $1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Étiquette lisible d'une variante, pour l'afficher à côté du titre. */
export function variantLabel(info) {
  const tags = [];
  if (info.regions.length) tags.push(info.regions.join(', '));
  if (info.revision) tags.push(`rév. ${info.revision}`);
  if (info.translation) tags.push(`traduction ${info.translation}`);
  if (info.hack) tags.push('hack');
  if (info.proto) tags.push('prototype');
  if (info.beta) tags.push('bêta/démo');
  if (info.bad) tags.push('mauvais dump');
  if (info.pirate) tags.push('pirate');
  if (info.trainer) tags.push('trainer');
  if (info.overdump) tags.push('surdump');
  if (info.unlicensed) tags.push('sans licence');
  if (info.verified) tags.push('vérifié [!]');
  return tags.join(' · ');
}
