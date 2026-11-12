// lessonScene: a unique two-tone riso scene per lesson id.
//
// The seed (the lesson id) picks one of the composition TEMPLATES, mirrors it
// or not, and then picks that template's parameters: horizon, hero shape,
// motif positions, figure count, poses and items, background pattern. Each
// template is a small, legible picture of a civic idea, drawn with the motif
// vocabulary in motifs.mjs, so a generated scene reads as illustrated rather
// than as random clip art.
//
// Frame: like the hand-drawn scenes, the subject sits in a 320×240 safe box
// and the paper, sky and ground bleed past it, so `meet` scaling fills a wide
// tile or a tall 9:16 card with no empty bars.

import { PAPER, INK, SURFACE, SLATE } from "../palette.mjs";
import { rand } from "./rand.mjs";
import { n, svgDoc, idPrefix } from "./svg.mjs";
import * as M from "./motifs.mjs";

export const W = 320;
export const H = 240;
/** Bleed: enough for a 9:16 card or a 2:1 tile around the safe box. */
export const BLEED = { x: -160, y: -240, w: 640, h: 720 };
const BX1 = BLEED.x + BLEED.w;
const BY1 = BLEED.y + BLEED.h;

// ---- shared layers ---------------------------------------------------------------

function defs(p, r) {
  const seedA = r.int(1, 999);
  const seedB = r.int(1, 999);
  return (
    `<defs>` +
    `<pattern id="${p}-d" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(28)"><circle cx="3" cy="3" r="1.25" fill="${SLATE}"/></pattern>` +
    `<pattern id="${p}-k" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-20)"><circle cx="2.5" cy="2.5" r="1.1" fill="${INK}" opacity="0.45"/></pattern>` +
    `<pattern id="${p}-h" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 3.5H7" stroke="${SLATE}" stroke-width="1.6"/></pattern>` +
    // riso grain: dark specks and light specks (same recipe as the app's --grain)
    `<filter id="${p}-g" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="${seedA}" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.086 0 0 0 0 0.086 0 0 0 0 0.086 0 0 0 -15 5.4"/></filter>` +
    `<filter id="${p}-l" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="${seedB}" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1 0 0 0 0 0.992 0 0 0 0 0.965 0 0 0 15 -9.6"/></filter>` +
    `</defs>`
  );
}

const fillRect = (x, y, w, h, fill, op) => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${fill}"${op != null ? ` opacity="${op}"` : ""}/>`;
/** A pattern over a region. */
const pat = (p, k, x, y, w, h, op) => fillRect(x, y, w, h, `url(#${p}-${k})`, op);
/** The ground line across the whole bleed. */
const groundLine = (y) => M.line(`M${BLEED.x} ${n(y)}H${BX1}`);
/** Sky treatment above y: halftone dots, hatch, or nothing (grain only). */
function sky(r, p, y, { min = 0.18, max = 0.45 } = {}) {
  const kind = r.weighted(["dots", "hatch", "plain", "band"], [5, 2, 2, 2]);
  const op = n(r.range(min, max));
  if (kind === "dots") return pat(p, "d", BLEED.x, BLEED.y, BLEED.w, y - BLEED.y, op);
  if (kind === "hatch") return pat(p, "h", BLEED.x, BLEED.y, BLEED.w, y - BLEED.y, n(Math.min(0.5, +op + 0.05)));
  if (kind === "band") {
    const top = r.int(-40, 30);
    return pat(p, "d", BLEED.x, top, BLEED.w, y - top, n(+op + 0.1)) + pat(p, "d", BLEED.x, BLEED.y, BLEED.w, top - BLEED.y, n(+op * 0.4));
  }
  return "";
}
/** Ground treatment below y. */
function ground(r, p, y, kind) {
  const k = kind || r.weighted(["dots", "slate"], [3, 2]);
  if (k === "slate") return fillRect(BLEED.x, y, BLEED.w, BY1 - y, SLATE) + pat(p, "k", BLEED.x, y, BLEED.w, BY1 - y);
  return pat(p, "d", BLEED.x, y, BLEED.w, BY1 - y, n(r.range(0.6, 0.85)));
}
const fillsFor = (r, c, count, allowC = true) => {
  const pool = allowC ? [SURFACE, SLATE, c, SURFACE] : [SURFACE, SLATE, SURFACE];
  const start = r.int(0, pool.length - 1);
  return Array.from({ length: count }, (_, i) => pool[(start + i) % pool.length]);
};

// ---- templates ---------------------------------------------------------------------
// Each: (r, c, p) → { body, about }. `about` is a short description used in docs/tests.

const TEMPLATES = {
  /** A door ajar in a wall; someone walks out. */
  threshold(r, c, p) {
    const gy = r.int(194, 206);
    const wx1 = r.int(176, 214);
    const wy = r.int(22, 54);
    const dw = r.int(44, 58);
    const dh = Math.min(r.int(92, 114), gy - wy - 26);
    const dx0 = wx1 - dw - r.int(16, 44);
    const o = [];
    o.push(r.chance(0.6) ? pat(p, "d", wx1, BLEED.y, BX1 - wx1, gy - BLEED.y, n(r.range(0.4, 0.6))) : pat(p, "h", wx1, BLEED.y, BX1 - wx1, gy - BLEED.y, 0.45));
    o.push(M.regPath(`M${BLEED.x} ${wy}H${wx1}V${gy}H${BLEED.x}Z`, c));
    o.push(M.bricks(BLEED.x, wx1, wy, gy, { x0: dx0, x1: dx0 + dw, y0: gy - dh }, r.pick([20, 22, 24])));
    o.push(M.doorway(dx0, dx0 + dw, gy - dh, gy, `${p}-k`, 1));
    const decor = r.pick(["key", "lamp", "flag", "plaque"]);
    if (decor === "key" && dx0 > 70) {
      const kx = r.int(26, dx0 - 50);
      const ky = r.int(wy + 34, Math.min(gy - 60, wy + 70));
      o.push(M.line(`M${kx} ${ky - 12}v-10`, 2.6) + `<circle cx="${kx}" cy="${ky - 24}" r="2.6" fill="${INK}"/>` + M.bigKey(kx, ky, r.int(-34, -14), c));
    } else if (decor === "flag" && wy >= 62) {
      o.push(M.flag(r.int(30, wx1 - 40), wy, r.int(38, 52), SURFACE, r.sign()));
    } else if (decor === "plaque" && dx0 > 60) {
      const px = r.int(20, dx0 - 46);
      const py = r.int(wy + 30, gy - 70);
      o.push(M.rect(px, py, 36, 24, SURFACE, 3) + M.line(`M${px + 7} ${py + 9}h22M${px + 7} ${py + 16}h14`, 2.4));
    } else {
      o.push(M.lamp(dx0 - 22, gy - dh + 26, SURFACE));
    }
    o.push(ground(r, p, gy, "dots"));
    o.push(`<path d="M${dx0} ${gy}h${dw}l${r.int(50, 80)} ${BY1 - gy}h${-dw - r.int(90, 130)}Z" fill="${SURFACE}" opacity="0.7"/>`);
    o.push(groundLine(gy));
    const fx = r.int(wx1 + 36, 288);
    const item = r.pick(["bag", "bag", "key", "flag", null]);
    o.push(M.figure(fx, gy + 14, { s: r.range(0.98, 1.1), fill: r.pick([c, c, SURFACE]), step: 1.1, item, itemFill: item === "flag" ? c : SLATE, arm: item === "flag" ? "hold" : "down", hat: r.pick([null, null, "cap", "beanie"]) }));
    o.push(M.speed(fx - 32, gy + 8));
    if (r.chance(0.5)) o.push(M.figure(dx0 + dw / 2, gy, { s: 0.9, fill: r.pick([SURFACE, SLATE]), step: 0, facing: 1, arm: "wave" }));
    return { body: o.join(""), about: "a door ajar in a wall, someone walking out" };
  },

  /** People around a table under a big disc: talking it through. */
  table(r, c, p) {
    const gy = r.int(198, 208);
    const o = [];
    o.push(r.chance(0.5) ? pat(p, "d", BLEED.x, gy - 12, BLEED.w, BY1 - gy + 12, 0.7) : sky(r, p, gy));
    if (r.chance(0.7)) o.push(M.regCircle(r.int(124, 196), r.int(86, 110), r.int(80, 98), c));
    else {
      const ax = r.int(50, 90);
      const aw = r.int(150, 200);
      o.push(M.regPath(`M${ax} ${gy - 30}V${n(gy - 160 + aw / 2)}a${n(aw / 2)} ${n(aw / 2)} 0 0 1 ${aw} 0V${gy - 30}Z`, c));
    }
    if (r.chance(0.4)) o.push(M.bunting(-20, 340, r.int(10, 22), r.int(6, 12), [c, SURFACE, SLATE]));
    const ty = gy - 46;
    const tx0 = r.int(28, 56);
    const tx1 = r.int(264, 292);
    const k = r.int(2, 4);
    const span = tx1 - tx0 - 60;
    const fills = fillsFor(r, c, k, false);
    const talker = r.int(0, k - 1);
    const xs = [];
    for (let i = 0; i < k; i++) {
      const x = tx0 + 30 + (k === 1 ? span / 2 : (span * i) / (k - 1)) + r.int(-6, 6);
      xs.push(x);
      const facing = x < (tx0 + tx1) / 2 ? 1 : -1;
      const arm = i === talker ? r.pick(["up", "wave"]) : r.pick(["down", "down", "hold"]);
      o.push(M.figure(x, ty + 12, { s: 1.08, fill: fills[i], facing, step: 0.3, arm, hat: r.pick([null, null, null, "cap", "beanie"]), itemFill: c }));
    }
    o.push(M.rect(tx0, ty, tx1 - tx0, 12, SLATE, 3));
    o.push(M.line(`M${tx0 + 22} ${ty + 12}V${gy}M${tx1 - 22} ${ty + 12}V${gy}`, 5));
    // cups and papers between the people
    for (let i = 0; i + 1 < xs.length || i < 1; i++) {
      const mid = xs.length > 1 ? (xs[i] + xs[i + 1]) / 2 : xs[0] + 30;
      const kind = r.pick(["cup", "cup", "paper", "bowl"]);
      if (kind === "cup") o.push(M.cup(mid - 8, ty, r.pick([SURFACE, c]), r.sign()));
      else if (kind === "paper") o.push(M.rect(mid - 12, ty - 4, 24, 4, SURFACE, 1) + M.rect(mid - 10, ty - 8, 22, 4, SURFACE, 1));
      else o.push(M.P(`M${n(mid - 14)} ${ty}a14 10 0 0 0 28 0Z`, c));
    }
    const bx = Math.min(250, Math.max(8, xs[talker] + (xs[talker] < 160 ? 12 : -72)));
    o.push(M.bubble(bx, r.int(16, 34), r.int(56, 66), 32, xs[talker] < 160 ? -1 : 1, r.int(1, 3)));
    o.push(groundLine(gy));
    return { body: o.join(""), about: "people talking at a table" };
  },

  /** Small towns on rolling hills, a path walked between them. */
  towns(r, c, p) {
    const o = [];
    o.push(sky(r, p, 260, { min: 0.18, max: 0.32 }));
    const hl = r.int(206, 220);
    const hr = r.int(180, 198);
    const q1 = r.int(60, 100);
    const q2 = r.int(-48, -30);
    const hill = `M${BLEED.x} ${hl}L-4 ${hl - 4}q${q1} ${q2} 160 -8t168 ${hr - hl + 12}L${BX1} ${hr}`;
    const hillLayer = `<path d="${hill}V${BY1}H${BLEED.x}Z" fill="${c}" transform="translate(1.5 1)"/>` + M.line(hill);
    const layouts = [
      [[52, 196], [164, 88], [266, 190]],
      [[60, 120], [160, 200], [262, 112]],
      [[48, 150], [150, 92], [256, 186]],
      [[70, 196], [226, 102]],
    ];
    const L = r.pick(layouts).map(([x, y]) => [x + r.int(-10, 10), y + r.int(-8, 8)]);
    // the sun goes in whichever top spot is farthest from every town
    const spots = [[r.int(40, 64), r.int(32, 50)], [r.int(146, 174), r.int(28, 40)], [r.int(256, 282), r.int(32, 50)]];
    const far = (pt) => Math.min(...L.map(([x, y]) => Math.hypot(pt[0] - x, pt[1] - (y - 24))));
    const [sx, sy] = spots.reduce((a, b) => (far(b) > far(a) ? b : a));
    o.push(M.sun(sx, sy, r.int(16, 22), c, r.chance(0.5) ? 8 : 0));
    o.push(hillLayer);
    const ext = [];
    const tf = r.shuffle([c, SLATE, SURFACE]);
    L.forEach(([x, y], i) => {
      const fill = y > 170 && tf[i] === c ? SURFACE : tf[i];
      const count = r.int(2, 4);
      let hx = x - 12 * count;
      const parts = [];
      for (let j = 0; j < count; j++) {
        const w = r.int(18, 26);
        const h = r.int(16, 34);
        parts.push(M.house(hx, y, w, h, fill));
        if (j === Math.floor(count / 2)) parts.push(M.win(hx + w / 2 - 8, y - h + 8, 7) + M.win(hx + w / 2 + 1, y - h + 8, 7));
        hx += w + r.int(2, 6);
      }
      o.push(parts.join("") + M.line(`M${x - 12 * count - 10} ${y}H${hx + 8}`));
      ext.push([x - 12 * count - 10, hx + 8, y]);
      if (r.chance(0.25)) o.push(M.pine(hx + 10, y, r.int(26, 36), fill === SLATE ? SURFACE : SLATE));
    });
    for (let i = 0; i + 1 < L.length; i++) {
      const [a, b] = [L[i], L[i + 1]];
      const ctrl = [(a[0] + b[0]) / 2 + r.int(-30, 30), Math.min(a[1], b[1]) + r.int(-10, 30)];
      if (r.chance(0.65)) o.push(M.footprints([a[0] + 18, a[1] + 8], ctrl, [b[0] - 20, b[1] + 6], r.int(5, 8)));
      else o.push(M.line(`M${a[0] + 18} ${a[1] + 8}Q${n(ctrl[0])} ${n(ctrl[1])} ${b[0] - 20} ${b[1] + 6}`, 3.2, ` stroke-dasharray="0.1 9"`));
    }
    if (r.chance(0.4)) {
      const [x0, x1, y] = ext[ext.length - 1];
      const right = x1 + 22 < 296;
      o.push(M.signpost(right ? x1 + 16 : x0 - 16, y, 46, [{ dir: right ? 1 : -1, fill: SURFACE }]));
    }
    return { body: o.join(""), about: "small towns on hills and a path walked between them" };
  },

  /** A street: houses, one civic building, a big sun. */
  street(r, c, p) {
    const gy = r.int(184, 196);
    const o = [];
    o.push(sky(r, p, gy, { min: 0.12, max: 0.28 }));
    o.push(M.sun(r.int(110, 210), r.int(74, 98), r.int(62, 80), c, r.chance(0.7) ? 8 : 0));
    o.push(ground(r, p, gy, "slate"));
    let x = r.int(6, 22);
    const civicAt = r.int(1, 3);
    const lotAt = r.chance(0.5) ? r.int(0, 4) : -1;
    let i = 0;
    while (x < 300) {
      if (i === lotAt && i !== civicAt) {
        const w = r.int(26, 36);
        o.push(`<rect x="${x}" y="${gy - 20}" width="${w}" height="20" fill="none" stroke="${INK}" stroke-width="2" stroke-dasharray="4 4"/>`);
        x += w + 6;
      } else if (i === civicAt) {
        const kind = r.pick(["hall", "workshop", "block"]);
        const w = r.int(64, 84);
        const h = r.int(44, 62);
        if (kind === "hall") {
          o.push(M.hall(x + 4, gy, w, h, SLATE));
          o.push(M.flag(x + 4 + w / 2, gy - h - w * 0.28, 28, c, r.sign()));
        } else if (kind === "workshop") {
          o.push(M.workshop(x, gy, w, h, SLATE, 3));
          o.push(M.rect(x + 12, gy - 28, 16, 28, c) + M.win(x + 40, gy - 34, 10) + M.win(x + 56, gy - 34, 10));
          o.push(M.rect(x + w - 14, gy - h - 34, 10, 30, SLATE) + M.line(`M${x + w - 9} ${gy - h - 40}q-6 -8 2 -14t0 -14`, 2.2));
        } else {
          o.push(M.block(x, gy, w, h + 10, SLATE));
          for (let wy = gy - h; wy < gy - 26; wy += 16) o.push(M.win(x + 10, wy, 9) + M.win(x + w - 19, wy, 9));
          o.push(M.rect(x + w / 2 - 9, gy - 26, 18, 26, c));
          o.push(M.flag(x + w / 2, gy - h - 10, 26, c, r.sign()));
        }
        x += w + 10;
      } else {
        const w = r.int(28, 38);
        const h = r.int(24, 38);
        o.push(r.chance(0.8) ? M.house(x, gy, w, h, SURFACE) : M.block(x, gy, w, h + 8, SURFACE));
        o.push(M.win(x + w / 2 - 4, gy - h + 8, 8));
        x += w + r.int(4, 10);
      }
      i++;
    }
    o.push(groundLine(gy));
    if (r.chance(0.5)) o.push(M.lampPost(r.pick([30, 160, 290]), gy + 30, 50, c));
    const walkers = r.int(0, 2);
    for (let j = 0; j < walkers; j++) o.push(M.figure(r.int(40, 280), gy + r.int(26, 40), { s: 0.62, fill: r.pick([SURFACE, c]), facing: r.sign(), step: 1, item: r.pick([null, "bag"]), itemFill: SURFACE }));
    return { body: o.join(""), about: "a street of houses and one civic building under a big sun" };
  },

  /** A bridge over a river; people meet in the middle. */
  bridge(r, c, p) {
    const by = r.int(150, 170);
    const rx0 = r.int(66, 96);
    const rx1 = r.int(224, 254);
    const wy = by + r.int(30, 40);
    const mid = (rx0 + rx1) / 2;
    const hump = r.int(18, 30);
    const o = [];
    o.push(sky(r, p, by, { min: 0.15, max: 0.32 }));
    if (r.chance(0.6)) o.push(M.sun(r.pick([r.int(40, 90), r.int(230, 280)]), r.int(36, 60), r.int(20, 28), c, r.chance(0.5) ? 8 : 0));
    else o.push(M.cloud(r.int(30, 90), r.int(50, 70), 70) + M.cloud(r.int(200, 250), r.int(36, 56), 60));
    // banks
    o.push(`<path d="M${BLEED.x} ${by}H${rx0}L${rx0 + 16} ${wy}H${rx1 - 16}L${rx1} ${by}H${BX1}V${BY1}H${BLEED.x}Z" fill="url(#${p}-d)" opacity="0.75"/>`);
    // water
    o.push(fillRect(rx0 + 10, wy, rx1 - rx0 - 20, BY1 - wy, SLATE) + pat(p, "k", rx0 + 10, wy, rx1 - rx0 - 20, BY1 - wy));
    let waves = "";
    for (let k = 0; k < 6; k++) {
      const x = rx0 + 26 + ((k * 37) % (rx1 - rx0 - 50));
      const y = wy + 12 + ((k * 13) % 40);
      waves += `M${n(x)} ${y}q5 -4 10 0t10 0`;
    }
    o.push(`<path d="${waves}" fill="none" stroke="${SURFACE}" stroke-width="2.2" stroke-linecap="round"/>`);
    o.push(M.line(`M${BLEED.x} ${by}H${rx0}L${rx0 + 16} ${wy}M${rx1 - 16} ${wy}L${rx1} ${by}H${BX1}`));
    // trees on the banks
    const tl = r.int(1, 2);
    for (let k = 0; k < tl; k++) o.push(r.chance(0.5) ? M.pine(r.int(14, rx0 - 34), by, r.int(34, 50), r.pick([SURFACE, SLATE])) : M.tree(r.int(16, rx0 - 34), by, r.int(16, 26), r.int(14, 20), r.pick([SURFACE, SLATE])));
    if (r.chance(0.7)) o.push(M.tree(r.int(rx1 + 30, 300), by, r.int(16, 26), r.int(14, 20), r.pick([SURFACE, SLATE])));
    // the bridge: a humped deck over an arch
    const a = (rx1 - 14 - (rx0 + 14)) / 2;
    const b = wy - (by + 12);
    const deck = `M${rx0 - 26} ${by}Q${n(mid)} ${by - hump * 2} ${rx1 + 26} ${by}L${rx1 + 4} ${wy}H${rx1 - 14}A${n(a)} ${n(b)} 0 0 0 ${rx0 + 14} ${wy}H${rx0 - 4}Z`;
    o.push(M.regPath(deck, c));
    const yAt = (x) => {
      const t = (x - (rx0 - 26)) / (rx1 + 26 - (rx0 - 26));
      return (1 - t) ** 2 * by + 2 * (1 - t) * t * (by - hump * 2) + t * t * by;
    };
    let rail = `M${rx0 - 20} ${n(yAt(rx0 - 20) - 16)}`;
    let posts = "";
    for (let x = rx0 - 20; x <= rx1 + 20; x += 16) {
      rail += `L${x} ${n(yAt(x) - 16)}`;
      posts += `M${x} ${n(yAt(x))}V${n(yAt(x) - 16)}`;
    }
    o.push(M.line(posts, 2.2) + M.line(rail, 2.6));
    // people on the bridge
    if (r.chance(0.6)) {
      const g = r.int(16, 26);
      o.push(M.figure(mid - g, yAt(mid - g), { s: 0.82, fill: SURFACE, facing: 1, step: 0.4, arm: r.pick(["out", "wave"]) }));
      o.push(M.figure(mid + g, yAt(mid + g), { s: 0.82, fill: SLATE, facing: -1, step: 0.4, arm: r.pick(["out", "down"]), item: r.pick([null, "bag"]), itemFill: SURFACE }));
    } else {
      const x = mid + r.int(-40, 40);
      o.push(M.figure(x, yAt(x), { s: 0.84, fill: SURFACE, facing: r.sign(), step: 1, item: "bag", itemFill: SLATE }));
    }
    return { body: o.join(""), about: "a bridge over a river, people meeting on it" };
  },

  /** A ballot box on a plinth and a queue of voters. */
  ballot(r, c, p) {
    const gy = r.int(196, 206);
    const o = [];
    o.push(sky(r, p, gy));
    const bx = r.int(150, 196);
    o.push(M.regCircle(bx + r.int(-20, 20), r.int(88, 108), r.int(76, 92), c));
    if (r.chance(0.35)) o.push(M.bunting(-20, 340, r.int(8, 18), r.int(5, 10), [SURFACE, SLATE, c]));
    o.push(ground(r, p, gy, "dots"));
    // plinth and box
    o.push(M.rect(bx - 30, gy - 40, 60, 40, SLATE) + pat(p, "k", bx - 30, gy - 40, 60, 40));
    o.push(M.ballotBox(bx - 24, gy - 40, 48, 42, SURFACE, c === SURFACE ? SLATE : c));
    // flag
    const fx = r.int(266, 300);
    o.push(M.flag(fx, gy, r.int(96, 130), r.pick([SURFACE, c]), -1));
    // the voter and the queue
    const k = r.int(1, 3);
    const fills = fillsFor(r, c, k + 1, true);
    o.push(M.figure(bx - 52, gy, { s: 1, fill: fills[0], facing: 1, step: 0.2, arm: "out" }));
    for (let i = 0; i < k; i++) {
      o.push(M.figure(bx - 92 - i * r.int(32, 40), gy, { s: 1, fill: fills[i + 1], facing: 1, step: 0.15, arm: r.pick(["down", "hold"]), item: r.pick([null, "paper", "bag"]), itemFill: SURFACE, hat: r.pick([null, null, "cap", "beanie"]) }));
    }
    o.push(groundLine(gy));
    return { body: o.join(""), about: "a ballot box and a queue of voters" };
  },

  /** A big tree on the commons, a bench, people resting under it. */
  commons(r, c, p) {
    const gy = r.int(192, 204);
    const tx = r.int(116, 196);
    const o = [];
    o.push(sky(r, p, gy, { min: 0.15, max: 0.3 }));
    if (r.chance(0.4)) o.push(M.sun(r.pick([46, 274]), r.int(36, 54), r.int(16, 22), SURFACE, 8));
    o.push(ground(r, p, gy, "dots"));
    if (r.chance(0.35)) {
      const t2 = tx + r.sign() * r.int(96, 130);
      if (t2 > 20 && t2 < 300) o.push(M.tree(t2, gy, r.int(26, 36), r.int(18, 24), SLATE));
    }
    if (r.chance(0.4)) {
      const mw = r.int(130, 180);
      o.push(M.P(`M${n(tx - mw / 2)} ${gy}Q${n(tx)} ${gy - r.int(20, 30)} ${n(tx + mw / 2)} ${gy}Z`, SURFACE));
    }
    // canopy: a cluster of circles, ink pass under a misregistered colour pass
    const th = r.int(54, 70);
    const cy = gy - th - 34;
    const blobs = [[0, 0, r.int(44, 52)]];
    const nb = r.int(2, 4);
    for (let i = 0; i < nb; i++) {
      const a = Math.PI * (0.9 + (1.2 * i) / Math.max(1, nb - 1)) + r.range(-0.15, 0.15);
      const d = r.int(34, 46);
      blobs.push([Math.cos(a) * d, Math.sin(a) * d * 0.7, r.int(26, 34)]);
    }
    o.push(M.rect(tx - 7, gy - th, 14, th, SLATE));
    o.push(M.line(`M${tx} ${gy - th + 18}l-16 -18M${tx} ${gy - th + 30}l14 -16`, 4));
    o.push(blobs.map(([x, y, rr]) => `<circle cx="${n(tx + x)}" cy="${n(cy + y)}" r="${n(rr + 1.3)}" fill="${INK}"/>`).join(""));
    o.push(`<g transform="translate(1.5 1)">${blobs.map(([x, y, rr]) => `<circle cx="${n(tx + x)}" cy="${n(cy + y)}" r="${n(rr - 1.3)}" fill="${c}"/>`).join("")}</g>`);
    o.push(M.shade(tx, cy, blobs[0][2]) + M.shade(tx + blobs[1][0], cy + blobs[1][1], blobs[1][2]));
    // bench and people
    const side = r.sign();
    const bw = r.int(54, 66);
    const bx = side > 0 ? tx + 18 : tx - 18 - bw;
    o.push(M.bench(bx, gy, bw, SURFACE));
    const sitters = r.int(1, 2);
    for (let i = 0; i < sitters; i++) o.push(M.sitter(bx + 16 + i * 26, gy, 18, { s: 0.86, fill: r.pick([SURFACE, SLATE, c]), facing: -side, arm: r.pick(["down", "up"]) }));
    if (r.chance(0.6)) {
      const fx = side > 0 ? r.int(30, tx - 50) : r.int(tx + 50, 290);
      o.push(M.figure(fx, gy + 6, { s: 0.9, fill: r.pick([SURFACE, c]), facing: side, step: r.pick([0.2, 1]), arm: r.pick(["wave", "down"]), item: r.pick([null, "bag"]), itemFill: SLATE }));
    }
    if (r.chance(0.5)) {
      const x0 = side > 0 ? BLEED.x + 100 : bx + bw + 40;
      o.push(M.fence(Math.max(-60, x0), Math.min(380, x0 + 120), gy, 24, SURFACE));
    }
    if (r.chance(0.5)) o.push(M.birds([[r.int(40, 100), r.int(30, 60)], [r.int(60, 120), r.int(20, 50)], [r.int(220, 290), r.int(24, 60)]]));
    o.push(groundLine(gy));
    return { body: o.join(""), about: "a big tree on the commons, a bench and people under it" };
  },

  /** A road to the horizon, a road across it, and a signpost: choosing a way. */
  crossroads(r, c, p) {
    const hz = r.int(110, 126);
    const vx = r.int(138, 162);
    const o = [];
    o.push(sky(r, p, hz));
    o.push(M.sun(r.pick([r.int(56, 100), r.int(214, 262)]), hz - r.int(34, 50), r.int(22, 30), c, r.chance(0.6) ? 8 : 0));
    // distant hills, printed in halftone
    const hills = `M${BLEED.x} ${hz}H-10q${r.int(40, 60)} ${-r.int(26, 46)} ${r.int(100, 130)} 0q${r.int(50, 70)} ${-r.int(20, 36)} ${r.int(110, 140)} 0q${r.int(30, 50)} ${-r.int(14, 30)} ${r.int(90, 110)} 0H${BX1}`;
    o.push(`<path d="${hills}V${hz}Z" fill="${PAPER}"/><path d="${hills}V${hz}Z" fill="url(#${p}-d)" opacity="0.9"/>` + M.line(hills));
    // a field in the trait colour on one side, furrows running to the road
    const field = `M${BLEED.x} ${hz}H${vx - 6}L${vx - 150} ${BY1}H${BLEED.x}Z`;
    o.push(`<path d="${field}" fill="${c}" transform="translate(1.5 1)"/>`);
    o.push(pat(p, "d", vx, hz, BX1 - vx, BY1 - hz, 0.7));
    let rows = "";
    for (let k = 1; k <= 6; k++) {
      const y = hz + k * k * 4 + 6;
      rows += `M${BLEED.x} ${y}H${n(vx - 14 - ((y - hz) * 144) / (BY1 - hz))}`;
    }
    o.push(M.line(rows, 1.8, ` opacity="0.6"`));
    // the road, and a road crossing it near the horizon
    const cy0 = hz + r.int(10, 16);
    o.push(M.P(`M${vx - 6} ${hz}L${vx - 150} ${BY1}H${vx + 150}L${vx + 6} ${hz}Z`, SURFACE));
    o.push(fillRect(BLEED.x, cy0, BLEED.w, 9, SURFACE) + M.line(`M${BLEED.x} ${cy0}H${BX1}M${BLEED.x} ${cy0 + 9}H${BX1}`, 2));
    o.push(M.line(`M${vx} ${cy0 + 16}L${vx} ${BY1}`, 3, ` stroke-dasharray="10 12"`));
    o.push(M.line(`M${BLEED.x} ${hz}H${BX1}`, 2.2));
    if (r.chance(0.5)) {
      // a small town where the road meets the horizon
      let tx = vx - r.int(26, 40);
      for (let k = r.int(2, 4); k > 0; k--) {
        const w = r.int(10, 14);
        const h = r.int(8, 16);
        o.push(M.house(tx, hz, w, h, r.pick([SURFACE, SLATE, c])));
        tx += w + 2;
      }
    }
    if (r.chance(0.45)) for (let k = 0; k < 3; k++) o.push(M.pine(vx + 44 + k * r.int(34, 46) + k * k * 6, hz + 18 + k * k * 9, 22 + k * 9, SLATE));
    if (r.chance(0.4)) o.push(M.figure(vx + r.int(-6, 6), hz + r.int(34, 46), { s: 0.36, fill: r.pick([SURFACE, c]), facing: r.sign(), step: 1, item: "bag", itemFill: SLATE }));
    // the signpost on the far verge, the traveller on the road in front
    const sx = vx + r.int(78, 96);
    const sy = r.int(196, 208);
    const boards = r.shuffle([{ dir: -1, fill: c }, { dir: 1, fill: SURFACE }, { dir: -1, fill: SURFACE }]).slice(0, r.int(2, 3));
    o.push(M.signpost(sx, sy, r.int(72, 84), boards));
    o.push(M.figure(vx - r.int(8, 40), r.int(226, 236), { s: 1.12, fill: r.pick([SURFACE, SLATE]), facing: 1, step: 0.15, item: "bag", itemFill: c, arm: "down", hat: r.pick([null, "cap", "beanie"]) }));
    return { body: o.join(""), about: "a road to the horizon, a road across it, and a signpost" };
  },

  /** Someone speaks from the steps; a crowd listens. */
  assembly(r, c, p) {
    const px = r.int(110, 210);
    const top = r.int(120, 140);
    const o = [];
    o.push(sky(r, p, 200, { min: 0.15, max: 0.3 }));
    if (r.chance(0.65)) o.push(M.regCircle(px + r.int(-10, 10), top - r.int(36, 54), r.int(62, 80), c));
    else {
      const bw = r.int(170, 220);
      const bx = Math.max(20, Math.min(300 - bw, px - bw / 2));
      o.push(M.line(`M${bx} 204V${top - 96}M${bx + bw} 204V${top - 96}`, 3.4));
      o.push(M.regPath(`M${bx} ${top - 92}H${bx + bw}V${top - 40}Q${n(bx + bw / 2)} ${top - 30} ${bx} ${top - 40}Z`, c));
      o.push(M.line(`M${bx + 22} ${top - 76}h${bw - 44}M${bx + 40} ${top - 62}h${bw - 80}`, 4));
    }
    // steps
    const tiers = r.int(2, 3);
    for (let t = tiers - 1; t >= 0; t--) {
      const w = 70 + t * 34;
      const y = top + (tiers - 1 - t) * 0 + t * 16;
      o.push(M.rect(px - w / 2, y, w, 16, t % 2 ? SLATE : SURFACE, 2));
    }
    o.push(fillRect(BLEED.x, top + tiers * 16, BLEED.w, BY1 - top - tiers * 16, SLATE) + pat(p, "k", BLEED.x, top + tiers * 16, BLEED.w, BY1));
    o.push(groundLine(top + tiers * 16));
    o.push(M.figure(px, top, { s: 0.9, fill: c, facing: r.sign(), step: 0.2, arm: r.pick(["up", "wave"]), back: r.pick(["none", "down"]) }));
    // the crowd, seen from behind, bodies running into the bleed
    const k = r.int(5, 7);
    const xs = [];
    for (let i = 0; i < k; i++) xs.push(-10 + (340 * (i + 0.5)) / k + r.int(-8, 8));
    const rows = r.shuffle(xs.map((x, i) => [x, i]));
    for (const [x, i] of rows) {
      const y = r.int(218, 236);
      const s = r.range(0.95, 1.2);
      const fill = [SURFACE, SLATE, INK, c][(i + r.int(0, 3)) % 4];
      if (r.chance(0.3)) o.push(M.line(`M${n(x + 14 * s)} ${n(y - 22 * s)}L${n(x + 22 * s)} ${n(y - 64 * s)}`, 5 * s));
      if (r.chance(0.18)) o.push(M.line(`M${n(x - 16 * s)} ${n(y - 24 * s)}V${n(y - 86 * s)}`, 2.6) + M.rect(x - 32 * s, y - 104 * s, 32 * s, 22 * s, r.pick([c, SURFACE]), 3));
      o.push(`<path d="M${n(x - 20 * s)} ${BY1}V${n(y - 14 * s)}C${n(x - 20 * s)} ${n(y - 26 * s)} ${n(x - 12 * s)} ${n(y - 30 * s)} ${n(x)} ${n(y - 30 * s)}C${n(x + 12 * s)} ${n(y - 30 * s)} ${n(x + 20 * s)} ${n(y - 26 * s)} ${n(x + 20 * s)} ${n(y - 14 * s)}V${BY1}Z" fill="${fill}" stroke="${INK}" stroke-width="${M.LINE}"/>`);
      o.push(M.circle(x, y - 42 * s, 12 * s, fill === INK ? SURFACE : r.pick([SURFACE, SURFACE, INK])));
    }
    return { body: o.join(""), about: "someone speaking from the steps to a crowd" };
  },

  /** A fence with an open gate; a path runs through it. */
  gate(r, c, p) {
    const gy = r.int(176, 192);
    const gx = r.int(110, 180);
    const gw = r.int(60, 76);
    const o = [];
    o.push(sky(r, p, gy, { min: 0.18, max: 0.35 }));
    if (r.chance(0.6)) o.push(M.sun(r.pick([r.int(40, 80), r.int(240, 280)]), r.int(40, 60), r.int(18, 26), c, 8));
    const trees = r.int(2, 4);
    for (let i = 0; i < trees; i++) {
      const x = 20 + (280 * (i + 0.5)) / trees + r.int(-14, 14);
      if (Math.abs(x - (gx + gw / 2)) < gw / 2 + 10) continue;
      o.push(r.chance(0.5) ? M.tree(x, gy - 8, r.int(18, 28), r.int(14, 20), SLATE) : M.pine(x, gy - 8, r.int(36, 52), SLATE));
    }
    o.push(ground(r, p, gy, "dots"));
    // path through the gate, widening toward us
    o.push(M.P(`M${gx + 14} ${gy}L${gx - 40} ${BY1}H${gx + gw + 60}L${gx + gw - 14} ${gy}Z`, SURFACE));
    let stones = "";
    for (let k = 0; k < 4; k++) {
      const y = gy + 14 + k * k * 6 + k * 8;
      const w = 10 + k * 5;
      stones += `M${n(gx + gw / 2 - w / 2 + (k % 2 ? 8 : -8))} ${n(y)}h${n(w)}`;
    }
    o.push(M.line(stones, 4, ` opacity="0.55"`));
    o.push(M.fence(-60, gx - 8, gy, 30, SURFACE) + M.fence(gx + gw + 8, 380, gy, 30, SURFACE));
    // the gate: two pillars and an arch in the trait colour
    const ah = r.int(78, 96);
    o.push(M.rect(gx - 10, gy - ah, 16, ah, SLATE) + M.rect(gx + gw - 6, gy - ah, 16, ah, SLATE));
    const ar = (gw + 16) / 2;
    o.push(M.regPath(`M${gx - 10} ${gy - ah}a${n(ar)} ${n(ar * 0.8)} 0 0 1 ${gw + 16} 0h-12a${n(ar - 12)} ${n(ar * 0.8 - 12)} 0 0 0 ${-gw + 8} 0Z`, c));
    // an open leaf, swung toward us
    const lf = r.sign();
    const hx = lf > 0 ? gx + gw - 6 : gx + 6;
    const lw = gw * 0.42 * lf;
    o.push(M.P(`M${hx} ${gy - 46}l${n(lw)} 8v${42}l${n(-lw)} -4Z`, SURFACE) + M.line(`M${n(hx + lw * 0.33)} ${gy - 41}v42M${n(hx + lw * 0.66)} ${gy - 39}v41`, 2));
    o.push(groundLine(gy));
    // people: one walking through, maybe one waiting beyond, never stacked on each other
    const fx = gx + gw / 2 + r.int(-6, 6);
    const side = r.sign();
    const beyond = r.chance(0.5);
    const wx = fx + (beyond ? side * r.int(28, 44) : r.int(-24, 24));
    if (beyond) o.push(M.figure(fx - side * r.int(0, 8), gy - 4, { s: 0.62, fill: SLATE, facing: -side, step: 0, arm: "wave" }));
    o.push(M.figure(wx, gy + r.int(34, 46), { s: 1.05, fill: r.pick([c, SURFACE]), facing: r.sign(), step: 1, item: r.pick(["bag", null, "flag"]), itemFill: SLATE, arm: "down", hat: r.pick([null, null, "beanie"]) }));
    return { body: o.join(""), about: "a fence with an open gate and a path through it" };
  },
};

export const TEMPLATE_NAMES = Object.keys(TEMPLATES);

/** Which template and mirror a lesson id gets (for docs and tests). */
export function sceneChoice(lessonId) {
  const r = rand(`scene|${lessonId}`);
  return { template: r.pick(TEMPLATE_NAMES), mirror: r.chance(0.5) };
}

/**
 * lessonScene({lessonId, color, title?, uid?, grain?})
 *   lessonId  the seed (any non-empty string)
 *   color     the trait colour "#RRGGBB" (validated, uppercased)
 *   title     optional accessible name (role="img" + <title>); else aria-hidden
 *   uid       optional salt for the id prefix (two copies of one scene on a page)
 *   grain     default true; false when the frame already carries a grain overlay
 */
export function lessonScene(lessonId, color, { title, uid = "", grain = true } = {}) {
  const r = rand(`scene|${lessonId}`);
  const template = r.pick(TEMPLATE_NAMES);
  const mirror = r.chance(0.5);
  const p = idPrefix("scene", `${lessonId}|${color}`, uid);
  const d = defs(p, r);
  const { body } = TEMPLATES[template](r, color, p);
  const art = mirror ? `<g transform="matrix(-1 0 0 1 ${W} 0)">${body}</g>` : body;
  const grainLayer = grain
    ? `<rect x="${BLEED.x}" y="${BLEED.y}" width="${BLEED.w}" height="${BLEED.h}" filter="url(#${p}-g)" opacity="0.5"/><rect x="${BLEED.x}" y="${BLEED.y}" width="${BLEED.w}" height="${BLEED.h}" filter="url(#${p}-l)" opacity="0.7"/>`
    : "";
  const out = d + fillRect(BLEED.x, BLEED.y, BLEED.w, BLEED.h, PAPER) + art + grainLayer;
  return svgDoc({ viewBox: `0 0 ${W} ${H}`, title, body: out, extra: ` preserveAspectRatio="xMidYMid meet" data-template="${template}"` });
}
