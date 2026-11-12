// Contract tests (planner-owned). Each rule the app or the compile relies on has a test here,
// so removing a rule from the validator fails something (code review 2026-11-12, S8 and the
// contract mutation survivors M20, M21, M22, M36, M44, M55, M61, M62).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as v from "../validate-app.mjs";
import * as stub from "../banned.stub.mjs";
import { badgeSvg } from "../badge-art.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const real = () => JSON.parse(readFileSync(ROOT + "content/build/app.json", "utf8"));
const lessonFile = (id) => JSON.parse(readFileSync(ROOT + `content/lessons/${id}.json`, "utf8"));
const errs = (a, o) => v.validateApp(a, o);
const has = (list, re) => list.some((e) => re.test(e));
const mutate = (fn) => { const a = real(); fn(a); return errs(a); };
const workLesson = (a) => a.lessons.find((l) => l.work.length >= 2);

test("the compiled app and every lesson file pass strict", () => {
  assert.deepEqual(errs(real(), { strict: true }), []);
  for (const id of ["own-your-exit", "friend-speech", "vote-with-your-feet", "what-lasts"]) {
    assert.deepEqual(v.validateLessonDoc(lessonFile(id), id, { strict: true }), [], id);
  }
});

test("text: HTML, links, banned words, format characters, very long words", () => {
  assert.ok(has(v.validateText("a <b>bold</b> claim", "t"), /no HTML/));
  assert.ok(has(v.validateText("see [this](https://x.org)", "t"), /no links/));
  assert.ok(has(v.validateText("the prize went to her", "t"), /mentions/));
  assert.ok(has(v.validateText("evil ‮ text", "t"), /format characters/));
  assert.ok(has(v.validateText("zero​width", "t"), /format characters/));
  assert.ok(has(v.validateText("x".repeat(41), "t"), /longer than 40/));
  assert.deepEqual(v.validateText("A plain *sentence*, fine.", "t"), []);
  assert.deepEqual(v.validateText("A prize", "t", { banned: false }), []);
});

test("lessons: slug ids, unique ids, known traits, numbers sorted and unique", () => {
  assert.ok(has(mutate((a) => (a.lessons[0].id = "Bad Id")), /kebab-case/));
  assert.ok(has(mutate((a) => (a.lessons[1].id = a.lessons[0].id)), /duplicate$/));
  assert.ok(has(mutate((a) => (a.lessons[0].trait = "heroic")), /unknown heroic/));
  assert.ok(has(mutate((a) => (a.lessons[1].number = a.lessons[0].number)), /sorted by number, unique/));
  assert.ok(has(mutate((a) => (a.lessons = [])), /non-empty/));
  assert.ok(has(mutate((a) => (a.lessons[1].topic = a.lessons[0].topic)), /duplicate topic/));
});

test("cards: exactly one counter and one trait card, unknown types reported without throwing", () => {
  const l = lessonFile("what-lasts");
  const counter = l.cards.find((c) => c.type === "counter");
  const twoCounters = { ...l, cards: [...l.cards.slice(0, 3), counter, ...l.cards.slice(3)] };
  assert.ok(has(v.validateLessonDoc(twoCounters, "l"), /exactly 1 counter/));
  const twoTraits = { ...l, cards: [...l.cards.slice(0, 3), { type: "trait" }, ...l.cards.slice(3)] };
  assert.ok(has(v.validateLessonDoc(twoTraits, "l"), /exactly one trait/));
  for (const type of ["constructor", "__proto__", "toString"]) {
    const bad = { ...l, cards: [...l.cards, { type }] };
    assert.doesNotThrow(() => v.validateLessonDoc(bad, "l"));
    assert.ok(has(v.validateLessonDoc(bad, "l"), /unknown card type/), type);
  }
  assert.doesNotThrow(() => v.validateLessonDoc({ ...l, sources: {} }, "l"));
  assert.ok(has(v.validateLessonDoc({ ...l, sources: {} }, "l"), /sources: array/));
});

test("drafts need an idea card", () => {
  const l = lessonFile("what-lasts");
  const draft = { ...l, status: "draft", cards: l.cards.filter((c) => c.type !== "idea") };
  assert.ok(has(v.validateLessonDoc(draft, "d"), /≥ 1 idea/));
});

test("sources: bounded, plain, not pointing at the platform", () => {
  const s = { title: "A book", author: "A. Writer", year: 1999, note: "Why it matters here." };
  assert.deepEqual(v.validateSource(s, "s"), []);
  assert.ok(has(v.validateSource({ ...s, title: "x ".repeat(100) }, "s"), /longer than 160/));
  assert.ok(has(v.validateSource({ ...s, title: "<b>t</b>" }, "s"), /no HTML/));
  assert.ok(has(v.validateSource({ ...s, url: "https://warpcast.com/x" }, "s"), /must not point/));
  assert.ok(has(v.validateSource({ ...s, url: "http://example.org" }, "s"), /https only/));
});

test("works: every video and build key is https; inline video only from allowed hosts", () => {
  const ok = (w) => v.validateWork(w, "w");
  const base = { id: "0x" + "a".repeat(40), fid: 1, role: "lead", caption: "A short explainer", original: "https://example.org/p", postedAt: "2026-11-01T00:00:00Z" };
  assert.deepEqual(ok({ ...base, kind: "video", video: { hls: "https://stream.farcaster.xyz/v1/video/x.m3u8" } }), []);
  assert.ok(has(ok({ ...base, kind: "video", video: { hls: "https://stream.farcaster.xyz/a.m3u8", mp4: "javascript:alert(1)" } }), /video\.mp4: https only/));
  assert.ok(has(ok({ ...base, kind: "video", video: { mp4: "https://evil.example/clip.mp4" } }), /inline video only from/));
  assert.deepEqual(ok({ ...base, kind: "video", video: { external: "https://www.youtube.com/watch?v=x" } }), []);
  assert.ok(has(ok({ ...base, kind: "build", build: { site: "https://ok.example", repo: "javascript:alert(1)" } }), /build\.repo/));
  assert.ok(has(ok({ ...base, kind: "build", build: { site: "https://ok.example", evil: "https://x.example" } }), /build\.evil/));
});

test("app: names are plain text, traits unique, works unique and credited, creators well-formed", () => {
  assert.ok(has(mutate((a) => (a.name = "Bounty")), /mentions/));
  assert.ok(has(mutate((a) => (a.citizen.name = "")), /citizen\.name/));
  assert.ok(has(mutate((a) => (a.traits[0].name = "Prize Winner")), /mentions/));
  assert.ok(has(mutate((a) => (a.traits[1].id = a.traits[0].id)), /id: duplicate/));
  assert.ok(has(mutate((a) => (a.traits[1].stampId = a.traits[0].stampId)), /stampId: duplicate/));
  assert.ok(has(mutate((a) => (a.traits[0].color = "#18c8f0")), /uppercase/));
  assert.ok(has(mutate((a) => { const l = workLesson(a); l.work[1] = { ...l.work[1], id: l.work[0].id }; }), /duplicate work/));
  assert.ok(has(mutate((a) => { const l = workLesson(a); delete a.creators[String(l.work[0].fid)]; }), /no creator entry/));
  assert.doesNotThrow(() => mutate((a) => (a.creators["1"] = null)));
  assert.ok(has(mutate((a) => (a.creators["1"] = null)), /creators\.1: object/));
  assert.ok(has(mutate((a) => (a.stamps = { chainId: 8453, address: "0xnope" })), /stamps\.address/));
});

test("display names: no control or format characters (the compile drops, never throws)", () => {
  assert.ok(v.isDisplayName("Ada L."));
  for (const bad of ["", " ", "x".repeat(81), "a⁦b", "a‮b", "a​b", "a\nb", "a\u0007b"]) assert.equal(v.isDisplayName(bad), false, JSON.stringify(bad));
});

test("the browser stub bans nothing; the real list bans", () => {
  assert.equal(stub.BANNED.test("prize farcaster bounty"), false);
  assert.equal(v.BANNED.test("the prize"), true);
});

test("badge art reproduces every parity vector", () => {
  const { vectors } = JSON.parse(readFileSync(ROOT + "contract/fixtures/badge-vectors.json", "utf8"));
  assert.ok(vectors.length >= 10);
  for (const { input, sha256, svg } of vectors) {
    const out = badgeSvg(input);
    assert.equal(out, svg);
    assert.equal(createHash("sha256").update(out).digest("hex"), sha256);
  }
});
