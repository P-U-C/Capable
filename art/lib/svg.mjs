// Small string helpers shared by every generator. Output is plain SVG text:
// numbers are rounded to one decimal so bytes are stable and small.

import { hash32 } from "./rand.mjs";

/** A number for SVG: at most one decimal, no "-0", no exponent. */
export function n(x) {
  const v = Math.round(x * 10) / 10;
  return Object.is(v, -0) || v === 0 ? "0" : String(v);
}

/** Escape text for element content and attribute values. */
export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Strip characters XML 1.0 forbids (controls other than tab/newline) before escaping a title. */
export const cleanText = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "").trim();

/**
 * The id prefix for one SVG: a letter plus base-36 hash of the generator kind
 * and its seed (and an optional caller salt). Every id in that SVG starts with
 * it, so two different pieces inlined on one page never share an id.
 */
export const idPrefix = (kind, seed, salt = "") => `${kind[0]}${hash32(`${kind}|${seed}|${salt}`).toString(36)}`;

/**
 * The outer <svg>. `title` (optional) makes it role="img", named by aria-label
 * and a first-child <title> (no id, so copies never clash); without one the
 * piece is decorative (aria-hidden).
 */
export function svgDoc({ viewBox, width, height, title, body, extra = "" }) {
  const size = width ? ` width="${n(width)}" height="${n(height ?? width)}"` : "";
  const t = title ? cleanText(title) : "";
  const a11y = t ? ` role="img" aria-label="${esc(t)}"` : ` aria-hidden="true"`;
  const head = t ? `<title>${esc(t)}</title>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${size}${a11y} focusable="false"${extra}>${head}${body}</svg>`;
}

/** Polar point on a circle; angle in degrees, 0 = +x, counter-clockwise on screen (y up). */
export const polar = (cx, cy, r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
};

/** A circle as a path (for compound shapes). */
export const circlePath = (cx, cy, r) => `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;

/** An arc path from angle a0 to a1 (degrees, counter-clockwise on screen). */
export function arcPath(cx, cy, r, a0, a1) {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const span = (((a1 - a0) % 360) + 360) % 360;
  return `M${n(x0)} ${n(y0)}A${n(r)} ${n(r)} 0 ${span > 180 ? 1 : 0} 0 ${n(x1)} ${n(y1)}`;
}
