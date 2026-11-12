// Build-time icons, rendered in plain Node (no image libraries): four candy
// discs with ink outlines and hard ink shadows on the off-white base, the
// app's sticker language in a square. PNG encoding uses node:zlib.

import { deflateSync } from "node:zlib";

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG = hex("#f7f4ea");
const INK = hex("#161616");
const CANDY = ["#18c8f0", "#ff1fc8", "#5cf27e", "#ffe11a"].map(hex);

/**
 * RGBA pixels for a size×size icon. `maskable` keeps the mark inside the
 * central safe zone (a circle of 40% radius) that launchers may crop to.
 */
export function renderIcon(size, { maskable = false } = {}) {
  const S = 3; // supersampling per axis
  const px = new Uint8Array(size * size * 4);
  const scale = maskable ? 0.26 : 0.36; // cluster half-width as a fraction of size
  const c = size / 2;
  const r = size * scale * 0.47; // disc radius
  const gap = size * scale * 0.53; // centre offset from the middle
  const line = Math.max(2, size * 0.022);
  const sh = Math.max(2, size * 0.03);
  const discs = [
    [c - gap, c - gap, CANDY[0]],
    [c + gap, c - gap, CANDY[1]],
    [c - gap, c + gap, CANDY[2]],
    [c + gap, c + gap, CANDY[3]],
  ];
  const sample = (x, y) => {
    let col = BG;
    for (const [dx, dy, fill] of discs) {
      const ds = Math.hypot(x - dx - sh, y - dy - sh);
      if (ds <= r + line) col = INK; // hard shadow
      const d = Math.hypot(x - dx, y - dy);
      if (d <= r + line) col = d <= r ? fill : INK;
    }
    return col;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let R = 0;
      let G = 0;
      let B = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const [a, b, d] = sample(x + (sx + 0.5) / S, y + (sy + 0.5) / S);
          R += a;
          G += b;
          B += d;
        }
      const i = (y * size + x) * 4;
      px[i] = Math.round(R / (S * S));
      px[i + 1] = Math.round(G / (S * S));
      px[i + 2] = Math.round(B / (S * S));
      px[i + 3] = 255;
    }
  return px;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Encode RGBA pixels as a PNG (Paeth filter on every row). */
export function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 4;
    for (let x = 0; x < stride; x++) {
      const cur = rgba[y * stride + x];
      const left = x >= 4 ? rgba[y * stride + x - 4] : 0;
      const up = y > 0 ? rgba[(y - 1) * stride + x] : 0;
      const ul = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4] : 0;
      raw[y * (stride + 1) + 1 + x] = (cur - paeth(left, up, ul)) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** Every icon the manifest and index.html reference: [file, size, maskable]. */
export const ICONS = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, false],
  ["favicon-32.png", 32, false],
];

export function iconFiles() {
  return ICONS.map(([file, size, maskable]) => [file, encodePng(size, size, renderIcon(size, { maskable }))]);
}
