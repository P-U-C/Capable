// W7 — the map of ideas. Strands are horizontal bands; ideas sit along them
// in publish order (one column per idea, so time reads left to right and no
// two ideas share a column); an idea on two strands sits between its bands;
// connections are hairline curves. Pure: layout is computed, then rendered.

import { html, join, num } from "./html.mjs";
import { plain } from "./inline.mjs";
import { ideaStrands, ideaConnections, isUnplaced, KIND_LABEL } from "./model.mjs";

export const DENSE = 12; // past this many nodes in a band, labels show only on hover/focus
export const CHAR_W = 6.4; // generous average advance of a 13px italic label glyph (Newsreader ≈ 5.6, Georgia ≈ 6)
export const LINE_H = 13;
export const GUTTER = 104; // left gutter that holds the (sticky) band names
const PAD_X = 8;
const PAD_Y = 0;
export const BAND_H = 88;
const NODE_DY = 30; // node row, measured from the band's top edge
export const UNPLACED = "unplaced";

/** Order strands so two-strand ideas sit on adjacent bands when that is possible. */
export function orderBands(ids, pairs) {
  const n = ids.length;
  const cost = (perm) => {
    const pos = new Map(perm.map((id, i) => [id, i]));
    return pairs.reduce((s, [a, b]) => s + Math.abs(pos.get(a) - pos.get(b)) - 1, 0);
  };
  if (!pairs.length || n < 3 || cost(ids) === 0 || n > 7) return [...ids];
  let best = ids;
  let bestCost = cost(ids);
  const used = new Array(n).fill(false);
  const cur = [];
  (function walk() {
    if (cur.length === n) {
      const c = cost(cur);
      if (c < bestCost) {
        bestCost = c;
        best = [...cur];
      }
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true;
      cur.push(ids[i]);
      walk();
      cur.pop();
      used[i] = false;
    }
  })();
  return best;
}

/** Wrap a title into at most two lines that fit `maxChars`, with an ellipsis if cut. */
export function wrapLabel(title, maxChars) {
  const words = String(title)
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > maxChars ? w.slice(0, maxChars - 1) + "…" : w));
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > 2) {
    const second = lines[1];
    lines.length = 2;
    lines[1] = (second.length >= maxChars ? second.slice(0, maxChars - 1) : second).replace(/…$/, "") + "…";
  }
  return lines.length ? lines : [""];
}

/** Compute the map's geometry. */
export function layoutMap(m, reads = [], { width: frameWidth = 0 } = {}) {
  const readSet = new Set(reads);
  const ideas = m.published.map((id) => m.byId.get(id)).filter(Boolean);
  const frameStart = ideas.filter((c) => c.kind === "prologue");
  const frameEnd = ideas.filter((c) => c.kind === "coda");
  const body = ideas.filter((c) => c.kind !== "prologue" && c.kind !== "coda");

  const pairs = [];
  for (const c of body) {
    const s = ideaStrands(m, c);
    if (s.length === 2) pairs.push(s);
  }
  const strandOrder = orderBands(m.strands.map((s) => s.id), pairs);
  const hasUnplaced = body.some((c) => isUnplaced(m, c));
  const bandIds = hasUnplaced ? [...strandOrder, UNPLACED] : strandOrder;

  const count = new Map(bandIds.map((id) => [id, 0]));
  for (const c of body) {
    const s = ideaStrands(m, c);
    for (const id of s.length ? s : [UNPLACED]) count.set(id, (count.get(id) || 0) + 1);
  }
  const anyDense = [...count.values()].some((n) => n > DENSE);
  // Columns fill the frame when there is room; never narrower than a label needs.
  const columnCount = frameStart.length + body.length + frameEnd.length;
  const colMin = anyDense ? 60 : frameWidth && frameWidth < 600 ? 84 : 104;
  const fill = frameWidth && columnCount ? Math.floor((frameWidth - GUTTER - PAD_X * 2) / columnCount) : 0;
  const colW = Math.max(colMin, Math.min(anyDense ? 60 : 168, fill));
  const maxChars = Math.floor((colW - 14) / CHAR_W);

  const bands = bandIds.map((id, i) => {
    const s = m.strandById.get(id);
    const top = PAD_Y + i * BAND_H;
    return {
      id,
      name: s ? s.name : "Just in · unplaced",
      top,
      h: BAND_H,
      row: top + NODE_DY,
      count: count.get(id) || 0,
      dense: (count.get(id) || 0) > DENSE,
      unplaced: id === UNPLACED,
    };
  });
  const bandBy = new Map(bands.map((b) => [b.id, b]));
  const height = PAD_Y * 2 + Math.max(1, bands.length) * BAND_H;
  const midY = bands.length ? (bands[0].row + bands[bands.length - 1].row) / 2 : PAD_Y + NODE_DY;

  const columns = [...frameStart, ...body, ...frameEnd];
  const nodes = columns.map((c, col) => {
    const x = GUTTER + PAD_X + col * colW + colW / 2;
    const frame = c.kind === "prologue" || c.kind === "coda";
    const s = frame ? [] : ideaStrands(m, c);
    const onBands = frame ? [] : s.length ? s : [UNPLACED];
    const rows = onBands.map((id) => bandBy.get(id).row);
    const y = frame ? midY : rows.reduce((a, b) => a + b, 0) / rows.length;
    const dense = onBands.some((id) => bandBy.get(id).dense);
    const lines = wrapLabel(c.title, maxChars);
    const w = Math.max(...lines.map((l) => l.length)) * CHAR_W;
    const labelBox = { x0: x - w / 2, x1: x + w / 2, y0: y + 10, y1: y + 10 + lines.length * LINE_H + 2 };
    return {
      id: c.id,
      number: c.number,
      title: c.title,
      line: plain(c.line),
      x,
      y,
      col,
      frame,
      bands: onBands,
      span: rows.length === 2 ? [Math.min(...rows), Math.max(...rows)] : null,
      draft: c.status === "draft",
      read: readSet.has(c.id),
      dense,
      showLabel: !dense,
      lines,
      labelBox,
    };
  });
  const nodeBy = new Map(nodes.map((n) => [n.id, n]));

  const edges = [];
  for (const c of columns) {
    for (const x of ideaConnections(m, c)) {
      const a = nodeBy.get(c.id);
      const b = nodeBy.get(x.to);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const bend = Math.min(64, 0.2 * len + 12);
      const cx = (a.x + b.x) / 2 + (dy / len) * bend;
      const cy = (a.y + b.y) / 2 + (-dx / len) * bend;
      edges.push({
        frame: a.frame || b.frame,
        from: c.id,
        to: x.to,
        kind: x.kind,
        why: plain(x.why),
        d: `M${num(a.x)} ${num(a.y)}Q${num(cx)} ${num(cy)} ${num(b.x)} ${num(b.y)}`,
        mid: { x: 0.25 * a.x + 0.5 * cx + 0.25 * b.x, y: 0.25 * a.y + 0.5 * cy + 0.25 * b.y },
      });
    }
  }
  const width = GUTTER + PAD_X * 2 + columns.length * colW;
  return { width, height, colW, bands, nodes, edges };
}

function nodeLabel(m, n) {
  const parts = [`${n.frame ? "" : `Idea ${n.number}, `}${n.title}`];
  if (n.bands.length && n.bands[0] !== UNPLACED) parts.push(n.bands.map((id) => m.strandById.get(id).name).join(" and "));
  else if (!n.frame) parts.push("not yet placed on a strand");
  if (n.draft) parts.push("draft");
  parts.push(n.read ? "read" : "not read");
  return parts.join(". ") + ".";
}

/** Render the map block: sticky band names (buttons) over an SVG. */
export function renderMap(m, reads = [], opts = {}) {
  const L = layoutMap(m, reads, { width: opts.width || 0 });
  const active = opts.filter || null;
  const titleOf = (id) => (m.byId.get(id) ? m.byId.get(id).title : id);

  const bandRows = L.bands.map(
    (b) => html`<div class="band${b.unplaced ? " band--unplaced" : ""}${active === b.id ? " is-active" : ""}" data-band="${b.id}"><button type="button" class="band-btn" data-act="filter" data-strand="${b.id}" aria-pressed="${active === b.id ? "true" : "false"}" aria-label="${`Show ${b.name} in the index (${b.count} ${b.count === 1 ? "idea" : "ideas"})`}">${b.name}</button></div>`,
  );

  const edges = L.edges.map(
    (e) => html`<g class="edge${e.kind === "in-tension-with" ? " edge--tension" : ""}${e.frame ? " edge--frame" : ""}" data-from="${e.from}" data-to="${e.to}" data-kind="${e.kind}"><title>${`${titleOf(e.from)} · ${KIND_LABEL[e.kind].toLowerCase()} · ${titleOf(e.to)}. ${e.why}`}</title><path class="edge-hit" d="${e.d}"/><path class="edge-line" d="${e.d}"/><text class="edge-kind" x="${num(e.mid.x)}" y="${num(e.mid.y - 4)}" text-anchor="middle">${KIND_LABEL[e.kind]}</text></g>`,
  );

  const hit = Math.min(22, L.colW / 2 - 2);
  const nodes = L.nodes.map((n) => {
    const stem = n.span && n.span[1] - n.span[0] > BAND_H + 1 ? html`<path class="stem" d="${`M${num(n.x)} ${num(n.span[0])}L${num(n.x)} ${num(n.span[1])}`}"/><circle class="stem-end" cx="${num(n.x)}" cy="${num(n.span[0])}" r="2"/><circle class="stem-end" cx="${num(n.x)}" cy="${num(n.span[1])}" r="2"/>` : "";
    const mark = n.frame
      ? html`<rect class="dot dot--frame" x="${num(n.x - 3.5)}" y="${num(n.y - 3.5)}" width="7" height="7"/>`
      : n.draft
        ? html`<circle class="dot dot--draft" cx="${num(n.x)}" cy="${num(n.y)}" r="5.25"/>`
        : html`<circle class="dot" cx="${num(n.x)}" cy="${num(n.y)}" r="4.5"/>`;
    const check = n.read ? html`<path class="check" d="${`M${num(n.x + 6)} ${num(n.y - 10)}l2.5 2.5l5 -6`}"/>` : "";
    const label = html`<text class="lbl" x="${num(n.x)}" y="${num(n.y + 10 + LINE_H - 2)}" text-anchor="middle">${n.lines.map((l, i) => html`<tspan x="${num(n.x)}" dy="${i === 0 ? "0" : String(LINE_H)}">${l}</tspan>`)}</text>`;
    return html`<a class="node${n.dense ? " node--dense" : ""}${n.draft ? " node--draft" : ""}${n.read ? " node--read" : ""}" href="${`#${n.id}`}" data-node="${n.id}" data-bands="${n.bands.join(" ")}" aria-label="${nodeLabel(m, n)}">${stem}<circle class="node-hit" cx="${num(n.x)}" cy="${num(n.y)}" r="${num(hit)}"/><circle class="node-focus" cx="${num(n.x)}" cy="${num(n.y)}" r="10"/>${mark}${check}${label}</a>`;
  });

  return html`<div class="map" data-dense="${L.bands.some((b) => b.dense) ? "1" : "0"}">
<div class="map-scroll" tabindex="0" role="group" aria-label="Map of ideas. Scrolls sideways. Each idea is a link; each strand name filters the index.">
<div class="map-canvas">
<div class="map-bands">${bandRows}</div>
<svg class="map-svg" width="${L.width}" height="${L.height}" viewBox="${`0 0 ${L.width} ${L.height}`}" focusable="false"><g class="edges">${edges}</g><g class="nodes">${nodes}</g></svg>
</div>
</div>
</div>`;
}
