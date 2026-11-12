// capable's art grammar: the ArtAPI of contract/citizen.d.ts.
//
//   seal({mode, size?})                 the logo: "logo" | "lockup" | "favicon"
//   iconSvg({size, maskable?})          app icons rendered from the seal
//   lessonScene({lessonId, color, title?})  a unique riso scene per lesson id
//   portrait({seed, color?})            the passport photo
//   stamp                               contract/badge-art.mjs badgeSvg, unchanged
//
// Pure functions: same input → byte-identical SVG. Only palette colours
// (palette.mjs) plus a caller's trait colour. No external references. Every
// id inside an SVG starts with a prefix derived from the piece's seed.
// See docs/ART.md.

import { badgeSvg } from "../contract/badge-art.mjs";
import { normColor } from "./palette.mjs";
import { seal as sealImpl, iconSvg as iconImpl } from "./lib/seal.mjs";
import { lessonScene as sceneImpl } from "./lib/scene.mjs";
import { portraitSvg } from "./lib/portrait.mjs";

export { PAPER, INK, CANDIES, TINTS, ALLOWED } from "./palette.mjs";
export { TEMPLATE_NAMES, sceneChoice } from "./lib/scene.mjs";
export { FAVICON, TRAIT_QUARTER } from "./lib/seal.mjs";

const nonEmpty = (s, what) => {
  if (typeof s !== "string" || !s.length) throw new TypeError(`${what}: a non-empty string is required`);
  if (s.length > 256) throw new TypeError(`${what}: at most 256 characters`);
  return s;
};

/**
 * The citizen seal. "logo" = seal only; "lockup" = seal + wordmark;
 * "favicon" = simplified ring + head and shoulders, legible at 16 px.
 * `size` sets the rendered height in px (and drives optical sizing: under
 * 96 px the seal drops its beaded rim and ring rules).
 * Extension: `filled` (optional, logo and lockup) is a list of trait ids
 * ("sovereign", "civil", "mobile", "enduring"); only their ring quarters are
 * coloured, the others print as paper, so the logo fills in as traits are
 * earned. Omitted → the full ring.
 */
export function seal(opts = {}) {
  const { mode = "logo", size, filled } = opts;
  if (size != null && !(Number.isFinite(size) && size > 0)) throw new TypeError("seal: size must be a positive number");
  return sealImpl({ mode, size, filled });
}

/** App icon (192, 512, maskable, apple-touch): the seal on a solid paper square. */
export function iconSvg(opts = {}) {
  return iconImpl(opts);
}

/**
 * A unique scene for a lesson. Extensions beyond the contract (optional):
 * `uid` salts the id prefix when one scene appears twice on a page; `grain:
 * false` drops the built-in riso grain for frames that already carry one.
 */
export function lessonScene(opts = {}) {
  const { lessonId, color, title, uid = "", grain = true } = opts;
  return sceneImpl(nonEmpty(lessonId, "lessonScene: lessonId"), normColor(color, "lessonScene: color"), { title, uid: String(uid), grain: grain !== false });
}

/**
 * A passport portrait, unique per seed (fid, address or a local random id).
 * `color` (optional) is the garment colour. Extensions (optional): `uid` salts
 * the id prefix; `title` names it (default "A citizen's portrait"; "" makes it
 * decorative, e.g. an avatar beside a visible name).
 */
export function portrait(opts = {}) {
  const { seed, color, uid = "", title = "A citizen's portrait" } = opts;
  const s = typeof seed === "number" && Number.isFinite(seed) ? String(seed) : seed;
  return portraitSvg(nonEmpty(s, "portrait: seed"), color == null ? undefined : normColor(color, "portrait: color"), { uid: String(uid), title: title == null ? "" : String(title) });
}

/** The stamp: exactly contract/badge-art.mjs badgeSvg (imported, not copied). */
export const stamp = badgeSvg;

/** The whole ArtAPI as one object. */
export const art = Object.freeze({ seal, lessonScene, portrait, stamp, iconSvg });
export default art;
