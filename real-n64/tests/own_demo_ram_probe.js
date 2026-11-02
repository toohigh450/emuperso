// Controlled research helper for the repository's MIT homebrew, never another ROM.
// Sampling at 180 ms can repeatedly see the same double-buffer parity. The
// fallback proves an eight-byte native-state echo, then independently proves the
// original bytes are back in live RAM AND a fresh native state after real frames.
// forceNativeProof is a test-only research option; no product module uses this file.
async function findOwnDemoRam({ forceNativeProof = false } = {}) {
  if (typeof forceNativeProof !== 'boolean') throw new Error('RAM proof option must be boolean');
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
  let live = candidates.filter(c => c.pointers.includes(0xa0100000) && c.pointers.includes(0xa0140000));
  let identificationMethod = 'framebuffer-alternation';
  if (forceNativeProof || live.length !== 1) {
    const snapshot = gm.getState(), stateRegions = [];
    for (const [wordSwapped, pattern] of [[false, normal], [true, swapped]]) {
      for (let i = 0; i <= snapshot.length - pattern.length; i += 4) {
        const base = i - 0x400;
        if (base >= 0 && base + 0x800000 <= snapshot.length && snapshot[i] === pattern[0] &&
            pattern.every((value, j) => snapshot[i + j] === value)) stateRegions.push({ base, wordSwapped });
      }
    }
    if (stateRegions.length !== 1) throw new Error('Native RAM state is not uniquely identified');
    const physical = 0x10010, region = stateRegions[0], proven = [];
    const index = (address, wordSwapped) => wordSwapped ? address ^ 3 : address;
    const read = (bytes, base, wordSwapped) => Array.from({ length: 8 }, (_, i) => bytes[base + index(physical + i, wordSwapped)]);
    const same = (left, right) => left.length === right.length && left.every((value, i) => value === right[i]);
    const frames = async () => {
      const before = gm.getFrameNum(), deadline = performance.now() + 4000;
      while (gm.getFrameNum() < before + 2 && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30));
      const after = gm.getFrameNum();
      if (!Number.isFinite(before) || !Number.isFinite(after) || after < before + 2)
        throw new Error('No real frame progression during RAM proof');
      return { before, after, delta: after - before };
    };
    for (const candidate of candidates.filter(c => c.pointers.every(value => value === 0xa0100000 || value === 0xa0140000))) {
      const original = read(gm.Module.HEAPU8, candidate.base, candidate.wordSwapped);
      const nativeBefore = read(gm.getState(), region.base, region.wordSwapped);
      if (!same(original, nativeBefore)) continue;
      const nonce = [0x71, 0x39, 0xb2, 0x4e, 0x25, 0xd8, 0x6a, 0xc1];
      if (same(nonce, original)) nonce[0] ^= 0xff;
      let positiveFrames = null, positiveEcho = null, restorationFrames, restoredHeap, restoredNative;
      try {
        nonce.forEach((value, i) => { gm.Module.HEAPU8[candidate.base + index(physical + i, candidate.wordSwapped)] = value; });
        positiveFrames = await frames();
        positiveEcho = read(gm.getState(), region.base, region.wordSwapped);
      } finally {
        // Always restore live/candidate bytes, even if a frame or snapshot fails.
        original.forEach((value, i) => { gm.Module.HEAPU8[candidate.base + index(physical + i, candidate.wordSwapped)] = value; });
        restorationFrames = await frames();
        restoredHeap = read(gm.Module.HEAPU8, candidate.base, candidate.wordSwapped);
        restoredNative = read(gm.getState(), region.base, region.wordSwapped);
        if (!same(restoredHeap, original) || !same(restoredNative, original))
          throw new Error('Temporary RAM probe bytes were not demonstrably restored in heap and native state');
      }
      if (same(positiveEcho, nonce)) proven.push({ ...candidate, native_proof: {
        forced: forceNativeProof, heap_base: candidate.base, state_ram_base: region.base,
        physical_address: physical, byte_count: 8, original, nonce,
        native_before: nativeBefore, positive_echo: positiveEcho,
        restored_heap: restoredHeap, restored_native: restoredNative,
        positive_matches: true, restoration_matches: true,
        positive_frames: positiveFrames, restoration_frames: restorationFrames
      } });
    }
    live = proven; identificationMethod = 'native-state-nonce';
  }
  if (live.length !== 1) throw new Error('Live RAM not uniquely identified: ' + JSON.stringify(candidates));
  const found = live[0];
  window.ownDemoReadBytes = (physicalAddress, length) => {
    if (!Number.isInteger(physicalAddress) || !Number.isInteger(length) || physicalAddress < 0 || physicalAddress + length > 0x800000) throw new Error('RAM read out of bounds');
    const current = gm.Module.HEAPU8;
    return Array.from({ length }, (_, i) => current[found.base + (found.wordSwapped ? (physicalAddress + i) ^ 3 : physicalAddress + i)]);
  };
  return { ...found, candidates: candidates.length, rom_sha256: hash, identification_method: identificationMethod };
}
window.findOwnDemoRam = findOwnDemoRam;
