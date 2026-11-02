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
