import { extractFirst, listCandidates } from './zip.mjs';
export const MAX_BIOS_ZIP = 2 * 1024 * 1024;
export const BIOS_SIZES = {
  'bios7.bin': [16384],
  'bios9.bin': [4096],
  'firmware.bin': [131072, 262144, 524288],
};
export async function validateDsBios(bytes) {
  if (bytes.length > MAX_BIOS_ZIP) throw new Error('ZIP BIOS trop gros (maximum 2 Mio).');
  const entries = listCandidates(bytes, new Set(['bin']));
  for (const [name, sizes] of Object.entries(BIOS_SIZES)) {
    const matches = entries.filter(e => e.name === name);
    if (matches.length !== 1) throw new Error(`BIOS DS : ${name} doit apparaître une seule fois, à la racine du ZIP, avec ce nom exact.`);
    if (!sizes.includes(matches[0].size)) throw new Error(`BIOS DS : taille incorrecte pour ${name} (${sizes.join(' ou ')} octets attendus).`);
    await extractFirst(bytes, new Set(['bin']), { name, maxBytes: Math.max(...sizes) });
  }
  return { files: Object.keys(BIOS_SIZES) }; // Structure et CRC contrôlés ; authenticité non attestée.
}
