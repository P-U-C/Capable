// Derived, read-only views of a Book. Pure: no DOM, no clock (callers pass `now`).
// The web app renders the Book; it never reclassifies anything here.

const PLACE_RANK = { "1st": 0, "2nd": 1, hm: 2 };
export const KIND_LABEL = {
  "builds-on": "Builds on",
  "in-tension-with": "In tension with",
  "instance-of": "Instance of",
  "precondition-for": "Precondition for",
  echoes: "Echoes",
};
/** How an incoming link reads from the target's side. */
export const KIND_INCOMING = {
  "builds-on": "Built on by",
  "in-tension-with": "In tension with",
  "instance-of": "Has an instance in",
  "precondition-for": "Needs first",
  echoes: "Echoed by",
};
export const PLACE_LABEL = { "1st": "1st", "2nd": "2nd", hm: "HM" };
export const EDITORS = "editors-path";
export const PUBLISHED = "published";

const arr = (v) => (Array.isArray(v) ? v : []);
const time = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
};

/** Build lookups once per Book. */
export function model(book) {
  const chapters = [...arr(book.chapters)].sort((a, b) => a.number - b.number || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const strands = arr(book.strands);
  const strandById = new Map(strands.map((s) => [s.id, s]));
  const prizes = arr(book.prizes);
  const prizeById = new Map(prizes.map((p) => [p.id, p]));
  const subs = arr(book.submissions);
  const subByHash = new Map(subs.map((s) => [s.hash, s]));
  const subsByChapter = new Map();
  for (const s of subs) {
    if (!subsByChapter.has(s.chapter)) subsByChapter.set(s.chapter, []);
    subsByChapter.get(s.chapter).push(s);
  }
  const people = book.people && typeof book.people === "object" ? book.people : {};
  const m = { book, chapters, byId, strands, strandById, prizes, prizeById, subs, subByHash, subsByChapter, people };
  m.published = publishedOrder(m);
  const editors = arr(book.paths).find((p) => p && p.id === EDITORS);
  const onPath = editors ? arr(editors.chapters).filter((id, i, a) => byId.has(id) && a.indexOf(id) === i) : [];
  // The book's frame (prologue, coda) opens and closes the editor's path even
  // when the path itself leaves them out.
  const inPath = new Set(onPath);
  const before = chapters.filter((c) => c.kind === "prologue" && !inPath.has(c.id)).map((c) => c.id);
  const after = chapters.filter((c) => c.kind === "coda" && !inPath.has(c.id)).map((c) => c.id);
  m.editorsPath = onPath.length ? [...before, ...onPath, ...after] : [];
  m.editorsPathInfo = editors || null;
  return m;
}

/** Strand ids of an idea that the book knows (unknown ids are ignored at render). */
export function ideaStrands(m, ch) {
  return arr(ch && ch.strands).filter((id, i, a) => m.strandById.has(id) && a.indexOf(id) === i);
}

/** Connections of an idea that point at ideas the book knows. */
export function ideaConnections(m, ch) {
  return arr(ch && ch.connections).filter((x) => x && m.byId.has(x.to) && x.to !== ch.id);
}

/** Incoming connections: other ideas that link to this one. */
export function incoming(m, id) {
  const out = [];
  for (const c of m.chapters) for (const x of ideaConnections(m, c)) if (x.to === id) out.push({ from: c.id, kind: x.kind, why: x.why });
  return out;
}

export function prizeOf(m, ch) {
  return ch && ch.prize ? m.prizeById.get(ch.prize) || null : null;
}

/**
 * "As published": ideas with a prize are ordered by the prize's postedAt;
 * ideas without one (prologue, coda) keep their place in number order.
 */
export function publishedOrder(m) {
  const dated = m.chapters
    .map((c) => ({ c, t: time(prizeOf(m, c)?.postedAt) }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t || a.c.number - b.c.number)
    .map((x) => x.c.id);
  let i = 0;
  return m.chapters.map((c) => (Number.isFinite(time(prizeOf(m, c)?.postedAt)) ? dated[i++] : c.id));
}

/** The ordered ids of a reading path. */
export function pathOrder(m, pathId) {
  return pathId === PUBLISHED ? m.published : m.editorsPath.length ? m.editorsPath : m.published;
}

/**
 * Previous/next ideas on the chosen path. An idea that is not on the
 * editor's path falls back to the as-published order, and says so.
 */
export function neighbours(m, pathId, id) {
  let used = pathId === PUBLISHED ? PUBLISHED : EDITORS;
  let order = pathOrder(m, used);
  if (!order.includes(id)) {
    used = PUBLISHED;
    order = m.published;
  }
  const i = order.indexOf(id);
  return {
    path: used,
    prev: i > 0 ? m.byId.get(order[i - 1]) : null,
    next: i >= 0 && i < order.length - 1 ? m.byId.get(order[i + 1]) : null,
    position: i + 1,
    length: order.length,
  };
}

/** Ideas a reader can read that sit on no strand, apart from the frame (prologue/coda). */
export function isUnplaced(m, ch) {
  return ch.kind === "chapter" && ideaStrands(m, ch).length === 0;
}

/** Voices for an idea: winners first (1st, 2nd, HM), then newest. */
export function voicesFor(m, id) {
  return [...(m.subsByChapter.get(id) || [])].sort((a, b) => {
    const pa = a.place in PLACE_RANK ? PLACE_RANK[a.place] : 9;
    const pb = b.place in PLACE_RANK ? PLACE_RANK[b.place] : 9;
    if (pa !== pb) return pa - pb;
    const ta = time(a.postedAt) || 0;
    const tb = time(b.postedAt) || 0;
    if (ta !== tb) return tb - ta;
    return a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0;
  });
}

/** Prize status as the Book states it; derived by the SPEC rules only when the Book leaves it out. */
export function prizeStatus(prize, now) {
  if (!prize) return null;
  if (prize.status) return prize.status;
  if (prize.results) return "awarded";
  const d = time(prize.deadline);
  if (!Number.isFinite(d) || !Number.isFinite(now)) return null;
  if (now < d) return "open";
  return now - d <= 14 * 86400e3 ? "judging" : "closed";
}

/** "2d 4h left", "2h 41m left", "12m left", "under a minute left"; null once passed. */
export function countdown(deadline, now) {
  const d = time(deadline);
  if (!Number.isFinite(d) || !Number.isFinite(now)) return null;
  const ms = d - now;
  if (ms <= 0) return null;
  const min = Math.floor(ms / 60e3);
  const days = Math.floor(min / 1440);
  const hours = Math.floor((min % 1440) / 60);
  const mins = min % 60;
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${mins}m left`;
  if (mins > 0) return `${mins}m left`;
  return "under a minute left";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "12 Nov", "12 Nov 2024", "12 Nov, 17:00 UTC". Always UTC, never locale-dependent. */
export function fmtDate(iso, { time: withTime = false, year = null } = {}) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const y = d.getUTCFullYear();
  let s = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  if (year !== null && year !== y) s += ` ${y}`;
  if (withTime) s += `, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
  return s;
}

/** The year the book is "set in", for deciding when dates need a year. */
export const bookYear = (m) => new Date(Date.parse(m.book.generatedAt) || 0).getUTCFullYear();

export function person(m, fid) {
  const p = m.people[String(fid)];
  const username = p && typeof p.username === "string" && p.username ? p.username : null;
  return { fid, username, label: username ? `@${username}` : `fid ${fid}`, monogram: username ? username[0].toUpperCase() : String(fid)[0] || "#" };
}

export function duration(seconds) {
  if (!Number.isInteger(seconds) || seconds <= 0) return "";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Per strand: how many ideas sit on it and how many of those are read. */
export function strandProgress(m, readSet) {
  const out = new Map(m.strands.map((s) => [s.id, { strand: s, total: 0, read: 0, ideas: [] }]));
  for (const c of m.chapters) {
    for (const sid of ideaStrands(m, c)) {
      const p = out.get(sid);
      p.total++;
      p.ideas.push(c.id);
      if (readSet.has(c.id)) p.read++;
    }
  }
  return out;
}

/** Every term from every idea, A–Z. */
export function glossary(m) {
  const all = [];
  for (const c of m.chapters) for (const t of arr(c.terms)) if (t && typeof t.term === "string") all.push({ term: t.term, def: t.def, id: c.id, title: c.title });
  return all.sort((a, b) => a.term.localeCompare(b.term, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id));
}

/** Word count used for reading-time estimates. */
export function words(text) {
  return typeof text === "string" ? text.replace(/\{\{sub:0x[0-9a-f]{40}\}\}/g, "").split(/\s+/).filter(Boolean).length : 0;
}

export function readingMinutes(n) {
  return Math.max(1, Math.round(n / 230));
}
