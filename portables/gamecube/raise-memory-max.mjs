// Réécrit la section "memory" d'un wasm-pack --target web pour relever le plafond
// de mémoire linéaire. Le build Gecko épinglé plafonne à 512 Mio, ce qui interdit
// toute image disque GameCube (> 1 Gio). Usage : node raise-memory-max.mjs in.wasm out.wasm [pages]
import { readFileSync, writeFileSync } from 'node:fs';

const [input, output, pagesArg] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node raise-memory-max.mjs <in.wasm> <out.wasm> [pages=65536]');
const maxPages = Number(pagesArg || 65536);
if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 65536) throw new Error('pages doit être un entier entre 1 et 65536 (4 Gio wasm32).');

const src = readFileSync(input);
if (src.length < 8 || src.readUInt32LE(0) !== 0x6d736100 || src.readUInt32LE(4) !== 1) throw new Error('Pas un binaire WebAssembly.');

const lebLen = (v) => { let n = 1; while (v >= 0x80) { v >>>= 7; n++; } return n; };
const leb = (v) => { const out = []; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; out.push(b); } while (v); return out; };
const readLeb = (b, p) => { let r = 0, s = 0; for (;;) { const x = b[p++]; r |= (x & 0x7f) << s; if (!(x & 0x80)) return [r >>> 0, p]; s += 7; } };

const parts = [src.subarray(0, 8)];
let p = 8, memories = 0;
while (p < src.length) {
  const id = src[p++];
  const [size, contentStart] = readLeb(src, p);
  const contentEnd = contentStart + size;
  if (contentEnd > src.length) throw new Error(`Section ${id} tronquée.`);
  if (id !== 5) { parts.push(src.subarray(p - 1, contentEnd)); p = contentEnd; continue; }

  let q = contentStart;
  const [count, afterCount] = readLeb(src, q); q = afterCount;
  const out = [...leb(count)];
  for (let i = 0; i < count; i++) {
    const flags = src[q++];
    const [min, afterMin] = readLeb(src, q); q = afterMin;
    out.push(flags, ...leb(min));
    if (flags & 1) {
      const [, afterMax] = readLeb(src, q); q = afterMax;
      out.push(...leb(maxPages));
    }
  }
  if (q !== contentEnd) throw new Error('Section memory mal formée.');
  memories += count;
  const body = Buffer.from(out);
  parts.push(Buffer.from([id, ...leb(body.length), ...body]));
  p = contentEnd;
}
if (!memories) throw new Error('Aucune mémoire exportée trouvée.');
writeFileSync(output, Buffer.concat(parts));
console.log(`memory: ${memories} bloc(s), plafond relevé à ${maxPages} pages (${(maxPages * 65536 / 1024 / 1024).toFixed(0)} Mio).`);
