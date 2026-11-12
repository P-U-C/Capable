// portrait: the passport photo. The citizen figure (round head, rounded
// shoulders) with seeded hair or headwear, a collar or garment, minimal face
// hints, a background colour block and pixel confetti in the corners.
// Square (160 units), drawn with line weights that hold from a 48 px avatar to
// a 320 px passport page.

import { PAPER, INK, CANDIES, SURFACE, SLATE, LILAC, BLUSH, SKY, normColor } from "../palette.mjs";
import { rand } from "./rand.mjs";
import { n, svgDoc, idPrefix } from "./svg.mjs";

const V = 160;
const LW = 3.5; // line weight
const S = `stroke="${INK}" stroke-width="${LW}" stroke-linejoin="round"`;
const P = (d, fill) => `<path d="${d}" fill="${fill}" ${S} stroke-linecap="round"/>`;
const L = (d, w = LW, color = INK) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${n(w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
const C = (cx, cy, r, fill, stroke = true) => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"${stroke ? " " + S : ""}/>`;

export const HAIR = ["none", "crop", "fringe", "bun", "puff", "long", "bob", "spikes", "curls", "ponytail", "undercut"];
export const HATS = ["none", "beanie", "cap", "beret", "headband", "bucket"];
export const GARMENTS = ["crew", "vneck", "collar", "turtleneck", "hoodie", "overalls", "scarf", "stripes", "lapels"];
export const BLOCKS = ["full", "disc", "arch", "split"];
export const BACKDROPS = ["plain", "dots", "stripes", "rays"];
export const EYES = ["none", "dots", "happy", "glasses"];

const BG = [...CANDIES, LILAC, BLUSH, SKY];

/** Choose every feature of a portrait from its seed (exported for tests and docs). */
export function portraitTraits(seed, color) {
  const r = rand(`portrait|${seed}`);
  let bg = r.pick(BG);
  // always draw the garment, so a caller's colour changes the clothes, not the person
  const drawn = r.pick([...CANDIES, SLATE, INK, SURFACE].filter((x) => x !== bg));
  const garment = color ? normColor(color) : drawn;
  // a caller's colour never vanishes into the background
  if (garment === bg) bg = BG[(BG.indexOf(bg) + 3) % BG.length];
  const hatKind = r.weighted(HATS, [10, 2, 2, 1.5, 1.5, 1.5]);
  const hairKind = r.weighted(HAIR, [1, 3, 3, 2, 2, 2.5, 2, 1, 1.5, 1.5, 1]);
  const hairColor = r.weighted([INK, SLATE, ...CANDIES.filter((x) => x !== bg && x !== garment)], [6, 2, 0.5, 0.5, 0.5, 0.5].slice(0, 2 + CANDIES.filter((x) => x !== bg && x !== garment).length));
  const hatColor = r.pick([...CANDIES, SLATE, INK].filter((x) => x !== bg && x !== garment));
  return {
    r,
    bg,
    garment,
    hair: hairKind,
    hairColor,
    hat: hatKind,
    hatColor,
    collar: r.pick(GARMENTS),
    block: r.weighted(BLOCKS, [3, 3, 2, 1.5]),
    backdrop: r.weighted(BACKDROPS, [3, 2, 1.5, 1.5]),
    eyes: r.weighted(EYES, [3.5, 4, 1.5, 1]),
    blush: r.chance(0.3),
    smile: r.chance(0.3),
    tilt: r.int(-7, 7),
    hx: 80 + r.int(-4, 4),
    hy: 74 + r.int(-3, 3),
    hr: r.int(26, 30),
  };
}

// ---- hair -------------------------------------------------------------------------

/** Hair drawn behind the head. */
function hairBack(t) {
  const { hx, hy, hr: R, hairColor: hc, r } = t;
  switch (t.hair) {
    case "bun":
      return C(hx + r.int(-4, 4), hy - R - 8, 12, hc);
    case "puff":
      return C(hx, hy - 6, R * 1.42, hc);
    case "long": {
      const w = R + 9;
      return P(`M${n(hx - w)} ${n(hy + R + 30)}V${n(hy - 4)}A${n(w)} ${n(w)} 0 0 1 ${n(hx + w)} ${n(hy - 4)}V${n(hy + R + 30)}Z`, hc);
    }
    case "bob": {
      const w = R + 7;
      return P(`M${n(hx - w)} ${n(hy + R * 0.55)}V${n(hy - 4)}A${n(w)} ${n(w)} 0 0 1 ${n(hx + w)} ${n(hy - 4)}V${n(hy + R * 0.55)}Q${n(hx + w)} ${n(hy + R * 0.75)} ${n(hx + w - 8)} ${n(hy + R * 0.75)}H${n(hx - w + 8)}Q${n(hx - w)} ${n(hy + R * 0.75)} ${n(hx - w)} ${n(hy + R * 0.55)}Z`, hc);
    }
    case "ponytail": {
      const f = r.sign();
      return `<ellipse cx="${n(hx + f * (R + 6))}" cy="${n(hy + 4)}" rx="9" ry="18" transform="rotate(${f * 18} ${n(hx + f * (R + 6))} ${n(hy + 4)})" fill="${hc}" ${S}/>`;
    }
    default:
      return "";
  }
}

/** The cap of hair over the top of the head, with a hairline of a given shape. */
function hairCap(hx, hy, R, hairline) {
  const a = (deg) => [hx + (R + 1) * Math.cos((deg * Math.PI) / 180), hy - (R + 1) * Math.sin((deg * Math.PI) / 180)];
  const [lx, ly] = a(188);
  const [rx, ry] = a(-8);
  return `M${n(lx)} ${n(ly)}A${n(R + 1)} ${n(R + 1)} 0 0 1 ${n(rx)} ${n(ry)}${hairline(rx, ry, lx, ly)}Z`;
}

/** Hair drawn over the head. */
function hairFront(t, hatted) {
  const { hx, hy, hr: R, hairColor: hc, r } = t;
  if (hatted) return "";
  const arch = (k) => (rx, ry, lx, ly) => `Q${n(hx)} ${n(hy - R * k)} ${n(lx)} ${n(ly)}`;
  switch (t.hair) {
    case "none":
      return "";
    case "crop":
    case "bun":
    case "ponytail":
      return P(hairCap(hx, hy, R, arch(0.75)), hc);
    case "puff":
      return P(hairCap(hx, hy, R, arch(0.55)), hc);
    case "fringe": {
      const f = r.sign();
      return P(hairCap(hx, hy, R, (rx, ry, lx, ly) => `Q${n(hx + f * R * 0.2)} ${n(hy - R * 0.05)} ${n(hx - f * R * 0.3)} ${n(hy - R * 0.45)}Q${n(hx - f * R * 0.5)} ${n(hy - R * 0.1)} ${n(lx)} ${n(ly)}`), hc);
    }
    case "long":
    case "bob":
      return P(hairCap(hx, hy, R, (rx, ry, lx, ly) => `Q${n(hx + R * 0.5)} ${n(hy - R * 0.5)} ${n(hx)} ${n(hy - R * 0.62)}Q${n(hx - R * 0.5)} ${n(hy - R * 0.5)} ${n(lx)} ${n(ly)}`), hc);
    case "spikes": {
      let d = `M${n(hx - R)} ${n(hy - 6)}`;
      const k = 5;
      for (let i = 0; i <= k; i++) {
        const ang = Math.PI * (1 - i / k);
        const x = hx + (R + 12) * Math.cos(ang) * 0.92;
        const y = hy - 6 - (R + 12) * Math.sin(ang);
        const ang2 = Math.PI * (1 - (i + 0.5) / k);
        d += `L${n(x)} ${n(y)}`;
        if (i < k) d += `L${n(hx + R * 0.8 * Math.cos(ang2))} ${n(hy - 6 - R * 0.8 * Math.sin(ang2))}`;
      }
      d += `L${n(hx + R)} ${n(hy - 6)}Q${n(hx)} ${n(hy - R * 0.7)} ${n(hx - R)} ${n(hy - 6)}Z`;
      return P(d, hc);
    }
    case "curls": {
      let o = "";
      for (let i = 0; i < 7; i++) {
        const ang = Math.PI * (0.02 + (0.96 * i) / 6);
        o += C(hx + (R + 1) * Math.cos(ang), hy - 4 - (R + 1) * Math.sin(ang) * 0.95, 9, hc);
      }
      return o;
    }
    case "undercut": {
      const f = r.sign();
      return P(`M${n(hx - f * R * 0.2)} ${n(hy - R - 1)}A${n(R + 1)} ${n(R + 1)} 0 0 ${f > 0 ? 1 : 0} ${n(hx + f * (R + 1))} ${n(hy - 4)}Q${n(hx + f * R * 0.5)} ${n(hy - R * 0.4)} ${n(hx - f * R * 0.45)} ${n(hy - R * 0.62)}Q${n(hx - f * R * 0.7)} ${n(hy - R * 0.75)} ${n(hx - f * R * 0.2)} ${n(hy - R - 1)}Z`, hc);
    }
    default:
      return "";
  }
}

// ---- headwear ---------------------------------------------------------------------------

function hat(t) {
  const { hx, hy, hr: R, hatColor: hc, r } = t;
  switch (t.hat) {
    case "beanie": {
      const top = hy - R - 6;
      return P(`M${n(hx - R - 2)} ${n(hy - 6)}V${n(hy - 12)}C${n(hx - R - 2)} ${n(top - 6)} ${n(hx + R + 2)} ${n(top - 6)} ${n(hx + R + 2)} ${n(hy - 12)}V${n(hy - 6)}Z`, hc) + P(`M${n(hx - R - 3)} ${n(hy - 16)}h${n(2 * R + 6)}v10h${n(-2 * R - 6)}Z`, hc) + C(hx, top - 4, 6, hc);
    }
    case "cap": {
      const f = r.sign();
      return P(hairCap(hx, hy - 2, R, (rx, ry, lx, ly) => `L${n(lx)} ${n(ly)}`), hc) + P(`M${n(hx + f * (R - 6))} ${n(hy - 6)}h${n(f * 26)}q${n(f * 6)} 0 ${n(f * 2)} 6h${n(-f * 30)}Z`, hc) + C(hx, hy - R - 2, 3, INK, false);
    }
    case "beret": {
      const f = r.sign();
      return `<ellipse cx="${n(hx + f * 4)}" cy="${n(hy - R + 4)}" rx="${n(R + 6)}" ry="12" transform="rotate(${f * 8} ${n(hx)} ${n(hy - R)})" fill="${hc}" ${S}/>` + L(`M${n(hx + f * 4)} ${n(hy - R - 8)}v-6`, 3.5);
    }
    case "headband":
      return P(`M${n(hx - R - 1)} ${n(hy - 12)}Q${n(hx)} ${n(hy - 22)} ${n(hx + R + 1)} ${n(hy - 12)}v9Q${n(hx)} ${n(hy - 13)} ${n(hx - R - 1)} ${n(hy - 3)}Z`, hc);
    case "bucket": {
      return P(hairCap(hx, hy - 4, R - 2, (rx, ry, lx, ly) => `L${n(lx)} ${n(ly)}`), hc) + P(`M${n(hx - R - 12)} ${n(hy - 2)}L${n(hx - R + 2)} ${n(hy - 14)}H${n(hx + R - 2)}L${n(hx + R + 12)} ${n(hy - 2)}Z`, hc);
    }
    default:
      return "";
  }
}

// ---- face -------------------------------------------------------------------------------

function face(t) {
  const { hx, hy } = t;
  const ey = hy + 3;
  let o = "";
  if (t.eyes === "dots") o += `<circle cx="${n(hx - 9)}" cy="${n(ey)}" r="2.8" fill="${INK}"/><circle cx="${n(hx + 9)}" cy="${n(ey)}" r="2.8" fill="${INK}"/>`;
  if (t.eyes === "happy") o += L(`M${n(hx - 13)} ${n(ey + 1)}q4 -5 8 0M${n(hx + 5)} ${n(ey + 1)}q4 -5 8 0`, 2.8);
  if (t.eyes === "glasses") o += `<circle cx="${n(hx - 10)}" cy="${n(ey)}" r="7" fill="none" ${S}/><circle cx="${n(hx + 10)}" cy="${n(ey)}" r="7" fill="none" ${S}/>` + L(`M${n(hx - 3)} ${n(ey)}h6`, 3) + `<circle cx="${n(hx - 10)}" cy="${n(ey)}" r="2" fill="${INK}"/><circle cx="${n(hx + 10)}" cy="${n(ey)}" r="2" fill="${INK}"/>`;
  if (t.blush) o += `<circle cx="${n(hx - 16)}" cy="${n(ey + 9)}" r="4.5" fill="${BLUSH}"/><circle cx="${n(hx + 16)}" cy="${n(ey + 9)}" r="4.5" fill="${BLUSH}"/>`;
  if (t.smile) o += L(`M${n(hx - 6)} ${n(hy + 15)}q6 5 12 0`, 2.8);
  return o;
}

// ---- garment ------------------------------------------------------------------------------

const SH_TOP = 112;
const shoulders = (x, k = 0) => `M${n(x - 60 - k)} ${V + 6}V${n(146)}C${n(x - 60 - k)} ${n(SH_TOP + 10 - k)} ${n(x - 36)} ${n(SH_TOP - k)} ${n(x)} ${n(SH_TOP - k)}C${n(x + 36)} ${n(SH_TOP - k)} ${n(x + 60 + k)} ${n(SH_TOP + 10 - k)} ${n(x + 60 + k)} ${146}V${V + 6}Z`;

function garmentBack(t) {
  if (t.collar !== "hoodie") return "";
  const { hx, hy, hr: R, garment } = t;
  const w = R + 13;
  return P(`M${n(hx - w)} ${SH_TOP + 8}V${n(hy - 2)}A${n(w)} ${n(w + 2)} 0 0 1 ${n(hx + w)} ${n(hy - 2)}V${SH_TOP + 8}Z`, garment);
}

function garment(t, p) {
  const { hx, garment: g, r } = t;
  const contrast = g === INK || g === SLATE ? SURFACE : INK;
  let o = P(shoulders(hx), g);
  const x = hx;
  switch (t.collar) {
    case "crew":
      o += L(`M${n(x - 16)} ${SH_TOP + 1}Q${n(x)} ${SH_TOP + 14} ${n(x + 16)} ${SH_TOP + 1}`, 3.2, contrast);
      break;
    case "vneck":
      o += P(`M${n(x - 15)} ${SH_TOP}L${n(x)} ${SH_TOP + 22}L${n(x + 15)} ${SH_TOP}Z`, SURFACE);
      break;
    case "collar":
      o += P(`M${n(x - 18)} ${SH_TOP - 1}L${n(x - 2)} ${SH_TOP + 6}L${n(x - 10)} ${SH_TOP + 18}Z`, SURFACE) + P(`M${n(x + 18)} ${SH_TOP - 1}L${n(x + 2)} ${SH_TOP + 6}L${n(x + 10)} ${SH_TOP + 18}Z`, SURFACE) + `<circle cx="${n(x)}" cy="${SH_TOP + 28}" r="2.6" fill="${contrast}"/><circle cx="${n(x)}" cy="${SH_TOP + 40}" r="2.6" fill="${contrast}"/>`;
      break;
    case "turtleneck":
      o += P(`M${n(x - 15)} ${SH_TOP + 6}V${SH_TOP - 12}h30v${18}Z`, g) + L(`M${n(x - 15)} ${SH_TOP - 4}h30M${n(x - 15)} ${SH_TOP + 1}h30`, 2, contrast);
      break;
    case "hoodie":
      o += L(`M${n(x - 8)} ${SH_TOP + 4}v20M${n(x + 8)} ${SH_TOP + 4}v16`, 3, contrast) + `<circle cx="${n(x - 8)}" cy="${SH_TOP + 26}" r="2.6" fill="${contrast}"/><circle cx="${n(x + 8)}" cy="${SH_TOP + 22}" r="2.6" fill="${contrast}"/>`;
      break;
    case "overalls":
      o += P(`M${n(x - 30)} ${SH_TOP + 22}L${n(x - 24)} ${SH_TOP + 4}h10L${n(x - 18)} ${SH_TOP + 24}Z`, SURFACE) + P(`M${n(x + 30)} ${SH_TOP + 22}L${n(x + 24)} ${SH_TOP + 4}h-10L${n(x + 18)} ${SH_TOP + 24}Z`, SURFACE) + P(`M${n(x - 24)} ${V + 6}V${SH_TOP + 30}h48V${V + 6}Z`, g === INK ? SLATE : r.pick(CANDIES.filter((c) => c !== g && c !== t.bg))) + `<circle cx="${n(x - 16)}" cy="${SH_TOP + 37}" r="3" fill="${INK}"/><circle cx="${n(x + 16)}" cy="${SH_TOP + 37}" r="3" fill="${INK}"/>`;
      break;
    case "scarf": {
      const sc = r.pick([...CANDIES, SURFACE].filter((c) => c !== g && c !== t.bg));
      const f = r.sign();
      o += P(`M${n(x - 26)} ${SH_TOP + 2}Q${n(x)} ${SH_TOP + 18} ${n(x + 26)} ${SH_TOP + 2}L${n(x + 24)} ${SH_TOP - 10}Q${n(x)} ${SH_TOP + 2} ${n(x - 24)} ${SH_TOP - 10}Z`, sc) + P(`M${n(x + f * 8)} ${SH_TOP + 8}l${n(f * 4)} 34h${n(f * 13)}l${n(-f * 2)} -36Z`, sc);
      break;
    }
    case "stripes": {
      let d = "";
      for (let y = SH_TOP + 16; y < V; y += 11) d += `M${n(x - 62)} ${y}H${n(x + 62)}`;
      o += `<path d="${d}" stroke="${contrast}" stroke-width="3.5" clip-path="url(#${p}-c)"/>` + L(`M${n(x - 16)} ${SH_TOP + 1}Q${n(x)} ${SH_TOP + 12} ${n(x + 16)} ${SH_TOP + 1}`, 3.2, contrast);
      break;
    }
    case "lapels":
      o += P(`M${n(x - 14)} ${SH_TOP}L${n(x)} ${SH_TOP + 30}L${n(x + 14)} ${SH_TOP}Z`, SURFACE) + P(`M${n(x - 14)} ${SH_TOP}L${n(x - 24)} ${SH_TOP + 18}L${n(x - 14)} ${SH_TOP + 22}L${n(x)} ${SH_TOP + 30}Z`, g) + P(`M${n(x + 14)} ${SH_TOP}L${n(x + 24)} ${SH_TOP + 18}L${n(x + 14)} ${SH_TOP + 22}L${n(x)} ${SH_TOP + 30}Z`, g);
      break;
    default:
  }
  return o;
}

// ---- background ---------------------------------------------------------------------------

function background(t, p) {
  const { r, bg } = t;
  const o = [`<rect width="${V}" height="${V}" fill="${PAPER}"/>`];
  let shape = "";
  if (t.block === "full") shape = `M0 0H${V}V${V}H0Z`;
  if (t.block === "disc") shape = `M${80 - 66} 78a66 66 0 1 0 132 0a66 66 0 1 0 -132 0Z`;
  if (t.block === "arch") shape = `M18 ${V}V74A62 62 0 0 1 142 74V${V}Z`;
  if (t.block === "split") shape = `M0 0H${V}V${r.int(40, 70)}L0 ${r.int(100, 130)}Z`;
  o.push(`<path d="${shape}" fill="${bg}"/>`);
  if (t.backdrop === "dots") o.push(`<path d="${shape}" fill="url(#${p}-d)"/>`);
  if (t.backdrop === "stripes") o.push(`<path d="${shape}" fill="url(#${p}-s)"/>`);
  if (t.backdrop === "rays") {
    const cx = t.hx;
    const cy = t.hy;
    const count = r.pick([12, 14, 16]);
    let d = "";
    for (let i = 0; i < count; i++) {
      const a0 = ((i + 0.25) * 2 * Math.PI) / count;
      const a1 = ((i + 0.75) * 2 * Math.PI) / count;
      d += `M${n(cx)} ${n(cy)}L${n(cx + 200 * Math.cos(a0))} ${n(cy + 200 * Math.sin(a0))}L${n(cx + 200 * Math.cos(a1))} ${n(cy + 200 * Math.sin(a1))}Z`;
    }
    const ray = bg === SURFACE || [LILAC, BLUSH, SKY].includes(bg) ? SURFACE : PAPER;
    o.push(`<g clip-path="url(#${p}-b)"><path d="${d}" fill="${ray}" opacity="0.55"/></g>`);
  }
  if (t.block !== "full") o.push(`<path d="${shape}" fill="none" stroke="${INK}" stroke-width="${LW}"/>`);
  return { svg: o.join(""), shape };
}

function confetti(t) {
  const { r, bg } = t;
  const cols = [...CANDIES, INK].filter((c) => c !== bg && c !== t.garment);
  const corners = r.shuffle([[4, 4], [126, 4], [4, 118], [126, 118]]);
  const k = r.int(4, 7);
  let o = "";
  for (let i = 0; i < k; i++) {
    const [cx, cy] = corners[i % 4];
    const sz = r.pick([5, 6, 8]);
    // bottom corners: stay outside the shoulders
    const x = cx + (cy > 100 ? (cx < 80 ? r.int(0, 6) : r.int(24, 30 - sz)) : r.int(0, 30 - sz));
    const y = cy + r.int(0, 36 - sz);
    o += `<rect x="${x}" y="${y}" width="${sz}" height="${sz}" fill="${r.pick(cols)}"/>`;
  }
  return o;
}

/**
 * portrait({seed, color?, uid?}) → SVG (160×160 viewBox).
 *   seed   any non-empty string (an fid, an address, a local random id)
 *   color  optional "#RRGGBB": the garment colour (e.g. the person's latest trait)
 *   uid    optional salt for the id prefix
 */
export function portraitSvg(seed, color, { uid = "", title = "A citizen's portrait" } = {}) {
  const t = portraitTraits(seed, color);
  const p = idPrefix("portrait", `${seed}|${color || ""}`, uid);
  const { svg: bgSvg, shape } = background(t, p);
  const hatted = t.hat !== "none";
  const tilt = `rotate(${t.tilt} ${n(t.hx)} ${n(t.hy + t.hr)})`;
  const back = hatted && ["bun", "spikes", "curls", "undercut", "crop", "fringe"].includes(t.hair) ? "" : hairBack(t);
  const backGroup = back ? `<g transform="${tilt}">${back}</g>` : "";
  const headGroup =
    `<g transform="${tilt}">` +
    `<circle cx="${n(t.hx)}" cy="${n(t.hy)}" r="${t.hr}" fill="${SURFACE}" ${S}/>` +
    face(t) +
    hairFront(t, hatted) +
    hat(t) +
    `</g>`;
  const shadow = `<g transform="translate(5 5)" fill="${INK}"><path d="${shoulders(t.hx)}"/><circle cx="${n(t.hx)}" cy="${n(t.hy)}" r="${t.hr + 1}" transform="${tilt}"/></g>`;
  const defs =
    `<defs>` +
    `<pattern id="${p}-d" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><circle cx="4" cy="4" r="1.5" fill="${INK}" opacity="0.28"/></pattern>` +
    `<pattern id="${p}-s" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><path d="M0 3H12" stroke="${PAPER}" stroke-width="4" opacity="0.5"/></pattern>` +
    `<clipPath id="${p}-b"><path d="${shape}"/></clipPath>` +
    `<clipPath id="${p}-c"><path d="${shoulders(t.hx, -1.5)}"/></clipPath>` +
    `</defs>`;
  const body = defs + bgSvg + confetti(t) + shadow + backGroup + garmentBack(t) + garment(t, p) + headGroup;
  return svgDoc({ viewBox: `0 0 ${V} ${V}`, title, body, extra: "" });
}
