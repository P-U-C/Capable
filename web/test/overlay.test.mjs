// W3 — overlay merge: validate, replace by key, append new, drop and count invalid.
import test from "node:test";
import assert from "node:assert/strict";
import { mergeOverlay, collect, readOverlay } from "../src/overlay.mjs";
import { model } from "../src/model.mjs";
import { renderPage } from "../src/views.mjs";
import { renderMap } from "../src/map.mjs";
import { blank } from "../src/progress.mjs";
import { fixture, hash } from "./synthetic.mjs";

const empty = () => ({ submissions: [], prizes: [], chapters: [], people: [], strands: [] });
const newSub = (n, extra = {}) => ({
  hash: hash(0xfeed00 + n),
  fid: 777,
  postedAt: "2026-11-12T18:00:00Z",
  chapter: "what-lasts",
  kind: "video",
  gloss: "A new entry on the communes.",
  embeds: ["https://stream.farcaster.xyz/v1/video/new.m3u8"],
  url: `https://farcaster.xyz/~/conversations/${hash(0xfeed00 + n)}`,
  ...extra,
});
const draft = (id, number, extra = {}) => ({
  id,
  number,
  kind: "chapter",
  status: "draft",
  title: "A New Pick",
  kicker: "New pick · just dropped",
  line: "A new prize just dropped.",
  minute: "Words.",
  essay: [{ type: "p", text: "Draft." }],
  objections: [],
  terms: [],
  thread: "This pick just dropped.",
  strands: [],
  connections: [],
  ...extra,
});

test("a valid new submission is appended and counted", () => {
  const book = fixture();
  const r = mergeOverlay(book, { ...empty(), submissions: [newSub(1)] });
  assert.equal(r.added, 1);
  assert.equal(r.dropped, 0);
  assert.equal(r.book.submissions.length, book.submissions.length + 1);
  assert.equal(r.book.submissions.at(-1).hash, hash(0xfeed01));
});

test("a valid doc with an existing key replaces the snapshot item in place", () => {
  const book = fixture();
  const s = { ...book.submissions[1], place: "hm", gloss: "Updated gloss." };
  const r = mergeOverlay(book, { ...empty(), submissions: [s] });
  assert.equal(r.added, 0);
  assert.equal(r.replaced, 1);
  assert.equal(r.book.submissions.length, book.submissions.length);
  assert.equal(r.book.submissions[1].gloss, "Updated gloss.");
  assert.equal(r.book.submissions[1].place, "hm");
});

test("invalid docs are dropped and counted, never merged", () => {
  const book = fixture();
  const bad = [
    newSub(2, { hash: "0xNOTAHASH" }),
    newSub(3, { gloss: "<script>alert(1)</script>" }),
    newSub(4, { url: "https://evil.example/x" }),
    newSub(5, { embeds: ["javascript:alert(1)"] }),
    null,
    "string",
  ];
  const r = mergeOverlay(book, { ...empty(), submissions: [...bad, newSub(6)], prizes: [{ id: "BAD ID" }], people: [{ fid: -1 }], strands: [{ id: "x" }], chapters: [draft("cover", 50)] });
  assert.equal(r.added, 1);
  assert.equal(r.dropped, bad.length + 4);
  const hashes = new Set(r.book.submissions.map((s) => s.hash));
  assert.ok(!hashes.has("0xNOTAHASH"));
  assert.ok(!r.book.submissions.some((s) => String(s.gloss).includes("<script")));
  assert.ok(!r.book.chapters.some((c) => c.id === "cover"));
});

test("new draft ideas are appended and ideas re-sorted by number", () => {
  const book = fixture();
  const r = mergeOverlay(book, { ...empty(), chapters: [draft("new-pick", 8, { strands: ["founding"] }), draft("early", 3)] });
  assert.equal(r.added, 2);
  const nums = r.book.chapters.map((c) => c.number);
  assert.deepEqual(nums, [...nums].sort((a, b) => a - b));
  assert.equal(r.book.chapters.at(-1).id, "next-pick");
  assert.ok(r.book.chapters.some((c) => c.id === "early"));
});

test("people replace by fid; strands and prizes by id", () => {
  const book = fixture();
  const strand = { id: "craft", name: "Craft & making", line: "How things get made.", facet: { name: "Maker", grant: "You can make it." } };
  const trust = { ...book.strands[1], name: "Trust, renamed" };
  const prize = { ...book.prizes.find((p) => p.id === "nordhoff"), status: "judging" };
  const r = mergeOverlay(book, { ...empty(), people: [{ fid: 5254, username: "papa2" }, { fid: 999999, username: "newbie" }], strands: [strand, trust], prizes: [prize] });
  assert.equal(r.book.people["5254"].username, "papa2");
  assert.equal(r.book.people["999999"].username, "newbie");
  assert.equal(r.book.strands.length, book.strands.length + 1);
  assert.equal(r.book.strands[1].name, "Trust, renamed");
  assert.equal(r.book.prizes.find((p) => p.id === "nordhoff").status, "judging");
  assert.equal(r.added, 1); // the new strand; people are not counted as "new"
});

test("the snapshot is never mutated", () => {
  const book = fixture();
  const before = JSON.stringify(book);
  mergeOverlay(book, { ...empty(), submissions: [newSub(7), { ...book.submissions[0], gloss: "Changed." }], chapters: [draft("z", 9)], people: [{ fid: 1, username: "x" }], refreshedAt: "2026-11-13T00:00:00Z" });
  assert.equal(JSON.stringify(book), before);
});

test("overlay docs win over earlier overlay docs with the same key", () => {
  const r = mergeOverlay(fixture(), { ...empty(), submissions: [newSub(8, { gloss: "First." }), newSub(8, { gloss: "Second." })] });
  assert.equal(r.added, 1);
  assert.equal(r.book.submissions.at(-1).gloss, "Second.");
});

test("refresh time is taken only when well-formed", () => {
  const ok = mergeOverlay(fixture(), { ...empty(), refreshedAt: "2026-11-13T09:30:00Z" });
  assert.equal(ok.book.provenance.refreshedAt, "2026-11-13T09:30:00Z");
  const bad = mergeOverlay(fixture(), { ...empty(), refreshedAt: "yesterday" });
  assert.equal(bad.book.provenance.refreshedAt, fixture().provenance.refreshedAt);
});

test("collect: ids must equal natural keys; unreadable docs are counted", () => {
  const s = newSub(9);
  const raw = {
    submissions: { docs: [{ id: s.hash, exists: true, data: () => s }, { id: "0xwrong", exists: true, data: () => newSub(10) }, { id: "gone", exists: false, data: () => ({}) }, { id: "boom", exists: true, data: () => { throw new Error("x"); } }] },
    people: { docs: [{ id: "42", exists: true, data: () => ({ fid: 42 }) }, { id: "43", exists: true, data: () => ({ fid: 44 }) }] },
    refresh: { exists: true, data: () => ({ refreshedAt: "2026-11-13T01:00:00Z", note: "1 new" }) },
  };
  const ov = collect(raw);
  assert.equal(ov.submissions.length, 1);
  assert.equal(ov.people.length, 1);
  assert.equal(ov.invalid, 3);
  assert.equal(ov.refreshedAt, "2026-11-13T01:00:00Z");
  const r = mergeOverlay(fixture(), ov);
  assert.equal(r.dropped, 3);
  assert.equal(r.added, 1);
});

function fakeDb(collections, { refresh = null, fail = null } = {}) {
  return {
    collection: (n) => ({
      get: async () => {
        if (fail === n) throw { code: "permission-denied", message: "no" };
        return { docs: (collections[n] || []).map((d) => ({ id: d.id, exists: true, data: () => d.value })) };
      },
    }),
    doc: () => ({ get: async () => (refresh ? { exists: true, data: () => refresh } : { exists: false, data: () => undefined }) }),
  };
}

test("readOverlay: outside the artifact there is no overlay", async () => {
  assert.equal(await readOverlay(undefined), null);
  assert.equal(await readOverlay({}), null);
});

test("readOverlay: a null namespace (signed out, not granted) means no overlay", async () => {
  assert.equal(await readOverlay({ use: async () => null }), null);
});

test("readOverlay: any rejection means no overlay", async () => {
  assert.equal(await readOverlay({ use: async () => { throw { code: "unavailable", message: "x" }; } }), null);
  assert.equal(await readOverlay({ use: async () => fakeDb({}, { fail: "chapters" }) }), null);
});

test("readOverlay: no answer within the timeout means no overlay", async () => {
  const never = { use: () => new Promise(() => {}) };
  const t0 = Date.now();
  assert.equal(await readOverlay(never, { timeoutMs: 20 }), null);
  assert.ok(Date.now() - t0 < 2000);
});

test("readOverlay: reads every collection once and the refresh doc", async () => {
  const s = newSub(11);
  const calls = [];
  const db = fakeDb({ submissions: [{ id: s.hash, value: s }] }, { refresh: { refreshedAt: "2026-11-13T02:00:00Z" } });
  const spy = { collection: (n) => (calls.push(n), db.collection(n)), doc: (p) => (calls.push(p), db.doc(p)) };
  const ov = await readOverlay({ use: async (name) => (name === "db" ? spy : null) });
  assert.deepEqual(calls.sort(), ["chapters", "meta/refresh", "people", "prizes", "strands", "submissions"]);
  assert.equal(ov.submissions.length, 1);
  assert.equal(ov.refreshedAt, "2026-11-13T02:00:00Z");
  assert.ok(!("set" in spy) && !("onSnapshot" in spy));
});

test("after a merge, links and strands that point at unknown ids are ignored at render", () => {
  const book = fixture();
  const d = draft("ghost-pick", 8, { strands: ["no-such-strand"], connections: [{ to: "no-such-idea", kind: "echoes", why: "Nothing." }, { to: "exit", kind: "echoes", why: "Something." }] });
  const r = mergeOverlay(book, { ...empty(), chapters: [d] });
  const m = model(r.book);
  const ctx = { m, route: { view: "idea", id: "ghost-pick", section: null }, state: blank(), depth: 2, path: "editors-path", filter: null, voiceFilter: "all", newCount: r.added, now: Date.parse("2026-11-12T17:00:00Z"), media: "link" };
  const page = String(renderPage(ctx));
  assert.ok(!page.includes("#no-such-idea"));
  assert.ok(!page.includes("no-such-strand"));
  assert.ok(page.includes('href="#exit"'));
  assert.ok(page.includes("· 1 new since snapshot"));
  const map = String(renderMap(m, []));
  assert.ok(!map.includes('data-to="no-such-idea"'));
  assert.ok(map.includes('data-from="ghost-pick" data-to="exit"'));
  // a strandless draft lands on the unplaced band
  assert.ok(map.includes('data-node="ghost-pick" data-bands="unplaced"'));
});
