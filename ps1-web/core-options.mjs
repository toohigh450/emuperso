// SPDX-License-Identifier: MIT
// Lecture tolérante des options du cœur libretro (sans dépendance navigateur,
// pour être testable). Certains cœurs listent « clé; desc|v1|v2 », d'autres
// « clé|v1|v2 » ou « clé = valeur », parfois avec des espaces en tête.
// L'ancienne version exigeait exactement « clé; … », d'où « option introuvable »
// à tort pour pcsx_rearmed_pad1type (mandat §6).
export function findCoreOptionLine(coreOptions, key) {
  if (typeof coreOptions !== 'string') return null;
  for (const raw of coreOptions.split('\n')) {
    const row = raw.trim();
    const m = row.match(/^([A-Za-z0-9_]+)\s*(?:;|\||=|$)/);
    if (m && m[1] === key) return row;
  }
  return null;
}
export function coreOptionKeys(coreOptions) {
  if (typeof coreOptions !== 'string') return [];
  return coreOptions.split('\n').flatMap(row => {
    const match = row.trim().match(/^([A-Za-z0-9_]+)\s*(?:;|\||=)/);
    return match ? [match[1]] : [];
  });
}
export function coreOptionCurrent(coreOptions, key) {
  const line = findCoreOptionLine(coreOptions, key);
  if (!line) return null;
  // Pinned EmulatorJS: key|current; value1|value2. No value inferred from listing.
  const head = line.split(';', 1)[0];
  if (head.includes('|')) return head.slice(head.indexOf('|') + 1).trim() || null;
  if (head.includes('=')) return head.slice(head.indexOf('=') + 1).trim() || null;
  return null;
}
export function coreOptionLists(coreOptions, key, value) {
  const line = findCoreOptionLine(coreOptions, key);
  if (!line) return { found: false, listed: false, line: null };
  const after = line.includes(';') ? line.slice(line.indexOf(';') + 1) : line.slice(line.indexOf(key) + key.length);
  const values = after.split('|').map(v => v.trim()).filter(Boolean);
  return { found: true, listed: values.includes(value), line };
}
