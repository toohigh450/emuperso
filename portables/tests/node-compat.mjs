// Node 22 ne fournit pas deflate-raw dans DecompressionStream, contrairement à Chrome.
// Adaptateur réservé aux tests : le navigateur continue d'utiliser son API native.
import {createInflateRaw} from 'node:zlib';
import {Duplex} from 'node:stream';
try { new DecompressionStream('deflate-raw'); }
catch {
  const Native=globalThis.DecompressionStream;
  globalThis.DecompressionStream=class extends Native {
    constructor(format) {
      if(format==='deflate-raw')return Duplex.toWeb(createInflateRaw());
      super(format);
    }
  };
}
