// SPDX-License-Identifier: MIT
// Logique pure des commandes PS1 : manette « standard » du navigateur -> identifiants RetroPad d'EmulatorJS.
// Hypothèse NON vérifiée ici : valeur analogique 0..0x7fff sur les identifiants 16..23 (voir README).
export const SCALE = 0x7fff;
export const DEFAULT_INPUT = Object.freeze({ analog: 'off', stickToDpad: true, deadzone: 0.2, native: false });
export function normalizeInput(value) {
  const v = value && typeof value === 'object' ? value : {};
  const deadzone = Number.isFinite(v.deadzone) ? Math.min(0.6, Math.max(0.05, Math.round(v.deadzone * 100) / 100)) : DEFAULT_INPUT.deadzone;
  const out = { analog: ['off', 'analog', 'dualshock'].includes(v.analog) ? v.analog : 'off', stickToDpad: v.stickToDpad !== false, deadzone, native: v.native === true };
  if (typeof v._profile === 'string' && v._profile) out._profile = v._profile;
  return Object.freeze(out);
}
// Valeurs de l'option réelle du cœur pcsx_rearmed_pad1type : standard | analog | dualshock.
export const padType = profile => (profile.analog === 'off' ? 'standard' : profile.analog);
// Positionnel OEM (Xbox 360 -> PS1) : bas=Croix, droite=Rond, gauche=Carré, haut=Triangle.
// RetroPad : B=bas(Croix) A=droite(Rond) Y=gauche(Carré) X=haut(Triangle). [indice Gamepad standard, identifiant RetroPad]
export const BUTTONS = Object.freeze([[0, 0], [1, 8], [2, 1], [3, 9], [4, 10], [5, 11], [6, 12], [7, 13], [8, 2], [9, 3], [10, 14], [11, 15], [12, 4], [13, 5], [14, 6], [15, 7]]);
const down = button => !!button && (button.pressed || button.value > 0.5);
function radial(x, y, deadzone) {
  const magnitude = Math.hypot(x, y); if (magnitude <= deadzone) return [0, 0];
  const k = Math.min(1, (magnitude - deadzone) / (1 - deadzone)) / magnitude; return [x * k, y * k];
}
export function computeInputs(pad, profile) {
  const out = {}; for (let id = 0; id < 24; id++) out[id] = 0;
  if (!pad) return out;
  for (const [index, id] of BUTTONS) if (down(pad.buttons?.[index])) out[id] = 1;
  const axis = index => (Number.isFinite(pad.axes?.[index]) ? pad.axes[index] : 0);
  if (profile.analog === 'off') {
    if (profile.stickToDpad) {
      const threshold = Math.max(profile.deadzone, 0.35), x = axis(0), y = axis(1);
      if (x < -threshold) out[6] = 1; if (x > threshold) out[7] = 1; if (y < -threshold) out[4] = 1; if (y > threshold) out[5] = 1;
    }
    return out;
  }
  for (const [first, a, b] of [[16, 0, 1], [20, 2, 3]]) {
    const [x, y] = radial(axis(a), axis(b), profile.deadzone);
    out[first] = x > 0 ? Math.round(x * SCALE) : 0; out[first + 1] = x < 0 ? Math.round(-x * SCALE) : 0;
    out[first + 2] = y > 0 ? Math.round(y * SCALE) : 0; out[first + 3] = y < 0 ? Math.round(-y * SCALE) : 0;
  }
  return out;
}
