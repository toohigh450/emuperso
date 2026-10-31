// Read-only research helper for the repository's MIT homebrew, never another ROM.
// Evaluate this file in the top page, then await findOwnDemoRam().
async function findOwnDemoRam() {
  const emulator = window.RealN64?.engineWindow?.EJS_emulator ?? window.EJS_emulator;
  const gm = emulator?.gameManager;
  if (!gm) throw new Error('Own-demo engine not ready');
  const rom = gm.FS.readFile(emulator.fileName);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', rom))].map(x => x.toString(16).padStart(2, '0')).join('');
  if (hash !== 'f18280a16c83721bdd56564701d505f96346784f36168402e5431b12499e2252') throw new Error('RAM probe restricted to the repository MIT demo');
  const normal = rom.slice(0x1000, 0x1040), swapped = normal.slice();
  for (let i = 0; i < normal.length; i += 4) swapped.set(normal.slice(i, i + 4).reverse(), i);
  const heap = gm.Module.HEAPU8, candidates = [];
  for (const [wordSwapped, pattern] of [[false, normal], [true, swapped]]) {
    for (let i = 0; i <= heap.length - pattern.length; i += 4) {
      if (heap[i] !== pattern[0]) continue;
      let matches = true;
      for (let j = 1; j < pattern.length; j++) if (heap[i + j] !== pattern[j]) { matches = false; break; }
      const base = i - 0x400;
      if (matches && base >= 0 && base + 0x800000 <= heap.length) candidates.push({ base, wordSwapped, pointers: [] });
    }
  }
  for (let sample = 0; sample < 6; sample++) {
    const view = new DataView(gm.Module.HEAPU8.buffer);
    for (const c of candidates) c.pointers.push(view.getUint32(c.base + 0xb78, c.wordSwapped));
    await new Promise(resolve => setTimeout(resolve, 180));
  }
  const live = candidates.filter(c => c.pointers.includes(0xa0100000) && c.pointers.includes(0xa0140000));
  if (live.length !== 1) throw new Error('Live RAM not uniquely identified: ' + JSON.stringify(candidates));
  const found = live[0];
  window.ownDemoReadBytes = (physicalAddress, length) => {
    if (!Number.isInteger(physicalAddress) || !Number.isInteger(length) || physicalAddress < 0 || physicalAddress + length > 0x800000) throw new Error('RAM read out of bounds');
    const current = gm.Module.HEAPU8;
    return Array.from({ length }, (_, i) => current[found.base + (found.wordSwapped ? (physicalAddress + i) ^ 3 : physicalAddress + i)]);
  };
  return { ...found, candidates: candidates.length, rom_sha256: hash };
}
window.findOwnDemoRam = findOwnDemoRam;
