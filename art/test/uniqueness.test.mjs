// R1 uniqueness: 1,000 seeds → 1,000 distinct pictures per seeded generator.
//
// Distinct *pictures*, not just distinct strings: before comparing, the
// seed-derived id prefix and the grain filter's turbulence seed are replaced
// by constants, so two scenes that differed only there would count as equal.
import test from "node:test";
import assert from "node:assert/strict";
import { lessonScene, portrait, TEMPLATE_NAMES, sceneChoice } from "../index.mjs";
import { portraitTraits } from "../lib/portrait.mjs";

/** Replace this SVG's own id prefix (from its first id) and grain seeds with constants. */
export function normalise(svg) {
  const m = /\bid="([a-z][0-9a-z]*)-/.exec(svg);
  const out = m ? svg.split(`${m[1]}-`).join("X-") : svg;
  return out.replace(/seed="\d+"/g, 'seed="0"');
}

test("lessonScene: 1,000 lesson ids → 1,000 distinct scenes (one colour)", () => {
  const seen = new Map();
  const templates = new Set();
  for (let i = 0; i < 1000; i++) {
    const id = `lesson-${i}`;
    const pic = normalise(lessonScene({ lessonId: id, color: "#18C8F0" }));
    assert.ok(!seen.has(pic), `${id} draws the same picture as ${seen.get(pic)}`);
    seen.set(pic, id);
    templates.add(sceneChoice(id).template);
  }
  assert.equal(seen.size, 1000);
  assert.equal(templates.size, TEMPLATE_NAMES.length, "every composition template is reachable");
});

test("lessonScene: the normaliser really strips the seeds (sanity)", () => {
  const a = lessonScene({ lessonId: "own-your-exit", color: "#18C8F0" });
  const b = lessonScene({ lessonId: "own-your-exit", color: "#18C8F0", uid: "other" });
  assert.notEqual(a, b);
  assert.equal(normalise(a), normalise(b));
});

test("portrait: 1,000 seeds → 1,000 distinct portraits", () => {
  const seen = new Map();
  for (let i = 0; i < 1000; i++) {
    const seed = String(1 + i * 31);
    const pic = normalise(portrait({ seed }));
    assert.ok(!seen.has(pic), `${seed} draws the same portrait as ${seen.get(pic)}`);
    seen.set(pic, seed);
  }
  assert.equal(seen.size, 1000);
});

test("portrait: features vary widely (not just confetti)", () => {
  const combos = new Set();
  const hair = new Set();
  const hats = new Set();
  const garments = new Set();
  for (let i = 0; i < 1000; i++) {
    const t = portraitTraits(String(1 + i * 31));
    combos.add([t.bg, t.garment, t.hair, t.hairColor, t.hat, t.collar, t.block, t.backdrop, t.eyes].join());
    hair.add(t.hair);
    hats.add(t.hat);
    garments.add(t.collar);
  }
  assert.ok(combos.size > 950, `feature combinations: ${combos.size}`);
  assert.equal(hair.size, 11);
  assert.equal(hats.size, 6);
  assert.equal(garments.size, 9);
});

test("lessonScene: every template is reached in fair proportion", () => {
  const n = Object.fromEntries(TEMPLATE_NAMES.map((t) => [t, 0]));
  for (let i = 0; i < 2000; i++) n[sceneChoice(`lesson-${i}`).template]++;
  for (const [t, k] of Object.entries(n)) assert.ok(k > 120 && k < 280, `${t}: ${k} of 2000`);
});

test("portrait: a garment colour changes the clothes, not the person", () => {
  for (let i = 0; i < 200; i++) {
    const a = portraitTraits(`same-${i}`);
    const b = portraitTraits(`same-${i}`, "#FF1FC8");
    for (const k of ["hair", "hat", "collar", "block", "backdrop", "eyes", "blush", "smile", "tilt", "hx", "hy", "hr"]) assert.equal(b[k], a[k], `same-${i} ${k}`);
    assert.equal(b.garment, "#FF1FC8");
    // the background stays unless it would swallow the garment
    if (a.bg !== "#FF1FC8") assert.equal(b.bg, a.bg, `same-${i} bg`);
    else assert.notEqual(b.bg, "#FF1FC8");
  }
});
