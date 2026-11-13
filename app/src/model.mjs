// Pure derivations from the App and the reader's progress, shared by home and
// the deck: reading order, traits and how full they are, and the context a
// deck is rendered with.
//
// Drafts (status "draft") are shown and can be read, but they never count
// toward any total: not the trait card's count, not the logo's fill, not the
// traits on home or in the "you" panel.

import { deckCards } from "./deck.mjs";
import { lessonProgress } from "./store.mjs";

/** The trait a lesson builds, or a neutral stand-in if the App names an unknown one. */
export function traitOf(app, lesson) {
  return app.traits.find((t) => t.id === lesson.trait) || { id: lesson.trait, name: lesson.trait, grant: "", hue: 195 };
}

/** Lessons in reading order with their 1-based position (numbers may have gaps). */
export const ordered = (app) => [...(app.lessons || [])].sort((a, b) => a.number - b.number).map((lesson, i) => ({ lesson, position: i + 1 }));

/** A lesson that counts toward totals: written up, not an automatic draft. */
export const counts = (lesson) => lesson?.status === "ready";

/** The lessons that count, in reading order. */
export const countable = (app) => ordered(app).filter((x) => counts(x.lesson));

/** Each trait with how many of its ready lessons exist and how many are finished. */
export function traitProgress(app, state) {
  const ready = countable(app).map((x) => x.lesson);
  return app.traits.map((trait) => {
    const ls = ready.filter((l) => l.trait === trait.id);
    const done = ls.filter((l) => state.done[l.id] === true).length;
    return { trait, total: ls.length, done, fraction: ls.length ? done / ls.length : 0 };
  });
}

/**
 * How many traits are earned: at least one finished ready lesson builds it (SPEC-V3 "Earned").
 * The same rule as passport.earnedTraitIds, so home's "N/4", the passport, the seal and the stamps agree
 * once a trait has more than one lesson (e.g. mobile: vote-with-your-feet + know-who-came-first).
 */
export const traitsComplete = (tp) => tp.filter((t) => t.total > 0 && t.done > 0).length;

/** What home's intro says: how many ready lessons, their minutes (low, high), and how many traits they build. */
export function homeFacts(app) {
  const ready = countable(app).map((x) => x.lesson);
  const mins = ready.map((l) => l.minutes).filter((n) => Number.isInteger(n) && n > 0);
  const traits = new Set(ready.map((l) => l.trait));
  return { lessons: ready.length, minutes: mins.length ? [Math.min(...mins), Math.max(...mins)] : [0, 0], traits: app.traits.filter((t) => traits.has(t.id)).length };
}

/** Where a lesson stands for the reader, with its trait and reading position. */
const entry = (app, state, x) => ({ ...x, trait: traitOf(app, x.lesson), ...lessonProgress(state, x.lesson.id) });

/** The first ready lesson the reader has not finished, in reading order; null when every ready lesson is done (review U2). */
export function upNext(app, state) {
  const x = countable(app).find((y) => state.done?.[y.lesson.id] !== true);
  return x ? entry(app, state, x) : null;
}

/**
 * The hand-off at the end of a lesson (review U3): the first unfinished ready
 * lesson after this one, wrapping round to the start, and how many unfinished
 * ready lessons remain besides this one. `next` is null only when every other
 * ready lesson is done ("all caught up").
 */
export function nextAfter(app, lessonId, state) {
  const list = ordered(app);
  const at = list.findIndex((x) => x.lesson.id === lessonId);
  const around = at < 0 ? list : [...list.slice(at + 1), ...list.slice(0, at)];
  const open = around.filter((x) => counts(x.lesson) && state.done?.[x.lesson.id] !== true);
  return { next: open.length ? entry(app, state, open[0]) : null, left: open.length };
}

/** Logo letters filled for `done` of `total` lessons (7 letters in "capable"). */
export function logoFill(done, total, letters = 7) {
  if (!total || done <= 0) return 0;
  return Math.max(1, Math.min(letters, Math.round((letters * done) / total)));
}

/**
 * Everything a deck is rendered from: its cards (work slots resolved) and the
 * context the card renderers read. The trait card's one count is ready lessons
 * finished out of ready lessons in the whole app, including this lesson
 * (reaching that card finishes it) unless it is a draft. Null for an unknown id.
 */
export function deckModel(app, lessonId, state) {
  const list = ordered(app);
  const at = list.findIndex((x) => x.lesson.id === lessonId);
  if (at < 0) return null;
  const { lesson, position } = list[at];
  const trait = traitOf(app, lesson);
  const cards = deckCards(lesson);
  const doneIds = new Set([...Object.keys(state.done || {}).filter((id) => state.done[id] === true), lesson.id]);
  const ready = countable(app);
  const doneAfter = ready.filter((x) => doneIds.has(x.lesson.id)).length;
  const { next, left } = nextAfter(app, lessonId, state);
  return {
    cards,
    ctx: {
      app,
      lesson,
      trait,
      hue: trait.hue,
      position,
      count: cards.length,
      next,
      left,
      doneAfter,
      totalLessons: ready.length,
      logoFilled: logoFill(doneAfter, ready.length),
      ticks: state.ticks || {},
    },
  };
}
