// Generates static/icon.png (128x128) without external dependencies: three stacked, offset bars.
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const W = 128;
const H = 128;
const px = Buffer.alloc(W * H * 4, 0);

function rect(x, y, w, h, [r, g, b], radius = 8) {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      const dx = Math.max(x + radius - i, 0, i - (x + w - 1 - radius));
      const dy = Math.max(y + radius - j, 0, j - (y + h - 1 - radius));
      if (dx * dx + dy * dy > radius * radius) continue;
      const o = (j * W + i) * 4;
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = 255;
    }
  }
}

rect(0, 0, W, H, [0, 120, 212], 22);
rect(24, 28, 80, 20, [255, 255, 255]);
rect(34, 54, 70, 20, [200, 226, 247]);
rect(44, 80, 60, 20, [140, 190, 235]);

const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 6;

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0))
]);
const out = path.join(__dirname, "..", "static", "icon.png");
fs.writeFileSync(out, png);
console.log("wrote", out, png.length, "bytes");
