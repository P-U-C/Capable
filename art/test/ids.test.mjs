// R1 id namespacing: every id inside a piece starts with that piece's
// seed-derived prefix, every internal reference resolves inside the same
// piece, and different pieces inlined on one page never share an id.
import test from "node:test";
import assert from "node:assert/strict";
import { parseXml, idsOf, refsOf } from "./xml.mjs";
import { corpus } from "./corpus.mjs";
import { seal, lessonScene, portrait, iconSvg } from "../index.mjs";

test("within a piece: ids are unique, share one prefix, and every reference resolves", () => {
  for (const [name, , fn] of corpus()) {
    const doc = parseXml(fn());
    const ids = idsOf(doc);
    assert.equal(new Set(ids).size, ids.length, `${name}: duplicate id`);
    const prefixes = new Set(ids.map((id) => id.split("-")[0]));
    assert.ok(prefixes.size <= 1, `${name}: ids with mixed prefixes ${[...prefixes]}`);
    for (const p of prefixes) assert.match(p, /^[a-z][0-9a-z]{3,}$/, `${name}: prefix ${p}`);
    for (const ref of refsOf(doc)) assert.ok(ids.includes(ref), `${name}: dangling reference #${ref}`);
  }
});

test("the seal, lockup, favicon and icons carry no ids at all (any number can share a page)", () => {
  for (const svg of [seal({ mode: "logo" }), seal({ mode: "lockup" }), seal({ mode: "favicon" }), iconSvg({ size: 512, maskable: true })]) {
    assert.deepEqual(idsOf(parseXml(svg)), []);
  }
});

test("across a page: 300 scenes and 300 portraits share no id", () => {
  const owner = new Map();
  const add = (label, svg) => {
    for (const id of idsOf(parseXml(svg))) {
      assert.ok(!owner.has(id), `${label} reuses id ${id} from ${owner.get(id)}`);
      owner.set(id, label);
    }
  };
  for (let i = 0; i < 300; i++) add(`scene ${i}`, lessonScene({ lessonId: `page-${i}`, color: "#FF1FC8" }));
  for (let i = 0; i < 300; i++) add(`portrait ${i}`, portrait({ seed: `page-${i}` }));
  assert.ok(owner.size > 1000);
});

test("the same lesson in two colours, or twice with a uid, gets different ids", () => {
  const ids = (svg) => idsOf(parseXml(svg));
  const a = ids(lessonScene({ lessonId: "what-lasts", color: "#FFE11A" }));
  const b = ids(lessonScene({ lessonId: "what-lasts", color: "#18C8F0" }));
  const c = ids(lessonScene({ lessonId: "what-lasts", color: "#FFE11A", uid: "cover" }));
  assert.equal(a.filter((x) => b.includes(x) || c.includes(x)).length, 0);
  const p1 = ids(portrait({ seed: "7" }));
  const p2 = ids(portrait({ seed: "7", uid: "avatar" }));
  assert.equal(p1.filter((x) => p2.includes(x)).length, 0);
});
