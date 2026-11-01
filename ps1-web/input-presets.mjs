// SPDX-License-Identifier: MIT
// Profils de commandes nommés EMUPERSO PS1 — couche au-dessus de input-profile.mjs (Claude).
// Mandat officiel §4 : deux profils clairement identifiables, configurables et enregistrables par jeu.
// Ne modifie pas input-profile.mjs : réutilise normalizeInput() tel quel.
import { normalizeInput, DEFAULT_INPUT } from './input-profile.mjs';

// « PS1 authentique » — commandes du contrôleur original, sans simulation ajoutée.
// Le stick gauche ne pilote PAS la croix : comportement strict d'époque.
const AUTHENTIQUE = Object.freeze({
  analog: 'off',
  stickToDpad: false,
  deadzone: DEFAULT_INPUT.deadzone,
  native: false,
});

// « Confort moderne » — choix privilégié de Karl (mandat §3).
// Mapping positionnel OEM + stick gauche -> croix directionnelle (zone morte réglable).
// La croix physique reste opérationnelle en tout temps (gérée par input-profile.mjs).
const CONFORT = Object.freeze({
  analog: 'off',
  stickToDpad: true,
  deadzone: 0.2,
  native: false,
});

export const PROFILES = Object.freeze({
  authentique: Object.freeze({
    id: 'authentique',
    label: 'PS1 authentique',
    description: 'Commandes du contrôleur original. Respecte les limitations des jeux, sans simulation ajoutée.',
    config: AUTHENTIQUE,
  }),
  confort: Object.freeze({
    id: 'confort',
    label: 'Confort moderne',
    description: 'Mapping positionnel OEM. Le stick gauche pilote aussi la croix (zone morte réglable). Choix privilégié.',
    config: CONFORT,
  }),
});

export const DEFAULT_PROFILE_ID = 'confort';

export function profileIds() {
  return Object.freeze(Object.keys(PROFILES));
}

export function getProfile(id) {
  const found = PROFILES[id];
  return found ?? PROFILES[DEFAULT_PROFILE_ID];
}

// Retourne la configuration normalisée (via le schéma de Claude) pour un profil nommé.
// Les surcharges permettent un réglage fin par jeu, enregistrable (mandat §4, §6).
export function resolveProfile(id, overrides = {}) {
  const base = getProfile(id).config;
  return normalizeInput({ ...base, ...overrides });
}

// Vrai si le profil demande une émulation stick -> croix (utile pour l'UI : l'afficher clairement).
export function usesStickToDpad(id, overrides = {}) {
  return resolveProfile(id, overrides).stickToDpad === true;
}
