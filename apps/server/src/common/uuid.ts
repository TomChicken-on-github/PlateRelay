import { randomBytes } from "node:crypto";

let lastMs = 0;
let seq = 0;

/**
 * UUID version 7 (RFC 9562): 48-bit Unix milliseconds, then random bits, so
 * keys sort by creation time and index inserts stay at the right edge.
 * Generated here rather than by PostgreSQL, which only has uuidv7() from 18.
 * Within one millisecond a 12-bit counter in rand_a keeps them increasing.
 */
export function uuidv7(now = Date.now()): string {
  if (now > lastMs) {
    lastMs = now;
    seq = randomBytes(2).readUInt16BE() & 0x3ff; // start low so the counter has room
  } else if (++seq > 0xfff) {
    lastMs++;
    seq = 0;
  }
  const b = randomBytes(16);
  b.writeUIntBE(lastMs, 0, 6);
  b[6] = 0x70 | (seq >> 8);
  b[7] = seq & 0xff;
  b[8] = 0x80 | (b[8] & 0x3f);
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
