// Writes Phaser's three built-in textures as PNGs so the webview CSP needs no `img-src data:` (spec §13).
// Run once with `node scripts/make-default-textures.mjs`; the output is committed.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const png = (w, h, pixel) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    for (let x = 0; x < w; x++) raw.set(pixel(x, y), y * (1 + w * 4) + 1 + x * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const out = new URL('../public/textures/', import.meta.url);
writeFileSync(
  new URL('default.png', out),
  png(32, 32, () => [0, 0, 0, 0]),
);
writeFileSync(
  new URL('missing.png', out),
  png(32, 32, (x, y) => (((x >> 3) + (y >> 3)) % 2 === 0 ? [255, 0, 255, 255] : [0, 0, 0, 255])),
);
writeFileSync(
  new URL('white.png', out),
  png(4, 4, () => [255, 255, 255, 255]),
);
