// The sign-in QR code (app/src/identity/qr.mjs): byte mode, level M, ink
// #161616 on paper #F7F4EA with a four-module quiet zone. Checked two ways:
// against reference matrices from an independent encoder (python-qrcode 8,
// forced mask), and by decoding our own output with the small decoder below,
// which derives the layout from the standard's tables, checks both copies of
// the format information, the Reed-Solomon syndromes of every block, and reads
// the text back. (zxing-cpp decoded 52 more strings, v3-v40, during the build
// of this file; see docs/IDENTITY.md.)
import test from "node:test";
import assert from "node:assert/strict";
import { qrMatrix, qrSvg, qrDataUrl, byteCapacity } from "../src/identity/qr.mjs";
import * as identity from "../src/identity/index.mjs";

// ---- references: python-qrcode, error M, byte mode, border 0, forced mask ----
const REFS = [
  { text: "https://p-u-c.github.io/Capable/", mask: 2, version: 3, b64: "/hd7/BH+UG67QLt1NuXbqx+uwWQhB/qqr+AaUwC+aJPi73m8c7X5YGIaJq+wtEZ01N9E2CCvjQZR8n8QSWfmeP1guehpW7lGKKMl+4BIFH/5BuuQW3MSuslPtdS1A+623b0Em32v6eUOAA==" },
  { text: "https://farcaster.xyz/~/siwf?channelToken=210f1718-427e-46a4-99e3-2207f21f83ec", mask: 2, version: 5, b64: "/g//i/wRFkWQbr4N6rt1PYTl26oj0q7BWUAJB/qqqq/gFROnAL4F2VvhQRmdIq2t4RXWqRoMMxPtvT3vqqQfxIs/RbL/NiyQoHMWuCnaqkHPviC75QCenoqFfz2X4WAm6k4mbrYpTb8I7z8H/OYwymOTU6yHGe8iJ81ihsdB8kgwiiX0D/sAUl/8a/nGqiqwUIK1G7qyKd+11n6bdG6okIQPBH0tfZ/oxDZLgA==" },
  { text: "x".repeat(150), mask: 2, version: 8, b64: "/h+w1gi/wQkNPlHQbrBjynxrt1YesGul26zuf2DC7BXJkeUxB/qqqqqq/gEbxFPnAL40O+NYvla0S2sGM5asAR8p032Y9SU+cx84Ojg1iyTKgvawYzqJKrHynTcKDDJT5zEmv1uDWLJAjStrBjOowTkfKdNwHUUlPnMd9CW4NYsnqQq2sGM4/lef8p/2EQicU+cRStk+o1mqNFQZGwZHm+7Y/ym/fAWJTT5ZFLsYUjWRpScCLLBpuszVC3KblusuVNPlkFJwvSNZG95UissGm4ykMLcpuXUnAU0+WR76OdI1kabLqaywabkehgtym5bjW9TT5ZHi43/jWfoAResbBse/kymvKetwWh3FPnEbque+NY+l1ymZsGT+6m+ecpjRBGoZk+bB/q14Y1nLgA==" },
  { text: "héllo wörld ✓", mask: 6, version: 2, b64: "/qu/wUhQbrQrt0EF26gy7BPNB/qq/gCZAJ+sS4j2YCrJDF+VuMwn298uPje4cr1z4T2no/8AT0a/pCuwUVG7rP/N1heu6alvBMQH/ub8gA==" },
];

const unpack = (b64, size) => {
  const bytes = Buffer.from(b64, "base64");
  return Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => ((bytes[(y * size + x) >> 3] >> (7 - ((y * size + x) & 7))) & 1) === 1));
};

test("matches an independent encoder bit for bit (v2, v3, v5, v8 with version info; UTF-8)", () => {
  for (const r of REFS) {
    const q = qrMatrix(r.text, { mask: r.mask });
    assert.equal(q.version, r.version, r.text.slice(0, 30));
    assert.deepEqual(q.modules, unpack(r.b64, q.size), r.text.slice(0, 30));
  }
});

// ---- an independent decoder (no error correction: a valid code needs none) ----

// Standard tables, ISO/IEC 18004 Table 9 and Annex E (level M), versions 1-15.
const TOTAL = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655];
const EC_M = [null, [10, 1], [16, 1], [26, 1], [18, 2], [24, 2], [16, 4], [18, 4], [22, 4], [22, 5], [26, 5], [30, 5], [22, 8], [22, 9], [24, 9], [24, 10]];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70]];

const EXP = new Array(512);
const LOG = new Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function bch15(data5) {
  let v = data5 << 10;
  for (let i = 14; i >= 10; i--) if (v & (1 << i)) v ^= 0x537 << (i - 10);
  return ((data5 << 10) | v) ^ 0x5412;
}

export function decode(m) {
  const size = m.length;
  const ver = (size - 17) / 4;
  assert.ok(Number.isInteger(ver) && ver >= 1 && ver <= 15, `size ${size}`);
  const isFn = (x, y) => {
    if ((x < 9 && y < 9) || (x >= size - 8 && y < 9) || (x < 9 && y >= size - 8)) return true;
    if (x === 6 || y === 6) return true;
    if (ver >= 7 && ((x >= size - 11 && x < size - 8 && y < 6) || (y >= size - 11 && y < size - 8 && x < 6))) return true;
    const al = ALIGN[ver];
    for (const cy of al)
      for (const cx of al) {
        const corner = (cx === 6 && cy === 6) || (cx === 6 && cy === al.at(-1)) || (cx === al.at(-1) && cy === 6);
        if (!corner && Math.abs(x - cx) <= 2 && Math.abs(y - cy) <= 2) return true;
      }
    return false;
  };
  // finder patterns and timing
  for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]])
    for (let dy = 0; dy < 7; dy++)
      for (let dx = 0; dx < 7; dx++) {
        const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        assert.equal(m[oy + dy][ox + dx], d !== 2, `finder at ${ox},${oy}`);
      }
  for (let i = 8; i < size - 8; i++) assert.equal(m[6][i], i % 2 === 0, "timing row");
  assert.equal(m[size - 8][8], true, "dark module");
  // format information, both copies, BCH-valid
  const a = [];
  for (let i = 0; i <= 5; i++) a.push(m[i][8]);
  a.push(m[7][8], m[8][8], m[8][7]);
  for (let i = 9; i < 15; i++) a.push(m[8][14 - i]);
  const b = [];
  for (let i = 0; i < 8; i++) b.push(m[8][size - 1 - i]);
  for (let i = 8; i < 15; i++) b.push(m[size - 15 + i][8]);
  const fmtA = a.reduce((v, bit, i) => v | ((bit ? 1 : 0) << i), 0);
  const fmtB = b.reduce((v, bit, i) => v | ((bit ? 1 : 0) << i), 0);
  assert.equal(fmtA, fmtB, "format copies agree");
  const data5 = (fmtA ^ 0x5412) >> 10;
  assert.equal(bch15(data5), fmtA, "format BCH");
  assert.equal(data5 >> 3, 0, "level M");
  const mask = data5 & 7;
  const masks = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0, (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];
  // codewords in placement order
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const up = ((size - 1 - right) >> 1) % 2 === 0;
    for (let i = 0; i < size; i++) {
      const y = up ? size - 1 - i : i;
      for (const x of [right, right - 1]) if (!isFn(x, y)) bits.push(m[y][x] !== masks[mask](x, y) ? 1 : 0);
    }
  }
  const cw = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) cw.push(bits.slice(i, i + 8).reduce((v, x) => (v << 1) | x, 0));
  assert.equal(cw.length, TOTAL[ver], "codeword count");
  // de-interleave and check every block's syndromes
  const [ecc, nBlocks] = EC_M[ver];
  const nLong = TOTAL[ver] % nBlocks;
  const shortData = Math.floor(TOTAL[ver] / nBlocks) - ecc;
  const lens = Array.from({ length: nBlocks }, (_, j) => shortData + (j >= nBlocks - nLong ? 1 : 0));
  const blocks = lens.map(() => []);
  let k = 0;
  for (let i = 0; i < shortData + 1; i++) for (let j = 0; j < nBlocks; j++) if (i < lens[j]) blocks[j].push(cw[k++]);
  for (let i = 0; i < ecc; i++) for (let j = 0; j < nBlocks; j++) blocks[j].push(cw[k++]);
  for (const blk of blocks)
    for (let s = 0; s < ecc; s++) {
      let acc = 0;
      for (const c of blk) acc = mul(acc, EXP[s]) ^ c;
      assert.equal(acc, 0, `syndrome ${s}`);
    }
  // the data: byte mode, count, bytes, terminator
  const data = blocks.flatMap((blk, j) => blk.slice(0, lens[j]));
  const dbits = data.flatMap((byte) => [7, 6, 5, 4, 3, 2, 1, 0].map((i) => (byte >> i) & 1));
  let p = 0;
  const read = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | dbits[p++];
    return v;
  };
  assert.equal(read(4), 0b0100, "byte mode");
  const count = read(ver < 10 ? 8 : 16);
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) out[i] = read(8);
  assert.equal(read(Math.min(4, dbits.length - p)), 0, "terminator");
  return { text: new TextDecoder("utf-8", { fatal: true }).decode(out), version: ver, mask };
}

/** Parse our own SVG back into a module grid, checking the quiet zone. */
function svgModules(svg) {
  const n = Number(svg.match(/viewBox="0 0 (\d+) \1"/)[1]);
  const grid = Array.from({ length: n }, () => new Array(n).fill(false));
  const d = svg.match(/<path fill="#161616" d="([^"]*)"\/>/)[1];
  const parts = [...d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)];
  assert.equal(parts.map((x) => x[0]).join(""), d, "path is only module runs");
  for (const [, x, y, run, back] of parts) {
    assert.equal(run, back);
    for (let i = 0; i < Number(run); i++) {
      assert.equal(grid[y][Number(x) + i], false, "no overlapping runs");
      grid[y][Number(x) + i] = true;
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) assert.ok(!grid[j][i] && !grid[n - 1 - j][i] && !grid[i][j] && !grid[i][n - 1 - j], "quiet zone of 4");
  return grid.slice(4, n - 4).map((r) => r.slice(4, n - 4));
}

const SAMPLES = [
  "",
  "a",
  "https://farcaster.xyz/~/siwf?channelToken=210f1718-427e-46a4-99e3-2207f21f83ec",
  "https://p-u-c.github.io/Capable/#/passport",
  "héllo wörld ✓ 漢字 🙂",
  "farcaster://connect?channelToken=76be6229-bdf7-4ad2-930a-540fb2de1e08&nonce=ESsxs6MaFio7OvqWb&siweUri=https%3A%2F%2Fp-u-c.github.io%2FCapable%2F&domain=p-u-c.github.io",
  "https://example.com/" + "a".repeat(230), // ~250 characters: version 11
  "z".repeat(400),
];

test("decodes back to the text: qrMatrix, every mask, and the SVG as drawn", () => {
  for (const text of SAMPLES) {
    const q = qrMatrix(text);
    assert.deepEqual(decode(q.modules), { text, version: q.version, mask: q.mask }, text.slice(0, 30));
    for (let mask = 0; mask < 8; mask++) assert.equal(decode(qrMatrix(text, { mask }).modules).text, text, `mask ${mask}`);
    assert.equal(decode(svgModules(qrSvg(text))).text, text, `svg: ${text.slice(0, 30)}`);
  }
  for (let n = 0; n <= 300; n += 13) {
    const text = "https://farcaster.xyz/~/siwf?channelToken=" + "0123456789abcdef-".repeat(20).slice(0, n);
    assert.equal(decode(qrMatrix(text).modules).text, text, `length ${text.length}`);
  }
});

test("picks the smallest version: ~80-char deep link → v5, 250-char URL → v11", () => {
  assert.equal(qrMatrix(SAMPLES[2]).version, 5);
  assert.equal(qrMatrix(SAMPLES[6]).version, 11);
  assert.equal(byteCapacity(10), 213);
  assert.equal(byteCapacity(11), 251);
  assert.equal(byteCapacity(40), 2331);
  assert.equal(qrMatrix("w".repeat(2331)).version, 40);
  assert.throws(() => qrMatrix("w".repeat(2332)), RangeError);
});

test("the SVG: ink on paper, quiet zone, no text from the input, deterministic, small", () => {
  const url = "https://farcaster.xyz/~/siwf?channelToken=\"><script>alert(1)</script>";
  const svg = qrSvg(url);
  assert.equal(svg, qrSvg(url), "same input → same bytes");
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (\d+) \1" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><rect width="\1" height="\1" fill="#F7F4EA"\/><path fill="#161616" d="[Mhvz0-9 -]+"\/><\/svg>$/);
  assert.ok(!svg.includes("script") && !svg.includes("farcaster"), "the encoded text never appears");
  const n = Number(svg.match(/viewBox="0 0 (\d+)/)[1]);
  assert.equal(n, qrMatrix(url).size + 8);
  assert.ok(qrSvg(SAMPLES[2]).length < 8 * 1024, `${qrSvg(SAMPLES[2]).length} bytes for a deep link`);
  assert.match(qrSvg("a", { px: 240 }), / width="240" height="240" /);
  assert.doesNotMatch(qrSvg("a", { px: '1" onload="x' }), /onload/);
  assert.match(qrDataUrl("a"), /^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  assert.equal(identity.qrSvg, qrSvg, "exported from the identity module");
});

test("the decoder is not vacuous: one flipped data module or a wrong format fails it", () => {
  const q = qrMatrix(SAMPLES[2]);
  const flipped = q.modules.map((r) => r.slice());
  flipped[20][20] = !flipped[20][20]; // a data module in a v5 symbol
  assert.throws(() => decode(flipped), /syndrome/);
  const badFormat = q.modules.map((r) => r.slice());
  badFormat[8][0] = !badFormat[8][0];
  assert.throws(() => decode(badFormat), /format/);
});
