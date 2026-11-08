// Profils de commandes (mandat Controller V2) pour les consoles du lanceur Portables.
// Modèle : ps1-web/input-presets.mjs. La manette est lue par le lanceur (Gamepad API, disposition
// « standard ») et envoyée au moteur avec simulateInput ; les liaisons manette du moteur sont retirées
// pour éviter les doubles commandes. Le clavier reste géré par EmulatorJS.
// Module pur, testable avec Node.

// Indices de la manette « standard » du navigateur (Xbox : A en bas, B à droite, X à gauche, Y en haut).
export const PAD = Object.freeze({ bottom: 0, right: 1, left: 2, top: 3, LB: 4, RB: 5, LT: 6, RT: 7, back: 8, start: 9, LS: 10, RS: 11, up: 12, down: 13, dleft: 14, dright: 15 });
// Identifiants RetroPad d'EmulatorJS (simulateInput). 16-19 : stick gauche droite/gauche/bas/haut, 20-23 : stick droit.
export const RP = Object.freeze({ B: 0, Y: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8, X: 9, L: 10, R: 11, L2: 12, R2: 13, L3: 14, R3: 15 });
const SCALE = 0x7fff;

const BASE = [[PAD.back, RP.SELECT], [PAD.start, RP.START], [PAD.up, RP.UP], [PAD.down, RP.DOWN], [PAD.dleft, RP.LEFT], [PAD.dright, RP.RIGHT]];

// Disposition AUTHENTIQUE : chaque bouton à la place qu'il occupe sur la manette d'origine.
// Confort : mêmes boutons, plus des doublons pratiques (gâchettes, X/Y de la manette Xbox).
const LAYOUTS = {
  // NES / Game Boy : B à gauche, A à droite → bas = B, droite = A.
  nes: { authentique: [[PAD.bottom, RP.B], [PAD.right, RP.A]], confort: [[PAD.left, RP.B], [PAD.top, RP.A]] },
  gb: { authentique: [[PAD.bottom, RP.B], [PAD.right, RP.A]], confort: [[PAD.left, RP.B], [PAD.top, RP.A]] },
  gbc: { authentique: [[PAD.bottom, RP.B], [PAD.right, RP.A]], confort: [[PAD.left, RP.B], [PAD.top, RP.A]] },
  // GBA : + L/R sur les boutons d'épaule ; les gâchettes les doublent en confort.
  gba: { authentique: [[PAD.bottom, RP.B], [PAD.right, RP.A], [PAD.LB, RP.L], [PAD.RB, RP.R]], confort: [[PAD.LT, RP.L], [PAD.RT, RP.R]] },
  // SNES / DS : losange identique à la manette Xbox (bas B, droite A, gauche Y, haut X).
  snes: { authentique: [[PAD.bottom, RP.B], [PAD.right, RP.A], [PAD.left, RP.Y], [PAD.top, RP.X], [PAD.LB, RP.L], [PAD.RB, RP.R]], confort: [[PAD.LT, RP.L], [PAD.RT, RP.R]] },
  nds: { authentique: [[PAD.bottom, RP.B], [PAD.right, RP.A], [PAD.left, RP.Y], [PAD.top, RP.X], [PAD.LB, RP.L], [PAD.RB, RP.R]], confort: [[PAD.LT, RP.L], [PAD.RT, RP.R]] },
  // Genesis (Genesis Plus GX dans EmulatorJS) : A = Y, B = B, C = A, X = L, Y = X, Z = R, Mode = Select.
  // Rangée du bas A-B-C de gauche à droite : X, A, B de la manette Xbox ; rangée du haut X-Y-Z : LB, Y, RB.
  genesis: { authentique: [[PAD.left, RP.Y], [PAD.bottom, RP.B], [PAD.right, RP.A], [PAD.LB, RP.L], [PAD.top, RP.X], [PAD.RB, RP.R]], confort: [[PAD.LT, RP.L], [PAD.RT, RP.R]] },
  // PSP (ppsspp) : ✕ = B, ○ = A, □ = Y, △ = X ; même losange que la manette Xbox.
  psp: { authentique: [[PAD.bottom, RP.B], [PAD.right, RP.A], [PAD.left, RP.Y], [PAD.top, RP.X], [PAD.LB, RP.L], [PAD.RB, RP.R]], confort: [[PAD.LT, RP.L], [PAD.RT, RP.R]] },
  // Arcade (MAME 2003-Plus, FBNeo) : boutons 1 à 6 = B, A, Y, X, L, R du RetroPad ; Pièce = Select (Back),
  // Start = Start. Clic du stick gauche (L3) = menu de MAME 2003-Plus, où sont les cheats du jeu.
  // DOOM (PrBoom) : X = tirer, A = utiliser/ouvrir, Y = courir, B = pas de côté, L/R = pas de côté gauche/droite,
  // L2/R2 = arme précédente/suivante, Select = carte, Start = menu. Confort : gâchettes pour tirer et courir.
  doom: { authentique: [[PAD.bottom, RP.A], [PAD.right, RP.B], [PAD.left, RP.X], [PAD.top, RP.Y], [PAD.LB, RP.L], [PAD.RB, RP.R], [PAD.LT, RP.L2], [PAD.RT, RP.R2]], confort: [[PAD.RT, RP.X], [PAD.LT, RP.Y]] },
  arcade: { authentique: [[PAD.bottom, RP.B], [PAD.right, RP.A], [PAD.left, RP.Y], [PAD.top, RP.X], [PAD.LB, RP.L], [PAD.RB, RP.R], [PAD.LS, RP.L3]], confort: [[PAD.LT, RP.L], [PAD.RT, RP.R]] },
};

// Consoles à stick analogique : le stick gauche reste analogique (jamais converti en croix).
const ANALOG = new Set(['psp', 'doom']);

export const PAD_PROFILES = Object.freeze({
  authentique: Object.freeze({ id: 'authentique', label: 'Authentique', description: 'Les boutons à la place qu’ils ont sur la manette d’origine. Le stick ne remplace pas la croix.' }),
  confort: Object.freeze({ id: 'confort', label: 'Confort moderne', description: 'Même disposition, plus le stick gauche comme croix et des doublons sur les gâchettes. Choix conseillé.' }),
  natif: Object.freeze({ id: 'natif', label: 'Natif EmulatorJS', description: 'Les commandes du moteur, sans la disposition EMUPERSO (à utiliser si une manette n’est pas reconnue).' }),
});
export const DEFAULT_PAD = Object.freeze({ profile: 'confort', deadzone: 0.25, hideTouch: true, touchSize: 1, touchOpacity: 0.85, touchOffsets: Object.freeze({}) });
// Éléments tactiles déplaçables : un bouton (classe b_<id> du moteur) ou un bloc entier (croix et stick).
export const MOVABLE_KEY = /^(?:b_[a-z0-9_-]{1,20}|left|right|top|center)$/i;

/** Réglages normalisés (valeurs bornées), pour une console ou un jeu. */
export function normalizePad(value) {
  const v = value && typeof value === 'object' ? value : {};
  const num = (x, lo, hi, d) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x * 100) / 100)) : d);
  return Object.freeze({
    profile: PAD_PROFILES[v.profile] ? v.profile : DEFAULT_PAD.profile,
    deadzone: num(v.deadzone, 0.05, 0.6, DEFAULT_PAD.deadzone),
    hideTouch: v.hideTouch !== false,
    touchSize: num(v.touchSize, 0.6, 1.6, DEFAULT_PAD.touchSize),
    touchOpacity: num(v.touchOpacity, 0.2, 1, DEFAULT_PAD.touchOpacity),
    touchOffsets: Object.freeze(Object.fromEntries(Object.entries(v.touchOffsets && typeof v.touchOffsets === 'object' ? v.touchOffsets : {})
      .filter(([k, o]) => MOVABLE_KEY.test(k) && Array.isArray(o) && o.length === 2 && o.every(Number.isFinite))
      .slice(0, 40).map(([k, [x, y]]) => [k, [Math.max(-600, Math.min(600, Math.round(x))), Math.max(-600, Math.min(600, Math.round(y)))]]))),
  });
}

/** Table [indice manette, identifiant RetroPad] d'une console et d'un profil (null pour le profil natif). */
export function buttonMap(system, profile) {
  if (profile === 'natif') return null;
  const layout = LAYOUTS[system];
  if (!layout) return null;
  return [...BASE, ...layout.authentique, ...(profile === 'confort' ? layout.confort : [])];
}

const pressed = (b) => !!b && (b.pressed || b.value > 0.5);

/**
 * Valeurs à envoyer au moteur pour l'état d'une manette : { identifiant: valeur }.
 * Toujours 24 identifiants (0 = relâché), pour qu'un bouton lâché soit bien relâché dans le moteur.
 */
export function computePadInputs(system, pad, settings) {
  const cfg = normalizePad(settings);
  const out = {};
  for (let id = 0; id < 24; id++) out[id] = 0;
  const map = buttonMap(system, cfg.profile);
  if (!pad || !map) return out;
  for (const [index, id] of map) if (pressed(pad.buttons?.[index])) out[id] = 1;
  const axis = (i) => (Number.isFinite(pad.axes?.[i]) ? pad.axes[i] : 0);
  if (ANALOG.has(system)) {
    // Stick gauche analogique avec zone morte radiale (PSP).
    const x = axis(0), y = axis(1), m = Math.hypot(x, y);
    if (m > cfg.deadzone) {
      const k = Math.min(1, (m - cfg.deadzone) / (1 - cfg.deadzone)) / m;
      const sx = x * k, sy = y * k;
      out[16] = sx > 0 ? Math.round(sx * SCALE) : 0; out[17] = sx < 0 ? Math.round(-sx * SCALE) : 0;
      out[18] = sy > 0 ? Math.round(sy * SCALE) : 0; out[19] = sy < 0 ? Math.round(-sy * SCALE) : 0;
    }
  } else if (cfg.profile === 'confort') {
    // Stick gauche → croix (seuil au moins 0,35 pour éviter les diagonales involontaires).
    const t = Math.max(cfg.deadzone, 0.35), x = axis(0), y = axis(1);
    if (x < -t) out[RP.LEFT] = 1; if (x > t) out[RP.RIGHT] = 1; if (y < -t) out[RP.UP] = 1; if (y > t) out[RP.DOWN] = 1;
  }
  return out;
}

/** Choisit la manette à lire : la première de disposition « standard », sinon la première branchée. */
export function pickPad(pads) {
  const list = [...(pads || [])].filter((p) => p && p.connected);
  return list.find((p) => p.mapping === 'standard') || list[0] || null;
}

// Commandes tactiles PSP : le moteur n'en a pas (disposition générique Y/X/B/A, sans stick).
// Comme sur la console : croix en haut à gauche et stick analogique dessous, ✕ ○ □ △ en losange,
// L/R en haut ; Select/Start dans la bande centrale réservée sous l'image (player-layout.css).
export const PSP_TOUCH_LAYOUT = Object.freeze([
  { type: 'button', text: '△', id: 'triangle', location: 'right', left: 40, top: 0, bold: true, input_value: 9 },
  { type: 'button', text: '□', id: 'square', location: 'right', left: 0, top: 40, bold: true, input_value: 1 },
  { type: 'button', text: '○', id: 'circle', location: 'right', left: 81, top: 40, bold: true, input_value: 8 },
  { type: 'button', text: '✕', id: 'cross', location: 'right', left: 40, top: 80, bold: true, input_value: 0 },
  // Croix remontée et stick abaissé : ils ne se chevauchent plus (mesuré en portrait et en paysage).
  { type: 'dpad', id: 'dpad', location: 'left', left: '50%', top: '-40%', joystickInput: false, inputValues: [4, 5, 6, 7] },
  { type: 'zone', id: 'stick', location: 'left', left: '40%', top: '120%', joystickInput: true, inputValues: [16, 17, 18, 19] },
  { type: 'button', text: 'L', id: 'l', block: true, location: 'top', left: 10, top: -80, bold: true, input_value: 10 },
  { type: 'button', text: 'R', id: 'r', block: true, location: 'top', right: 10, top: -80, bold: true, input_value: 11 },
  { type: 'button', text: 'Select', id: 'select', location: 'center', left: -5, fontSize: 15, block: true, input_value: 2 },
  { type: 'button', text: 'Start', id: 'start', location: 'center', left: 60, fontSize: 15, block: true, input_value: 3 },
]);

/** Disposition tactile propre à EMUPERSO, ou null pour garder celle du moteur. */
export function touchLayout(system) {
  return system === 'psp' ? PSP_TOUCH_LAYOUT.map((b) => ({ ...b })) : null;
}
