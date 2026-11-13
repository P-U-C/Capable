// A1 — the deck engine: card list, state machine, progress, gestures' arithmetic,
// keyboard map, reduced motion, end-of-deck handoff, remembered position.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deckCards,
  createDeck,
  step,
  segments,
  fraction,
  resumeAt,
  isFinishedAt,
  stepId,
  rubberBand,
  stackPose,
  settle,
  tapZone,
  classifyPress,
  keyAction,
  PEEK,
  TILT,
  SLOP,
  HOLD_MS,
} from "../src/deck.mjs";
import { renderDeck, renderCard } from "../src/cards.mjs";
import { deckModel } from "../src/model.mjs";
import { emptyState, recordVisit, sanitize, openStore, lessonProgress, toggleTick, migrateLesson, storageKey } from "../src/store.mjs";
import { parseRoute } from "../src/router.mjs";
import { fixture, lessonOf, tags, attr, visibleText, APP_DIR } from "./helpers.mjs";

const app = fixture();
const types = (cards) => cards.map((c) => c.type);

test("deckCards keeps the lesson's order, expands work slots, and ends with the handoff", () => {
  const cards = deckCards(lessonOf(app, "friend-speech"));
  const t = types(cards);
  assert.equal(t[0], "cover");
  assert.equal(t.at(-1), "next");
  assert.equal(t.at(-2), "deeper");
  assert.equal(t.at(-3), "trait");
  assert.equal(t.filter((x) => x === "lead").length, 1, "one lead card for the one lead work");
  assert.equal(t.filter((x) => x === "more").length, 1, "the three more works share one card");
  assert.equal(cards.find((c) => c.type === "more").works.length, 3);
  assert.equal(cards.find((c) => c.type === "lead").work.id, "0x780d71e5b43cfe009ffcaf5ff0ac234bb711a927");
  // the lead slot sits where the lesson put it
  assert.equal(t.indexOf("lead"), lessonOf(app, "friend-speech").cards.findIndex((c) => c.type === "work" && c.role === "lead"));
});

test("empty work slots are skipped entirely, with no placeholder", () => {
  const t = types(deckCards(lessonOf(app, "what-lasts")));
  assert.ok(!t.includes("lead") && !t.includes("more") && !t.includes("work"));
  assert.equal(t.length, lessonOf(app, "what-lasts").cards.length - 2 + 1, "two slots dropped, handoff added");
  // a slot is dropped on its own when only the other role has work
  const onlyMore = { ...lessonOf(app, "friend-speech"), work: lessonOf(app, "friend-speech").work.filter((w) => w.role === "more") };
  const t2 = types(deckCards(onlyMore));
  assert.ok(!t2.includes("lead"));
  assert.ok(t2.includes("more"));
});

test("drafts get the same handoff; unknown card types and repeated slots are dropped", () => {
  const t = types(deckCards(lessonOf(app, "new-topic")));
  assert.deepEqual(t, ["cover", "idea", "trait", "next"]);
  const odd = { ...lessonOf(app, "friend-speech"), cards: [{ type: "cover" }, { type: "poll" }, { type: "work", role: "lead" }, { type: "work", role: "lead" }, { type: "trait" }] };
  assert.deepEqual(types(deckCards(odd)), ["cover", "lead", "trait", "next"]);
});

test("the state machine clamps, tracks the furthest card, and ignores unknown actions", () => {
  let s = createDeck(5, 0);
  assert.deepEqual(s, { count: 5, index: 0, furthest: 0 });
  assert.equal(step(s, { type: "prev" }), s, "no move before the first card");
  s = step(s, { type: "next" });
  s = step(s, { type: "next" });
  assert.equal(s.index, 2);
  s = step(s, { type: "prev" });
  assert.equal(s.index, 1);
  assert.equal(s.furthest, 2);
  s = step(s, { type: "goto", index: 99 });
  assert.equal(s.index, 4);
  assert.equal(step(s, { type: "next" }), s, "no move past the last card");
  assert.equal(step(s, { type: "goto", index: 1.5 }), s);
  assert.equal(step(s, { type: "shuffle" }), s);
  assert.equal(createDeck(3, 7).index, 2);
  assert.equal(createDeck(0).count, 1);
});

test("segments are stories-style and fraction follows the furthest card", () => {
  let s = createDeck(4, 0);
  assert.deepEqual(segments(s), ["active", "todo", "todo", "todo"]);
  s = step(s, { type: "goto", index: 2 });
  assert.deepEqual(segments(s), ["done", "done", "active", "todo"]);
  s = step(s, { type: "prev" });
  assert.equal(fraction(s), 2 / 3);
});

test("a remembered card resumes by its key, except the handoff, a gone card or junk", () => {
  const cards = deckCards(lessonOf(app, "friend-speech"));
  const i = cards.findIndex((c) => c.key === "idea-1");
  assert.ok(i > 0);
  assert.equal(resumeAt(cards, "idea-1"), i);
  assert.equal(resumeAt(cards, "next"), 0, "on the handoff card: start over");
  assert.equal(resumeAt(cards, "idea-99"), 0, "a card that is gone: start over");
  assert.equal(resumeAt(cards, undefined), 0);
  assert.equal(resumeAt(cards, 3), 0, "an old index is not a key");
});

test("card keys are stable when work arrives and when other cards are added (review S12)", () => {
  const l = lessonOf(app, "friend-speech");
  const withWork = deckCards(l);
  const noWork = deckCards({ ...l, work: [] });
  const key = (cards, type, ord) => cards.find((c) => c.type === type && c.ord === ord).key;
  assert.equal(key(withWork, "idea", 2), "idea-2");
  assert.equal(key(noWork, "idea", 2), "idea-2", "same key without the work cards in front");
  // a story inserted before the ideas shifts indexes but not idea keys
  const more = deckCards({ ...l, cards: [l.cards[0], { type: "story", heading: "h", text: "t" }, ...l.cards.slice(1)] });
  assert.equal(more.filter((c) => c.type === "idea").map((c) => c.key).join(), withWork.filter((c) => c.type === "idea").map((c) => c.key).join());
  assert.notEqual(more.findIndex((c) => c.key === "idea-0"), withWork.findIndex((c) => c.key === "idea-0"));
  // every key is unique within a deck, and practice steps get ids from their text
  assert.equal(new Set(withWork.map((c) => c.key)).size, withWork.length);
  const pr = withWork.find((c) => c.type === "practice");
  assert.deepEqual(pr.stepIds, pr.steps.map(stepId));
  assert.match(stepId("Write it down."), /^s[0-9a-z]{1,8}$/);
  assert.notEqual(stepId("a"), stepId("b"));
});

test("a lesson is finished only when its trait card is on screen, not by jumping past it", () => {
  const cards = deckCards(lessonOf(app, "own-your-exit"));
  const t = cards.findIndex((c) => c.type === "trait");
  assert.equal(isFinishedAt(cards, t - 1), false);
  assert.equal(isFinishedAt(cards, t), true);
  assert.equal(isFinishedAt(cards, cards.length - 1), false, "End jumps to the handoff and skips the trait card (review U15)");
  const noTrait = [{ type: "cover", key: "cover-0" }, { type: "next", key: "next" }];
  assert.equal(isFinishedAt(noTrait, 1), true);
});

test("rubber band: resists, keeps direction, never reaches the full width", () => {
  const w = 360;
  assert.equal(rubberBand(0, w), 0);
  let last = 0;
  for (const dx of [10, 50, 100, 200, 400, 1000]) {
    const r = rubberBand(dx, w);
    assert.ok(r > last && r < dx && r < w, `dx=${dx} → ${r}`);
    assert.equal(rubberBand(-dx, w), -r);
    last = r;
  }
});

test("stack poses: at rest, while dragging forward, back, and past either end", () => {
  const W = 340;
  const n = 6;
  // at rest on card 2
  const rest = (i) => stackPose(i, 2, 0, W, n);
  assert.deepEqual(rest(2), { x: 0, rot: 0, z: 3, shown: true });
  assert.deepEqual(rest(3), { x: PEEK, rot: 0, z: 2, shown: true }, "the next card peeks");
  assert.equal(rest(4).shown, false);
  assert.equal(rest(1).shown, false);
  assert.ok(rest(1).x < -W && rest(1).rot === -TILT, "read cards wait off to the left, dealt");
  // dragging toward the next card: the current card follows and turns; the next one slides in
  const fwd = (i) => stackPose(i, 2, -120, W, n);
  assert.equal(fwd(2).x, -120);
  assert.ok(fwd(2).rot < 0 && fwd(2).rot > -TILT);
  assert.ok(fwd(3).x < PEEK && fwd(3).x > 0);
  // dragging back: the previous card comes in on top
  const back = (i) => stackPose(i, 2, 170, W, n);
  assert.equal(back(1).shown, true);
  assert.ok(back(1).z > back(2).z);
  assert.ok(back(1).x > -(W + 48) && back(1).x < 0);
  // past the ends: rubber-banded
  const first = stackPose(0, 0, 200, W, n);
  assert.ok(first.x > 0 && first.x < 200);
  const last = stackPose(n - 1, n - 1, -200, W, n);
  assert.ok(last.x < 0 && last.x > -200);
  // only transform-able values come out
  for (const p of [rest(2), fwd(2), back(1), first, last]) assert.deepEqual(Object.keys(p).sort(), ["rot", "shown", "x", "z"]);
});

test("settle: short drags spring back; long drags and flicks move one card; ends clamp", () => {
  const W = 340;
  assert.equal(settle({ dx: -30, vx: 0, width: W, index: 3, count: 8 }), 3);
  assert.equal(settle({ dx: -W * 0.3, vx: 0, width: W, index: 3, count: 8 }), 4);
  assert.equal(settle({ dx: W * 0.3, vx: 0, width: W, index: 3, count: 8 }), 2);
  assert.equal(settle({ dx: -40, vx: -0.8, width: W, index: 3, count: 8 }), 4, "a quick flick");
  assert.equal(settle({ dx: -40, vx: 0.8, width: W, index: 3, count: 8 }), 3, "a flick against the drag does not move");
  assert.equal(settle({ dx: -SLOP + 1, vx: -2, width: W, index: 3, count: 8 }), 3, "no flick inside the slop");
  assert.equal(settle({ dx: -W, vx: -2, width: W, index: 7, count: 8 }), 7);
  assert.equal(settle({ dx: W, vx: 2, width: W, index: 0, count: 8 }), 0);
});

test("taps: left third back, right third forward, middle belongs to the card", () => {
  assert.equal(tapZone(10, 300), "prev");
  assert.equal(tapZone(99, 300), "prev");
  assert.equal(tapZone(150, 300), "middle");
  assert.equal(tapZone(201, 300), "next");
  assert.equal(tapZone(10, 0), "middle");
});

test("presses classify as tap, hold (pause), swipe or scroll", () => {
  assert.equal(classifyPress({ dx: 2, dy: 1, ms: 120 }), "tap");
  assert.equal(classifyPress({ dx: 2, dy: 1, ms: HOLD_MS + 10 }), "hold");
  assert.equal(classifyPress({ dx: -40, dy: 5, ms: 200 }), "swipe");
  assert.equal(classifyPress({ dx: 4, dy: 60, ms: 200 }), "scroll");
});

test("keyboard: arrows, space, shift+space, Home/End, Esc; on a video, Space and K play or pause", () => {
  assert.equal(keyAction(" ", { video: true }), "toggle");
  assert.equal(keyAction("k", { video: true }), "toggle");
  assert.equal(keyAction("K", { video: true }), "toggle");
  assert.equal(keyAction("k"), null, "K means nothing on a text card");
  assert.equal(keyAction(" ", { video: true, shift: true }), "prev", "Shift+Space still goes back");
  assert.equal(keyAction("ArrowRight", { video: true }), "next");
  assert.equal(keyAction("ArrowRight"), "next");
  assert.equal(keyAction("ArrowLeft"), "prev");
  assert.equal(keyAction(" "), "next");
  assert.equal(keyAction(" ", { shift: true }), "prev");
  assert.equal(keyAction("Escape"), "close");
  assert.equal(keyAction("Home"), "first");
  assert.equal(keyAction("End"), "last");
  assert.equal(keyAction("a"), null);
});

test("the deck renders a progress bar, a region per card, and a polite live region", () => {
  const { cards, ctx } = deckModel(app, "friend-speech", emptyState());
  const markup = String(renderDeck(ctx, cards));
  const sections = tags(markup, "section");
  assert.equal(sections.length, cards.length);
  sections.forEach((s, i) => {
    assert.equal(attr(s, "role"), "region");
    assert.match(attr(s, "aria-label"), new RegExp(`^Card ${i + 1} of ${cards.length}: `));
    assert.equal(attr(s, "tabindex"), "-1");
  });
  const bar = tags(markup, "div").find((t) => attr(t, "role") === "progressbar");
  assert.ok(bar);
  assert.equal(attr(bar, "aria-valuemax"), String(cards.length));
  assert.equal((markup.match(/class="seg"/g) || []).length, cards.length, "one segment per card");
  assert.doesNotMatch(markup, /aria-live/, "the focused card names itself; no live region repeats it (review U11)");
  assert.match(markup, /class="btn-icon deck__close" href="#\/" aria-label="Back to lessons"/);
  assert.match(markup, /data-nav="prev"[^>]*aria-label="Previous card"/);
  assert.match(markup, /data-nav="next"[^>]*aria-label="Next card"/);
});

test("end of deck: the hand-off goes to the next unfinished ready lesson, wrapping round (review U3)", () => {
  const handoff = (id, state) => {
    const { cards, ctx } = deckModel(app, id, state);
    return String(renderCard(cards.at(-1), cards.length - 1, ctx));
  };
  const finish = (s, id) => recordVisit(s, id, { key: "trait-0", index: 9, count: 10, finished: true });
  // nothing read: lesson 1 hands off to lesson 2, with what is left
  let m = handoff("own-your-exit", emptyState());
  assert.match(m, /href="#\/l\/friend-speech"/);
  assert.match(m, /Start lesson 02/);
  assert.match(visibleText(m), /2 lessons left/);
  // lesson 2 already finished: lesson 1 skips it
  m = handoff("own-your-exit", finish(emptyState(), "friend-speech"));
  assert.match(m, /href="#\/l\/what-lasts"/);
  assert.match(m, /Start lesson 03/);
  assert.match(visibleText(m), /1 lesson left/);
  // the last lesson (a draft here) wraps round to the first unread one, never "all caught up" while lessons are unread
  m = handoff("new-topic", emptyState());
  assert.match(m, /href="#\/l\/own-your-exit"/);
  assert.doesNotMatch(visibleText(m), /All caught up/i);
  // a started lesson is continued
  m = handoff("what-lasts", recordVisit(emptyState(), "own-your-exit", { key: "idea-0", index: 3, count: 12 }));
  assert.match(m, /Continue lesson 01/);
  // every other ready lesson done: all caught up, and the way to the traits
  let all = emptyState();
  for (const id of ["own-your-exit", "friend-speech"]) all = finish(all, id);
  m = handoff("what-lasts", all);
  assert.match(visibleText(m), /All caught up/i);
  assert.match(m, /href="#\/you"/);
  assert.doesNotMatch(m, /Start lesson|Continue lesson/);
  assert.equal(deckModel(app, "no-such-lesson", emptyState()), null);
});

test("reduced motion: the view crossfades with no movement", () => {
  const css = readFileSync(join(APP_DIR, "src/app.css"), "utf8");
  const block = css.match(/\.deck\.is-reduced \.card \{([^}]*)\}/)[1];
  assert.match(block, /transform:\s*none\s*!important/);
  assert.match(block, /opacity:\s*0/);
  assert.match(block, /transition:\s*opacity/);
  assert.match(css, /\.deck\.is-reduced \.card\.is-active \{[^}]*opacity:\s*1/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  const shell = readFileSync(join(APP_DIR, "src/shell.mjs"), "utf8");
  assert.match(shell, /matchMedia\?\.\("\(prefers-reduced-motion: reduce\)"\)/);
  const view = readFileSync(join(APP_DIR, "src/view-deck.mjs"), "utf8");
  assert.match(view, /if \(!reduced && !sheet\) apply\(dx, false\)/, "drags do not move cards under reduced motion");
});

test("swipes animate transform only", () => {
  const css = readFileSync(join(APP_DIR, "src/app.css"), "utf8");
  const t = css.match(/\.deck\.is-ready \.card \{([^}]*)\}/)[1];
  assert.match(t, /transition:\s*transform/);
  assert.doesNotMatch(t, /left|width|margin/);
  const gesture = readFileSync(join(APP_DIR, "src/gesture.mjs"), "utf8");
  assert.match(gesture, /const opts = \{ passive: true \}/);
});

test("progress is remembered per lesson by card key, and storage failures are harmless", () => {
  let s = emptyState();
  assert.equal(lessonProgress(recordVisit(s, "own-your-exit", { key: "cover-0", index: 0, count: 13 }), "own-your-exit").started, false, "seeing only the cover is not started (review U15)");
  s = recordVisit(s, "own-your-exit", { key: "idea-2", index: 4, count: 13 });
  assert.equal(s.at["own-your-exit"], "idea-2");
  assert.equal(s.furthest["own-your-exit"], 4 / 12);
  assert.equal(lessonProgress(s, "own-your-exit").started, true);
  s = recordVisit(s, "own-your-exit", { key: "idea-0", index: 2, count: 13 });
  assert.equal(s.furthest["own-your-exit"], 4 / 12, "going back keeps the furthest point");
  s = recordVisit(s, "own-your-exit", { key: "trait-0", index: 11, count: 13, finished: true });
  assert.equal(s.done["own-your-exit"], true);
  assert.equal(lessonProgress(s, "own-your-exit").fraction, 1);
  const k = "own-your-exit/practice-0";
  assert.deepEqual(toggleTick(s, k, "s1a").ticks[k], ["s1a"]);
  assert.deepEqual(toggleTick(toggleTick(s, k, "s1a"), k, "s1a").ticks[k], []);
  assert.equal(toggleTick(s, "bad key", "s1a"), s, "malformed keys are ignored");
  assert.equal(toggleTick(s, k, 3), s, "an index is not a step id");

  const mem = new Map();
  const storage = { getItem: (key) => mem.get(key) ?? null, setItem: (key, v) => mem.set(key, v) };
  const st = openStore(storage, { key: storageKey("/Capable/") });
  st.visit("what-lasts", { key: "story-0", index: 3, count: 12 });
  assert.equal(openStore(storage, { key: storageKey("/Capable/") }).get().at["what-lasts"], "story-0", "a second open reads it back");
  assert.equal(openStore(storage, { key: storageKey("/staging/") }).get().at["what-lasts"], undefined, "another base path has its own progress (review S23)");
  assert.deepEqual([...mem.keys()], ["capable.progress@/Capable/"]);

  const broken = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceeded");
    },
  };
  const b = openStore(broken);
  assert.doesNotThrow(() => b.visit("what-lasts", { key: "idea-1", index: 2, count: 12 }));
  assert.equal(b.get().at["what-lasts"], "idea-1", "kept in memory");
  assert.equal(openStore(null).get().sound, false);

  const junk = sanitize({
    at: { ok: "idea-2", "Bad Id": "idea-1", bad: "<b>", num: 3 },
    pos: { "Bad Id": 2, ok: -1, fine: 3, "x-y": "3" },
    done: { a: "yes", b: true },
    furthest: { a: 2, b: 0.5 },
    ticks: { "a/practice-0": ["s1", "x", "s1", 7], "a/b": [0, 9, "x", 2], nope: [1] },
  });
  assert.deepEqual(junk.at, { ok: "idea-2" });
  assert.deepEqual(junk.legacy.pos, { fine: 3 });
  assert.deepEqual(junk.done, { b: true });
  assert.deepEqual(junk.furthest, { b: 0.5 });
  assert.deepEqual(junk.legacy.ticks, { "a/practice-0": [7], "a/b": [0, 2] }, "number arrays are old-format ticks");
  assert.deepEqual(junk.ticks, {});
  assert.deepEqual(sanitize([1, 2]), emptyState());
});

test("progress saved by the old version (indexes under citizen.v1) is read and converted lesson by lesson", () => {
  const l = lessonOf(app, "friend-speech");
  const cards = deckCards(l);
  const pr = cards.find((c) => c.type === "practice");
  const oldTick = `friend-speech/practice-${pr.at}`;
  const legacy = { pos: { "friend-speech": 4, "what-lasts": 2 }, furthest: { "friend-speech": 0.3 }, done: { "own-your-exit": true }, ticks: { [oldTick]: [0, pr.steps.length - 1] }, sound: true };
  const mem = new Map([["citizen.v1", JSON.stringify(legacy)]]);
  const storage = { getItem: (key) => mem.get(key) ?? null, setItem: (key, v) => mem.set(key, v) };
  const st = openStore(storage, { key: storageKey("/Capable/") });
  assert.equal(st.get().done["own-your-exit"], true, "done and sound carry over as they are");
  assert.equal(st.get().sound, true);
  assert.equal(st.get().at["friend-speech"], undefined, "an index waits until its lesson's cards are known");
  const s = st.migrate("friend-speech", cards);
  assert.equal(s.at["friend-speech"], cards[4].key, "the old index becomes that card's key");
  assert.deepEqual(s.ticks[`friend-speech/${pr.key}`], [pr.stepIds[0], pr.stepIds.at(-1)].sort(), "old ticks become step ids");
  assert.equal(s.legacy.pos["friend-speech"], undefined);
  assert.equal(s.legacy.pos["what-lasts"], 2, "other lessons keep theirs until opened");
  assert.equal(migrateLesson(s, "friend-speech", cards), s, "nothing left to convert: unchanged");
  const saved = JSON.parse(mem.get("capable.progress@/Capable/"));
  assert.equal(saved.v, 2);
  assert.equal(saved.at["friend-speech"], cards[4].key);
  assert.ok(mem.has("citizen.v1"), "the old key is left alone (another deployment may still read it)");
  // a key saved in the new form wins over an old index
  const both = migrateLesson({ ...emptyState(), at: { "friend-speech": "idea-0" }, legacy: { pos: { "friend-speech": 4 }, ticks: {} } }, "friend-speech", cards);
  assert.equal(both.at["friend-speech"], "idea-0");
});

test("routes: home, the you panel, and a lesson", () => {
  assert.deepEqual(parseRoute(""), { view: "home" });
  assert.deepEqual(parseRoute("#/"), { view: "home" });
  assert.deepEqual(parseRoute("#/you"), { view: "home", focus: "you" });
  assert.deepEqual(parseRoute("#/l/own-your-exit"), { view: "lesson", id: "own-your-exit" });
  assert.deepEqual(parseRoute("#/l/<script>"), { view: "home" });
  assert.deepEqual(parseRoute("#/l/../../etc"), { view: "home" });
});
