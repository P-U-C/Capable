// W3 — the live overlay.
// In the artifact, `window.claude.use("db")` may resolve (later, never during
// the first run) to a read-only namespace. Primer reads it once at load, never
// writes, never subscribes. Every doc is validated against the contract;
// valid docs replace the snapshot item with the same key or are appended;
// invalid docs are dropped and counted, never rendered.

import { validateSubmission, validatePrize, validateChapterDoc, validatePerson, validateStrand } from "../../contract/validate.mjs";

export const COLLECTIONS = ["submissions", "prizes", "chapters", "people", "strands"];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const KEY = {
  submissions: (x) => x.hash,
  prizes: (x) => x.id,
  chapters: (x) => x.id,
  people: (x) => String(x.fid),
  strands: (x) => x.id,
};
const VALIDATE = {
  submissions: (x) => validateSubmission(x),
  prizes: (x) => validatePrize(x),
  chapters: (x) => validateChapterDoc(x, "chapter", { strict: false }),
  people: (x) => validatePerson(x),
  strands: (x) => validateStrand(x),
};

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Turn db query snapshots into a contract `Overlay`, plus a count of docs
 * that could not be read or whose id is not their natural key.
 * `raw` = { submissions: {docs:[{id, exists, data()}]}, ..., refresh: {exists, data()} }
 */
export function collect(raw) {
  const overlay = { submissions: [], prizes: [], chapters: [], people: [], strands: [], invalid: 0 };
  for (const name of COLLECTIONS) {
    const docs = raw && raw[name] && Array.isArray(raw[name].docs) ? raw[name].docs : [];
    for (const d of docs) {
      if (!d || d.exists === false) continue;
      let value;
      try {
        value = typeof d.data === "function" ? d.data() : undefined;
      } catch {
        value = undefined;
      }
      if (!isObj(value)) {
        overlay.invalid++;
        continue;
      }
      // A doc's id is its natural key; a mismatch means the doc cannot be trusted.
      if (typeof d.id === "string" && d.id !== "" && String(KEY[name](value)) !== d.id) {
        overlay.invalid++;
        continue;
      }
      overlay[name].push(value);
    }
  }
  const r = raw && raw.refresh;
  if (r && r.exists !== false && typeof r.data === "function") {
    try {
      const v = r.data();
      if (isObj(v) && typeof v.refreshedAt === "string" && ISO.test(v.refreshedAt)) overlay.refreshedAt = v.refreshedAt;
    } catch {
      /* no refresh time */
    }
  }
  return overlay;
}

function upsert(list, items, key, stats) {
  const out = [...list];
  const index = new Map(out.map((x, i) => [key(x), i]));
  for (const item of items) {
    const k = key(item);
    if (index.has(k)) {
      out[index.get(k)] = item;
      stats.replaced++;
    } else {
      index.set(k, out.length);
      out.push(item);
      stats.added++;
    }
  }
  return out;
}

/**
 * Pure merge of a contract `Overlay` over a snapshot Book. Never mutates the
 * snapshot. Returns { book, added, replaced, dropped, refreshedAt }.
 * `added` counts new items (not people); `dropped` counts invalid docs.
 */
export function mergeOverlay(book, overlay) {
  const stats = { added: 0, replaced: 0, dropped: Number.isInteger(overlay?.invalid) ? overlay.invalid : 0 };
  const valid = {};
  for (const name of COLLECTIONS) {
    const items = Array.isArray(overlay?.[name]) ? overlay[name] : [];
    // Last write wins inside the overlay itself.
    const byKey = new Map();
    for (const item of items) {
      if (!isObj(item) || VALIDATE[name](item).length) {
        stats.dropped++;
        continue;
      }
      byKey.set(String(KEY[name](item)), item);
    }
    valid[name] = [...byKey.values()];
  }

  const counted = { added: 0, replaced: 0 };
  const next = { ...book };
  next.submissions = upsert(book.submissions || [], valid.submissions, KEY.submissions, counted);
  next.prizes = upsert(book.prizes || [], valid.prizes, KEY.prizes, counted);
  next.strands = upsert(book.strands || [], valid.strands, KEY.strands, counted);
  next.chapters = upsert(book.chapters || [], valid.chapters, KEY.chapters, counted)
    .map((c, i) => [c, i])
    .sort((a, b) => a[0].number - b[0].number || a[1] - b[1])
    .map(([c]) => c);
  const peopleStats = { added: 0, replaced: 0 };
  const people = { ...(book.people || {}) };
  for (const p of valid.people) {
    const k = String(p.fid);
    if (k in people) peopleStats.replaced++;
    else peopleStats.added++;
    people[k] = p;
  }
  next.people = people;
  let refreshedAt = null;
  if (typeof overlay?.refreshedAt === "string" && ISO.test(overlay.refreshedAt)) {
    refreshedAt = overlay.refreshedAt;
    next.provenance = { ...(book.provenance || {}), refreshedAt };
  }
  return {
    book: next,
    added: counted.added,
    replaced: counted.replaced + peopleStats.replaced,
    dropped: stats.dropped,
    refreshedAt,
  };
}

/**
 * Read the overlay once. Resolves to a contract `Overlay` (with `invalid`)
 * or null: outside the artifact, signed out, not granted, any rejection, or
 * no answer within `timeoutMs`.
 */
export async function readOverlay(claude, { timeoutMs = 10_000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (!claude || typeof claude.use !== "function") return null;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimer(() => resolve(null), timeoutMs);
  });
  const work = (async () => {
    const db = await claude.use("db");
    if (!db || typeof db.collection !== "function") return null;
    const snaps = await Promise.all(COLLECTIONS.map((n) => db.collection(n).get()));
    const refresh = typeof db.doc === "function" ? await db.doc("meta/refresh").get() : null;
    const raw = { refresh };
    COLLECTIONS.forEach((n, i) => (raw[n] = snaps[i]));
    return collect(raw);
  })().catch(() => null);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimer(timer);
  }
}
