// Long cards fit their phone: the type steps down (data-fit 1, then 2) until
// the card's body fits, and only past the last step does the body scroll.
// Text is never clipped. The step logic is pure; fitCard is its DOM half.

/** Card types whose text may need to step down. */
export const FIT_TYPES = new Set(["idea", "story", "term", "counter", "question", "practice"]);
export const FIT_MAX = 2;
const SLACK = 6;

/**
 * The smallest step (0..max) at which the card no longer overflows, and
 * whether it still scrolls at the last step. `overflowsAt(k)` applies step k
 * and reports overflow.
 */
export function fitStep(overflowsAt, max = FIT_MAX) {
  for (let k = 0; k <= max; k++) if (!overflowsAt(k)) return { step: k, scrolls: false };
  return { step: max, scrolls: true };
}

/**
 * Fit one card. Text cards step their type down; any card whose body still
 * overflows is marked data-scrolls, which shows a small "more below" cue
 * until the body is scrolled to its end (data-at-end).
 */
export function fitCard(card, max = FIT_MAX) {
  const body = card?.querySelector?.(".card__body");
  if (!body) return;
  // a few px past the end only eats into the body's bottom padding, never text
  const overflows = () => body.scrollHeight > body.clientHeight + SLACK;
  const r = FIT_TYPES.has(card.dataset.type)
    ? fitStep((k) => {
        card.dataset.fit = String(k);
        return overflows();
      }, max)
    : { step: 0, scrolls: overflows() };
  if (FIT_TYPES.has(card.dataset.type)) card.dataset.fit = String(r.step);
  card.toggleAttribute("data-scrolls", r.scrolls);
  atEnd(card, body);
  if (!body.dataset.watched) {
    body.dataset.watched = "true";
    body.addEventListener("scroll", () => atEnd(card, body), { passive: true });
  }
}

const atEnd = (card, body) => card.toggleAttribute("data-at-end", body.scrollTop + body.clientHeight >= body.scrollHeight - 4);
