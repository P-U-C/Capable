// The citizen seal: capable's logo. A round civic seal: an ink-outlined paper
// rim with a beaded edge, the four-candy ring, and a citizen (round head,
// rounded shoulders) cut off by the disc like a coin portrait. A hard ink
// offset shadow sits under it, the same family as the stamp
// (contract/badge-art.mjs) but cleaner: no confetti, no ribbon, no text.
//
// The seal uses no ids at all (no clipPath, no gradient), so any number of
// copies can sit inline on one page.

import { PAPER, INK, CANDIES, SURFACE } from "../palette.mjs";
import { n, svgDoc, polar, arcPath } from "./svg.mjs";

// ---- the seal, drawn around (cx, cy) with outer radius R ----------------------

/**
 * Seal body. Proportions follow the stamp: rim, candy ring, ink rules, disc.
 * `detail` adds the beaded rim and ring separators (dropped at small sizes).
 */
export function sealBody(cx, cy, R, { shadow = true, detail = true, filled = null } = {}) {
  const k = R / 108; // design units: R = 108
  const sw = (x) => n(x * k);
  const o = [];
  if (shadow) o.push(`<circle cx="${n(cx + 8 * k)}" cy="${n(cy + 8 * k)}" r="${n(R)}" fill="${INK}"/>`);
  // rim: paper, ink edge (stroke sits inside R)
  o.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R - 3 * k)}" fill="${PAPER}" stroke="${INK}" stroke-width="${sw(6)}"/>`);
  if (detail) {
    // beads on the rim: a civic edge, like a coin or a passport seal
    const beads = 36;
    const d = [];
    for (let i = 0; i < beads; i++) {
      const [x, y] = polar(cx, cy, 99.5 * k, 90 + (360 * i) / beads);
      d.push(`M${n(x)} ${n(y)}h0`);
    }
    o.push(`<path d="${d.join("")}" stroke="${INK}" stroke-width="${sw(4.2)}" stroke-linecap="round"/>`);
  }
  // the four-candy ring: quarters, boundaries on the diagonals (cyan on top).
  // `filled` (a Set of candy indices) colours only those quarters; the rest
  // print as paper between the ink rules: a ring that fills in as traits are earned.
  const rr = 82 * k;
  for (let i = 0; i < 4; i++) {
    const a0 = 45 + 90 * i;
    const lit = !filled || filled.has(RING_ORDER[i]);
    o.push(`<path d="${arcPath(cx, cy, rr, a0, a0 + 90)}" fill="none" stroke="${lit ? CANDIES[RING_ORDER[i]] : PAPER}" stroke-width="${sw(24)}"/>`);
  }
  if (detail || (filled && filled.size < 4)) {
    const d = [];
    for (let i = 0; i < 4; i++) {
      const a = 45 + 90 * i;
      const [x0, y0] = polar(cx, cy, 70 * k, a);
      const [x1, y1] = polar(cx, cy, 94 * k, a);
      d.push(`M${n(x0)} ${n(y0)}L${n(x1)} ${n(y1)}`);
    }
    o.push(`<path d="${d.join("")}" stroke="${INK}" stroke-width="${sw(4)}"/>`);
  }
  o.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(94 * k)}" fill="none" stroke="${INK}" stroke-width="${sw(4)}"/>`);
  // the disc: paper with a yellow sunburst rising from behind the citizen's head
  const rd = 70 * k;
  const hy = cy - 18 * k;
  o.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(rd)}" fill="${SURFACE}"/>`);
  o.push(`<path d="${sunburst(cx, cy, rd, hy, detail ? 14 : 10)}" fill="${CANDIES[3]}"/>`);
  o.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(rd)}" fill="none" stroke="${INK}" stroke-width="${sw(4.5)}"/>`);
  o.push(citizenBust(cx, cy, rd, k));
  return o.join("");
}

/** Ring order: top cyan, left yellow, bottom lime, right magenta (indices into CANDIES). */
const RING_ORDER = [0, 3, 2, 1];

/** Which ring quarter (index into CANDIES) each founding trait lights (content/app.meta.json). */
export const TRAIT_QUARTER = Object.freeze({ sovereign: 0, civil: 1, mobile: 2, enduring: 3 });

/**
 * `filled` → a Set of candy indices, or null for a full ring. Accepts an array
 * of trait ids; ids without a quarter (a future fifth trait) light nothing.
 */
export function parseFilled(filled) {
  if (filled == null) return null;
  if (!Array.isArray(filled) || filled.some((t) => typeof t !== "string" || t.length > 64)) throw new TypeError("seal: filled must be an array of trait ids");
  return new Set(filled.filter((t) => Object.hasOwn(TRAIT_QUARTER, t)).map((t) => TRAIT_QUARTER[t]));
}

/**
 * Sunburst wedges from (cx, hy) out to the disc edge (centre cx, cy; radius
 * rd). Each wedge ends on the disc's own circle, so no clipPath is needed.
 */
function sunburst(cx, cy, rd, hy, count) {
  const hit = (deg) => {
    // where the ray from (cx, hy) at angle deg meets the disc circle
    const a = (deg * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = -Math.sin(a);
    const oy = hy - cy;
    const b = 2 * oy * dy;
    const c = oy * oy - rd * rd;
    const t = (-b + Math.sqrt(b * b - 4 * c)) / 2;
    return [cx + t * dx, hy + t * dy];
  };
  const step = 360 / count;
  let d = "";
  for (let i = 0; i < count; i++) {
    const a0 = 90 + step / 4 + i * step;
    const [x0, y0] = hit(a0);
    const [x1, y1] = hit(a0 + step / 2);
    d += `M${n(cx)} ${n(hy)}L${n(x0)} ${n(y0)}A${n(rd)} ${n(rd)} 0 0 0 ${n(x1)} ${n(y1)}Z`;
  }
  return d;
}

/**
 * The citizen at the centre: a round paper head over rounded ink shoulders
 * with a paper V collar. The shoulders' base follows the disc's edge (no
 * clipPath needed).
 */
export function citizenBust(cx, cy, rd, k, { headFill = SURFACE, bodyFill = INK, collar = SURFACE, line = 5 } = {}) {
  const w = 46 * k; // half-width where the shoulders meet the disc
  const yb = cy + Math.sqrt(rd * rd - w * w);
  const top = cy + 10 * k; // top of the shoulders
  const sh = `M${n(cx - w)} ${n(yb)}C${n(cx - w)} ${n(top + 12 * k)} ${n(cx - 26 * k)} ${n(top)} ${n(cx)} ${n(top)}C${n(cx + 26 * k)} ${n(top)} ${n(cx + w)} ${n(top + 12 * k)} ${n(cx + w)} ${n(yb)}A${n(rd)} ${n(rd)} 0 0 1 ${n(cx - w)} ${n(yb)}Z`;
  const v = `M${n(cx - 13 * k)} ${n(top + 1 * k)}L${n(cx)} ${n(top + 17 * k)}L${n(cx + 13 * k)} ${n(top + 1 * k)}`;
  return (
    `<path d="${sh}" fill="${bodyFill}" stroke="${INK}" stroke-width="${n(line * k)}" stroke-linejoin="round"/>` +
    (collar ? `<path d="${v}" fill="none" stroke="${collar}" stroke-width="${n(5 * k)}" stroke-linejoin="round" stroke-linecap="round"/>` : "") +
    `<circle cx="${n(cx)}" cy="${n(cy - 18 * k)}" r="${n(21 * k)}" fill="${headFill}" stroke="${INK}" stroke-width="${n(line * k)}"/>`
  );
}

// ---- favicon: ring + head and shoulders, legible at 16 px ------------------------

/**
 * Favicon geometry on a 64-unit grid. Exported so the raster test can sample
 * known points: the ring's four quarters, the head, and the paper disc.
 */
export const FAVICON = {
  view: 64,
  c: 32,
  rim: 32, // ink disc under everything
  ring: [20, 29.5], // candy ring band (inner, outer)
  disc: 19, // paper disc
  head: { cx: 32, cy: 26, r: 7.5 },
  shoulders: { top: 37, w: 13 },
};

export function faviconBody({ rich = true, collar = rich } = {}) {
  const F = FAVICON;
  const o = [];
  o.push(`<circle cx="32" cy="32" r="${F.rim}" fill="${INK}"/>`);
  const mid = (F.ring[0] + F.ring[1]) / 2;
  const wid = F.ring[1] - F.ring[0];
  for (let i = 0; i < 4; i++) {
    const a0 = 45 + 90 * i;
    o.push(`<path d="${arcPath(32, 32, mid, a0, a0 + 90)}" fill="none" stroke="${CANDIES[RING_ORDER[i]]}" stroke-width="${n(wid)}"/>`);
  }
  o.push(`<circle cx="32" cy="32" r="${F.disc}" fill="${SURFACE}"/>`);
  // from 32 px up: the logo's sunburst, a few broad rays
  if (rich) o.push(`<path d="${sunburst(32, 32, F.disc, F.head.cy, 8)}" fill="${CANDIES[3]}"/>`);
  // shoulders: solid ink, base on the disc edge
  const { top, w } = F.shoulders;
  const rd = F.disc;
  const yb = 32 + Math.sqrt(rd * rd - w * w);
  o.push(`<path d="M${n(32 - w)} ${n(yb)}C${n(32 - w)} ${n(top + 3)} ${n(32 - 7)} ${top} 32 ${top}C39 ${top} ${n(32 + w)} ${n(top + 3)} ${n(32 + w)} ${n(yb)}A${rd} ${rd} 0 0 1 ${n(32 - w)} ${n(yb)}Z" fill="${INK}"/>`);
  if (collar) o.push(`<path d="M28 ${top}L32 ${top + 5}L36 ${top}" fill="none" stroke="${SURFACE}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`);
  o.push(`<circle cx="${F.head.cx}" cy="${F.head.cy}" r="${F.head.r}" fill="${INK}"/>`);
  return o.join("");
}

// ---- the wordmark: "capable" in outlined blob letters ------------------------------
//
// Monoline rounded letters on a grid: x-height 24–64, ascender to 2,
// descender to 86. Each glyph is a list of centre-line strokes drawn three
// times: an offset ink shadow, an ink outline (wider), then the candy fill.
// Counters stay open because strokes never fill a bowl's centre.

const W = 11; // candy stroke width
const OUT = 3.5; // ink outline each side
const R = 14.5; // bowl radius (centre line)
const CY = 44; // bowl centre
const bowl = (cx) => `M${n(cx - R)} ${CY}a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0`;
const stem = (x, y0, y1) => `M${x} ${y0}V${y1}`;
const top = CY - R; // 29.5
const base = CY + R; // 58.5

const GLYPHS = {
  c: { w: 2 * R + W, d: [arcPath(R + W / 2, CY, R, 48, 312)] },
  a: { w: 2 * R + W, d: [bowl(R + W / 2), stem(2 * R + W / 2, top, base)] },
  p: { w: 2 * R + W, d: [bowl(R + W / 2), stem(W / 2, top, 80)] },
  b: { w: 2 * R + W, d: [bowl(R + W / 2), stem(W / 2, 8, base)] },
  l: { w: W, d: [stem(W / 2, 8, base)] },
  e: {
    w: 2 * R + W,
    d: [`M${n(W / 2 + 1)} ${CY}H${n(2 * R + W / 2)}` + arcPath(R + W / 2, CY, R, 0, 318).replace(/^M[^A]+/, "")],
  },
};
const WORD = "capable";
const WORD_COLORS = [CANDIES[0], CANDIES[1], CANDIES[2], CANDIES[3], CANDIES[0], CANDIES[1], CANDIES[2]];
const GAP = 5;

/** Width of the wordmark in glyph units. */
export function wordmarkWidth() {
  return [...WORD].reduce((x, ch) => x + GLYPHS[ch].w + GAP, -GAP) + 2 * OUT;
}

/** The wordmark, drawn with its top-left at (x, y), scaled by s. */
export function wordmarkBody(x, y, s, { shadow = 4 } = {}) {
  const parts = { shadow: [], outline: [], fill: [] };
  let gx = OUT;
  [...WORD].forEach((ch, i) => {
    const g = GLYPHS[ch];
    const tr = `translate(${n(gx)} 0)`;
    const d = g.d.join("");
    parts.shadow.push(`<path transform="${tr}" d="${d}"/>`);
    parts.outline.push(`<path transform="${tr}" d="${d}"/>`);
    parts.fill.push(`<path transform="${tr}" d="${d}" stroke="${WORD_COLORS[i]}"/>`);
    gx += g.w + GAP;
  });
  const cap = `fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  return (
    `<g transform="translate(${n(x)} ${n(y)}) scale(${s})">` +
    (shadow ? `<g transform="translate(${shadow} ${shadow})" ${cap} stroke="${INK}" stroke-width="${W + 2 * OUT}">${parts.shadow.join("")}</g>` : "") +
    `<g ${cap} stroke="${INK}" stroke-width="${W + 2 * OUT}">${parts.outline.join("")}</g>` +
    `<g ${cap} stroke-width="${W}">${parts.fill.join("")}</g>` +
    `</g>`
  );
}

// ---- public: seal() and iconSvg() -----------------------------------------------

const TITLE = "capable";
/** Below this rendered size (px) the seal drops its beads and ring rules: optical sizing. */
export const DETAIL_MIN = 96;

/** seal({mode, size, filled}): "logo" | "lockup" | "favicon". `filled` applies to logo and lockup. */
export function seal({ mode = "logo", size, filled } = {}) {
  const lit = parseFilled(filled);
  if (mode === "logo") {
    const s = size ?? 240;
    return svgDoc({ viewBox: "0 0 240 240", width: s, height: s, title: TITLE, body: sealBody(114, 114, 108, { detail: s >= DETAIL_MIN, filled: lit }) });
  }
  if (mode === "favicon") {
    const s = size ?? 32;
    return svgDoc({ viewBox: "0 0 64 64", width: s, height: s, title: TITLE, body: faviconBody({ rich: s > 24, collar: s > 48 }) });
  }
  if (mode === "lockup") {
    // seal (240 tall) + wordmark scaled so its x-height sits on the seal's centre band
    const sc = 1.9;
    const wx = 252;
    const ww = wordmarkWidth() * sc + 4 * sc;
    const vw = Math.ceil(wx + ww + 8);
    const h = size ?? 240;
    const body = sealBody(114, 114, 108, { detail: h >= DETAIL_MIN, filled: lit }) + wordmarkBody(wx, 114 - 44 * sc, sc);
    return svgDoc({ viewBox: `0 0 ${vw} 240`, width: (h * vw) / 240, height: h, title: TITLE, body });
  }
  throw new TypeError(`seal: mode must be "logo", "lockup" or "favicon", got ${JSON.stringify(mode)}`);
}

/**
 * App icons (192, 512, maskable, apple-touch): the seal on a solid paper square.
 * maskable: the whole seal, shadow included, sits inside the central 80% circle
 * (the maskable safe zone), so any mask shape keeps it intact.
 */
export function iconSvg({ size = 512, maskable = false } = {}) {
  if (!Number.isFinite(size) || size <= 0) throw new TypeError("iconSvg: size must be a positive number");
  const V = 512;
  const c = V / 2;
  // the seal's extent from its centre, shadow included: R + 8k·√2 ≈ R·1.105
  const R = maskable ? (0.4 * V) / 1.11 : (0.47 * V) / 1.08;
  const k = R / 108;
  const cx = c - 4 * k; // centre the seal + shadow pair
  const body = `<rect width="${V}" height="${V}" fill="${PAPER}"/>` + (size <= 48 ? faviconAt(c, c, 0.47 * V) : sealBody(cx, cx, R, { detail: size >= DETAIL_MIN }));
  return svgDoc({ viewBox: `0 0 ${V} ${V}`, width: size, height: size, title: TITLE, body });
}

function faviconAt(cx, cy, r) {
  const s = r / 32;
  return `<g transform="translate(${n(cx - 32 * s)} ${n(cy - 32 * s)}) scale(${Math.round(s * 100) / 100})">${faviconBody({ rich: true })}</g>`;
}
