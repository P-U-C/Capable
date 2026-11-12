// W7 — the map of ideas and the path switch.
import test from "node:test";
import assert from "node:assert/strict";
import { layoutMap, renderMap, orderBands, wrapLabel, DENSE, UNPLACED, GUTTER } from "../src/map.mjs";
import { model, ideaStrands, ideaConnections, neighbours, EDITORS, PUBLISHED } from "../src/model.mjs";
import { renderPage, indexBlock } from "../src/views.mjs";
import { blank } from "../src/progress.mjs";
import { validateBook } from "../../contract/validate.mjs";
import { fixture, makeBook } from "./synthetic.mjs";

const NOW = Date.parse("2026-11-12T17:00:00Z");
const ctxFor = (m, route, extra = {}) => ({ m, route, state: blank(), depth: 2, path: EDITORS, filter: null, voiceFilter: "all", newCount: 0, now: NOW, media: "link", ...extra });

function overlaps(a, b) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

test("synthetic books used here are valid Books", () => {
  for (const b of [makeBook({ ideas: 40 }), makeBook({ ideas: 12, draftsUnplaced: 3 })]) assert.deepEqual(validateBook(b), []);
});

test("every idea is a node on its strand(s); two-strand ideas sit between their bands", () => {
  const m = model(fixture());
  const L = layoutMap(m);
  const svg = String(renderMap(m));
  const band = new Map(L.bands.map((b) => [b.id, b]));
  for (const c of m.chapters) {
    const n = L.nodes.find((x) => x.id === c.id);
    assert.ok(n, `no node for ${c.id}`);
    assert.ok(svg.includes(`href="#${c.id}" data-node="${c.id}"`), c.id);
    const s = ideaStrands(m, c);
    if (c.kind === "prologue" || c.kind === "coda") assert.ok(n.frame);
    else if (s.length) assert.deepEqual(n.bands, s);
    if (s.length === 1) assert.equal(n.y, band.get(s[0]).row);
    if (s.length === 2) {
      const [a, b] = s.map((id) => band.get(id).row).sort((x, y) => x - y);
      assert.ok(n.y > a && n.y < b, `${c.id} not between its bands`);
    }
  }
  // exit is on tools + choice; the bands are ordered so those two are adjacent
  const order = L.bands.map((b) => b.id);
  assert.equal(Math.abs(order.indexOf("tools") - order.indexOf("choice")), 1);
});

test("nodes follow publish order left to right", () => {
  const m = model(makeBook({ ideas: 15 }));
  const L = layoutMap(m);
  const body = L.nodes.filter((n) => !n.frame);
  const expected = m.published.filter((id) => !["prologue", "next-pick"].includes(id));
  assert.deepEqual([...body].sort((a, b) => a.x - b.x).map((n) => n.id), expected);
  assert.ok(body.every((n) => n.x > GUTTER));
});

test("every connection is an edge; in-tension edges are dashed", () => {
  const m = model(fixture());
  const svg = String(renderMap(m));
  let count = 0;
  for (const c of m.chapters) {
    for (const x of ideaConnections(m, c)) {
      count++;
      const re = new RegExp(`<g class="edge( edge--tension)?" data-from="${c.id}" data-to="${x.to}" data-kind="${x.kind}">`);
      const mm = svg.match(re);
      assert.ok(mm, `${c.id} → ${x.to}`);
      assert.equal(!!mm[1], x.kind === "in-tension-with");
      assert.ok(svg.includes(`>${{ "builds-on": "Builds on", "in-tension-with": "In tension with", "instance-of": "Instance of", "precondition-for": "Precondition for", echoes: "Echoes" }[x.kind]}</text>`));
    }
  }
  assert.ok(count >= 4);
  assert.equal((svg.match(/<g class="edge[ "]/g) || []).length, count);
});

test("drafts are hollow rings; read ideas get a check", () => {
  const m = model(fixture());
  const svg = String(renderMap(m, ["exit"]));
  assert.match(svg, /data-node="network-state-visuals"[^>]*>(?:(?!<\/a>).)*class="dot dot--draft"/s);
  assert.match(svg, /class="node node--read" href="#exit"/);
  assert.match(svg, /data-node="exit"(?:(?!<\/a>).)*class="check"/s);
  assert.doesNotMatch(svg, /data-node="friend-speech"(?:(?!<\/a>).)*class="check"/s);
});

test("drafts with no strand appear under 'unplaced'", () => {
  const m = model(makeBook({ ideas: 6, draftsUnplaced: 2 }));
  const L = layoutMap(m);
  assert.equal(L.bands.at(-1).id, UNPLACED);
  assert.equal(L.bands.at(-1).name, "Just in · unplaced");
  for (const id of ["idea-7", "idea-8"]) assert.deepEqual(L.nodes.find((n) => n.id === id).bands, [UNPLACED]);
  const svg = String(renderMap(m));
  assert.ok(svg.includes(`data-strand="${UNPLACED}"`));
  // the index groups them too
  const idx = String(indexBlock(ctxFor(m, { view: "cover" })));
  assert.match(idx, /Just in · unplaced<\/h3><ol class="rows"><li class="row" data-strands="">/);
  // no unplaced band when nothing is unplaced
  assert.ok(!layoutMap(model(fixture())).bands.some((b) => b.id === UNPLACED));
});

test("40 synthetic ideas: no visible labels overlap; past 12 per band labels show only on hover/focus", () => {
  // two busy strands (> 12 each) and two quiet ones
  const strandOf = (i) => (i <= 30 ? [i % 2 ? "tools" : "trust"] : [i % 2 ? "choice" : "founding"]);
  const m = model(makeBook({ ideas: 40, strandOf }));
  const L = layoutMap(m);
  assert.equal(L.nodes.length, 42);
  const counts = Object.fromEntries(L.bands.map((b) => [b.id, b.count]));
  assert.ok(counts.tools > DENSE && counts.trust > DENSE && counts.choice <= DENSE);
  for (const n of L.nodes) {
    const dense = n.bands.some((b) => counts[b] > DENSE);
    assert.equal(n.showLabel, !dense, n.id);
  }
  const visible = L.nodes.filter((n) => n.showLabel);
  for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) assert.ok(!overlaps(visible[i].labelBox, visible[j].labelBox), `${visible[i].id} overlaps ${visible[j].id}`);
  // nodes never overlap each other
  for (let i = 0; i < L.nodes.length; i++) for (let j = i + 1; j < L.nodes.length; j++) assert.ok(Math.hypot(L.nodes[i].x - L.nodes[j].x, L.nodes[i].y - L.nodes[j].y) >= 12);
  const svg = String(renderMap(m));
  assert.equal((svg.match(/class="node node--dense/g) || []).length, L.nodes.filter((n) => !n.showLabel).length);
  // every node is a focusable link with an accessible name
  assert.equal((svg.match(/<a class="node[^"]*" href="#[a-z0-9-]+" data-node="[^"]+" data-bands="[^"]*" aria-label="[^"]+"/g) || []).length, 42);
});

test("labels sparse enough to show never overlap, at any frame width", () => {
  const m = model(makeBook({ ideas: 24 }));
  for (const width of [0, 300, 358, 700, 1024]) {
    const L = layoutMap(m, [], { width });
    const visible = L.nodes.filter((n) => n.showLabel);
    assert.ok(visible.length > 0);
    for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) assert.ok(!overlaps(visible[i].labelBox, visible[j].labelBox), `w=${width} ${visible[i].id}/${visible[j].id}`);
    for (const n of visible) for (const line of n.lines) assert.ok(line.length * 7 <= L.colW - 14 + 0.001, `${line} too wide at ${L.colW}`);
  }
});

test("wrapLabel keeps two lines and marks a cut", () => {
  assert.deepEqual(wrapLabel("Vote With Your Feet", 12), ["Vote With", "Your Feet"]);
  assert.deepEqual(wrapLabel("Exit", 12), ["Exit"]);
  const cut = wrapLabel("The Communistic Societies of the United States", 12);
  assert.equal(cut.length, 2);
  assert.ok(cut[1].endsWith("…"));
  assert.ok(cut.every((l) => l.length <= 12));
  assert.ok(wrapLabel("Supercalifragilistic", 8)[0].length <= 8);
});

test("orderBands makes two-strand pairs adjacent when possible and is stable otherwise", () => {
  assert.deepEqual(orderBands(["a", "b", "c", "d"], []), ["a", "b", "c", "d"]);
  assert.deepEqual(orderBands(["a", "b", "c", "d"], [["a", "b"]]), ["a", "b", "c", "d"]);
  const o = orderBands(["a", "b", "c", "d"], [["a", "c"]]);
  assert.equal(Math.abs(o.indexOf("a") - o.indexOf("c")), 1);
});

test("choosing a band filters the index", () => {
  const m = model(fixture());
  const svg = String(renderMap(m, [], { filter: "trust" }));
  assert.match(svg, /<button type="button" class="band-btn" data-act="filter" data-strand="trust" aria-pressed="true"/);
  const idx = String(indexBlock(ctxFor(m, { view: "cover" }, { filter: "trust" })));
  assert.ok(idx.includes('href="#friend-speech"'));
  assert.ok(!idx.includes('href="#exit"'));
  assert.ok(!idx.includes('href="#what-lasts"'));
});

test("the path switch changes prev/next order", () => {
  const m = model(fixture());
  // editor's path: prologue → exit → friend-speech → what-lasts → next-pick
  const ed = neighbours(m, EDITORS, "exit");
  assert.equal(ed.prev.id, "prologue");
  assert.equal(ed.next.id, "friend-speech");
  // as published: the 2024 archive prize comes first
  assert.deepEqual(m.published, ["prologue", "network-state-visuals", "exit", "friend-speech", "what-lasts", "next-pick"]);
  const pub = neighbours(m, PUBLISHED, "exit");
  assert.equal(pub.prev.id, "network-state-visuals");
  assert.equal(pub.next.id, "friend-speech");
  // an idea off the editor's path falls back to as-published, and says so
  const off = neighbours(m, EDITORS, "network-state-visuals");
  assert.equal(off.path, PUBLISHED);
  // the rendered pager follows the chosen path
  const route = { view: "idea", id: "exit", section: null };
  const a = String(renderPage(ctxFor(m, route)));
  const b = String(renderPage(ctxFor(m, route, { path: PUBLISHED })));
  assert.match(a, /class="pager-prev" href="#prologue" rel="prev"/);
  assert.match(b, /class="pager-prev" href="#network-state-visuals" rel="prev"/);
  assert.match(a, /The editor&#39;s path · 2 of 5/);
  assert.match(b, /As published · 3 of 6/);
  // and the index order switches with it
  const order = (html) => [...html.matchAll(/class="row-title" href="#([a-z0-9-]+)"/g)].map((x) => x[1]);
  assert.deepEqual(order(String(indexBlock(ctxFor(m, { view: "cover" })))), ["prologue", "exit", "friend-speech", "what-lasts", "next-pick", "network-state-visuals"]);
  assert.deepEqual(order(String(indexBlock(ctxFor(m, { view: "cover" }, { path: PUBLISHED })))), m.published);
});

test("map output is escaped", () => {
  const book = fixture();
  book.chapters = book.chapters.map((c) => (c.id === "exit" ? { ...c, title: "<img src=x onerror=alert(1)>" } : c));
  book.strands = book.strands.map((s) => (s.id === "trust" ? { ...s, name: '"><script>' } : s));
  const svg = String(renderMap(model(book)));
  assert.ok(!svg.includes("<img") && !svg.includes("<script"));
});
