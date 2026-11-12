// W6 — the Figure: one mark per strand, one notch per idea read, unknown strands composed.
import test from "node:test";
import assert from "node:assert/strict";
import { renderFigure, facets, figureStats, statsLine, marks } from "../src/figure.mjs";
import { model } from "../src/model.mjs";
import { fixture, makeBook, craftStrand } from "./synthetic.mjs";

/** Parse the rendered SVG into { strand → {state, known, notches, title, base} }. */
function groups(svg) {
  const out = {};
  for (const g of String(svg).matchAll(/<g class="facet" data-strand="([^"]+)" data-state="([^"]+)" data-known="([01])"><title>([^<]*)<\/title><path class="base" d="([^"]+)"\/>(.*?)<\/g>/g)) {
    out[g[1]] = { state: g[2], known: g[3] === "1", title: g[4], base: g[5], notches: [...g[6].matchAll(/class="notch"/g)].length, notchIdeas: [...g[6].matchAll(/data-idea="([^"]+)"/g)].map((x) => x[1]) };
  }
  return out;
}

test("0 reads: one dotted mark per strand, no notches, a title per strand", () => {
  const m = model(fixture());
  const svg = String(renderFigure(m, []));
  assert.match(svg, /^<svg class="fig" viewBox="0 0 120 120" role="img"/);
  const g = groups(svg);
  assert.deepEqual(Object.keys(g), ["tools", "trust", "choice", "founding"]);
  for (const x of Object.values(g)) {
    assert.equal(x.state, "unread");
    assert.equal(x.notches, 0);
    assert.ok(x.known);
  }
  assert.equal(g.trust.title, "Civil — 0 of 1 idea");
  assert.equal(g.founding.title, "Enduring — 0 of 2 ideas"); // what-lasts + the draft
  assert.match(svg, /<title id="fig-t">The Founder-Citizen: No ideas read yet/);
  assert.deepEqual(figureStats(m, []), { ideas: 0, strands: 0, total: 4 });
});

test("reads on 2 strands: read strands turn ink, the latest turns rubric, one notch per read", () => {
  const m = model(fixture());
  // friend-speech (trust) then what-lasts (founding): founding is the most recently deepened
  const g = groups(renderFigure(m, ["friend-speech", "what-lasts"]));
  assert.equal(g.trust.state, "read");
  assert.equal(g.founding.state, "recent");
  assert.equal(g.tools.state, "unread");
  assert.equal(g.choice.state, "unread");
  assert.equal(g.trust.notches, 1);
  assert.equal(g.founding.notches, 1);
  assert.equal(g.tools.notches + g.choice.notches, 0);
  assert.equal(g.trust.title, "Civil — 1 of 1 idea");
  assert.equal(g.founding.title, "Enduring — 1 of 2 ideas");
  assert.equal(statsLine(figureStats(m, ["friend-speech", "what-lasts"])), "2 ideas read across 2 strands");
});

test("an idea on two strands notches both, and both are the latest", () => {
  const m = model(fixture());
  const g = groups(renderFigure(m, ["friend-speech", "exit"]));
  assert.equal(g.tools.state, "recent");
  assert.equal(g.choice.state, "recent");
  assert.equal(g.trust.state, "read");
  assert.equal(g.tools.notches, 1);
  assert.equal(g.choice.notches, 1);
  // the prologue sits on no strand and adds no notch
  assert.equal(groups(renderFigure(m, ["prologue"])).tools.notches, 0);
  assert.deepEqual(figureStats(m, ["prologue"]), { ideas: 0, strands: 0, total: 4 });
});

test("reads on all 4 strands plus a 5th unknown strand: composed mark, notches, titles", () => {
  const strandOf = (i) => [["tools", "trust", "choice", "founding", "craft"][i % 5]];
  const book = makeBook({ ideas: 10, extraStrands: [craftStrand], strandOf });
  const m = model(book);
  const all = book.chapters.filter((c) => c.kind === "chapter").map((c) => c.id);
  const g = groups(renderFigure(m, all));
  assert.deepEqual(Object.keys(g), ["tools", "trust", "choice", "founding", "craft"]);
  for (const id of ["tools", "trust", "choice", "founding", "craft"]) {
    assert.equal(g[id].notches, 2, id);
    assert.equal(g[id].title.endsWith("2 of 2 ideas"), true, g[id].title);
  }
  assert.equal(g.craft.known, false);
  assert.equal(g.craft.title, "Maker — 2 of 2 ideas");
  // composed on the outer ring (r = 54)
  assert.match(g.craft.base, /A54 54 /);
  // the last read idea is idea-10 → strand index 10 % 5 = tools
  assert.equal(g.tools.state, "recent");
  for (const id of ["trust", "choice", "founding", "craft"]) assert.equal(g[id].state, "read");
});

test("adding a strand never redraws the existing marks", () => {
  const four = marks(model(fixture()));
  const book = fixture();
  book.strands = [...book.strands, craftStrand, { ...craftStrand, id: "sixth", name: "Sixth" }];
  const six = marks(model(book));
  for (let i = 0; i < 4; i++) assert.equal(six[i].geo.base(), four[i].geo.base());
  // and the two unknown strands get distinct marks
  assert.notEqual(six[4].geo.base(), six[5].geo.base());
});

test("notch positions come from catalogue numbers, not reading order", () => {
  const strandOf = () => ["trust"];
  const m = model(makeBook({ ideas: 6, strandOf }));
  const a = String(renderFigure(m, ["idea-2", "idea-5", "idea-1"]));
  const b = String(renderFigure(m, ["idea-5", "idea-1", "idea-2"]));
  const notches = (s) => [...s.matchAll(/<path class="notch" d="([^"]+)" data-idea="([^"]+)"/g)].map((x) => `${x[2]}:${x[1]}`).sort();
  assert.deepEqual(notches(a), notches(b));
  assert.equal(notches(a).length, 3);
  // distinct positions
  assert.equal(new Set(notches(a).map((x) => x.split(":")[1])).size, 3);
});

test("many unknown strands each get a deterministic mark", () => {
  const extra = Array.from({ length: 14 }, (_, i) => ({ ...craftStrand, id: `s${i}`, name: `S${i}` }));
  const book = fixture();
  book.strands = [...book.strands, ...extra];
  const m = model(book);
  const one = String(renderFigure(m, []));
  const two = String(renderFigure(m, []));
  assert.equal(one, two);
  const bases = Object.values(groups(one)).map((g) => g.base);
  assert.equal(bases.length, 18);
  assert.equal(new Set(bases).size, 18);
});

test("highlight mode marks the given strands for the 'You, now' figure", () => {
  const m = model(fixture());
  const g = groups(renderFigure(m, ["exit", "friend-speech"], { highlight: ["trust"], idPrefix: "you" }));
  assert.equal(g.trust.state, "hl");
  assert.equal(g.tools.state, "read");
  assert.equal(g.founding.state, "unread");
  assert.deepEqual(facets(m, []).map((f) => f.total), [1, 1, 1, 2]);
});

test("the figure is escaped like everything else", () => {
  const book = fixture();
  book.strands[0] = { ...book.strands[0], facet: { name: "<b>x</b>", grant: "g" } };
  book.archetype = { name: "<script>", line: "x" };
  const svg = String(renderFigure(model(book), []));
  assert.ok(!svg.includes("<b>") && !svg.includes("<script>"));
  assert.ok(svg.includes("&lt;b&gt;x&lt;/b&gt; — 0 of 1 idea"));
});
