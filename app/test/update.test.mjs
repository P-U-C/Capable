// Updates: a newer, valid app.json replaces the inlined copy; anything else is ignored.
import test from "node:test";
import assert from "node:assert/strict";
import { readInline, isNewer, acceptUpdate, fetchLatest } from "../src/data.mjs";
import { fixture } from "./helpers.mjs";

test("readInline parses the inlined App and survives a broken one", () => {
  const app = fixture();
  const doc = (text) => ({ getElementById: (id) => (id === "app-data" && text !== null ? { textContent: text } : null) });
  assert.deepEqual(readInline(doc(JSON.stringify(app))), app);
  assert.equal(readInline(doc("{not json")), null);
  assert.equal(readInline(doc(null)), null);
});

test("only a newer, valid App replaces the current one", () => {
  const cur = fixture();
  const newer = { ...fixture(), generatedAt: "2026-11-13T08:00:00Z" };
  const older = { ...fixture(), generatedAt: "2026-11-01T08:00:00Z" };
  assert.equal(isNewer(newer, cur), true);
  assert.equal(isNewer(cur, cur), false);
  assert.deepEqual(acceptUpdate(cur, newer), { app: newer, changed: true, errors: [] });
  assert.equal(acceptUpdate(cur, older).app, cur);
  assert.equal(acceptUpdate(cur, cur).changed, false);
  const invalid = { ...newer, lessons: [{ ...newer.lessons[0], title: "Win the prize" }] };
  const r = acceptUpdate(cur, invalid);
  assert.equal(r.changed, false, "a newer App that fails validation is dropped");
  assert.ok(r.errors.length > 0);
  assert.equal(acceptUpdate(cur, null).changed, false);
  assert.equal(acceptUpdate(cur, { generatedAt: "nope" }).changed, false);
});

test("fetchLatest asks for ./app.json past the HTTP cache and fails closed", async () => {
  const seen = [];
  const ok = async (url, init) => (seen.push([url, init]), { ok: true, json: async () => ({ v: 1 }) });
  assert.deepEqual(await fetchLatest(ok), { v: 1 });
  assert.equal(seen[0][0], "./app.json");
  assert.equal(seen[0][1].cache, "no-cache");
  await assert.rejects(fetchLatest(async () => ({ ok: false, status: 404 })));
});
