// Distribution versionnée ; l'intégrité du loader ne couvre pas ses sous-ressources.
export const ENGINE_VERSION = '4.2.3';
export const LOADER_INTEGRITY = 'sha256-aeCQO/Hi9izteIleflEfom4RMW9+tzSSXDXpGboSh7I=';
export const REMOTE_ENGINE = { path: 'https://cdn.emulatorjs.org/4.2.3/data/', integrity: LOADER_INTEGRITY };
// PSP seulement : le cœur ppsspp de 4.2.3 (juin 2025) charge Gran Turismo à 5-6 images/s ; celui de la
// distribution nightly passe ce chargement à 19-38 images/s et atteint le menu à 60 (mesures du 2 novembre 2026).
// La 4.3.0-pre ne démarre pas. Nightly change sans numéro de version : pas de contrôle SRI possible.
// En cas d'échec de préparation, le lanceur repasse sur 4.2.3 (sources essayées dans l'ordre).
export const PSP_ENGINE = { path: 'https://cdn.emulatorjs.org/nightly/data/', integrity: null, label: 'EmulatorJS nightly' };
