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
  const outside = String(value ?? '').replace(/\.(chd|pbp|iso|bin|img|cue)$/i, '')
    .replace(groups, (match, a, b) => {
      const item = classifyMetadata(a ?? b); metadata.push(item);
      for (const region of item.regions) found.add(region);
      return ' ';
    });
  // Only explicit suffix tokens outside metadata. Never scan words in the title.
  const suffix = /(?:-|\s)(NTSC[-_ ]?[UJ]|NTSC[UJ]|USA|US|Europe|EUR|EU|Japan|JAP|JPN|JP|PAL|World|France|Germany|Italy|Spain)(?=-|\s|$)/gi;
  for (const match of outside.matchAll(suffix)) {
    const token = match[1].replace(/^NTSC[-_ ]?([UJ])$/i, 'NTSC-$1');
    const region = regionOf(token); if (region) found.add(region);
  }
  const regions = [...found];
  return { status: regions.length === 1 ? 'explicit-name-hint' : regions.length ? 'ambiguous' : 'unknown',
    region: regions.length === 1 ? regions[0] : null, regions, metadata, editionVerified: false, source: 'filename' };
}
