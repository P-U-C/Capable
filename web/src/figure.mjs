// W6 — the Founder-Citizen. A geometric mark on a 120×120 grid, 1.5px strokes.
// One stroke group per strand, one notch per idea read on that strand. It
// grows with the series and is never complete. Pure: returns an SVG string.

import { html, join, num } from "./html.mjs";
import { ideaStrands } from "./model.mjs";

const CX = 60;
const CY = 58;
const R = 44;
const OUTER = 54;
const GAP = 28; // degrees, centred on the bottom of the circle
const rad = (d) => (d * Math.PI) / 180;
const pt = (cx, cy, r, deg) => [cx + r * Math.cos(rad(deg)), cy + r * Math.sin(rad(deg))];
const seg = (a, b) => `M${num(a[0])} ${num(a[1])}L${num(b[0])} ${num(b[1])}`;
/** Evenly spaced positions in (0,1) for n slots. */
const slots = (n) => Array.from({ length: n }, (_, i) => (i + 0.5) / n);

// Trust: two arcs facing each other inside the circle. Each is part of a
// circle of radius 30; the chord is vertical (y 34..82) and the arc bows 12px.
const TRUST_R = 30;
const TRUST_HALF = (Math.asin(24 / TRUST_R) * 180) / Math.PI; // ≈ 53.13°
const TRUST_LEFT = { cx: 64, cy: CY, from: 180 - TRUST_HALF, to: 180 + TRUST_HALF };
const TRUST_RIGHT = { cx: 56, cy: CY, from: -TRUST_HALF, to: TRUST_HALF };

/** Base marks and notch placement for the four strands the book started with. */
const KNOWN = {
  tools: {
    base: () => {
      const a = pt(CX, CY, R, 90 + GAP / 2);
      const b = pt(CX, CY, R, 90 - GAP / 2);
      return `M${num(a[0])} ${num(a[1])}A${R} ${R} 0 1 1 ${num(b[0])} ${num(b[1])}`;
    },
    notch: (t) => {
      const deg = 90 + GAP / 2 + (360 - GAP) * t;
      return seg(pt(CX, CY, R, deg), pt(CX, CY, R - 5.5, deg));
    },
  },
  trust: {
    base: () => {
      const l1 = pt(TRUST_LEFT.cx, TRUST_LEFT.cy, TRUST_R, TRUST_LEFT.from);
      const l2 = pt(TRUST_LEFT.cx, TRUST_LEFT.cy, TRUST_R, TRUST_LEFT.to);
      const r1 = pt(TRUST_RIGHT.cx, TRUST_RIGHT.cy, TRUST_R, TRUST_RIGHT.from);
      const r2 = pt(TRUST_RIGHT.cx, TRUST_RIGHT.cy, TRUST_R, TRUST_RIGHT.to);
      return `M${num(l1[0])} ${num(l1[1])}A${TRUST_R} ${TRUST_R} 0 0 1 ${num(l2[0])} ${num(l2[1])}` + `M${num(r1[0])} ${num(r1[1])}A${TRUST_R} ${TRUST_R} 0 0 1 ${num(r2[0])} ${num(r2[1])}`;
    },
    // Alternate between the two arcs; even spacing along each.
    notch: (t, i, n) => {
      const arc = i % 2 === 0 ? TRUST_LEFT : TRUST_RIGHT;
      const onArc = i % 2 === 0 ? Math.ceil(n / 2) : Math.floor(n / 2);
      const k = Math.floor(i / 2);
      const deg = arc.from + (arc.to - arc.from) * ((k + 0.5) / onArc);
      return seg(pt(arc.cx, arc.cy, TRUST_R, deg), pt(arc.cx, arc.cy, TRUST_R + 5, deg));
    },
  },
  choice: {
    base: () => `M${CX} 64L${CX} 110M54.5 104.5L${CX} 110L65.5 104.5`,
    notch: (t) => {
      const y = 68 + (98 - 68) * t;
      return seg([CX - 3.5, y], [CX + 3.5, y]);
    },
  },
  founding: {
    base: () => `M14 114L106 114M80 114L80 106L88 106L88 114`,
    notch: (t) => {
      // Spread along the ground line, stepping around the square.
      let x = 18 + (100 - 18) * t;
      if (x > 77 && x < 91) x = x < 84 ? 76 : 92;
      return seg([x, 114], [x, 118.5]);
    },
  },
};

// Unknown strands: a short arc on the outer ring, at a slot derived from the
// strand's index among unknown strands. Slots fill the top first, then
// alternate outwards, and never reach the ground line.
const RING_SLOTS = [270, 246, 294, 222, 318, 198, 342, 174, 366, 150, 390];
function ringPlace(k) {
  const round = Math.floor(k / RING_SLOTS.length);
  const angle = RING_SLOTS[k % RING_SLOTS.length] + (round % 2 === 1 ? 12 : 0) + (round > 1 ? 6 * (round - 1) : 0);
  const span = round === 0 ? 20 : 8;
  return { angle, span };
}
function composed(k) {
  const { angle, span } = ringPlace(k);
  return {
    base: () => {
      const a = pt(CX, CY, OUTER, angle - span / 2);
      const b = pt(CX, CY, OUTER, angle + span / 2);
      return `M${num(a[0])} ${num(a[1])}A${OUTER} ${OUTER} 0 0 1 ${num(b[0])} ${num(b[1])}`;
    },
    notch: (t) => {
      const deg = angle - span / 2 + span * t;
      return seg(pt(CX, CY, OUTER, deg), pt(CX, CY, OUTER - 4.5, deg));
    },
  };
}

/** Geometry for every strand in the book, in book order. Exported for tests. */
export function marks(m) {
  let unknown = 0;
  return m.strands.map((s) => ({ strand: s, geo: KNOWN[s.id] || composed(unknown++), known: s.id in KNOWN }));
}

/**
 * Facts the Figure shows: per strand, the ideas on it (by catalogue number),
 * which are read, and the state of its mark.
 */
export function facets(m, reads) {
  const readSet = new Set(reads);
  const last = [...reads].reverse().find((id) => m.byId.has(id) && ideaStrands(m, m.byId.get(id)).length);
  const recent = new Set(last ? ideaStrands(m, m.byId.get(last)) : []);
  return m.strands.map((s) => {
    const ideas = m.chapters.filter((c) => ideaStrands(m, c).includes(s.id)).sort((a, b) => a.number - b.number || (a.id < b.id ? -1 : 1));
    const read = ideas.filter((c) => readSet.has(c.id)).length;
    const state = read === 0 ? "unread" : recent.has(s.id) ? "recent" : "read";
    return { strand: s, ideas, read, total: ideas.length, state, readSet };
  });
}

/** "N ideas read across M strands" numbers. */
export function figureStats(m, reads) {
  const fs = facets(m, reads);
  const readSet = new Set(reads);
  const ideas = m.chapters.filter((c) => readSet.has(c.id) && ideaStrands(m, c).length).length;
  return { ideas, strands: fs.filter((f) => f.read > 0).length, total: m.strands.length };
}

export function statsLine(st) {
  if (st.ideas === 0) return "No ideas read yet. Each one you read adds a mark.";
  return `${st.ideas} ${st.ideas === 1 ? "idea" : "ideas"} read across ${st.strands} ${st.strands === 1 ? "strand" : "strands"}`;
}

/**
 * Render the Figure.
 * opts.idPrefix — unique per figure on a page
 * opts.highlight — strand ids to mark in rubric (the "You, now" view)
 * opts.className — extra class (size variants)
 */
export function renderFigure(m, reads, opts = {}) {
  const prefix = opts.idPrefix || "fig";
  const hl = new Set(opts.highlight || []);
  const geo = new Map(marks(m).map((x) => [x.strand.id, x]));
  const fs = facets(m, reads);
  const st = figureStats(m, reads);
  const name = (m.book.archetype && m.book.archetype.name) || "The Founder-Citizen";
  const groups = fs.map((f) => {
    const g = geo.get(f.strand.id);
    const n = f.total;
    const notches = [];
    const pos = slots(n);
    f.ideas.forEach((c, i) => {
      if (f.readSet.has(c.id)) notches.push(html`<path class="notch" d="${g.geo.notch(pos[i], i, n)}" data-idea="${c.id}"/>`);
    });
    const state = hl.size ? (hl.has(f.strand.id) ? "hl" : f.state === "recent" ? "read" : f.state) : f.state;
    const facetName = (f.strand.facet && f.strand.facet.name) || f.strand.name;
    const title = `${facetName} — ${f.read} of ${n} ${n === 1 ? "idea" : "ideas"}`;
    return html`<g class="facet" data-strand="${f.strand.id}" data-state="${state}" data-known="${g.known ? "1" : "0"}"><title>${title}</title><path class="base" d="${g.geo.base()}"/>${notches}</g>`;
  });
  const label = `${name}: ${statsLine(st)}`;
  return html`<svg class="fig${opts.className ? " " + opts.className : ""}" viewBox="0 0 120 120" role="img" aria-labelledby="${prefix}-t" focusable="false"><title id="${prefix}-t">${label}</title>${join(groups)}</svg>`;
}
