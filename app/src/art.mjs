// Visual decisions that need code (docs/DESIGN-APP.md): the candy colour for
// each trait, the blob-letter "capable" logo, seeded pixel confetti, and the
// two-tone screenprint scenes per lesson. Fixed tokens (bg, ink, type, radii,
// outlines, shadows) live in src/tokens.css. A restyle touches these two files.
//
// Everything here is pure and returns escaped SafeHtml or plain data, so it is
// tested in Node and safe to inline. Colours reach markup only as hex strings
// computed here; ids are sanitised.

import { html, join, num, empty } from "./html.mjs";

// ---- colour ---------------------------------------------------------------

/** Neutrals. Kept equal to --bg / --ink / --surface / --slate in tokens.css (tested). */
export const BG = "#f7f4ea";
export const INK = "#161616";
export const SURFACE = "#fffdf6";
export const SLATE = "#5b6488";
export const CONFETTI = ["#e4ddf7", "#f7d9ef", "#ddebfa"];

/** The four candies. Trait hues near an anchor take its exact colour. */
export const CANDY = [
  { hue: 195, hex: "#18c8f0" }, // cyan: sovereign
  { hue: 312, hex: "#ff1fc8" }, // magenta: civil
  { hue: 135, hex: "#5cf27e" }, // lime: mobile
  { hue: 52, hex: "#ffe11a" }, // yellow: enduring
];
export const MAGENTA = "#ff1fc8";
export const MAGENTA_HERO = "#ff2bb0";

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hslHueToRgb(h) {
  const k = (n) => (n + h / 30) % 12;
  const f = (n) => 0.5 - 0.5 * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

function toOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

const inGamut = (rgb) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);
const toHex = (rgb) => "#" + rgb.map((c) => Math.round(Math.min(1, Math.max(0, linearToSrgb(c))) * 255).toString(16).padStart(2, "0")).join("");

/** oklch → sRGB hex, reducing chroma until the colour fits. */
export function oklch(L, C, H) {
  const h = (H * Math.PI) / 180;
  const at = (c) => fromOklab([L, c * Math.cos(h), c * Math.sin(h)]);
  if (inGamut(at(C))) return toHex(at(C));
  let lo = 0;
  let hi = C;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(at(mid))) lo = mid;
    else hi = mid;
  }
  return toHex(at(lo));
}

/** The OKLCH hue matching an HSL-style hue angle. */
export function okHue(hslHue) {
  const [, a, b] = toOklab(hslHueToRgb(((hslHue % 360) + 360) % 360).map(srgbToLinear));
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
}

const hueDist = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/**
 * A trait's candy colour. The four anchors are exact; any other hue gets a
 * bright, high-chroma colour light enough for ink text, like a candy.
 */
export function traitColor(hue) {
  const h = ((Number(hue) % 360) + 360) % 360;
  const anchor = CANDY.find((c) => hueDist(c.hue, h) <= 6);
  if (anchor) return anchor.hex;
  return oklch(0.84, 0.2, okHue(h));
}

/** A darker shade of a colour, for overlaps in the logo and shadows in scenes. */
export function shade(hex, dl = 0.12) {
  const n = parseInt(hex.slice(1), 16);
  const [L, a, b] = toOklab([(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => srgbToLinear(c / 255)));
  const C = Math.hypot(a, b);
  const H = (Math.atan2(b, a) * 180) / Math.PI;
  return oklch(Math.max(0, L - dl), C, H);
}

/** CSS custom properties for an element showing a trait (applied with CSSOM: CSP-safe). */
export const traitVars = (hue) => ({ "--trait": traitColor(hue), "--trait-deep": shade(traitColor(hue), 0.14) });

/** WCAG 2 contrast ratio between two hex colours. */
export function contrast(a, b) {
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, bl] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => srgbToLinear(c / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// ---- seeds ----------------------------------------------------------------

/** FNV-1a: a stable 32-bit seed from any string. */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: deterministic numbers in [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An id safe inside attributes and url(#…). */
export const uidOf = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 48) || "x";

// ---- pixel confetti ---------------------------------------------------------

/**
 * Seeded confetti: n squares placed only inside the given free zones
 * (fractions of the box: {x, y, w, h}), so they never land on text.
 */
export function confetti(seed, zones, n = 8) {
  const r = rng(hash32(`confetti|${seed}`));
  const out = [];
  if (!zones.length) return out;
  for (let i = 0; i < n; i++) {
    const z = zones[Math.floor(r() * zones.length)];
    out.push({
      x: Math.round((z.x + r() * z.w) * 1000) / 10,
      y: Math.round((z.y + r() * z.h) * 1000) / 10,
      size: 6 + Math.floor(r() * 4) * 2,
      color: CONFETTI[Math.floor(r() * CONFETTI.length)],
    });
  }
  return out;
}

/** Confetti as an absolutely-positioned SVG layer (no style attributes: CSP-safe). */
export function confettiSvg(seed, zones, n = 8) {
  const bits = confetti(seed, zones, n);
  // A 1000×1000 box stretched over the parent; squares use a fixed-size inner
  // <svg> so they stay square whatever the parent's aspect.
  return html`<svg class="confetti" aria-hidden="true" focusable="false" preserveAspectRatio="none">${join(
    bits.map((b) => html`<svg x="${b.x}%" y="${b.y}%" width="${b.size}" height="${b.size}" overflow="visible"><rect width="${b.size}" height="${b.size}" fill="${b.color}"/></svg>`),
  )}</svg>`;
}

// ---- the logo -----------------------------------------------------------------

const LETTERS = "capable";
const LOGO_COLORS = ["#18c8f0", "#ff1fc8", "#5cf27e", "#ffe11a", "#18c8f0", "#ff1fc8", "#5cf27e"];

// Each letter is built from circles and rounded rectangles on a 0–84 grid
// (x-height 24–64). Shapes: ["c", cx, cy, r] | ["r", x, y, w, h, rx] |
// ["arc", cx, cy, r, from°, to°, width] (counter-clockwise). Holes are counters.
const GLYPHS = {
  c: { w: 42, shapes: [["arc", 21, 44, 13, 42, 318, 16]] },
  a: { w: 46, shapes: [["c", 20, 44, 20], ["r", 26, 24, 18, 40, 9]], holes: [["c", 19, 44, 6.5]] },
  p: { w: 46, shapes: [["r", 0, 24, 18, 60, 9], ["c", 25, 44, 20]], holes: [["c", 26, 44, 6.5]] },
  b: { w: 46, shapes: [["r", 0, 2, 18, 62, 9], ["c", 25, 44, 20]], holes: [["c", 26, 44, 6.5]] },
  l: { w: 20, shapes: [["r", 1, 2, 18, 62, 9]] },
  // e's slot opens through the edge; `clip` keeps its outline inside the letter's
  e: { w: 42, shapes: [["c", 21, 44, 20]], holes: [["c", 21, 37.5, 6], ["r", 21, 46.5, 24, 6.5, 3.25]], clip: ["c", 21, 44, 23.6] },
};

const deg = (d) => (d * Math.PI) / 180;
function shapePath(s) {
  if (s[0] === "c") {
    const [, cx, cy, r] = s;
    return `M${num(cx - r)} ${num(cy)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
  }
  if (s[0] === "r") {
    const [, x, y, w, h, rx] = s;
    return `M${num(x + rx)} ${num(y)}h${num(w - 2 * rx)}a${rx} ${rx} 0 0 1 ${rx} ${rx}v${num(h - 2 * rx)}a${rx} ${rx} 0 0 1 ${-rx} ${rx}h${num(-(w - 2 * rx))}a${rx} ${rx} 0 0 1 ${-rx} ${-rx}v${num(-(h - 2 * rx))}a${rx} ${rx} 0 0 1 ${rx} ${-rx}Z`;
  }
  const [, cx, cy, r, from, to] = s;
  const p = (a) => `${num(cx + r * Math.cos(deg(a)))} ${num(cy - r * Math.sin(deg(a)))}`;
  return `M${p(from)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 0 ${p(to)}`;
}

/**
 * The blob-letter logo. `filled` letters are in candy colours; the rest are
 * ink outlines waiting to fill (the trait card fills them as lessons finish).
 * `paper` is the colour behind the logo, used for the letters' counters.
 */
export function logoSvg({ filled = LETTERS.length, outline = false, title = "capable", cls = "logo", paper = BG, uid = "logo" } = {}) {
  const u = uidOf(uid);
  const defs = [];
  let x = 0;
  const parts = [];
  [...LETTERS].forEach((ch, i) => {
    const g = GLYPHS[ch];
    const on = i < filled;
    const color = on ? LOGO_COLORS[i] : paper;
    const draw = (s, fill, extra = 0) =>
      s[0] === "arc"
        ? html`<path d="${shapePath(s)}" fill="none" stroke="${fill}" stroke-width="${s[6] + extra}" stroke-linecap="round"/>`
        : extra
          ? html`<path d="${shapePath(s)}" fill="${fill}" stroke="${fill}" stroke-width="${extra}" stroke-linejoin="round"/>`
          : html`<path d="${shapePath(s)}" fill="${fill}"/>`;
    const body = [];
    const ring = outline || !on;
    if (ring) for (const s of g.shapes) body.push(draw(s, INK, 7));
    for (const s of g.shapes) body.push(draw(s, color));
    const holes = [];
    for (const h of g.holes || []) {
      if (ring) holes.push(draw(h, INK, 7));
      holes.push(draw(h, paper));
    }
    if (g.clip && ring) {
      defs.push(html`<clipPath id="lc-${u}-${i}"><path d="${shapePath(g.clip)}"/></clipPath>`);
      body.push(html`<g clip-path="url(#lc-${u}-${i})">${join(holes)}</g>`);
    } else body.push(...holes);
    parts.push(html`<g transform="translate(${x} 0)">${join(body)}</g>`);
    x += g.w + 6;
  });
  const w = x - 6 + 8;
  return html`<svg class="${cls}" viewBox="-4 -2 ${w} 92" role="img" aria-label="${title}" focusable="false">${defs.length ? html`<defs>${join(defs)}</defs>` : empty}${join(parts)}</svg>`;
}

// ---- screenprint scenes ---------------------------------------------------------
//
// Each scene is drawn inside a 320×240 safe box and bleeds far past it (sky,
// walls, ground), so `meet` scaling shows the whole subject in any frame shape,
// from a wide tile to a 9:16 poster, with the bleed filling the rest. Grain is
// not drawn here: frames carry a tiled grain overlay (--grain in tokens.css),
// which is far cheaper than a full-size SVG filter per scene.

const W = 320;
const H = 240;
const LINE = { stroke: INK, sw: 2.6 };
const BLEED = { x: -480, y: -720, w: 1280, h: 1680 };

/** Halftone patterns, unique per scene instance. */
function defs(uid) {
  return html`<defs>
<pattern id="ht-${uid}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(28)"><circle cx="3" cy="3" r="1.25" fill="${SLATE}"/></pattern>
<pattern id="hc-${uid}" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-20)"><circle cx="2.5" cy="2.5" r="1.1" fill="${INK}" opacity="0.45"/></pattern>
</defs>`;
}

const paper = () => html`<rect x="${BLEED.x}" y="${BLEED.y}" width="${BLEED.w}" height="${BLEED.h}" fill="${BG}"/>`;
const dots = (u, y = BLEED.y, opacity = 0.3, x = BLEED.x, w = BLEED.w, h = BLEED.h) => html`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#ht-${u})" opacity="${opacity}"/>`;
const groundLine = (y) => html`<path d="M${BLEED.x} ${y}H${BLEED.x + BLEED.w}" stroke="${INK}" stroke-width="${LINE.sw}"/>`;

/** A simple figure: round head, rounded body, stroked limbs. `step` swings the legs. */
function figure(x, y, { fill = SURFACE, s = 1, bag = false, facing = 1, step = 1, arm = "down" } = {}) {
  const k = (n) => num(n * s);
  const legs = html`<path d="M${num(x - 4 * s)} ${num(y - 22 * s)}L${num(x - (4 + 6 * step) * s * facing)} ${num(y)}M${num(x + 4 * s)} ${num(y - 22 * s)}L${num(x + (4 + 7 * step) * s * facing)} ${num(y)}" stroke="${INK}" stroke-width="${k(5)}" stroke-linecap="round" fill="none"/>`;
  const armPath =
    arm === "up"
      ? `M${num(x + 8 * s * facing)} ${num(y - 48 * s)}L${num(x + 16 * s * facing)} ${num(y - 70 * s)}`
      : `M${num(x + 8 * s * facing)} ${num(y - 46 * s)}L${num(x + 14 * s * facing)} ${num(y - 26 * s)}`;
  const body = html`<rect x="${num(x - 11 * s)}" y="${num(y - 54 * s)}" width="${k(22)}" height="${k(34)}" rx="${k(10)}" fill="${fill}" stroke="${INK}" stroke-width="${LINE.sw}"/>`;
  const head = html`<circle cx="${num(x + 1 * s * facing)}" cy="${num(y - 64 * s)}" r="${k(9)}" fill="${SURFACE}" stroke="${INK}" stroke-width="${LINE.sw}"/>`;
  const a = html`<path d="${armPath}" stroke="${INK}" stroke-width="${k(4.5)}" stroke-linecap="round" fill="none"/>`;
  const b = bag
    ? html`<rect x="${num(x + (facing > 0 ? 9 : -23) * s)}" y="${num(y - 28 * s)}" width="${k(14)}" height="${k(12)}" rx="${k(2.5)}" fill="${SLATE}" stroke="${INK}" stroke-width="${LINE.sw}"/><path d="M${num(x + (facing > 0 ? 12 : -20) * s)} ${num(y - 28 * s)}q${k(4)} ${k(-6)} ${k(8)} 0" stroke="${INK}" stroke-width="2" fill="none"/>`
    : "";
  return html`<g>${legs}${body}${a}${b}${head}</g>`;
}

const house = (x, y, w, h, fill) =>
  html`<path d="M${x} ${y}v${-h}l${num(w / 2)} ${num(-w * 0.42)}l${num(w / 2)} ${num(w * 0.42)}v${h}Z" fill="${fill}" stroke="${INK}" stroke-width="${LINE.sw}" stroke-linejoin="round"/>`;
const win = (x, y, s = 9) => html`<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${INK}"/>`;

/** Brick courses for a wall from x0 to x1 between y0 and y1, skipping a doorway. */
function bricks(x0, x1, y0, y1, door) {
  const d = [];
  let row = 0;
  for (let y = y0 + 22; y < y1; y += 22, row++) {
    const inDoorRow = y > door.y;
    if (inDoorRow) d.push(`M${x0} ${y}H${door.x0}M${door.x1} ${y}H${x1}`);
    else d.push(`M${x0} ${y}H${x1}`);
    for (let x = x0 + (row % 2 ? 20 : 40); x < x1; x += 40) {
      if (!(x > door.x0 - 4 && x < door.x1 + 4 && y - 22 >= door.y - 22)) d.push(`M${x} ${y - 22}v22`);
    }
  }
  return html`<path d="${d.join("")}" stroke="${INK}" stroke-width="1.6" opacity="0.5"/>`;
}

const SCENES = {
  "own-your-exit": (c, u) => html`
${paper()}
${dots(u, BLEED.y, 0.55, 196, 600, 916)}
<g transform="translate(1.5 1)"><rect x="${BLEED.x}" y="28" width="${192 - BLEED.x}" height="172" fill="${c}"/></g>
<path d="M${BLEED.x} 28H192V200" fill="none" stroke="${INK}" stroke-width="${LINE.sw}"/>
${bricks(BLEED.x, 192, 28, 200, { x0: 112, x1: 164, y: 92 })}
<rect x="112" y="92" width="52" height="108" fill="${SLATE}" stroke="${INK}" stroke-width="${LINE.sw}"/>
<rect x="112" y="92" width="52" height="108" fill="url(#hc-${u})"/>
<path d="M164 92l30 -10v128l-30 -10Z" fill="${SURFACE}" stroke="${INK}" stroke-width="${LINE.sw}" stroke-linejoin="round"/>
<circle cx="186" cy="150" r="3" fill="${INK}"/>
<g transform="translate(36 70) rotate(-24)"><circle cx="0" cy="0" r="12" fill="${SURFACE}" stroke="${INK}" stroke-width="${LINE.sw}"/><circle cx="0" cy="0" r="4.5" fill="${c}" stroke="${INK}" stroke-width="2"/><path d="M12 -3h34v6h-34Z" fill="${SURFACE}" stroke="${INK}" stroke-width="${LINE.sw}" stroke-linejoin="round"/><path d="M36 3v8M43 3v6" stroke="${INK}" stroke-width="3.5" stroke-linecap="square"/></g>
<path d="M36 48v-12" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/><circle cx="36" cy="36" r="2.6" fill="${INK}"/>
${dots(u, 200, 0.8)}
<path d="M112 200h52l70 ${-BLEED.y}h-160Z" fill="${SURFACE}" opacity="0.7"/>
${groundLine(200)}
${figure(250, 214, { fill: c, bag: true, step: 1.1, s: 1.05 })}
<path d="M214 222l-14 2M200 230l-14 2" stroke="${INK}" stroke-width="2" stroke-linecap="round" opacity="0.6"/>`,

  "friend-speech": (c, u) => html`
${paper()}
${dots(u, 190, 0.7)}
<g transform="translate(1.5 1)"><circle cx="160" cy="104" r="96" fill="${c}"/></g>
<circle cx="160" cy="104" r="96" fill="none" stroke="${INK}" stroke-width="${LINE.sw}"/>
${figure(78, 168, { fill: SLATE, s: 1.1, facing: 1, step: 0.4, arm: "up" })}
${figure(244, 168, { fill: SURFACE, s: 1.1, facing: -1, step: 0.4 })}
<g transform="translate(104 64) rotate(12)"><rect x="-13" y="-6" width="26" height="28" rx="9" fill="${SURFACE}" stroke="${INK}" stroke-width="${LINE.sw}"/><rect x="-12" y="-26" width="6.5" height="24" rx="3.25" fill="${SURFACE}" stroke="${INK}" stroke-width="2.2"/><rect x="-4.5" y="-31" width="6.5" height="29" rx="3.25" fill="${SURFACE}" stroke="${INK}" stroke-width="2.2"/><rect x="3" y="-28" width="6.5" height="26" rx="3.25" fill="${SURFACE}" stroke="${INK}" stroke-width="2.2"/><rect x="10" y="-21" width="6" height="20" rx="3" fill="${SURFACE}" stroke="${INK}" stroke-width="2.2"/><rect x="-24" y="2" width="16" height="7" rx="3.5" transform="rotate(-35 -12 6)" fill="${SURFACE}" stroke="${INK}" stroke-width="2.2"/></g>
<rect x="38" y="156" width="244" height="12" rx="3" fill="${SLATE}" stroke="${INK}" stroke-width="${LINE.sw}"/>
<path d="M62 168v34M258 168v34" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
<rect x="132" y="138" width="16" height="18" rx="3" fill="${SURFACE}" stroke="${INK}" stroke-width="2.2"/><path d="M148 143q7 0 7 5t-7 5" fill="none" stroke="${INK}" stroke-width="2"/>
<rect x="176" y="138" width="16" height="18" rx="3" fill="${c}" stroke="${INK}" stroke-width="2.2"/><path d="M176 143q-7 0 -7 5t7 5" fill="none" stroke="${INK}" stroke-width="2"/>
<path d="M196 54h46a10 10 0 0 1 10 10v18a10 10 0 0 1 -10 10h-30l-12 10v-10h-4a10 10 0 0 1 -10 -10v-18a10 10 0 0 1 10 -10Z" fill="${SURFACE}" stroke="${INK}" stroke-width="${LINE.sw}" stroke-linejoin="round"/>
<path d="M200 68h40M200 78h28" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
${groundLine(202)}`,

  "vote-with-your-feet": (c, u) => {
    const towns = [
      { x: 52, y: 196, fill: c },
      { x: 166, y: 86, fill: SLATE },
      { x: 268, y: 192, fill: SURFACE },
    ];
    const town = ({ x, y, fill }) =>
      html`<g>${house(x - 34, y, 22, 22, fill)}${house(x - 8, y, 26, 34, fill)}${house(x + 22, y, 20, 18, fill)}${win(x - 2, y - 26, 8)}${win(x + 7, y - 26, 8)}<path d="M${x - 44} ${y}h96" stroke="${INK}" stroke-width="${LINE.sw}"/></g>`;
    const prints = [];
    const along = (p0, p1, p2, n, t0 = 0.12, t1 = 0.88) => {
      for (let i = 0; i < n; i++) {
        const t = t0 + ((t1 - t0) * i) / (n - 1);
        const x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0];
        const y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1];
        const dx = 2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
        const dy = 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
        const a = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
        const side = i % 2 ? 4.5 : -4.5;
        const len = Math.hypot(dx, dy);
        prints.push(html`<g transform="translate(${num(x + (-dy / len) * side)} ${num(y + (dx / len) * side)}) rotate(${num(a)})"><ellipse rx="3.2" ry="5" fill="${INK}"/><circle cy="-6.8" r="1.7" fill="${INK}"/></g>`);
      }
    };
    along([70, 206], [96, 120], [140, 96], 7);
    along([196, 100], [250, 108], [262, 178], 6);
    return html`
${paper()}
${dots(u, BLEED.y, 0.28)}
<g transform="translate(1.5 1)"><path d="M${BLEED.x} 218L-4 214q80 -40 160 -8t168 -18L${BLEED.x + BLEED.w} 186V${BLEED.y + BLEED.h}H${BLEED.x}Z" fill="${c}"/><circle cx="270" cy="44" r="22" fill="${c}"/></g>
<path d="M${BLEED.x} 218L-4 214q80 -40 160 -8t168 -18L${BLEED.x + BLEED.w} 186" fill="none" stroke="${INK}" stroke-width="${LINE.sw}"/>
<circle cx="270" cy="44" r="22" fill="none" stroke="${INK}" stroke-width="${LINE.sw}"/>
${join(towns.map(town))}
${join(prints)}`;
  },

  "what-lasts": (c, u) => {
    const homes = [
      [20, 188, 34, 30],
      [62, 188, 32, 36],
      [138, 188, 34, 30],
      [180, 188, 32, 34],
    ];
    return html`
${paper()}
${dots(u, BLEED.y, 0.18)}
<g transform="translate(1.5 1)"><circle cx="164" cy="92" r="78" fill="${c}"/></g>
<circle cx="164" cy="92" r="78" fill="none" stroke="${INK}" stroke-width="${LINE.sw}"/>
<path d="M164 2v-10M66 92h-16M278 92h16M94 22l-10 -10M234 22l10 -10" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
<rect x="${BLEED.x}" y="188" width="${BLEED.w}" height="${BLEED.y + BLEED.h - 188}" fill="${SLATE}"/>
<rect x="${BLEED.x}" y="188" width="${BLEED.w}" height="${BLEED.y + BLEED.h - 188}" fill="url(#hc-${u})"/>
${join(homes.map(([x, y, w, h]) => html`${house(x, y, w, h, SURFACE)}${win(x + w / 2 - 4, y - h + 8, 8)}`))}
<rect x="98" y="168" width="34" height="20" fill="none" stroke="${INK}" stroke-width="2" stroke-dasharray="4 4"/>
<path d="M222 188v-44l20 -14v14l20 -14v14l20 -14v14l20 -14v58Z" fill="${SLATE}" stroke="${INK}" stroke-width="${LINE.sw}" stroke-linejoin="round"/>
<rect x="290" y="104" width="10" height="30" fill="${SLATE}" stroke="${INK}" stroke-width="${LINE.sw}"/>
<path d="M295 98q-6 -8 2 -14t0 -14" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>
<rect x="236" y="160" width="16" height="28" fill="${c}" stroke="${INK}" stroke-width="2.2"/>
${win(264, 156, 10)}${win(282, 156, 10)}
${groundLine(188)}`;
  },

  seed: (c, u) => html`
${paper()}
${dots(u, BLEED.y, 0.3)}
<g transform="translate(1.5 1)"><circle cx="160" cy="112" r="84" fill="${c}"/></g>
<circle cx="160" cy="112" r="84" fill="none" stroke="${INK}" stroke-width="${LINE.sw}"/>
<path d="M160 160v-56" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
<path d="M160 120q-30 -2 -38 -26q28 -4 38 26Z" fill="${SURFACE}" stroke="${INK}" stroke-width="${LINE.sw}" stroke-linejoin="round"/>
<path d="M160 108q26 -6 34 -32q-30 0 -34 32Z" fill="${SURFACE}" stroke="${INK}" stroke-width="${LINE.sw}" stroke-linejoin="round"/>
<path d="M118 160h84l-10 54h-64Z" fill="${SLATE}" stroke="${INK}" stroke-width="${LINE.sw}" stroke-linejoin="round"/>
<path d="M118 160h84l-10 54h-64Z" fill="url(#hc-${u})"/>
<rect x="112" y="152" width="96" height="16" rx="3" fill="${SLATE}" stroke="${INK}" stroke-width="${LINE.sw}"/>
${groundLine(214)}`,

  build: (c, u) => html`
${paper()}
${dots(u, BLEED.y, 0.3)}
<g transform="translate(1.5 1)"><rect x="46" y="38" width="228" height="160" rx="14" fill="${c}"/></g>
<rect x="46" y="38" width="228" height="160" rx="14" fill="none" stroke="${INK}" stroke-width="${LINE.sw}"/>
<path d="M46 66h228" stroke="${INK}" stroke-width="${LINE.sw}"/>
<circle cx="64" cy="52" r="5" fill="${SURFACE}" stroke="${INK}" stroke-width="2"/><circle cx="80" cy="52" r="5" fill="${SURFACE}" stroke="${INK}" stroke-width="2"/><circle cx="96" cy="52" r="5" fill="${SURFACE}" stroke="${INK}" stroke-width="2"/>
<rect x="66" y="84" width="84" height="12" rx="3" fill="${INK}"/><rect x="66" y="104" width="120" height="12" rx="3" fill="${SURFACE}" stroke="${INK}" stroke-width="2"/><rect x="82" y="124" width="96" height="12" rx="3" fill="${SLATE}" stroke="${INK}" stroke-width="2"/><rect x="82" y="144" width="60" height="12" rx="3" fill="${SURFACE}" stroke="${INK}" stroke-width="2"/><rect x="66" y="164" width="40" height="12" rx="3" fill="${INK}"/>
<g transform="translate(232 150) rotate(-40)"><rect x="-6" y="0" width="12" height="54" rx="6" fill="${SLATE}" stroke="${INK}" stroke-width="${LINE.sw}"/><path d="M-16 -2a16 16 0 1 1 32 0l-8 6v-12h-16v12Z" fill="${SURFACE}" stroke="${INK}" stroke-width="${LINE.sw}" stroke-linejoin="round"/></g>`,
};

/** Which scene a lesson gets: its own if one was drawn for it, else the seed. */
export const sceneKey = (lesson) => (lesson?.status !== "draft" && SCENES[lesson?.id] ? lesson.id : "seed");
export const SCENE_KEYS = Object.keys(SCENES);

/**
 * A two-tone screenprint illustration: one flat trait colour, ink line work,
 * slate, and grain. `uid` must be unique among scenes in the document.
 */
export function sceneSvg(key, hue, uid, { label = "", align = "xMidYMid", fit = "meet" } = {}) {
  const draw = SCENES[key] || SCENES.seed;
  const u = uidOf(uid);
  const c = traitColor(hue);
  const body = draw(c, u);
  const par = `${align} ${fit === "slice" ? "slice" : "meet"}`;
  return html`<svg class="scene" viewBox="0 0 ${W} ${H}" preserveAspectRatio="${par}" ${label ? html`role="img" aria-label="${label}"` : html`aria-hidden="true"`} focusable="false">${defs(u)}${body}</svg>`;
}

/** Short descriptions of the scenes, for screen readers. */
export const SCENE_LABELS = {
  "own-your-exit": "A door ajar in a wall, a key on the wall, and a figure walking out with a small bag.",
  "friend-speech": "Two people at a table; one raises an open palm while the other speaks.",
  "vote-with-your-feet": "Footprints leading between three small towns of different colours.",
  "what-lasts": "A row of plain houses and a workshop under a big sun, with one empty lot.",
  seed: "A sprout growing in a pot.",
  build: "A window of code blocks and a wrench.",
};

// ---- v3: the art grammar (art/) ---------------------------------------------
// The logo, generated lesson scenes, portraits and stamps come from the art
// lane's generators (art/index.mjs) and the stamp art (contract/badge-art.mjs).
// They return SVG strings; svgMarkup() admits them as markup only after
// checking that each is one plain <svg>.

import { seal, lessonScene, portrait, sceneChoice } from "../../art/index.mjs";
import { svgMarkup, plain } from "./html.mjs";

/** The trait's candy as "#RRGGBB": the App's own colour when it has one, else the one its hue maps to. */
export const traitHex = (trait) =>
  typeof trait?.color === "string" && /^#[0-9A-Fa-f]{6}$/.test(trait.color) ? trait.color.toUpperCase() : traitColor(Number(trait?.hue) || 0).toUpperCase();

/**
 * The seal and the wordmark (the home header). `filled`: the trait ids whose
 * ring quarter is coloured, so the ring fills in as traits are earned;
 * omitted, the full ring.
 */
export function brandLockup({ size = 44, filled } = {}) {
  try {
    return svgMarkup(seal({ mode: "lockup", size, ...(Array.isArray(filled) ? { filled } : {}) }), "lockup");
  } catch {
    return empty;
  }
}

/** The seal alone. */
export function brandSeal({ size = 64, filled } = {}) {
  try {
    return svgMarkup(seal({ mode: "logo", size, ...(Array.isArray(filled) ? { filled } : {}) }), "seal");
  } catch {
    return empty;
  }
}

/** What a generated scene shows, by template (docs/ART.md), for screen readers. */
export const TEMPLATE_LABELS = {
  threshold: "A door ajar in a brick wall, and someone walking out.",
  table: "People talking at a long table.",
  towns: "Small towns on hills, with a path walked between them.",
  street: "A row of houses and a civic building under a big sun.",
  bridge: "People meeting on a bridge over a river.",
  ballot: "A queue of people at a ballot box.",
  commons: "People resting under a big tree on the commons.",
  crossroads: "A signpost at a crossroads.",
  assembly: "Someone speaking to a crowd from the steps.",
  gate: "An open gate in a picket fence, and a path through it.",
};

/** Does this lesson have a hand-drawn scene? The four written lessons do; any other lesson (new, or a draft) gets a generated one. */
export const handDrawn = (lesson) => sceneKey(lesson) !== "seed";

/**
 * A lesson's picture: its hand-drawn scene when it has one, else the scene the
 * art grammar generates from its id, in its trait colour. `label` true
 * describes it for screen readers; false leaves it decorative. `align`/`fit`
 * set preserveAspectRatio, as for sceneSvg. If generation fails, the seed scene.
 */
export function lessonArt(lesson, trait, uid, { label = false, align = "xMidYMid", fit = "meet" } = {}) {
  const hue = Number(trait?.hue) || 0;
  if (handDrawn(lesson)) {
    const key = sceneKey(lesson);
    return sceneSvg(key, hue, uid, { label: label ? SCENE_LABELS[key] : "", align, fit });
  }
  try {
    const title = label ? TEMPLATE_LABELS[sceneChoice(String(lesson?.id)).template] || "" : "";
    const par = `${/^x(Min|Mid|Max)Y(Min|Mid|Max)$/.test(align) ? align : "xMidYMid"} ${fit === "slice" ? "slice" : "meet"}`;
    const svg = lessonScene({ lessonId: String(lesson?.id), color: traitHex(trait), uid: uidOf(uid), grain: false, ...(title ? { title } : {}) }).replace(
      /preserveAspectRatio="[^"]*"/,
      `preserveAspectRatio="${par}"`,
    );
    const m = svgMarkup(svg, "scene scene--gen");
    if (String(m)) return m;
  } catch {
    /* fall through to the seed */
  }
  return sceneSvg("seed", hue, uid, { label: label ? SCENE_LABELS.seed : "", align, fit });
}

/** A passport portrait for a seed (an fid, an address or a local id). `title` "" makes it decorative. */
export function portraitArt(seed, { uid = "", title = "", color, cls = "portrait" } = {}) {
  try {
    return svgMarkup(portrait({ seed: String(seed), uid: uidOf(uid || "p"), title, ...(color ? { color } : {}) }), cls);
  } catch {
    return empty;
  }
}

/** A trait as the stamp art prints it: capitals, its colour, its emblem and its stamp id (the App's, else its place in the list). */
export function stampTraitOf(app, trait) {
  const i = Math.max(0, (app?.traits || []).findIndex((t) => t.id === trait?.id));
  return {
    stampId: Number.isInteger(trait?.stampId) && trait.stampId >= 0 && trait.stampId <= 255 ? trait.stampId : i,
    name: String(plain(trait?.name ?? "")).toUpperCase(),
    color: traitHex(trait),
    emblem: Number.isInteger(trait?.emblem) ? trait.emblem : i,
    open: true,
  };
}

/** A stamp's SVG (from the stamp module's preview()) as markup; empty if it is not one plain <svg>. */
export const stampMarkup = (svg) => svgMarkup(svg, "stamp__svg");

/** A trait's stamp SVG for (holder, tokenId) from `preview` (StampsAPI.preview), or "" when it cannot be drawn (an unprintable name, a bad holder). The exact on-chain art for a minted (holder, tokenId). */
export function stampArt(preview, app, trait, holder, tokenId = 0) {
  try {
    const st = stampTraitOf(app, trait);
    const svg = preview({ holder, stampId: st.stampId, tokenId, trait: st });
    return typeof svg === "string" ? svg : "";
  } catch {
    return "";
  }
}

/**
 * A stamp that is not minted (review V12, T14): the art for tokenId 0 with no
 * serial ("#—", not "#0"). Its pattern is a preview: the real one depends on
 * the minting account and the token id, which only the chain assigns.
 */
export function previewArt(preview, app, trait, holder) {
  return stampArt(preview, app, trait, holder, 0).replace(/>#0<\/text>/, ">#—</text>");
}
