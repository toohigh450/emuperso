// Fabrication de fausses ROM (en-têtes valides, contenu synthétique) : aucune ROM commerciale.
import { crc16Modbus } from '../js/systems.mjs';

const GB_LOGO = [0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 0x00, 0x0b];
const GBA_LOGO = [0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21];

function put(bytes, offset, arr) {
  for (let i = 0; i < arr.length; i++) bytes[offset + i] = arr[i];
}
function putAscii(bytes, offset, text) {
  for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
}

export function makeGb({ title = 'TESTGB', cgb = 0x00, size = 32768, dest = 1, version = 0, badChecksum = false } = {}) {
  const b = new Uint8Array(size);
  put(b, 0x104, GB_LOGO);
  putAscii(b, 0x134, title);
  b[0x143] = cgb;
  b[0x148] = Math.log2(size / 32768);
  b[0x14a] = dest;
  b[0x14c] = version;
  let x = 0;
  for (let i = 0x134; i <= 0x14c; i++) x = (x - b[i] - 1) & 0xff;
  b[0x14d] = badChecksum ? (x + 1) & 0xff : x;
  return b;
}

export function makeGba({ title = 'TESTGBA', code = 'ATSE', version = 0, size = 0x400, badChecksum = false } = {}) {
  const b = new Uint8Array(size);
  put(b, 0x04, GBA_LOGO);
  putAscii(b, 0xa0, title);
  putAscii(b, 0xac, code);
  putAscii(b, 0xb0, '01');
  b[0xb2] = 0x96;
  b[0xbc] = version;
  let c = 0;
  for (let i = 0xa0; i <= 0xbc; i++) c = (c - b[i]) & 0xff;
  c = (c - 0x19) & 0xff;
  b[0xbd] = badChecksum ? (c + 1) & 0xff : c;
  return b;
}

export function makeNds({ title = 'TESTNDS', code = 'ATSE', unit = 0, version = 0, size = 0x800, badCrc = false } = {}) {
  const b = new Uint8Array(size);
  putAscii(b, 0x00, title);
  putAscii(b, 0x0c, code);
  putAscii(b, 0x10, '01');
  b[0x12] = unit;
  b[0x1e] = version;
  put(b, 0xc0, GBA_LOGO);
  let crc = crc16Modbus(b, 0, 0x15e);
  if (badCrc) crc ^= 0x1;
  b[0x15e] = crc & 0xff;
  b[0x15f] = (crc >> 8) & 0xff;
  return b;
}
