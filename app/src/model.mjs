// Pure derivations from the App and the reader's progress, shared by home and
// the deck: reading order, traits and how full they are, and the context a
// deck is rendered with.

import { deckCards } from "./deck.mjs";

/** The trait a lesson builds, or a neutral stand-in if the App names an unknown one. */
export function traitOf(app, lesson) {
  return app.traits.find((t) => t.id === lesson.trait) || { id: lesson.trait, name: lesson.trait, grant: "", hue: 195 };
}

/** Lessons in reading order with their 1-based position (numbers may have gaps). */
export const ordered = (app) => [...(app.lessons || [])].sort((a, b) => a.number - b.number).map((lesson, i) => ({ lesson, position: i + 1 }));

/** Each trait with how many of its lessons exist and how many are finished. */
export function traitProgress(app, state) {
  return app.traits.map((trait) => {
    const ls = app.lessons.filter((l) => l.trait === trait.id);
    const done = ls.filter((l) => state.done[l.id] === true).length;
    return { trait, total: ls.length, done, fraction: ls.length ? done / ls.length : 0 };
  });
}

/** How many traits are complete (every lesson for it finished). */
export const traitsComplete = (tp) => tp.filter((t) => t.total > 0 && t.done === t.total).length;

/** Logo letters filled for `done` of `total` lessons (7 letters in "capable"). */
export function logoFill(done, total, letters = 7) {
  if (!total || done <= 0) return 0;
  return Math.max(1, Math.min(letters, Math.round((letters * done) / total)));
}

/**
 * Everything a deck is rendered from: its cards (work slots resolved) and the
 * context the card renderers read. Counts on the trait card include this
 * lesson, because reaching that card finishes it. Null for an unknown id.
 */
export function deckModel(app, lessonId, state) {
  const list = ordered(app);
  const at = list.findIndex((x) => x.lesson.id === lessonId);
  if (at < 0) return null;
  const { lesson, position } = list[at];
  const trait = traitOf(app, lesson);
  const cards = deckCards(lesson);
  const doneIds = new Set([...Object.keys(state.done || {}), lesson.id]);
  const doneAfter = list.filter((x) => doneIds.has(x.lesson.id)).length;
  const after = list[at + 1];
  const mine = list.filter((x) => x.lesson.trait === trait.id);
  return {
    cards,
    ctx: {
      app,
      lesson,
      trait,
      hue: trait.hue,
      position,
      count: cards.length,
      next: after ? { lesson: after.lesson, position: after.position, trait: traitOf(app, after.lesson) } : null,
      doneAfter,
      totalLessons: list.length,
      logoFilled: logoFill(doneAfter, list.length),
      traitTotal: mine.length,
      traitDone: mine.filter((x) => doneIds.has(x.lesson.id)).length,
      ticks: state.ticks || {},
    },
  };
}
