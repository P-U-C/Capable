// W2 — every route parses and round-trips; anything else is the cover.
import test from "node:test";
import assert from "node:assert/strict";
import { parse, format, PAGES, SECTIONS } from "../src/router.mjs";
import { fixture } from "./synthetic.mjs";

const book = fixture();
const ids = new Set(book.chapters.map((c) => c.id));

test("the default route is the cover", () => {
  for (const h of ["", "#", "#cover", undefined, null]) assert.deepEqual(parse(h, ids), { view: "cover" });
  assert.equal(format({ view: "cover" }), "#cover");
});

test("pages parse and round-trip", () => {
  for (const p of PAGES) {
    const r = parse(`#${p}`, ids);
    assert.deepEqual(r, { view: p });
    assert.equal(format(r), `#${p}`);
    assert.deepEqual(parse(format(r), ids), r);
  }
});

test("every idea and each of its sections parses and round-trips", () => {
  assert.ok(ids.size >= 5);
  for (const id of ids) {
    const r = parse(`#${id}`, ids);
    assert.deepEqual(r, { view: "idea", id, section: null });
    assert.equal(format(r), `#${id}`);
    for (const s of SECTIONS) {
      const rs = parse(`#${id}-${s}`, ids);
      assert.deepEqual(rs, { view: "idea", id, section: s });
      assert.equal(format(rs), `#${id}-${s}`);
      assert.deepEqual(parse(format(rs), ids), rs);
    }
  }
});

test("hyphenated ids are not confused with sections", () => {
  // "friend-speech" contains a hyphen; "network-state-visuals" contains two.
  assert.deepEqual(parse("#friend-speech", ids), { view: "idea", id: "friend-speech", section: null });
  assert.deepEqual(parse("#friend-speech-voices", ids), { view: "idea", id: "friend-speech", section: "voices" });
  assert.deepEqual(parse("#network-state-visuals-end", ids), { view: "idea", id: "network-state-visuals", section: "end" });
});

test("unknown ids and sections resolve to the cover", () => {
  for (const h of ["#nope", "#nope-essay", "#exit-minute", "#exit-", "#-essay", "#essay", "#exit-essay-voices", "#settings"]) {
    assert.deepEqual(parse(h, ids), { view: "cover" }, h);
  }
});

test("only plain names are accepted", () => {
  for (const h of ["#exit/../about", "#<script>", "#exit?x=1", "#exit%20", "#exit.html", "#ex it", "#exit#about", "#javascript:alert(1)", `#${"a".repeat(81)}`, "#éxit", "#exit\n"]) {
    assert.deepEqual(parse(h, ids), { view: "cover" }, JSON.stringify(h));
  }
});

test("hashes are case-insensitive and normalise to lower case", () => {
  assert.deepEqual(parse("#EXIT-Voices", ids), { view: "idea", id: "exit", section: "voices" });
  assert.deepEqual(parse("#About", ids), { view: "about" });
});

test("format refuses malformed routes", () => {
  assert.equal(format(null), "#cover");
  assert.equal(format({ view: "idea", id: "Bad Id" }), "#cover");
  assert.equal(format({ view: "idea", id: "exit", section: "minute" }), "#exit");
  assert.equal(format({ view: "nope" }), "#cover");
});

test("without a known-id set, any well-formed slug is an idea", () => {
  assert.deepEqual(parse("#some-new-pick"), { view: "idea", id: "some-new-pick", section: null });
  assert.deepEqual(parse("#some-new-pick-source"), { view: "idea", id: "some-new-pick", section: "source" });
});
