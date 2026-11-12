// The seal: modes, optical sizing, the filled ring, and app icon geometry.
import test from "node:test";
import assert from "node:assert/strict";
import { seal, iconSvg, TRAIT_QUARTER, CANDIES } from "../index.mjs";
import { parseXml } from "./xml.mjs";

/** The ring arcs: the four 24-unit strokes, in drawing order. */
const ringStrokes = (svg) => parseXml(svg).elements.filter((e) => e.name === "path" && e.attrs["stroke-width"] === "24").map((e) => e.attrs.stroke);

test("modes: logo is square, lockup is wider than tall, favicon is a 64-unit square", () => {
  assert.match(seal({ mode: "logo", size: 180 }), /viewBox="0 0 240 240" width="180" height="180"/);
  const lock = parseXml(seal({ mode: "lockup", size: 120 })).elements[0].attrs;
  assert.ok(+lock.width > 2.5 * +lock.height, `lockup ${lock.width}×${lock.height}`);
  assert.match(seal({ mode: "favicon", size: 16 }), /viewBox="0 0 64 64" width="16" height="16"/);
  assert.equal(seal(), seal({ mode: "logo" }));
});

test("the lockup carries the wordmark as paths (no text, no font)", () => {
  const svg = seal({ mode: "lockup" });
  assert.doesNotMatch(svg, /<text|font-family/);
  const glyphs = parseXml(svg).elements.filter((e) => e.name === "path" && /^translate\(/.test(e.attrs.transform || ""));
  assert.equal(glyphs.length, 7 * 3, "seven letters × shadow, outline, fill");
});

test("optical sizing: beads and ring rules only at 96 px and up", () => {
  const beads = (svg) => /stroke-linecap="round"\/>/.test(svg) && /h0M/.test(svg);
  assert.ok(beads(seal({ mode: "logo", size: 512 })));
  assert.ok(beads(seal({ mode: "logo", size: 96 })));
  assert.ok(!beads(seal({ mode: "logo", size: 48 })));
  assert.ok(!/stroke="#FFFDF6" stroke-width="1.8"/.test(seal({ mode: "favicon", size: 32 })), "no collar at 32 px");
});

test("filled: only the listed traits' quarters are coloured, the rest print as paper", () => {
  const full = ringStrokes(seal({ mode: "logo" }));
  assert.deepEqual([...full].sort(), [...CANDIES].sort());
  assert.deepEqual(ringStrokes(seal({ mode: "logo", filled: [] })), ["#F7F4EA", "#F7F4EA", "#F7F4EA", "#F7F4EA"]);
  for (const [trait, q] of Object.entries(TRAIT_QUARTER)) {
    const strokes = ringStrokes(seal({ mode: "logo", filled: [trait] }));
    assert.deepEqual(strokes.filter((c) => c !== "#F7F4EA"), [CANDIES[q]], trait);
  }
  // all 16 subsets differ; order and duplicates don't matter; the full set equals the default
  const traits = Object.keys(TRAIT_QUARTER);
  const seen = new Set();
  for (let m = 0; m < 16; m++) seen.add(seal({ mode: "lockup", size: 64, filled: traits.filter((_, i) => m & (1 << i)) }));
  assert.equal(seen.size, 16);
  assert.equal(seal({ filled: ["civil", "sovereign"] }), seal({ filled: ["sovereign", "civil", "civil"] }));
  assert.equal(seal({ filled: traits }), seal());
  // a trait with no quarter lights nothing; bad input throws
  assert.equal(seal({ filled: ["someday"] }), seal({ filled: [] }));
  assert.throws(() => seal({ filled: "sovereign" }), TypeError);
  assert.throws(() => seal({ filled: [1] }), TypeError);
  // an unfilled ring keeps its quarter rules even when small
  assert.match(seal({ mode: "logo", size: 32, filled: ["civil"] }), /stroke-width="4"\/>/);
});

test("trait quarters match content/app.meta.json colours", async () => {
  const meta = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../../content/app.meta.json", import.meta.url), "utf8"));
  for (const t of meta.traits) if (Object.hasOwn(TRAIT_QUARTER, t.id)) assert.equal(CANDIES[TRAIT_QUARTER[t.id]], t.color, t.id);
});

test("icons: solid paper square; maskable keeps the whole seal inside the 80% safe circle", () => {
  for (const maskable of [false, true]) {
    const doc = parseXml(iconSvg({ size: 512, maskable }));
    const rect = doc.elements.find((e) => e.name === "rect");
    assert.deepEqual([rect.attrs.width, rect.attrs.height, rect.attrs.fill], ["512", "512", "#F7F4EA"]);
    // the seal's outermost shapes are circles: the shadow and the rim (plus half its stroke)
    let reach = 0;
    for (const e of doc.elements.filter((x) => x.name === "circle")) {
      const d = Math.hypot(+e.attrs.cx - 256, +e.attrs.cy - 256) + +e.attrs.r + (+e.attrs["stroke-width"] || 0) / 2;
      reach = Math.max(reach, d);
    }
    if (maskable) assert.ok(reach <= 0.4 * 512 + 0.5, `maskable reach ${reach.toFixed(1)} > ${0.4 * 512}`);
    else assert.ok(reach <= 256, `icon reach ${reach.toFixed(1)}`);
  }
  assert.match(iconSvg({ size: 180 }), /width="180" height="180"/);
});
