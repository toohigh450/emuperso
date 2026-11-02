// SPDX-License-Identifier: MIT
// Names are hints, never authentication of a disc edition.
const aliases = new Map([
  ['usa', 'USA'], ['us', 'USA'], ['u', 'USA'], ['ntsc-u', 'USA'], ['ntscu', 'USA'],
  ['europe', 'Europe'], ['eur', 'Europe'], ['eu', 'Europe'], ['e', 'Europe'], ['pal', 'Europe'],
  ['france', 'Europe'], ['germany', 'Europe'], ['italy', 'Europe'], ['spain', 'Europe'],
  ['japan', 'Japan'], ['jap', 'Japan'], ['jpn', 'Japan'], ['jp', 'Japan'], ['j', 'Japan'],
  ['ntsc-j', 'Japan'], ['ntscj', 'Japan'], ['world', 'World'],
]);
const groups = /\(([^()]*)\)|\[([^\[\]]*)\]/g;
const regionOf = token => aliases.get(token.trim().toLowerCase()) ?? null;
function isLocale(token) {
  // Syntax classification only. Country subtags never supply a disc region.
  try { new Intl.Locale(token.trim()); return true; } catch { return false; }
}
export function classifyMetadata(inner) {
  const tokens = inner.split(',').map(x => x.trim());
  const explicit = tokens.map(regionOf);
  if (explicit.every(Boolean)) return { kind: 'region', tokens, regions: [...new Set(explicit)] };
  if (tokens.every(isLocale) && !explicit.some(Boolean)) return { kind: 'language', tokens, regions: [] };
  return { kind: 'ambiguous', tokens, regions: [] };
}
export function stripLanguageMetadata(value) {
  return String(value ?? '').replace(groups, (match, a, b) => {
    const inner = a ?? b, item = classifyMetadata(inner);
    return item.kind === 'language' || (inner.includes(',') && item.kind === 'ambiguous') ? ' ' : match;
  });
}
export function regionEvidence(value) {
  const metadata = [], found = new Set();
  const outside = String(value ?? '').replace(/\.(chd|pbp|iso|bin|img|cue|rar|zip|7z)$/i, '')
    .replace(groups, (match, a, b) => {
      const item = classifyMetadata(a ?? b); metadata.push(item);
      for (const region of item.regions) found.add(region);
      return ' ';
    });
  // Parse a contiguous, hyphen-delimited release tail from the END only.
  // Plain title words (including Us), and country words before a platform tag,
  // never become regional evidence. Bracketed metadata remains the primary form.
  const suffix = /(?:-(PSX|PS1|PSONE|PSX1|NTSC[-_ ]?[UJ]|NTSC[UJ]|NTSC|PAL|SECAM|USA|US|Europe|EUR|EU|Japan|JAP|JPN|JP|World|France|Germany|Italy|Spain|CD\s*\d+|Disc\s*\d+|Disk\s*\d+|Disque\s*\d+|Rev\s*\d+|v\d+(?:\.\d+)*)|\s+(NTSC[-_ ]?[UJ]|NTSC[UJ]))\s*$/i;
  const releaseTags = [];
  let rest = outside.trim(), match;
  while ((match = suffix.exec(rest)) && match.index > 0) {
    releaseTags.unshift(match[1] || match[2]);
    rest = rest.slice(0, match.index).trimEnd();
  }
  let platformSeen = false;
  for (const tag of releaseTags) {
    if (/^(PSX|PS1|PSONE|PSX1)$/i.test(tag)) platformSeen = true;
    const token = tag.replace(/^NTSC[-_ ]?([UJ])$/i, 'NTSC-$1');
    const region = regionOf(token);
    if (region && (platformSeen || /^(PAL|NTSC[-_ ]?[UJ]|NTSC[UJ])$/i.test(tag))) found.add(region);
  }
  const regions = [...found];
  return { status: regions.length === 1 ? 'explicit-name-hint' : regions.length ? 'ambiguous' : 'unknown',
    region: regions.length === 1 ? regions[0] : null, regions, metadata, releaseTags, editionVerified: false, source: 'filename' };
}
