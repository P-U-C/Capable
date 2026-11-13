// Review T10: what a returning reader hasn't seen yet. This browser keeps,
// per lesson, the work ids it has shown, under the app's scoped key:
//
//   { v: 1, lessons: { <lesson id>: [<work id>, …] } }
//
// The first visit takes everything there is as seen (nothing is "new" to a
// newcomer). After that a lesson missing from the record is new, and a lesson
// with works the record lacks has that many new works, until the reader opens
// it. Validated on read; storage may be missing, full or throwing.

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WORK_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const seenKey = (base = "/") => `capable.seen@${String(base || "/")}`;

const workIds = (lesson) => (Array.isArray(lesson?.work) ? lesson.work.map((w) => w?.id).filter((id) => typeof id === "string" && WORK_ID.test(id)) : []);

export function sanitizeSeen(raw) {
  const out = { v: 1, lessons: {} };
  const l = raw?.lessons;
  if (!raw || raw.v !== 1 || !l || typeof l !== "object" || Array.isArray(l)) return null;
  for (const [id, works] of Object.entries(l)) {
    if (!ID.test(id) || !Array.isArray(works)) continue;
    out.lessons[id] = [...new Set(works.filter((w) => typeof w === "string" && WORK_ID.test(w)))].slice(0, 256);
  }
  return out;
}

export function openSeen(storage, { key = seenKey("/") } = {}) {
  let state = null;
  try {
    state = sanitizeSeen(JSON.parse(storage?.getItem(key) || "null"));
  } catch {
    state = null;
  }
  const save = () => {
    try {
      storage?.setItem(key, JSON.stringify(state));
    } catch {
      /* full or disabled: this session only */
    }
  };
  return {
    key,
    get: () => state,
    /** First visit: everything in this App counts as seen. Later visits change nothing here. */
    baseline(app) {
      if (state || !Array.isArray(app?.lessons)) return false;
      state = { v: 1, lessons: Object.fromEntries(app.lessons.filter((l) => ID.test(l?.id ?? "")).map((l) => [l.id, workIds(l)])) };
      save();
      return true;
    },
    /** What is new since the reader last opened each lesson: { lessons: Set<id>, works: Map<id, count> }. */
    news(app) {
      const lessons = new Set();
      const works = new Map();
      if (!state) return { lessons, works };
      for (const l of app?.lessons || []) {
        const had = state.lessons[l.id];
        if (!had) lessons.add(l.id);
        else {
          const n = workIds(l).filter((w) => !had.includes(w)).length;
          if (n) works.set(l.id, n);
        }
      }
      return { lessons, works };
    },
    /** The reader opened this lesson: it and its works are seen. */
    markLesson(lesson) {
      if (!ID.test(lesson?.id ?? "")) return;
      const ids = workIds(lesson);
      const had = state?.lessons?.[lesson.id];
      if (had && ids.every((w) => had.includes(w))) return;
      state = { v: 1, lessons: { ...(state?.lessons || {}), [lesson.id]: [...new Set([...(had || []), ...ids])] } };
      save();
    },
  };
}
