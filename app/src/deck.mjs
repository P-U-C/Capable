// A1: the deck engine's pure half. No DOM here: the card list, the state
// machine, progress, and the arithmetic the gesture layer uses to decide what
// a drag or a tap means. src/gesture.mjs and src/view-deck.mjs wire it to the page.

/** Card types the app knows how to draw. Anything else is skipped (fail closed). */
const TEXT_CARDS = new Set(["cover", "idea", "story", "term", "counter", "question", "practice", "trait", "deeper"]);

/**
 * The cards a reader actually swipes: the lesson's cards in order, with work
 * slots expanded from lesson.work and skipped entirely when no work has that
 * role, and a final "next" handoff card.
 *   lead → one full-bleed card per lead work (normally exactly one)
 *   more → one card listing every "more" work
 */
export function deckCards(lesson) {
  const works = Array.isArray(lesson?.work) ? lesson.work : [];
  const used = new Set();
  const out = [];
  (lesson?.cards || []).forEach((c, i) => {
    if (!c || typeof c !== "object") return;
    if (c.type === "work") {
      if (used.has(c.role)) return;
      used.add(c.role);
      const ws = works.filter((w) => w && w.role === c.role);
      if (!ws.length) return;
      if (c.role === "lead") ws.forEach((w, j) => out.push({ type: "lead", key: `lead-${j}`, work: w }));
      else if (c.role === "more") out.push({ type: "more", key: "more", works: ws });
      return;
    }
    if (TEXT_CARDS.has(c.type)) out.push({ ...c, key: `${c.type}-${i}` });
  });
  out.push({ type: "next", key: "next" });
  return out;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function createDeck(count, index = 0) {
  const n = Math.max(1, count | 0);
  const i = clamp(Number.isInteger(index) ? index : 0, 0, n - 1);
  return { count: n, index: i, furthest: i };
}

/** The deck's only transition function. Unknown actions return the same state. */
export function step(state, action) {
  const to = (i) => {
    const index = clamp(i, 0, state.count - 1);
    if (index === state.index) return state;
    return { ...state, index, furthest: Math.max(state.furthest, index) };
  };
  switch (action?.type) {
    case "next":
      return to(state.index + 1);
    case "prev":
      return to(state.index - 1);
    case "goto":
      return Number.isInteger(action.index) ? to(action.index) : state;
    default:
      return state;
  }
}

export const atStart = (s) => s.index === 0;
export const atEnd = (s) => s.index === s.count - 1;

/** Stories-style segments: every card before the current one is done. */
export function segments(s) {
  return Array.from({ length: s.count }, (_, i) => (i < s.index ? "done" : i === s.index ? "active" : "todo"));
}

/** 0..1 through the deck by the furthest card reached. */
export const fraction = (s) => (s.count <= 1 ? 1 : s.furthest / (s.count - 1));

/**
 * Where to reopen a lesson. A remembered position is used unless it is
 * missing, out of range, or on the final handoff card (then start over).
 */
export function resumeIndex(saved, count) {
  if (!Number.isInteger(saved) || saved < 0 || saved >= count - 1) return 0;
  return saved;
}

/** Is the lesson finished? Reaching the trait card (or the handoff after it) counts. */
export function isFinishedAt(cards, index) {
  const t = cards.findIndex((c) => c.type === "trait");
  const end = t >= 0 ? t : cards.length - 1;
  return index >= end;
}

// ---- gesture arithmetic ---------------------------------------------------

export const SLOP = 10; // px before a press becomes a drag
export const HOLD_MS = 350; // press longer than this without moving = hold (pause)
export const TAP_MS = 300; // press shorter than this without moving = tap
export const DISTANCE = 0.22; // fraction of width that commits a swipe
export const VELOCITY = 0.35; // px/ms that commits a flick

/** iOS-style resistance past the ends: the further you pull, the less it moves. */
export function rubberBand(dx, width, c = 0.55) {
  if (!width) return 0;
  const a = Math.abs(dx);
  return Math.sign(dx) * (1 - 1 / ((a * c) / width + 1)) * width;
}

export const PEEK = 16; // px the next card sits to the right, like stacked paper (tokens.css --peek wins at runtime)
export const TILT = 3; // degrees a card turns as it is dealt away

/**
 * Where card i sits in the stack while the deck is at `index` and the finger
 * has moved dx (negative = toward the next card). Cards behind the current
 * one wait at the peek offset; cards already read sit off to the left, turned
 * a little, like dealt cards. Past either end the current card is
 * rubber-banded. The view applies these with transform only.
 */
export function stackPose(i, index, dx, width, count, peek = PEEK) {
  const PEEK = peek;
  const off = -(width + 48);
  const fwd = dx < 0 && index < count - 1 ? Math.min(1, -dx / width) : 0;
  const back = dx > 0 && index > 0 ? Math.min(1, dx / width) : 0;
  if (i < index - 1) return { x: off, rot: -TILT, z: 0, shown: false };
  if (i === index - 1) return back > 0 ? { x: off * (1 - back), rot: -TILT * (1 - back), z: 4, shown: true } : { x: off, rot: -TILT, z: 0, shown: false };
  if (i === index) {
    if (dx < 0) {
      const x = index === count - 1 ? rubberBand(dx, width) : dx;
      return { x, rot: (TILT * x) / width, z: 3, shown: true };
    }
    if (dx > 0) return index === 0 ? { x: rubberBand(dx, width), rot: 0, z: 3, shown: true } : { x: PEEK * back, rot: 0, z: 3, shown: true };
    return { x: 0, rot: 0, z: 3, shown: true };
  }
  if (i === index + 1) return { x: PEEK * (1 - fwd), rot: 0, z: 2, shown: true };
  return { x: PEEK, rot: 0, z: 1, shown: false };
}

/** Where a released drag lands: a flick or a long enough drag moves one card. */
export function settle({ dx, vx = 0, width, index, count }) {
  const flick = Math.abs(vx) > VELOCITY && Math.sign(vx) === Math.sign(dx) && Math.abs(dx) > SLOP;
  const far = width > 0 && Math.abs(dx) > width * DISTANCE;
  if (!(flick || far)) return index;
  return clamp(index + (dx < 0 ? 1 : -1), 0, count - 1);
}

/** Left third goes back, right third goes forward, the middle is for the card. */
export function tapZone(x, width) {
  if (!(width > 0)) return "middle";
  if (x < width / 3) return "prev";
  if (x > (2 * width) / 3) return "next";
  return "middle";
}

/** What a pointer press was, from how far and how long it moved. */
export function classifyPress({ dx, dy, ms }) {
  const moved = Math.hypot(dx, dy) > SLOP;
  if (moved) return Math.abs(dx) > Math.abs(dy) ? "swipe" : "scroll";
  if (ms >= HOLD_MS) return "hold";
  if (ms <= TAP_MS) return "tap";
  return "none";
}

/** Keyboard map. Space is next, Shift+Space back, Esc closes the deck. */
export function keyAction(key, { shift = false } = {}) {
  switch (key) {
    case "ArrowRight":
    case "PageDown":
      return "next";
    case "ArrowLeft":
    case "PageUp":
      return "prev";
    case " ":
    case "Spacebar":
      return shift ? "prev" : "next";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "Escape":
    case "Esc":
      return "close";
    default:
      return null;
  }
}
