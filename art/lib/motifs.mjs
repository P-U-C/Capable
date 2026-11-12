// The motif vocabulary: small civic objects and the citizen figure, drawn the
// way the hand-drawn scenes in app/src/art.mjs are drawn. Every motif is a pure
// function of explicit numbers and colours (no randomness here: the scene
// templates decide), returning an SVG fragment.
//
// House style:
//   - ink line work at LINE (2.6) with round joins; detail lines thinner;
//   - flat fills: the trait colour `c`, SURFACE, SLATE, INK, never gradients;
//   - the big trait-colour shape of a scene is "misregistered": its fill is
//     printed 1.5/1 units off its ink outline, like a riso second pass (reg*).

import { INK, SURFACE, SLATE } from "../palette.mjs";
import { n } from "./svg.mjs";

export const LINE = 2.6;
const S = `stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="round"`;

// ---- primitives -----------------------------------------------------------------

/** A filled, ink-outlined path. */
export const P = (d, fill = "none", w = LINE) =>
  `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="${n(w)}" stroke-linejoin="round" stroke-linecap="round"/>`;
/** An ink stroke only. */
export const line = (d, w = LINE, extra = "") => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${n(w)}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
export const rect = (x, y, w, h, fill, rx = 0) =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${rx ? ` rx="${n(rx)}"` : ""} fill="${fill}" ${S}/>`;
export const circle = (cx, cy, r, fill) => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}" ${S}/>`;
/** Solid ink, no stroke. */
export const blot = (d) => `<path d="${d}" fill="${INK}"/>`;

/** Misregistered path: the colour pass sits 1.5/1 off the ink pass. */
export const regPath = (d, c) => `<path d="${d}" fill="${c}" transform="translate(1.5 1)"/>${P(d)}`;
export const regCircle = (cx, cy, r, c) =>
  `<circle cx="${n(cx + 1.5)}" cy="${n(cy + 1)}" r="${n(r)}" fill="${c}"/><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="none" ${S}/>`;

/** A rounded-rect path (for misregistered blocks). */
export const rrPath = (x, y, w, h, r) =>
  `M${n(x + r)} ${n(y)}H${n(x + w - r)}Q${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + r)}V${n(y + h - r)}Q${n(x + w)} ${n(y + h)} ${n(x + w - r)} ${n(y + h)}H${n(x + r)}Q${n(x)} ${n(y + h)} ${n(x)} ${n(y + h - r)}V${n(y + r)}Q${n(x)} ${n(y)} ${n(x + r)} ${n(y)}Z`;

// ---- the citizen figure ------------------------------------------------------------

/**
 * A standing citizen, feet at (x, y). Round head, rounded body, stroked limbs.
 *   s      scale (1 ≈ 74 units tall)
 *   facing 1 right, -1 left
 *   step   leg swing (0 standing, 1 walking)
 *   arm    front arm: "down" | "up" | "wave" | "out" | "hold"
 *   back   back arm: "none" | "down" | "up"
 *   item   "bag" | "flag" | "sign" | "paper" | "key" | null (held in the front hand)
 *   hat    null | "cap" | "beanie"
 */
export function figure(x, y, o = {}) {
  const { s = 1, fill = SURFACE, facing: f = 1, step = 0.5, arm = "down", back = "none", item = null, itemFill = SURFACE, hat = null } = o;
  const X = (dx) => n(x + dx * s * f);
  const Y = (dy) => n(y - dy * s);
  const W = (w) => n(w * s);
  const limb = (d, w) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${W(w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const out = [];
  // back arm (behind the body)
  if (back === "down") out.push(limb(`M${X(-7)} ${Y(46)}L${X(-12)} ${Y(27)}`, 4.5));
  if (back === "up") out.push(limb(`M${X(-7)} ${Y(48)}L${X(-15)} ${Y(70)}`, 4.5));
  // legs
  out.push(limb(`M${X(-4)} ${Y(22)}L${X(-4 - 6 * step)} ${Y(0)}M${X(4)} ${Y(22)}L${X(4 + 7 * step)} ${Y(0)}`, 5));
  // body
  out.push(`<rect x="${n(x - 11 * s)}" y="${Y(54)}" width="${W(22)}" height="${W(34)}" rx="${W(10)}" fill="${fill}" ${S}/>`);
  // front arm + hand point
  const ARMS = {
    down: [8, 46, 14, 26],
    up: [8, 48, 16, 72],
    wave: [8, 48, 20, 66],
    out: [8, 46, 26, 44],
    hold: [8, 46, 20, 34],
  };
  const [ax, ay, hx, hy] = ARMS[arm] || ARMS.down;
  // item behind the hand
  if (item === "flag") {
    out.push(limb(`M${X(hx)} ${Y(hy - 10)}V${Y(hy + 44)}`, 2.6));
    out.push(`<path d="M${X(hx)} ${Y(hy + 44)}L${X(hx + 22)} ${Y(hy + 38)}L${X(hx)} ${Y(hy + 30)}Z" fill="${itemFill}" ${S}/>`);
  }
  if (item === "sign") {
    out.push(limb(`M${X(hx)} ${Y(hy - 6)}V${Y(hy + 30)}`, 2.6));
    out.push(`<rect x="${n(x + (hx * f - 14) * s)}" y="${Y(hy + 50)}" width="${W(28)}" height="${W(20)}" rx="${W(3)}" fill="${itemFill}" ${S}/>`);
  }
  out.push(limb(`M${X(ax)} ${Y(ay)}L${X(hx)} ${Y(hy)}`, 4.5));
  if (item === "bag") {
    const bx = x + (f > 0 ? hx - 6 : -hx - 8) * s;
    out.push(`<rect x="${n(bx)}" y="${Y(hy - 2)}" width="${W(14)}" height="${W(12)}" rx="${W(2.5)}" fill="${itemFill}" ${S}/>`);
    out.push(`<path d="M${n(bx + 3 * s)} ${Y(hy - 2)}q${W(4)} ${W(-6)} ${W(8)} 0" fill="none" stroke="${INK}" stroke-width="2"/>`);
  }
  if (item === "paper") out.push(`<rect x="${n(x + hx * s * f - 5 * s)}" y="${Y(hy + 12)}" width="${W(11)}" height="${W(14)}" rx="${W(1)}" fill="${itemFill}" ${S}/>`);
  if (item === "key") {
    const kx = x + hx * s * f;
    const ky = y - hy * s;
    out.push(`<circle cx="${n(kx)}" cy="${n(ky - 2 * s)}" r="${W(4.5)}" fill="${itemFill}" ${S}/>`);
    out.push(limb(`M${n(kx)} ${n(ky + 2 * s)}V${n(ky + 14 * s)}M${n(kx)} ${n(ky + 10 * s)}h${W(4 * f)}M${n(kx)} ${n(ky + 14 * s)}h${W(4 * f)}`, 2.4));
  }
  // head
  const hcx = x + 1 * s * f;
  const hcy = y - 64 * s;
  out.push(`<circle cx="${n(hcx)}" cy="${n(hcy)}" r="${W(9)}" fill="${SURFACE}" ${S}/>`);
  if (hat === "cap") out.push(`<path d="M${n(hcx - 9 * s)} ${n(hcy - 1 * s)}a${W(9)} ${W(9)} 0 0 1 ${W(18)} 0Z M${n(hcx + (f > 0 ? 8 : -16) * s)} ${n(hcy - 1 * s)}h${W(8)}" fill="${INK}" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`);
  if (hat === "beanie") out.push(`<path d="M${n(hcx - 9.5 * s)} ${n(hcy - 2 * s)}a${W(9.5)} ${W(10)} 0 0 1 ${W(19)} 0Z" fill="${itemFill}" ${S}/><circle cx="${n(hcx)}" cy="${n(hcy - 13 * s)}" r="${W(2.8)}" fill="${INK}"/>`);
  return `<g>${out.join("")}</g>`;
}

/** A seated citizen on a bench or step at height `seat`, feet on the ground at y. */
export function sitter(x, y, seat, o = {}) {
  const { s = 1, fill = SURFACE, facing: f = 1, arm = "down" } = o;
  const X = (dx) => n(x + dx * s * f);
  const W = (w) => n(w * s);
  const sy = y - seat;
  const limb = (d, w) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${W(w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const out = [];
  out.push(limb(`M${X(-2)} ${n(sy - 2 * s)}L${X(14)} ${n(sy - 2 * s)}L${X(16)} ${n(y)}`, 5));
  out.push(`<rect x="${n(x - 11 * s)}" y="${n(sy - 34 * s)}" width="${W(22)}" height="${W(34)}" rx="${W(10)}" fill="${fill}" ${S}/>`);
  if (arm === "up") out.push(limb(`M${X(8)} ${n(sy - 28 * s)}L${X(17)} ${n(sy - 50 * s)}`, 4.5));
  else out.push(limb(`M${X(8)} ${n(sy - 26 * s)}L${X(16)} ${n(sy - 10 * s)}`, 4.5));
  out.push(`<circle cx="${X(1)}" cy="${n(sy - 44 * s)}" r="${W(9)}" fill="${SURFACE}" ${S}/>`);
  return `<g>${out.join("")}</g>`;
}

/** Head and shoulders seen from behind or front (crowds). Base at y. */
export function bust(x, y, o = {}) {
  const { s = 1, fill = SURFACE } = o;
  const W = (w) => n(w * s);
  const sh = `M${n(x - 20 * s)} ${n(y)}V${n(y - 14 * s)}C${n(x - 20 * s)} ${n(y - 26 * s)} ${n(x - 12 * s)} ${n(y - 30 * s)} ${n(x)} ${n(y - 30 * s)}C${n(x + 12 * s)} ${n(y - 30 * s)} ${n(x + 20 * s)} ${n(y - 26 * s)} ${n(x + 20 * s)} ${n(y - 14 * s)}V${n(y)}Z`;
  return `<g><path d="${sh}" fill="${fill}" ${S}/><circle cx="${n(x)}" cy="${n(y - 42 * s)}" r="${W(12)}" fill="${SURFACE}" ${S}/></g>`;
}

// ---- buildings and civic objects -------------------------------------------------------

/** A gable house, base-left (x, y), width w, wall height h. */
export const house = (x, y, w, h, fill) => P(`M${n(x)} ${n(y)}v${n(-h)}l${n(w / 2)} ${n(-w * 0.42)}l${n(w / 2)} ${n(w * 0.42)}v${n(h)}Z`, fill);
/** A flat-roofed block with a parapet line. */
export const block = (x, y, w, h, fill) => rect(x, y - h, w, h, fill) + line(`M${n(x)} ${n(y - h + 6)}h${n(w)}`, 1.6);
/** A small solid ink window. */
export const win = (x, y, sz = 8) => `<rect x="${n(x)}" y="${n(y)}" width="${n(sz)}" height="${n(sz)}" fill="${INK}"/>`;
/** A sawtooth workshop. */
export function workshop(x, y, w, h, fill, teeth = 3) {
  const tw = w / teeth;
  let d = `M${n(x)} ${n(y)}v${n(-h)}`;
  for (let i = 0; i < teeth; i++) d += `l${n(tw)} ${n(-14)}v${14}`;
  d += `V${n(y)}Z`;
  return P(d, fill);
}
/** A civic hall: steps, columns, pediment. Base-left (x, y). */
export function hall(x, y, w, h, fill) {
  const cols = Math.max(3, Math.round(w / 14));
  const gap = (w - 12) / (cols - 1);
  const o = [];
  o.push(rect(x - 4, y - 6, w + 8, 6, SURFACE));
  o.push(rect(x + 2, y - h, w - 4, h - 6, fill));
  let d = "";
  for (let i = 0; i < cols; i++) d += `M${n(x + 6 + i * gap)} ${n(y - h + 8)}V${n(y - 8)}`;
  o.push(line(d, 3.4));
  o.push(P(`M${n(x - 6)} ${n(y - h)}L${n(x + w / 2)} ${n(y - h - w * 0.28)}L${n(x + w + 6)} ${n(y - h)}Z`, SURFACE));
  return o.join("");
}
/** A flag on a pole: pole base (x, y), height h, a waving cloth in `fill`, flying toward side f. */
export const flag = (x, y, h, fill, f = 1) =>
  line(`M${n(x)} ${n(y)}V${n(y - h - 2)}`, 3) + P(`M${n(x)} ${n(y - h)}q${n(7 * f)} -5 ${n(14 * f)} 0t${n(14 * f)} 0v16q${n(-7 * f)} 5 ${n(-14 * f)} 0t${n(-14 * f)} 0Z`, fill);
/** A door ajar in an opening (x0..x1, top y0, ground y). Leaf opens to side f. */
export function doorway(x0, x1, y0, y, hatch, f = 1) {
  const w = x1 - x0;
  const o = [];
  o.push(rect(x0, y0, w, y - y0, SLATE));
  o.push(`<rect x="${n(x0)}" y="${n(y0)}" width="${n(w)}" height="${n(y - y0)}" fill="url(#${hatch})"/>`);
  const hx = f > 0 ? x1 : x0;
  const leaf = 0.56 * w * f;
  o.push(P(`M${n(hx)} ${n(y0)}l${n(leaf)} ${n(-10)}v${n(y - y0 + 20)}l${n(-leaf)} ${n(-10)}Z`, SURFACE));
  o.push(`<circle cx="${n(hx + leaf * 0.78)}" cy="${n(y0 + (y - y0) * 0.55)}" r="3" fill="${INK}"/>`);
  return o.join("");
}
/** Brick courses across x0..x1 between y0 and y1, skipping an opening. */
export function bricks(x0, x1, y0, y1, hole, course = 22) {
  const d = [];
  let row = 0;
  for (let y = y0 + course; y < y1 - 2; y += course, row++) {
    if (hole && y > hole.y0) d.push(`M${n(x0)} ${n(y)}H${n(hole.x0)}M${n(hole.x1)} ${n(y)}H${n(x1)}`);
    else d.push(`M${n(x0)} ${n(y)}H${n(x1)}`);
    for (let x = x0 + (row % 2 ? course : course * 2); x < x1 - 4; x += course * 2) {
      if (!(hole && x > hole.x0 - 4 && x < hole.x1 + 4 && y > hole.y0)) d.push(`M${n(x)} ${n(y - course)}v${course}`);
    }
  }
  return `<path d="${d.join("")}" stroke="${INK}" stroke-width="1.6" opacity="0.5" fill="none"/>`;
}
/** A big key, ring centre (x, y), rotated a°. */
export const bigKey = (x, y, a, c) =>
  `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(a)})">${circle(0, 0, 12, SURFACE)}${circle(0, 0, 4.5, c)}${P("M12 -3h34v6h-34Z", SURFACE)}${line("M36 3v8M43 3v6", 3.5)}</g>`;
/** A wall lamp: bracket + glowing globe in c. */
export const lamp = (x, y, c) => line(`M${n(x)} ${n(y)}h10v-8`, 2.6) + circle(x + 10, y - 14, 6, c) + line(`M${n(x + 10)} ${n(y - 26)}v-4M${n(x + 20)} ${n(y - 18)}l4 -2M${n(x)} ${n(y - 18)}l-4 -2`, 2);
/** A plain tree: trunk + round canopy with a shade arc. Base (x, y). */
export function tree(x, y, h, r, fill) {
  const cy = y - h - r * 0.7;
  return rect(x - 3.5, y - h, 7, h, SLATE) + circle(x, cy, r, fill) + shade(x, cy, r);
}
/** A shade arc inside the lower right of a round shape (foliage, a sun, a head of hair). */
export const shade = (cx, cy, r) => {
  const a0 = (-8 * Math.PI) / 180;
  const a1 = (-78 * Math.PI) / 180;
  const k = r * 0.7;
  return line(`M${n(cx + k * Math.cos(a0))} ${n(cy - k * Math.sin(a0))}A${n(k)} ${n(k)} 0 0 1 ${n(cx + k * Math.cos(a1))} ${n(cy - k * Math.sin(a1))}`, 2);
};
/** A pine: trunk + triangle. */
export const pine = (x, y, h, fill) => rect(x - 3, y - 12, 6, 12, SLATE) + P(`M${n(x - h * 0.32)} ${n(y - 10)}L${n(x)} ${n(y - h)}L${n(x + h * 0.32)} ${n(y - 10)}Z`, fill);
/** A bench, seat at height 18. */
export const bench = (x, y, w, fill) => line(`M${n(x + 6)} ${n(y)}v-18M${n(x + w - 6)} ${n(y)}v-18`, 4) + rect(x, y - 22, w, 6, fill, 2) + rect(x + 2, y - 40, w - 4, 6, fill, 2) + line(`M${n(x + 10)} ${n(y - 34)}v12M${n(x + w - 10)} ${n(y - 34)}v12`, 2.4);
/** Picket fence from x0 to x1 on ground y. */
export function fence(x0, x1, y, h = 26, fill = SURFACE) {
  const o = [rect(x0, y - h * 0.72, x1 - x0, 5, fill)];
  for (let x = x0 + 2; x < x1 - 6; x += 13) o.push(P(`M${n(x)} ${n(y)}v${n(-h + 5)}l4 -5l4 5v${n(h - 5)}Z`, fill));
  return o.join("");
}
/** A speech bubble with text lines; its tail points down toward side f. */
export function bubble(x, y, w, h, f = -1, lines = 2) {
  const tail = f > 0 ? `H${n(x + w - 16)}L${n(x + w - 12)} ${n(y + h + 11)}L${n(x + w - 28)} ${n(y + h)}` : `H${n(x + 28)}L${n(x + 12)} ${n(y + h + 11)}L${n(x + 16)} ${n(y + h)}`;
  const d = `M${n(x + 9)} ${n(y)}H${n(x + w - 9)}Q${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + 9)}V${n(y + h - 9)}Q${n(x + w)} ${n(y + h)} ${n(x + w - 9)} ${n(y + h)}${tail}H${n(x + 9)}Q${n(x)} ${n(y + h)} ${n(x)} ${n(y + h - 9)}V${n(y + 9)}Q${n(x)} ${n(y)} ${n(x + 9)} ${n(y)}Z`;
  let txt = "";
  const gap = (h - 8) / (lines + 1);
  for (let i = 0; i < lines; i++) txt += `M${n(x + 10)} ${n(y + 4 + gap * (i + 1))}h${n((w - 20) * (i === lines - 1 ? 0.6 : 1))}`;
  return P(d, SURFACE) + line(txt, 3);
}
/** A cup with a handle, base (x, y). */
export const cup = (x, y, fill, f = 1) => rect(x, y - 18, 16, 18, fill, 3) + line(`M${n(f > 0 ? x + 16 : x)} ${n(y - 13)}q${n(7 * f)} 0 ${n(7 * f)} 5t${n(-7 * f)} 5`, 2);
/** A signpost: post at x from ground y; boards [{dir, fill}] stacked from the top. */
export function signpost(x, y, h, boards) {
  const o = [rect(x - 3.5, y - h, 7, h, SLATE)];
  boards.forEach((b, i) => {
    const by = y - h + 6 + i * 22;
    const w = 54;
    const d = b.dir > 0 ? `M${n(x - 10)} ${n(by)}h${w}l10 8l-10 8h${-w}Z` : `M${n(x + 10)} ${n(by)}h${-w}l-10 8l10 8h${w}Z`;
    o.push(P(d, b.fill));
  });
  return o.join("");
}
/** A ballot box with a paper going in. Base-left (x, y). */
export function ballotBox(x, y, w, h, fill, paperFill) {
  return (
    rect(x, y - h, w, h, fill, 4) +
    P(`M${n(x - 4)} ${n(y - h)}h${n(w + 8)}v-8h${n(-w - 8)}Z`, SURFACE) +
    `<rect x="${n(x + w / 2 - 14)}" y="${n(y - h - 6)}" width="28" height="4" fill="${INK}"/>` +
    P(`M${n(x + w / 2 - 9)} ${n(y - h - 4)}v-26h18v26`, paperFill) +
    line(`M${n(x + w / 2 - 5)} ${n(y - h - 18)}l4 4l7 -9`, 2.4) +
    P(`M${n(x + w / 2 - 12)} ${n(y - h * 0.55)}l12 -8l12 8l-12 8Z`, SURFACE)
  );
}
/** Bunting on a sagging string from (x0, y0) to (x1, y0); flags alternate fills. */
export function bunting(x0, x1, y0, sag, fills) {
  const o = [line(`M${n(x0)} ${n(y0)}Q${n((x0 + x1) / 2)} ${n(y0 + sag * 2)} ${n(x1)} ${n(y0)}`, 2)];
  const k = Math.max(4, Math.round((x1 - x0) / 26));
  for (let i = 1; i < k; i++) {
    const t = i / k;
    const x = x0 + (x1 - x0) * t;
    const yy = y0 + sag * 2 * 2 * t * (1 - t);
    o.push(P(`M${n(x - 7)} ${n(yy)}h14l-7 13Z`, fills[i % fills.length], 2));
  }
  return o.join("");
}
/** Footprints along a quadratic curve p0 → p2 (control p1). */
export function footprints(p0, p1, p2, count, t0 = 0.1, t1 = 0.9) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = t0 + ((t1 - t0) * i) / Math.max(1, count - 1);
    const x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0];
    const y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1];
    const dx = 2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
    const dy = 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
    const len = Math.hypot(dx, dy) || 1;
    const a = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    const side = i % 2 ? 4 : -4;
    out.push(`<g transform="translate(${n(x + (-dy / len) * side)} ${n(y + (dx / len) * side)}) rotate(${Math.round(a)})"><ellipse rx="3" ry="4.6"/><circle cy="-6.4" r="1.6"/></g>`);
  }
  return `<g fill="${INK}">${out.join("")}</g>`;
}
/** A sun: disc in c (misregistered) with short ink rays. */
export function sun(cx, cy, r, c, rays = 8) {
  let d = "";
  for (let i = 0; i < rays; i++) {
    const a = ((i + 0.5) * 2 * Math.PI) / rays;
    d += `M${n(cx + Math.cos(a) * (r + 7))} ${n(cy + Math.sin(a) * (r + 7))}L${n(cx + Math.cos(a) * (r + 15))} ${n(cy + Math.sin(a) * (r + 15))}`;
  }
  return regCircle(cx, cy, r, c) + (rays ? line(d, 3) : "");
}
/** A puffy cloud outline. */
export const cloud = (x, y, w) => P(`M${n(x)} ${n(y)}h${n(w)}a10 10 0 0 0 -8 -16a14 14 0 0 0 -24 -6a12 12 0 0 0 -22 10a9 9 0 0 0 -4 12Z`, SURFACE, 2.4);
/** Small birds: little "v" marks. */
export const birds = (pts) => line(pts.map(([x, y]) => `M${n(x - 6)} ${n(y - 3)}q3 0 6 4q3 -4 6 -4`).join(""), 2);
/** A street lamp post. */
export const lampPost = (x, y, h, c) => line(`M${n(x)} ${n(y)}V${n(y - h)}`, 3.4) + P(`M${n(x - 8)} ${n(y - h)}h16l-3 -12h-10Z`, c) + line(`M${n(x - 10)} ${n(y)}h20`, 3.4);
/** Speed lines behind a walker. */
export const speed = (x, y, f = 1) => line(`M${n(x)} ${n(y)}l${n(-14 * f)} 2M${n(x - 12 * f)} ${n(y + 8)}l${n(-14 * f)} 2`, 2, ` opacity="0.6"`);
