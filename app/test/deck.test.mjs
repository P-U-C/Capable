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
  resumeIndex,
  isFinishedAt,
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
import { renderDeck } from "../src/cards.mjs";
import { deckModel } from "../src/model.mjs";
import { emptyState, recordVisit, sanitize, openStore, lessonProgress, toggleTick } from "../src/store.mjs";
import { parseRoute } from "../src/router.mjs";
import { fixture, lessonOf, tags, attr, APP_DIR } from "./helpers.mjs";

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

test("a remembered position resumes, except from the handoff or when invalid", () => {
  assert.equal(resumeIndex(4, 12), 4);
  assert.equal(resumeIndex(11, 12), 0, "on the handoff card: start over");
  assert.equal(resumeIndex(40, 12), 0);
  assert.equal(resumeIndex(-1, 12), 0);
  assert.equal(resumeIndex(undefined, 12), 0);
  assert.equal(resumeIndex("3", 12), 0);
});

test("a lesson is finished on reaching its trait card", () => {
  const cards = deckCards(lessonOf(app, "own-your-exit"));
  const t = cards.findIndex((c) => c.type === "trait");
  assert.equal(isFinishedAt(cards, t - 1), false);
  assert.equal(isFinishedAt(cards, t), true);
  assert.equal(isFinishedAt(cards, cards.length - 1), true);
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

test("keyboard: arrows, space, shift+space, Home/End, Esc", () => {
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
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /class="btn-icon deck__close" href="#\/" aria-label="Back to lessons"/);
  assert.match(markup, /data-nav="prev"[^>]*aria-label="Previous card"/);
  assert.match(markup, /data-nav="next"[^>]*aria-label="Next card"/);
});

test("end of deck: trait card, then the next lesson; the last lesson points home", () => {
  const { cards, ctx } = deckModel(app, "own-your-exit", emptyState());
  const markup = String(renderDeck(ctx, cards));
  assert.match(markup, /href="#\/l\/friend-speech"/);
  assert.match(markup, /Start lesson 02/);
  const lastModel = deckModel(app, "new-topic", emptyState());
  const end = String(renderDeck(lastModel.ctx, lastModel.cards));
  assert.match(end, /href="#\/you"/);
  assert.doesNotMatch(end, /Start lesson/);
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
  const main = readFileSync(join(APP_DIR, "src/main.mjs"), "utf8");
  assert.match(main, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
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

test("progress is remembered per lesson, and storage failures are harmless", () => {
  let s = emptyState();
  s = recordVisit(s, "own-your-exit", { index: 4, count: 13 });
  assert.equal(s.pos["own-your-exit"], 4);
  assert.equal(s.furthest["own-your-exit"], 4 / 12);
  assert.equal(lessonProgress(s, "own-your-exit").started, true);
  s = recordVisit(s, "own-your-exit", { index: 2, count: 13 });
  assert.equal(s.furthest["own-your-exit"], 4 / 12, "going back keeps the furthest point");
  s = recordVisit(s, "own-your-exit", { index: 11, count: 13, finished: true });
  assert.equal(s.done["own-your-exit"], true);
  assert.equal(lessonProgress(s, "own-your-exit").fraction, 1);
  assert.deepEqual(toggleTick(toggleTick(s, "a/b", 1), "a/b", 1).ticks["a/b"], []);

  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const st = openStore(storage);
  st.visit("what-lasts", { index: 3, count: 12 });
  assert.equal(openStore(storage).get().pos["what-lasts"], 3, "a second open reads it back");

  const broken = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceeded");
    },
  };
  const b = openStore(broken);
  assert.doesNotThrow(() => b.visit("what-lasts", { index: 2, count: 12 }));
  assert.equal(b.get().pos["what-lasts"], 2, "kept in memory");
  assert.equal(openStore(null).get().sound, false);

  const junk = sanitize({ pos: { "Bad Id": 2, ok: -1, fine: 3, "x-y": "3" }, done: { a: "yes", b: true }, furthest: { a: 2, b: 0.5 }, ticks: { "a/b": [0, 9, "x", 2], nope: [1] } });
  assert.deepEqual(junk.pos, { fine: 3 });
  assert.deepEqual(junk.done, { b: true });
  assert.deepEqual(junk.furthest, { b: 0.5 });
  assert.deepEqual(junk.ticks, { "a/b": [0, 2] });
});

test("routes: home, the you panel, and a lesson", () => {
  assert.deepEqual(parseRoute(""), { view: "home" });
  assert.deepEqual(parseRoute("#/"), { view: "home" });
  assert.deepEqual(parseRoute("#/you"), { view: "home", focus: "you" });
  assert.deepEqual(parseRoute("#/l/own-your-exit"), { view: "lesson", id: "own-your-exit" });
  assert.deepEqual(parseRoute("#/l/<script>"), { view: "home" });
  assert.deepEqual(parseRoute("#/l/../../etc"), { view: "home" });
});
