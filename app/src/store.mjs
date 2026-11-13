// The reader's progress, kept in localStorage. Storage can be missing, full,
// disabled or throwing (private modes, sandboxed frames): every access is
// guarded and the app works the same without it, it just forgets.
//
// Places and ticks are kept by stable card keys ("idea-2") and step ids (a
// hash of the step's text), never by index, so they survive work arriving and
// lessons being edited (review S12). The key is namespaced by the app's base
// path, so two deployments on one origin never share progress (S23). Progress
// saved by older versions (index-based, under "citizen.v1") is read once and
// converted lesson by lesson when that lesson is next opened.

const LEGACY_KEY = "citizen.v1";
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CARD_KEY = /^[a-z]+(?:-\d{1,3})?$/;
const STEP_ID = /^s[0-9a-z]{1,8}$/;
const TICK_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z]+-\d{1,3}$/;

/** The localStorage key for an app served from `base` (its directory path, e.g. "/Capable/"). */
export const storageKey = (base = "/") => `capable.progress@${String(base || "/")}`;

export function emptyState() {
  return { at: {}, furthest: {}, done: {}, ticks: {}, sound: false, legacy: { pos: {}, ticks: {} } };
}

/** Keep only well-formed entries from whatever was stored (either format). */
export function sanitize(raw) {
  const s = emptyState();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return s;
  const entries = (o) => (o && typeof o === "object" && !Array.isArray(o) ? Object.entries(o) : []);
  for (const [k, v] of entries(raw.at)) if (ID.test(k) && typeof v === "string" && CARD_KEY.test(v)) s.at[k] = v;
  for (const [k, v] of entries(raw.furthest)) if (ID.test(k) && typeof v === "number" && v >= 0 && v <= 1) s.furthest[k] = v;
  for (const [k, v] of entries(raw.done)) if (ID.test(k) && v === true) s.done[k] = true;
  for (const [k, v] of entries(raw.ticks)) {
    if (!Array.isArray(v)) continue;
    if (TICK_KEY.test(k) && v.every((x) => typeof x === "string")) s.ticks[k] = [...new Set(v.filter((x) => STEP_ID.test(x)))].slice(0, 8);
    else if (/^[a-z0-9-]+\/[a-z0-9-]+$/.test(k)) s.legacy.ticks[k] = v.filter((n) => Number.isInteger(n) && n >= 0 && n < 8).slice(0, 8);
  }
  // older versions: a card index per lesson, and index-keyed ticks
  for (const [k, v] of entries(raw.pos)) if (ID.test(k) && Number.isInteger(v) && v >= 0 && v < 100) s.legacy.pos[k] = v;
  for (const [k, v] of entries(raw.legacy?.pos)) if (ID.test(k) && Number.isInteger(v) && v >= 0 && v < 100) s.legacy.pos[k] = v;
  for (const [k, v] of entries(raw.legacy?.ticks))
    if (/^[a-z0-9-]+\/[a-z0-9-]+$/.test(k) && Array.isArray(v)) s.legacy.ticks[k] = v.filter((n) => Number.isInteger(n) && n >= 0 && n < 8).slice(0, 8);
  s.sound = raw.sound === true;
  return s;
}

/**
 * Pure: the state after the reader lands on a card. `key` is the card's
 * stable key, `index`/`count` give how far through the deck it is, and
 * `finished` says the lesson is done (the caller passes it only for ready
 * lessons: a draft is never recorded as done, review S11).
 */
export function recordVisit(state, id, { key, index, count, finished = false }) {
  const frac = count > 1 ? Math.min(1, Math.max(0, index / (count - 1))) : 1;
  return {
    ...state,
    at: typeof key === "string" && CARD_KEY.test(key) ? { ...state.at, [id]: key } : state.at,
    furthest: { ...state.furthest, [id]: Math.max(state.furthest[id] || 0, finished ? 1 : frac) },
    done: finished || state.done[id] ? { ...state.done, [id]: true } : state.done,
  };
}

/** Pure: toggle a practice step's tick. `key` is "<lesson>/<card key>", `step` the step's id. */
export function toggleTick(state, key, step) {
  if (!TICK_KEY.test(key) || !STEP_ID.test(step)) return state;
  const cur = new Set(state.ticks[key] || []);
  cur.has(step) ? cur.delete(step) : cur.add(step);
  return { ...state, ticks: { ...state.ticks, [key]: [...cur].sort() } };
}

/**
 * Pure: convert progress an older version saved for one lesson, now that its
 * cards (from deckCards) are known: the saved card index becomes that card's
 * key, and index-keyed ticks become step ids. Converted entries leave
 * `legacy`; a key already saved in the new form wins.
 */
export function migrateLesson(state, id, cards) {
  let s = state;
  const pos = s.legacy.pos[id];
  if (Number.isInteger(pos)) {
    const key = cards[pos]?.key;
    const { [id]: _gone, ...rest } = s.legacy.pos;
    s = { ...s, at: key && !(id in s.at) ? { ...s.at, [id]: key } : s.at, legacy: { ...s.legacy, pos: rest } };
  }
  for (const c of cards) {
    if (c.type !== "practice" || !Number.isInteger(c.at)) continue;
    const old = `${id}/practice-${c.at}`;
    const ns = s.legacy.ticks[old];
    if (!ns) continue;
    const key = `${id}/${c.key}`;
    const ids = ns.map((n) => c.stepIds?.[n]).filter((x) => typeof x === "string");
    const { [old]: _gone, ...rest } = s.legacy.ticks;
    s = { ...s, ticks: { ...s.ticks, [key]: [...new Set([...(s.ticks[key] || []), ...ids])].sort() }, legacy: { ...s.legacy, ticks: rest } };
  }
  return s;
}

/** The reader's progress through one lesson, for tiles and buttons. Opening only the cover is not "started". */
export function lessonProgress(state, id) {
  const done = state.done[id] === true;
  const frac = done ? 1 : state.furthest[id] || 0;
  return { done, fraction: frac, started: frac > 0 };
}

function storageOf(explicit) {
  if (explicit !== undefined) return explicit;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** What is written: the legacy part only while something is left to convert. */
function serialize(state) {
  const { legacy, ...rest } = state;
  const left = Object.keys(legacy.pos).length + Object.keys(legacy.ticks).length;
  return JSON.stringify({ v: 2, ...rest, ...(left ? { legacy } : {}) });
}

export function openStore(storage, { key = storageKey("/") } = {}) {
  const st = storageOf(storage);
  let state;
  try {
    const raw = st?.getItem(key) ?? st?.getItem(LEGACY_KEY) ?? null;
    state = sanitize(JSON.parse(raw || "null"));
  } catch {
    state = emptyState();
  }
  const save = () => {
    try {
      st?.setItem(key, serialize(state));
    } catch {
      /* full or disabled: keep going in memory */
    }
  };
  return {
    key,
    get: () => state,
    visit(id, info) {
      state = recordVisit(state, id, info);
      save();
      return state;
    },
    tick(tickKey, step) {
      state = toggleTick(state, tickKey, step);
      save();
      return state;
    },
    setSound(on) {
      state = { ...state, sound: on === true };
      save();
    },
    /** Convert an older version's progress for this lesson (see migrateLesson). */
    migrate(id, cards) {
      const next = migrateLesson(state, id, cards);
      if (next !== state) {
        state = next;
        save();
      }
      return state;
    },
  };
}
