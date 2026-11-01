// SPDX-License-Identifier: MIT
// Signals observed from the pinned native frontend. Frame progress alone is
// insufficient: RetroArch keeps running after it rejects an invalid disc.
export function contentStartupError(message) {
  const text = String(message ?? '');
  return /\[ERROR\]\s*\[Content\]:\s*Failed to load content|unsupported\/invalid CD image|could not load (?:exe|CD)\b/i.test(text)
    ? 'Le cœur a refusé le contenu du disque ; la session n’est pas validée.' : null;
}
