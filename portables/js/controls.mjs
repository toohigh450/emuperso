// Profils de manette. « defaut » laisse EmulatorJS gérer. « positionnel » suit la position
// physique des boutons Nintendo : bouton du bas = B, bouton de droite = A, gauche = Y, haut = X.
// Les numéros BUTTON_n et les index viennent de la documentation EmulatorJS (EJS_defaultControls).
// À valider avec la vraie manette Xbox 360 de Karl.

export const CONTROL_PROFILES = {
  defaut: { id: 'defaut', label: 'Par défaut (étiquettes Xbox)' },
  positionnel: { id: 'positionnel', label: 'Positionnel Nintendo (A à droite, B en bas)' },
};

const KEYBOARD_AND_PAD_DEFAULTS = {
  0: { value: 'x', value2: 'BUTTON_2' },
  1: { value: 's', value2: 'BUTTON_4' },
  2: { value: 'v', value2: 'SELECT' },
  3: { value: 'enter', value2: 'START' },
  4: { value: 'up arrow', value2: 'DPAD_UP' },
  5: { value: 'down arrow', value2: 'DPAD_DOWN' },
  6: { value: 'left arrow', value2: 'DPAD_LEFT' },
  7: { value: 'right arrow', value2: 'DPAD_RIGHT' },
  8: { value: 'z', value2: 'BUTTON_1' },
  9: { value: 'a', value2: 'BUTTON_3' },
  10: { value: 'q', value2: 'LEFT_TOP_SHOULDER' },
  11: { value: 'e', value2: 'RIGHT_TOP_SHOULDER' },
  12: { value: 'tab', value2: 'LEFT_BOTTOM_SHOULDER' },
  13: { value: 'r', value2: 'RIGHT_BOTTOM_SHOULDER' },
  14: { value: '', value2: 'LEFT_STICK' },
  15: { value: '', value2: 'RIGHT_STICK' },
  16: { value: 'h', value2: 'LEFT_STICK_X:+1' },
  17: { value: 'f', value2: 'LEFT_STICK_X:-1' },
  18: { value: 'g', value2: 'LEFT_STICK_Y:+1' },
  19: { value: 't', value2: 'LEFT_STICK_Y:-1' },
  20: { value: 'l', value2: 'RIGHT_STICK_X:+1' },
  21: { value: 'j', value2: 'RIGHT_STICK_X:-1' },
  22: { value: 'k', value2: 'RIGHT_STICK_Y:+1' },
  23: { value: 'i', value2: 'RIGHT_STICK_Y:-1' },
  24: { value: '1' },
  25: { value: '2' },
  26: { value: '3' },
  27: { value: 'add' },
  28: { value: 'space' },
  29: { value: 'subtract' },
};

/** Retourne la valeur à donner à EJS_defaultControls, ou null pour ne rien imposer. */
/**
 * PSP : commandes par défaut sans la touche de chargement rapide d'état (n° 25, « 2 »).
 * Avec le cœur ppsspp nightly, charger un état fige le jeu (constaté le 2 novembre 2026).
 */
export function buildPspControls() {
  const p0 = structuredClone(KEYBOARD_AND_PAD_DEFAULTS);
  p0[25] = { value: '' };
  return { 0: p0, 1: {}, 2: {}, 3: {} };
}

export function buildDefaultControls(profileId) {
  if (profileId !== 'positionnel') return null;
  const p0 = structuredClone(KEYBOARD_AND_PAD_DEFAULTS);
  p0[0].value2 = 'BUTTON_1'; // bouton du bas  -> B
  p0[8].value2 = 'BUTTON_2'; // bouton de droite -> A
  p0[1].value2 = 'BUTTON_3'; // bouton de gauche -> Y
  p0[9].value2 = 'BUTTON_4'; // bouton du haut  -> X
  return { 0: p0, 1: {}, 2: {}, 3: {} };
}
