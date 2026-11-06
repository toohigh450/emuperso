// Estimation prudente avant allocation ; ce n'est pas une mesure de RAM libre.
export const MiB = 1024 * 1024;
export const MAX_ROM_BYTES = 512 * MiB;
export const MAX_INPUT_BYTES = MAX_ROM_BYTES + 16 * MiB;
export function memoryPlan(romBytes, { deviceMemory, archiveBytes = 0, activeBytes = 0 } = {}) {
  if (!Number.isFinite(romBytes) || romBytes < 0 || romBytes > MAX_ROM_BYTES) throw new Error('ROM trop grosse : maximum 512 Mio pour les consoles proposées.');
  const budget = Math.min(3 * 1024 * MiB, deviceMemory > 0 ? deviceMemory * 1024 * MiB / 2 : 2 * 1024 * MiB);
  const estimated = 256 * MiB + 5 * romBytes + archiveBytes + 3 * activeBytes;
  if (estimated > budget) throw new Error(`Mémoire estimée excessive (${Math.ceil(estimated / MiB)} Mio, budget prudent ${Math.floor(budget / MiB)} Mio). Ferme le jeu actif, utilise une ROM plus petite ou un émulateur natif.`);
  return { estimated, budget, warn: romBytes >= 256 * MiB };
}

// PSP : le lanceur ne garde pas le jeu en mémoire (lecture par tranches, empreinte par morceaux).
// Le moteur, lui, lit tout le fichier puis le copie dans son système de fichiers : environ deux fois
// la taille du jeu, plus le cœur PPSSPP et sa mémoire (estimés à 700 Mio). Estimation, pas mesure.
export const PSP_WARN_BYTES = 700 * MiB;
export function pspMemoryPlan(fileBytes, { deviceMemory } = {}) {
  const estimated = 700 * MiB + 2 * fileBytes;
  const budget = deviceMemory > 0 && deviceMemory < 8 ? deviceMemory * 1024 * MiB / 2 : 4 * 1024 * MiB;
  if (estimated > budget) throw new Error(`Jeu PSP trop lourd pour cet appareil dans le navigateur (estimation ${Math.ceil(estimated / MiB)} Mio, budget prudent ${Math.floor(budget / MiB)} Mio). Compresse-le en CSO avec maxcso, ou joue-le avec PPSSPP installé sur le PC.`);
  return { estimated, budget, warn: fileBytes >= PSP_WARN_BYTES };
}

// GameCube : Gecko/WASM lit l'image entière puis la copie dans sa mémoire linéaire ;
// même ordre de grandeur que la PSP (fichier + copie wasm + émulateur), mais sans audio ni JIT.
export const GC_MAX_BYTES = 1536 * MiB;
export const GC_WARN_BYTES = 700 * MiB;
export function gamecubeMemoryPlan(fileBytes, { deviceMemory } = {}) {
  const estimated = 800 * MiB + 2 * fileBytes;
  const budget = deviceMemory > 0 && deviceMemory < 8 ? deviceMemory * 1024 * MiB / 2 : 4 * 1024 * MiB;
  if (estimated > budget) throw new Error(`Image GameCube trop lourde pour cet appareil dans le navigateur (estimation ${Math.ceil(estimated / MiB)} Mio, budget prudent ${Math.floor(budget / MiB)} Mio). Utilise une image RVZ plus petite, ou un émulateur GameCube installé sur le PC.`);
  return { estimated, budget, warn: fileBytes >= GC_WARN_BYTES };
}
