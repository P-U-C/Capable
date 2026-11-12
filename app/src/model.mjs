// Pure derivations from the App and the reader's progress, shared by home and
// the deck: reading order, traits and how full they are, and the context a
// deck is rendered with.
//
// Drafts (status "draft") are shown and can be read, but they never count
// toward any total: not the trait card's count, not the logo's fill, not the
// traits on home or in the "you" panel.

import { deckCards } from "./deck.mjs";

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

/** How many traits are complete (every ready lesson for it finished). */
export const traitsComplete = (tp) => tp.filter((t) => t.total > 0 && t.done === t.total).length;

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
  const after = list[at + 1];
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
      totalLessons: ready.length,
      logoFilled: logoFill(doneAfter, ready.length),
      ticks: state.ticks || {},
    },
  };
}
