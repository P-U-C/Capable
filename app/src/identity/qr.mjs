// A small QR code encoder with no dependencies, so the sign-in sheet can show
// its link as a QR code without loading a library. Byte mode (UTF-8), error
// correction level M, versions 1–40, mask chosen by the standard penalty rules
// (ISO/IEC 18004 §7.8.3). Output is a plain SVG string: ink on paper with a
// four-module quiet zone. Only numbers and fixed strings reach the SVG; the
// encoded text never appears in it.

const INK = "#161616";
const PAPER = "#F7F4EA";
const QUIET = 4;

// Level M only. Index = version (0 unused).
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
const FORMAT_ECL_M = 0; // format-information bits for level M

/** Modules available for data and error correction in a version. */
function rawModules(ver) {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}

/** Data codewords (bytes) a version holds at level M. */
export const dataCapacity = (ver) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * BLOCKS[ver];

/** Bytes of text a version holds in byte mode at level M. */
export const byteCapacity = (ver) => Math.floor((dataCapacity(ver) * 8 - 4 - (ver < 10 ? 8 : 16)) / 8);

function alignmentCentres(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const out = [6];
  for (let pos = ver * 4 + 10; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

// ---- Reed–Solomon over GF(256), polynomial 0x11D ----

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree) {
  const out = new Array(degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < out.length; j++) {
      out[j] = gfMul(out[j], root);
      if (j + 1 < out.length) out[j] ^= out[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return out;
}

function rsRemainder(data, divisor) {
  const out = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ out.shift();
    out.push(0);
    for (let i = 0; i < divisor.length; i++) out[i] ^= gfMul(divisor[i], factor);
  }
  return out;
}

// ---- encoding ----

function utf8(text) {
  return new TextEncoder().encode(String(text));
}

function dataCodewords(bytes, ver) {
  const bits = [];
  const put = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(0b0100, 4); // byte mode
  put(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capBits = dataCapacity(ver) * 8;
  put(0, Math.min(4, capBits - bits.length)); // terminator
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) put(pad, 8);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return out;
}

function interleave(data, ver) {
  const nBlocks = BLOCKS[ver];
  const eccLen = ECC_PER_BLOCK[ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const nShort = nBlocks - (raw % nBlocks);
  const shortLen = Math.floor(raw / nBlocks);
  const divisor = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < nShort) dat.push(0); // placeholder so every block has the same length
    blocks.push(dat.concat(ecc));
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++)
    for (let j = 0; j < blocks.length; j++) if (i !== shortLen - eccLen || j >= nShort) out.push(blocks[j][i]);
  return out;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class Grid {
  constructor(ver) {
    this.ver = ver;
    this.size = ver * 4 + 17;
    this.m = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this.fn = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
  }
  setFn(x, y, dark) {
    this.m[y][x] = dark;
    this.fn[y][x] = true;
  }
  drawFunctionPatterns() {
    const s = this.size;
    for (let i = 0; i < s; i++) {
      this.setFn(6, i, i % 2 === 0);
      this.setFn(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(s - 4, 3);
    this.finder(3, s - 4);
    const al = alignmentCentres(this.ver);
    const n = al.length;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) if (!((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0))) this.alignment(al[i], al[j]);
    this.drawFormat(0); // reserve; redrawn with the real mask later
    this.drawVersion();
  }
  finder(cx, cy) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) this.setFn(x, y, d !== 2 && d !== 4);
      }
  }
  alignment(cx, cy) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  drawFormat(mask) {
    const data = (FORMAT_ECL_M << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i) => ((bits >>> i) & 1) !== 0;
    const s = this.size;
    for (let i = 0; i <= 5; i++) this.setFn(8, i, bit(i));
    this.setFn(8, 7, bit(6));
    this.setFn(8, 8, bit(7));
    this.setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.setFn(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.setFn(s - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.setFn(8, s - 15 + i, bit(i));
    this.setFn(8, s - 8, true); // the dark module
  }
  drawVersion() {
    if (this.ver < 7) return;
    let rem = this.ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFn(a, b, dark);
      this.setFn(b, a, dark);
    }
  }
  drawCodewords(cw) {
    const s = this.size;
    let i = 0;
    for (let right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < s; v++)
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const up = ((right + 1) & 2) === 0;
          const y = up ? s - 1 - v : v;
          if (!this.fn[y][x] && i < cw.length * 8) {
            this.m[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
    }
  }
  applyMask(mask) {
    const f = MASKS[mask];
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) if (!this.fn[y][x] && f(x, y)) this.m[y][x] = !this.m[y][x];
  }
  penalty() {
    const s = this.size;
    const m = this.m;
    let score = 0;
    const line = (get) => {
      let color = false;
      let run = 0;
      const hist = [0, 0, 0, 0, 0, 0, 0];
      const add = (len) => {
        if (hist[0] === 0) len += s; // light border before the line
        hist.pop();
        hist.unshift(len);
      };
      const count = () => {
        const n = hist[1];
        const core = n > 0 && hist[2] === n && hist[3] === n * 3 && hist[4] === n && hist[5] === n;
        return (core && hist[0] >= n * 4 && hist[6] >= n ? 1 : 0) + (core && hist[6] >= n * 4 && hist[0] >= n ? 1 : 0);
      };
      for (let i = 0; i < s; i++) {
        if (get(i) === color) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score++;
        } else {
          add(run);
          if (!color) score += count() * 40;
          color = get(i);
          run = 1;
        }
      }
      if (color) {
        add(run);
        run = 0;
      }
      add(run + s); // light border after the line
      score += count() * 40;
    };
    for (let y = 0; y < s; y++) line((x) => m[y][x]);
    for (let x = 0; x < s; x++) line((y) => m[y][x]);
    for (let y = 0; y < s - 1; y++)
      for (let x = 0; x < s - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
      }
    let dark = 0;
    for (const row of m) for (const c of row) if (c) dark++;
    const total = s * s;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
  }
}

/**
 * The QR matrix for `text`: { version, size, mask, modules } where
 * modules[y][x] is true for a dark module. `opts.mask` forces a mask (tests).
 */
export function qrMatrix(text, opts = {}) {
  const bytes = utf8(text);
  let ver = 1;
  while (ver <= 40 && byteCapacity(ver) < bytes.length) ver++;
  if (ver > 40) throw new RangeError(`qr: ${bytes.length} bytes is more than a QR code holds`);
  const g = new Grid(ver);
  g.drawFunctionPatterns();
  g.drawCodewords(interleave(dataCodewords(bytes, ver), ver));
  let mask = opts.mask;
  if (!(Number.isInteger(mask) && mask >= 0 && mask < 8)) {
    let best = Infinity;
    for (let k = 0; k < 8; k++) {
      g.applyMask(k);
      g.drawFormat(k);
      const p = g.penalty();
      if (p < best) {
        best = p;
        mask = k;
      }
      g.applyMask(k); // XOR undoes it
    }
  }
  g.applyMask(mask);
  g.drawFormat(mask);
  return { version: ver, size: g.size, mask, modules: g.m.map((r) => r.slice()) };
}

/**
 * The QR code for `text` as an SVG string: ink #161616 on paper #F7F4EA, a
 * four-module quiet zone, byte mode, level M. Size it with CSS; `opts.px`
 * sets width and height attributes.
 */
export function qrSvg(text, opts = {}) {
  const { size, modules } = qrMatrix(text);
  const n = size + QUIET * 2;
  let d = "";
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; ) {
      if (!modules[y][x]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < size && modules[y][x + run]) run++;
      d += `M${x + QUIET} ${y + QUIET}h${run}v1h-${run}z`;
      x += run;
    }
  const px = Number.isInteger(opts.px) && opts.px > 0 && opts.px <= 4096 ? ` width="${opts.px}" height="${opts.px}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}"${px} shape-rendering="crispEdges" aria-hidden="true" focusable="false"><rect width="${n}" height="${n}" fill="${PAPER}"/><path fill="${INK}" d="${d}"/></svg>`;
}

/** The same QR code as a data: URL, for an <img> (img-src already allows data:). */
export const qrDataUrl = (text, opts) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(text, opts))}`;
