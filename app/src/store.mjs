// The reader's progress, kept in localStorage. Storage can be missing, full,
// disabled or throwing (private modes, sandboxed frames): every access is
// guarded and the app works the same without it, it just forgets.

const KEY = "citizen.v1";
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function emptyState() {
  return { pos: {}, furthest: {}, done: {}, ticks: {}, sound: false };
}

/** Keep only well-formed entries from whatever was stored. */
export function sanitize(raw) {
  const s = emptyState();
  if (!raw || typeof raw !== "object") return s;
  for (const [k, v] of Object.entries(raw.pos || {})) if (ID.test(k) && Number.isInteger(v) && v >= 0 && v < 100) s.pos[k] = v;
  for (const [k, v] of Object.entries(raw.furthest || {})) if (ID.test(k) && typeof v === "number" && v >= 0 && v <= 1) s.furthest[k] = v;
  for (const [k, v] of Object.entries(raw.done || {})) if (ID.test(k) && v === true) s.done[k] = true;
  for (const [k, v] of Object.entries(raw.ticks || {}))
    if (/^[a-z0-9-]+\/[a-z0-9-]+$/.test(k) && Array.isArray(v)) s.ticks[k] = v.filter((n) => Number.isInteger(n) && n >= 0 && n < 8).slice(0, 8);
  s.sound = raw.sound === true;
  return s;
}

/** Pure: the state after the reader lands on card `index` of `count`. */
export function recordVisit(state, id, { index, count, finished = false }) {
  const frac = count > 1 ? Math.min(1, index / (count - 1)) : 1;
  return {
    ...state,
    pos: { ...state.pos, [id]: index },
    furthest: { ...state.furthest, [id]: Math.max(state.furthest[id] || 0, finished ? 1 : frac) },
    done: finished || state.done[id] ? { ...state.done, [id]: true } : state.done,
  };
}

/** Pure: toggle a practice step's tick. */
export function toggleTick(state, key, n) {
  const cur = new Set(state.ticks[key] || []);
  cur.has(n) ? cur.delete(n) : cur.add(n);
  return { ...state, ticks: { ...state.ticks, [key]: [...cur].sort((a, b) => a - b) } };
}

/** The reader's progress through one lesson, for rings and buttons. */
export function lessonProgress(state, id) {
  const done = state.done[id] === true;
  const frac = done ? 1 : state.furthest[id] || 0;
  return { done, fraction: frac, started: frac > 0 || Number.isInteger(state.pos[id]) };
}

function storageOf(explicit) {
  if (explicit !== undefined) return explicit;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function openStore(storage) {
  const st = storageOf(storage);
  let state;
  try {
    state = sanitize(JSON.parse(st?.getItem(KEY) || "null"));
  } catch {
    state = emptyState();
  }
  const save = () => {
    try {
      st?.setItem(KEY, JSON.stringify(state));
    } catch {
      /* full or disabled: keep going in memory */
    }
  };
  return {
    get: () => state,
    visit(id, info) {
      state = recordVisit(state, id, info);
      save();
      return state;
    },
    tick(key, n) {
      state = toggleTick(state, key, n);
      save();
      return state;
    },
    setSound(on) {
      state = { ...state, sound: on === true };
      save();
    },
  };
}
