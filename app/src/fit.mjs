// Long cards fit their phone: the type steps down (data-fit 1, then 2) until
// the card's body fits, and only past the last step does the body scroll.
// Text is never clipped. The step logic is pure; fitCard is its DOM half.
//
// Big titles (Shout headings, the passport's name) never break inside a word:
// when their longest word is wider than the line, the title shrinks
// (--title-scale, set through CSSOM) until it fits; only below TITLE_MIN does a
// word break, as a last resort, rather than run off the page.

export const TITLES = ".shout, .pp__name";
export const TITLE_MIN = 0.55;

/**
 * The scale at which a title fits: `widthAt(scale)` lays it out at that scale
 * and returns { content, avail } (its scrollWidth and clientWidth). Each step
 * jumps to the measured ratio (a little under), so a few steps settle it.
 * Returns { scale, broken }: broken when even TITLE_MIN overflows.
 */
export function titleScale(widthAt, min = TITLE_MIN) {
  let scale = 1;
  for (let i = 0; i < 6; i++) {
    const { content, avail } = widthAt(scale);
    if (!(avail > 0) || content <= avail + 1) return { scale, broken: false };
    const next = Math.max(min, scale * (avail / content) * 0.98);
    if (next >= scale) return { scale: min, broken: true };
    scale = next;
  }
  const { content, avail } = widthAt(scale);
  return content <= avail + 1 ? { scale, broken: false } : { scale: min, broken: true };
}

/** Fit one title element to its line width. */
export function fitTitle(el) {
  if (!el?.style) return;
  el.style.removeProperty("--title-scale");
  el.removeAttribute?.("data-title-break");
  const r = titleScale((scale) => {
    if (scale === 1) el.style.removeProperty("--title-scale");
    else el.style.setProperty("--title-scale", scale.toFixed(3));
    return { content: el.scrollWidth, avail: el.clientWidth };
  });
  if (r.scale !== 1) el.style.setProperty("--title-scale", r.scale.toFixed(3));
  if (r.broken) el.setAttribute?.("data-title-break", "");
  // data-max-lines (home tiles): keep shrinking until the title is at most that many lines tall,
  // so every tile is the same size (owner, 2026-11-13). Never below TITLE_MIN.
  const maxLines = Number(el.dataset?.maxLines || 0);
  if (!(maxLines > 0) || r.broken || typeof getComputedStyle !== "function") return;
  let scale = r.scale;
  el.style.setProperty("min-height", "0px"); // measure the text, not the tile's reserved two-line box
  try {
    for (let i = 0; i < 10; i++) {
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      if (!(lh > 0) || el.scrollHeight <= lh * maxLines + 2) return;
      const next = Math.max(TITLE_MIN, scale * 0.94);
      if (next >= scale) return;
      scale = next;
      el.style.setProperty("--title-scale", scale.toFixed(3));
    }
  } finally {
    el.style.removeProperty("min-height");
  }
}

/** Fit every title under `root`. */
export function fitTitles(root) {
  for (const el of root?.querySelectorAll?.(TITLES) || []) fitTitle(el);
}

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
  card.removeAttribute?.("data-scrolls"); // measure without the "more below" strip
  fitTitles(card); // a title that shrinks to fit its width is shorter too: before the height
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
