// Reading progress and preferences, kept in localStorage when it exists.
// Every storage access is wrapped: private modes and sandboxes throw.

const KEY = "primer:v1";
export const DEPTHS = ["line", "minute", "essay", "source", "voices"];
export const DEPTH_LABEL = { line: "Line", minute: "Minute", essay: "Essay", source: "Source", voices: "Voices" };
export const DEFAULT_DEPTH = 2;

/** A fresh, valid state. */
export function blank() {
  return { reads: [], depth: DEFAULT_DEPTH, path: "editors-path", last: null };
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Accept only well-formed stored state; anything odd falls back to defaults. */
export function sanitize(v) {
  const s = blank();
  if (!v || typeof v !== "object") return s;
  if (Array.isArray(v.reads)) {
    const seen = new Set();
    for (const r of v.reads) {
      if (typeof r === "string" && SLUG.test(r) && !seen.has(r)) {
        seen.add(r);
        s.reads.push(r);
      }
    }
    s.reads = s.reads.slice(-500);
  }
  if (Number.isInteger(v.depth) && v.depth >= 1 && v.depth <= 5) s.depth = v.depth;
  if (v.path === "published" || v.path === "editors-path") s.path = v.path;
  if (typeof v.last === "string" && SLUG.test(v.last)) s.last = v.last;
  return s;
}

/** Mark an idea read; the most recent read moves to the end. */
export function markRead(state, id) {
  return { ...state, reads: [...state.reads.filter((r) => r !== id), id] };
}

export function markUnread(state, id) {
  return { ...state, reads: state.reads.filter((r) => r !== id) };
}

export const readSet = (state) => new Set(state.reads);
export const lastRead = (state) => (state.reads.length ? state.reads[state.reads.length - 1] : null);

export function load(storage) {
  try {
    const raw = storage && storage.getItem(KEY);
    return sanitize(raw ? JSON.parse(raw) : null);
  } catch {
    return blank();
  }
}

export function save(storage, state) {
  try {
    if (storage) storage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or unavailable: progress lives for this visit only */
  }
}
