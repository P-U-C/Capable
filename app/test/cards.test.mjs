// A6 — card design rules that can be checked without a browser: idea cards
// rotate their look by index, the counter card is two labelled stickers, the
// trait card shows one count, drafts never count toward any total, and long
// cards step their type down before they scroll.
import test from "node:test";
import assert from "node:assert/strict";
import { renderDeck, renderCard, ideaLook, keyPhrase, IDEA_LOOKS } from "../src/cards.mjs";
import { renderHome } from "../src/home.mjs";
import { deckModel, traitProgress, traitsComplete, countable } from "../src/model.mjs";
import { deckCards } from "../src/deck.mjs";
import { fitStep, FIT_MAX } from "../src/fit.mjs";
import { emptyState, recordVisit } from "../src/store.mjs";
import { fixture, lessonOf, tags, attr, visibleText } from "./helpers.mjs";

const app = fixture();

/** The rendered markup of the first card of a type in a lesson's deck. */
function cardOf(a, lessonId, type, state = emptyState(), nth = 0) {
  const { cards, ctx } = deckModel(a, lessonId, state);
  const i = cards.map((c, k) => [c, k]).filter(([c]) => c.type === type)[nth][1];
  return String(renderCard(cards[i], i, ctx));
}

const finish = (s, id) => recordVisit(s, id, { index: 9, count: 10, finished: true });

test("idea looks rotate fill, paper, ink by the idea's place, the same on every render", () => {
  assert.deepEqual(IDEA_LOOKS, ["fill", "paper", "ink"]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(ideaLook), ["fill", "paper", "ink", "fill", "paper", "ink", "fill"]);
  assert.equal(ideaLook(undefined), "fill", "a missing index falls back to the first look");

  // ord counts ideas only, so other cards between ideas do not shift the rotation
  const lesson = {
    ...lessonOf(app, "friend-speech"),
    cards: [{ type: "cover" }, ...["one", "two", "three", "four"].flatMap((t) => [{ type: "idea", text: t }, { type: "term", term: "x", def: "y" }]), { type: "trait" }],
  };
  const ideas = deckCards(lesson).filter((c) => c.type === "idea");
  assert.deepEqual(
    ideas.map((c) => c.ord),
    [0, 1, 2, 3],
  );
  const a2 = { ...app, lessons: app.lessons.map((l) => (l.id === lesson.id ? lesson : l)) };
  const render = () => String(renderDeck(deckModel(a2, lesson.id, emptyState()).ctx, deckModel(a2, lesson.id, emptyState()).cards));
  const m = render();
  assert.equal(m, render(), "deterministic");
  const ideaTags = tags(m, "section").filter((t) => attr(t, "data-type") === "idea");
  assert.deepEqual(
    ideaTags.map((t) => attr(t, "data-look")),
    ["fill", "paper", "ink", "fill"],
  );
  assert.ok(
    tags(m, "section")
      .filter((t) => attr(t, "data-type") !== "idea")
      .every((t) => attr(t, "data-look") === null),
    "only idea cards carry a look",
  );
  // each idea shows its number as a decoration screen readers skip
  const nums = [...m.matchAll(/<div class="idea__deco" aria-hidden="true"><span class="idea__num">(\d+)<\/span>/g)].map((x) => x[1]);
  assert.deepEqual(nums, ["1", "2", "3", "4"]);
});

test("the paper look marks the key phrase: the text's own emphasis, else a short first sentence", () => {
  assert.equal(keyPhrase("Leaving is cheap. *Rules stay fair.*"), "Leaving is cheap. *Rules stay fair.*", "data emphasis wins");
  assert.equal(keyPhrase("You already vote with your feet. You chose a city."), "*You already vote with your feet.* You chose a city.");
  assert.equal(keyPhrase("Only one sentence here."), "Only one sentence here.", "never the whole text");
  const long = "In 1956 the economist Charles Tiebout answered that a country has many towns with their own bundles of taxes. People pick.";
  assert.equal(keyPhrase(long), long, "a long first sentence is not a key phrase");
  assert.equal(keyPhrase("The ones that lasted shared a short list: a creed, steady work and no debt."), "*The ones that lasted shared a short list:* a creed, steady work and no debt.", "else a short lead-in ending in a colon");
  assert.equal(keyPhrase("2 * 3 is six. Then more."), "2 * 3 is six. Then more.", "stray asterisks are left alone");
  assert.equal(keyPhrase(undefined), "");

  // rendered: paper (2nd idea) gets an <em>; fill and ink keep the text as written
  const lesson = { ...lessonOf(app, "own-your-exit"), cards: [{ type: "cover" }, ...[1, 2, 3].map(() => ({ type: "idea", text: "Short lead. Then the rest of it." })), { type: "trait" }] };
  const a2 = { ...app, lessons: app.lessons.map((l) => (l.id === lesson.id ? lesson : l)) };
  const looks = [0, 1, 2].map((n) => cardOf(a2, lesson.id, "idea", emptyState(), n));
  assert.doesNotMatch(looks[0], /<em>/);
  assert.match(looks[1], /<p class="idea__text"><em>Short lead\.<\/em> Then the rest of it\.<\/p>/);
  assert.doesNotMatch(looks[2], /<em>/);
  // and the key phrase is escaped like any other text
  const hostile = { ...lesson, cards: [{ type: "cover" }, { type: "idea", text: "a" }, { type: "idea", text: "<b>x</b>. Next." }, { type: "trait" }] };
  const a3 = { ...app, lessons: app.lessons.map((l) => (l.id === lesson.id ? hostile : l)) };
  assert.match(cardOf(a3, lesson.id, "idea", emptyState(), 1), /<em>&lt;b&gt;x&lt;\/b&gt;\.<\/em> Next\./);
});

test("the counter card renders both stickers: the objection under // but, the reply under // reply", () => {
  const c = lessonOf(app, "friend-speech").cards.find((x) => x.type === "counter");
  const m = cardOf(app, "friend-speech", "counter");
  const says = [...m.matchAll(/<div class="say say--(but|reply)"><p class="say__tab">([\s\S]*?)<\/p><p class="say__text counter__(claim|reply)">([\s\S]*?)<\/p><\/div>/g)];
  assert.equal(says.length, 2, "two stickers");
  assert.deepEqual(
    says.map((x) => [x[1], visibleText(x[2]), x[3]]),
    [
      ["but", "// but", "claim"],
      ["reply", "// reply", "reply"],
    ],
    "objection first, then the reply, each with its tab",
  );
  assert.equal(visibleText(says[0][4]), visibleText(c.claim.replace(/\*/g, "")));
  assert.equal(visibleText(says[1][4]), visibleText(c.reply.replace(/\*/g, "")));
  assert.match(m, /<p class="eyebrow"><span class="slashes" aria-hidden="true">\/\/ <\/span>push back<\/p>/, "screen readers skip the slashes (review U11)");
});

test("the trait card shows one count: ready lessons finished out of ready lessons in the app", () => {
  // fixture: three ready lessons (one per trait) and one draft
  let s = finish(emptyState(), "friend-speech");
  s = finish(s, "new-topic"); // a finished draft still does not count
  const m = cardOf(app, "own-your-exit", "trait", s);
  const text = visibleText(m);
  const countsShown = text.match(/\d+ of \d+/g) || [];
  assert.deepEqual(countsShown, ["2 of 3"], "exactly one count");
  assert.match(text, /\/\/ 2 of 3 lessons done/);
  assert.doesNotMatch(text, /of 1 lesson\b/, "no per-trait count");
  assert.match(m, /<h2 class="shout trait__name"[^>]*>[\s\S]*Sovereign/);
  const order = ["trait__name", "trait__grant", "trait__count"].map((k) => m.indexOf(k));
  assert.deepEqual([...order].sort((x, y) => x - y), order, "name, then grant, then the count");
  // accessible names do not repeat the count either
  for (const t of tags(m, "svg")) assert.doesNotMatch(attr(t, "aria-label") || "", /\d+ of \d+/);

  // a draft's own trait card: the draft is not added to the count
  const draft = visibleText(cardOf(app, "new-topic", "trait", emptyState()));
  assert.deepEqual(draft.match(/\d+ of \d+/g), ["0 of 3"]);
});

test("drafts never count toward any total: trait card, logo, home traits, you panel", () => {
  assert.deepEqual(
    countable(app).map((x) => x.lesson.id),
    ["own-your-exit", "friend-speech", "what-lasts"],
  );
  // a finished draft changes no total
  const withDraftDone = finish(emptyState(), "new-topic");
  const tp = traitProgress(app, withDraftDone);
  assert.deepEqual(
    tp.map((t) => [t.trait.id, t.done, t.total]),
    [
      ["sovereign", 0, 1],
      ["civil", 0, 1],
      ["mobile", 0, 0],
      ["enduring", 0, 1],
    ],
  );
  assert.equal(traitsComplete(tp), 0, "a trait with only drafts is never complete");
  const home = visibleText(String(renderHome(app, withDraftDone)));
  assert.doesNotMatch(home, /\b1 of 4\b/);
  assert.match(home, /\b0 of 4\b/, "you count: no trait complete");

  // all three ready lessons done: every count is full, the draft untouched
  let all = emptyState();
  for (const id of ["own-your-exit", "friend-speech", "what-lasts"]) all = finish(all, id);
  const { ctx } = deckModel(app, "what-lasts", all);
  assert.equal(ctx.totalLessons, 3);
  assert.equal(ctx.doneAfter, 3);
  assert.equal(ctx.logoFilled, 7, "the logo is full when every ready lesson is done");
  assert.equal(traitsComplete(traitProgress(app, all)), 3);

  // a ready lesson turned into a draft drops out of every total
  const demoted = { ...app, lessons: app.lessons.map((l) => (l.id === "what-lasts" ? { ...l, status: "draft" } : l)) };
  assert.equal(deckModel(demoted, "own-your-exit", emptyState()).ctx.totalLessons, 2);
  assert.equal(traitProgress(demoted, all).find((t) => t.trait.id === "enduring").total, 0);
});

test("long cards step their type down before they scroll, and never clip", () => {
  const at = (fitsFrom) => fitStep((k) => k < fitsFrom);
  assert.deepEqual(at(0), { step: 0, scrolls: false }, "fits as written");
  assert.deepEqual(at(1), { step: 1, scrolls: false });
  assert.deepEqual(at(2), { step: 2, scrolls: false });
  assert.deepEqual(at(99), { step: FIT_MAX, scrolls: true }, "past the last step the body scrolls");
  const tried = [];
  fitStep((k) => (tried.push(k), true));
  assert.deepEqual(tried, [0, 1, 2], "tries each step once, smallest first");
});
