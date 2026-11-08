// Profils de manette N64 (mandat Controller V2, section 4). Module pur, testable avec Node.
// Manette « standard » du navigateur → identifiants d'EmulatorJS pour mupen64plus_next :
// 0 A, 1 B, 3 Start, 4-7 croix, 10 L, 11 R, 12 Z, 16-19 stick (droite, gauche, bas, haut),
// 20-23 boutons C (droite, gauche, bas, haut). Correspondance à valider avec le vrai moteur et la vraie manette.
export const SCALE = 0x7fff;
const PAD = { bottom: 0, right: 1, left: 2, top: 3, LB: 4, RB: 5, LT: 6, RT: 7, start: 9, up: 12, down: 13, dleft: 14, dright: 15 };
const N64 = { A: 0, B: 1, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, L: 10, R: 11, Z: 12, C_RIGHT: 20, C_LEFT: 21, C_DOWN: 22, C_UP: 23 };

// Proposition du mandat : A = A, B = X, C = stick droit, Z = LT, R = RB, L = LB, croix = croix, Start = Menu.
const AUTHENTIQUE = [[PAD.bottom, N64.A], [PAD.left, N64.B], [PAD.LT, N64.Z], [PAD.RB, N64.R], [PAD.LB, N64.L],
  [PAD.start, N64.START], [PAD.up, N64.UP], [PAD.down, N64.DOWN], [PAD.dleft, N64.LEFT], [PAD.dright, N64.RIGHT]];
// Confort : en plus, Z aussi sur RT, C bas sur B et C gauche sur Y (boutons C sans lâcher le stick droit).
const CONFORT = [[PAD.RT, N64.Z], [PAD.right, N64.C_DOWN], [PAD.top, N64.C_LEFT]];

export const N64_PROFILES = Object.freeze({
  authentique: Object.freeze({ id: 'authentique', label: 'Authentique', description: 'Correspondance du mandat : A = A, B = X, boutons C = stick droit, Z = LT, L/R = LB/RB.' }),
  confort: Object.freeze({ id: 'confort', label: 'Confort moderne', description: 'Même base, plus Z sur RT, C bas sur B et C gauche sur Y.' }),
  natif: Object.freeze({ id: 'natif', label: 'Natif EmulatorJS', description: 'Les commandes du moteur, sans la disposition EMUPERSO.' }),
});
export const DEFAULT_N64_PAD = Object.freeze({ profile: 'confort', deadzone: 0.2, sensitivity: 1, hideTouch: true });

export function normalizeN64Pad(value) {
  const v = value && typeof value === 'object' ? value : {};
  const num = (x, lo, hi, d) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x * 100) / 100)) : d);
  return Object.freeze({
    profile: N64_PROFILES[v.profile] ? v.profile : DEFAULT_N64_PAD.profile,
    deadzone: num(v.deadzone, 0.05, 0.5, DEFAULT_N64_PAD.deadzone),
    sensitivity: num(v.sensitivity, 0.5, 1.5, DEFAULT_N64_PAD.sensitivity),
    hideTouch: v.hideTouch !== false,
  });
}

const pressed = (b) => !!b && (b.pressed || b.value > 0.5);

/** Valeurs à envoyer au moteur (24 identifiants, 0 = relâché) ; null pour le profil natif. */
export function computeN64Inputs(pad, settings) {
  const cfg = normalizeN64Pad(settings);
  if (cfg.profile === 'natif') return null;
  const out = {};
  for (let id = 0; id < 24; id++) out[id] = 0;
  if (!pad) return out;
  for (const [index, id] of [...AUTHENTIQUE, ...(cfg.profile === 'confort' ? CONFORT : [])]) if (pressed(pad.buttons?.[index])) out[id] = SCALE_IF_C(id);
  const axis = (i) => (Number.isFinite(pad.axes?.[i]) ? pad.axes[i] : 0);
  // Stick N64 : analogique, zone morte radiale et sensibilité (course pleine atteinte plus tôt au-delà de 1).
  const x = axis(0), y = axis(1), m = Math.hypot(x, y);
  if (m > cfg.deadzone) {
    const k = Math.min(1, ((m - cfg.deadzone) / (1 - cfg.deadzone)) * cfg.sensitivity) / m;
    const sx = x * k, sy = y * k;
    out[16] = sx > 0 ? Math.round(sx * SCALE) : 0; out[17] = sx < 0 ? Math.round(-sx * SCALE) : 0;
    out[18] = sy > 0 ? Math.round(sy * SCALE) : 0; out[19] = sy < 0 ? Math.round(-sy * SCALE) : 0;
  }
  // Boutons C : numériques sur la vraie manette ; stick droit au-delà de la moitié de sa course.
  const cx = axis(2), cy = axis(3);
  if (cx > 0.5) out[N64.C_RIGHT] = SCALE; if (cx < -0.5) out[N64.C_LEFT] = SCALE;
  if (cy > 0.5) out[N64.C_DOWN] = SCALE; if (cy < -0.5) out[N64.C_UP] = SCALE;
  return out;
}
// Les boutons C sont lus comme le stick droit du moteur : valeur pleine, pas 1.
function SCALE_IF_C(id) { return id >= 20 ? SCALE : 1; }

export function pickPad(pads) {
  const list = [...(pads || [])].filter((p) => p && p.connected);
  return list.find((p) => p.mapping === 'standard') || list[0] || null;
}

// Commandes tactiles N64 : celles du moteur, sans Fast/Slow (bloqués par cette application, donc sans effet),
// croix dessinée en croix (et non en second stick). Stick, A, B, Z, L, R, Start et les quatre C.
export const N64_TOUCH_LAYOUT = Object.freeze([
  { type: 'button', text: 'B', id: 'b', location: 'right', left: -10, top: 95, input_value: 1, bold: true },
  { type: 'button', text: 'A', id: 'a', location: 'right', left: 40, top: 150, input_value: 0, bold: true },
  // Croix remontée et stick abaissé : ils ne se chevauchent plus ; L et Z sur une même ligne en haut.
  { type: 'zone', id: 'stick', location: 'left', left: '40%', top: '120%', joystickInput: true, inputValues: [16, 17, 18, 19] },
  { type: 'dpad', id: 'dpad', location: 'left', left: '50%', top: '-45%', joystickInput: false, inputValues: [4, 5, 6, 7] },
  { type: 'button', text: 'Start', id: 'start', location: 'center', left: 30, top: -10, fontSize: 15, block: true, input_value: 3 },
  { type: 'button', text: 'L', id: 'l', block: true, location: 'top', left: 10, top: -90, bold: true, input_value: 10 },
  { type: 'button', text: 'R', id: 'r', block: true, location: 'top', right: 75, top: -90, bold: true, input_value: 11 }, // à gauche du bouton menu du moteur
  { type: 'button', text: 'Z', id: 'z', block: true, location: 'top', left: 70, top: -90, bold: true, input_value: 12 },
  { type: 'button', text: 'C▲', id: 'cu', fontSize: 20, joystickInput: true, location: 'right', left: 25, top: -65, input_value: 23 },
  { type: 'button', text: 'C▼', id: 'cd', fontSize: 20, joystickInput: true, location: 'right', left: 25, top: 15, input_value: 22 },
  { type: 'button', text: 'C◀', id: 'cl', fontSize: 20, joystickInput: true, location: 'right', left: -15, top: -25, input_value: 21 },
  { type: 'button', text: 'C▶', id: 'cr', fontSize: 20, joystickInput: true, location: 'right', left: 65, top: -25, input_value: 20 },
]);
export const touchLayout = () => N64_TOUCH_LAYOUT.map((b) => ({ ...b }));
