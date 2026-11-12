// Compile: meta + seed + chapter files + fetched items → a contract Book.
// Pure and deterministic: the clock is injected, sorts are stable and total,
// nothing is random. The result passes validateBook (non-strict) or compile throws.

import { validateBook, validatePerson, validatePrize, validateSubmission } from "../../contract/validate.mjs";
import { DAY_MS, msFromISO, normalizeISO, isoFromMs } from "./time.mjs";
import { plain, sentences, truncate } from "./text.mjs";
import { draftTitle } from "./detect.mjs";

export const JUDGING_DAYS = 14;
export const NEW_KICKER = "New pick · just dropped";
export const NEW_THREAD = "This pick just dropped. An editor will write it up; the voices below are live.";
export const ARCHIVE_THREAD = "From the archive. An editor will write it up; the voices below are live.";
const CODA_NUMBER = 999;
/** Appended to provenance.note when no node was read for this build. */
export const OFFLINE_NOTE = "Offline compile: no node was read for this build.";

export class CompileError extends Error {
  constructor(errors) {
    super(`compiled book is invalid (${errors.length} problem${errors.length === 1 ? "" : "s"}):\n  ${errors.slice(0, 40).join("\n  ")}`);
    this.name = "CompileError";
    this.errors = errors;
  }
}

const PRIZE_KEYS = ["id", "kind", "chapter", "castHash", "parentHash", "authorFid", "postedAt", "headline", "gloss", "pool", "deliverable", "deadline", "status", "series", "strands", "references", "context", "results"];
const SUB_KEYS = ["hash", "fid", "postedAt", "chapter", "kind", "gloss", "embeds", "name", "site", "repo", "voucher", "seconds", "ai", "place", "url"];
const CHAPTER_KEYS = ["id", "number", "kind", "status", "title", "kicker", "line", "minute", "essay", "source", "objections", "terms", "thread", "strands", "connections", "prize", "featured", "practice"];
const PERSON_KEYS = ["fid", "username", "displayName"];

/** Copy with known keys first, in contract order, then any others sorted. Drops undefined. */
function ordered(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  for (const k of Object.keys(obj).sort()) if (!(k in out) && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byPostedThen = (key) => (a, b) => cmp(a.postedAt, b.postedAt) || cmp(a[key], b[key]);

/** open · judging (≤ 14 days after the deadline, no results) · closed (later, no results) · awarded (results exist). */
export function prizeStatus(prize, nowMs) {
  if (prize.results && typeof prize.results === "object") return "awarded";
  if (!prize.deadline) return undefined;
  const d = msFromISO(prize.deadline);
  if (nowMs < d) return "open";
  if (nowMs <= d + JUDGING_DAYS * DAY_MS) return "judging";
  return "closed";
}

function oneYearBefore(nowMs) {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
}

/** A draft idea for a prize that has no chapter file yet. */
export function draftChapter(prize, number, { nowMs, strandIds }) {
  const archive = msFromISO(prize.postedAt) < oneYearBefore(nowMs);
  const headline = plain(prize.headline) || "A new pick";
  const minute = (prize.deliverable && plain(prize.deliverable, { paragraphs: true })) || headline;
  const line = truncate(sentences(plain(minute))[0] || headline, 200);
  const strands = [...new Set((prize.strands || []).filter((id) => strandIds.has(id)))].slice(0, 2);
  return {
    id: prize.chapter,
    number,
    kind: "chapter",
    status: "draft",
    title: draftTitle(prize.headline),
    kicker: archive ? `From the archive · ${prize.postedAt.slice(0, 4)}` : NEW_KICKER,
    line,
    minute,
    essay: [{ type: "p", text: minute }],
    objections: [],
    terms: [],
    thread: archive ? ARCHIVE_THREAD : NEW_THREAD,
    strands,
    connections: [],
    prize: prize.id,
    practice: {
      prompt: truncate(minute.replace(/\s+/g, " "), 900),
      action: { label: "Reply on Farcaster", url: `https://farcaster.xyz/~/conversations/${prize.castHash}` },
    },
  };
}

function cleanPerson(p) {
  if (!p || !Number.isInteger(p.fid) || p.fid <= 0) return null;
  const out = { fid: p.fid };
  if (typeof p.username === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(p.username)) out.username = p.username;
  if (typeof p.displayName === "string") {
    const d = plain(p.displayName).slice(0, 80).trim();
    if (d) out.displayName = d;
  }
  return out;
}

/**
 * @param {object} input
 * @param {object} input.meta              content/book.meta.json
 * @param {object[]} [input.seedPrizes]    content/seed/prizes.json (authoritative)
 * @param {object[]} [input.seedSubmissions] content/seed/submissions.json (authoritative)
 * @param {object} [input.seedPeople]      content/seed/people.json (authoritative)
 * @param {object[]} [input.chapters]      content/chapters/*.json
 * @param {{prizes?:object[], submissions?:object[], people?:object[]|object, nodes?:string[], refreshedAt?:string, offline?:boolean}} [input.fetched]
 *   `nodes` are the nodes actually read for this build. Without them (or with
 *   `offline: true`) this is an offline compile: provenance records only the
 *   nodes given (none by default) and says so in its note.
 * @param {string} input.now               ISO-8601 UTC; the injected clock
 * @param {(msg:string)=>void} [input.onWarning]
 */
export function compile({ meta, seedPrizes = [], seedSubmissions = [], seedPeople = {}, chapters = [], fetched = {}, now, onWarning = () => {} }) {
  if (!meta || typeof meta !== "object") throw new TypeError("compile: meta is required");
  const nowISO = normalizeISO(now);
  const nowMs = msFromISO(nowISO);
  const warn = (m) => onWarning(m);
  const strands = structuredClone(meta.strands || []);
  const strandIds = new Set(strands.map((s) => s.id));

  // Prizes: seed is authoritative for the fields it has; fetched adds new prizes and missing fields (results).
  const seedByHash = new Map(seedPrizes.map((p) => [p.castHash, p]));
  const seedIds = new Set(seedPrizes.map((p) => p.id));
  const prizes = new Map(); // id → prize
  for (const s of seedPrizes) prizes.set(s.id, structuredClone(s));
  const fetchedPrizes = [...(fetched.prizes || [])].sort(byPostedThen("castHash"));
  for (const f of fetchedPrizes) {
    const seed = seedByHash.get(f?.castHash);
    if (seed) {
      // The seed's hand-written fields stand; a fetch can only add results it lacks.
      if (!seed.results && f.results && !prizes.get(seed.id).results) prizes.get(seed.id).results = structuredClone(f.results);
      continue;
    }
    const errs = validatePrize(f, `fetched prize ${f?.id}`);
    if (errs.length) {
      warn(`dropped fetched prize: ${errs.join("; ")}`);
      continue;
    }
    const have = prizes.get(f.id);
    if (have) {
      if (have.castHash !== f.castHash || seedIds.has(f.id)) warn(`dropped fetched prize ${f.id}: id already used by cast ${have.castHash}`);
      continue;
    }
    prizes.set(f.id, structuredClone(f));
  }
  for (const p of prizes.values()) {
    delete p.status;
    if (p.kind === "prize") {
      const st = prizeStatus(p, nowMs);
      if (st) p.status = st;
    }
  }
  const prizeList = [...prizes.values()].sort(byPostedThen("id")).map((p) => ordered(p, PRIZE_KEYS));

  // Submissions: seed authoritative; fetched adds new hashes.
  const subs = new Map();
  const seedSubHashes = new Set(seedSubmissions.map((s) => s.hash));
  for (const s of seedSubmissions) subs.set(s.hash, structuredClone(s));
  for (const f of [...(fetched.submissions || [])].sort(byPostedThen("hash"))) {
    if (subs.has(f?.hash)) continue;
    const errs = validateSubmission(f, `fetched submission ${f?.hash}`);
    if (errs.length) {
      warn(`dropped fetched submission: ${errs.join("; ")}`);
      continue;
    }
    subs.set(f.hash, structuredClone(f));
  }
  // Winners: mark places from results onto submissions that do not carry one.
  for (const p of prizeList) {
    for (const pl of p.results?.places || []) {
      const s = subs.get(pl.submission);
      if (s && !s.place) s.place = pl.place;
    }
  }
  const subList = [...subs.values()].sort(byPostedThen("hash")).map((s) => ordered(s, SUB_KEYS));
  const subHashes = new Set(subList.map((s) => s.hash));

  // People, keyed by fid. Seed authoritative; fetched fills gaps.
  const people = new Map();
  for (const p of Object.values(seedPeople || {})) people.set(p.fid, structuredClone(p));
  const fetchedPeople = Array.isArray(fetched.people) ? fetched.people : Object.values(fetched.people || {});
  for (const raw of [...fetchedPeople].sort((a, b) => (a?.fid || 0) - (b?.fid || 0))) {
    const p = cleanPerson(raw);
    if (!p || validatePerson(p).length) continue;
    const have = people.get(p.fid);
    if (!have) people.set(p.fid, p);
    else {
      if (!have.username && p.username) have.username = p.username;
      if (!have.displayName && p.displayName) have.displayName = p.displayName;
    }
  }
  const peopleObj = {};
  for (const fid of [...people.keys()].sort((a, b) => a - b)) peopleObj[String(fid)] = ordered(people.get(fid), PERSON_KEYS);

  // Ideas: chapter files, then a draft for every prize without one.
  const docs = chapters.map((c) => {
    const d = structuredClone(c);
    if (!Array.isArray(d.strands)) d.strands = [];
    if (!Array.isArray(d.connections)) d.connections = [];
    return d;
  });
  const covered = new Set(docs.flatMap((d) => [d.id, d.prize ? `prize:${d.prize}` : null]).filter(Boolean));
  const maxNonCoda = docs.filter((d) => d.kind !== "coda").reduce((m, d) => (Number.isInteger(d.number) ? Math.max(m, d.number) : m), 0);
  const used = new Set(docs.map((d) => d.number));
  let next = Math.max(maxNonCoda + 1, 1);
  for (const p of prizeList.filter((x) => x.kind === "prize")) {
    if (covered.has(p.chapter) || covered.has(`prize:${p.id}`)) continue;
    while (used.has(next)) next += 1;
    if (next >= CODA_NUMBER) throw new CompileError([`no catalogue number left below ${CODA_NUMBER} for draft ${p.chapter}`]);
    docs.push(draftChapter(p, next, { nowMs, strandIds }));
    used.add(next);
    covered.add(p.chapter);
    next += 1;
  }
  docs.sort((a, b) => cmp(a.number, b.number) || cmp(a.id, b.id));
  const chapterIds = new Set(docs.map((d) => d.id));
  // A fetched entry whose idea is not in this book (its prize was dropped) goes too.
  for (const s of subList.filter((x) => !seedSubHashes.has(x.hash) && !chapterIds.has(x.chapter))) {
    warn(`dropped fetched submission ${s.hash}: its idea ${s.chapter} is not in this book`);
    subHashes.delete(s.hash);
    subList.splice(subList.indexOf(s), 1);
  }
  for (const d of docs) {
    const keep = d.connections.filter((x) => chapterIds.has(x?.to));
    if (keep.length !== d.connections.length) {
      warn(`${d.id}: dropped connection(s) to ideas not in this book: ${d.connections.filter((x) => !chapterIds.has(x?.to)).map((x) => x?.to).join(", ")}`);
      d.connections = keep;
    }
    if (Array.isArray(d.featured)) {
      const f = d.featured.filter((h) => subHashes.has(h));
      if (f.length !== d.featured.length) warn(`${d.id}: dropped featured submission(s) not in this book`);
      d.featured = f;
    }
  }
  const chapterList = docs.map((d) => ordered(d, CHAPTER_KEYS));

  // Paths: drop entries not in this book; the editor's path falls back to every idea by number.
  const byNumber = chapterList.map((c) => c.id);
  const paths = [];
  for (const p of meta.paths || []) {
    const ids = [...new Set((p.chapters || []).filter((id) => chapterIds.has(id)))];
    if (ids.length) paths.push({ ...structuredClone(p), chapters: ids });
    else if (p.id === "editors-path") paths.push({ ...structuredClone(p), chapters: byNumber });
    else warn(`path ${p.id}: no ideas left in this book; dropped`);
  }
  if (!paths.some((p) => p.id === "editors-path")) {
    paths.unshift({ id: "editors-path", name: "The editor's path", line: "Every idea in catalogue order, until an editor curates a route.", chapters: byNumber });
  }

  const prov = meta.provenance || {};
  // Provenance names the public nodes actually read from, never the configured
  // ones: an offline compile read none. The contract allows https only; a local
  // http node (tests, development) is not recorded.
  const offline = fetched.offline === true || !Array.isArray(fetched.nodes);
  const nodes = [...(Array.isArray(fetched.nodes) ? fetched.nodes : [])].filter((n) => {
    const ok = typeof n === "string" && /^https:\/\/[^\s<>"']+$/.test(n);
    if (!ok) warn(`provenance: not recording non-https node ${String(n).slice(0, 80)}`);
    return ok;
  });
  const book = {
    version: 1,
    generatedAt: nowISO,
    title: meta.title,
    subtitle: meta.subtitle,
    thesis: meta.thesis ? { line: meta.thesis.line, paragraph: meta.thesis.paragraph, asOf: meta.thesis.asOf } : undefined,
    archetype: meta.archetype ? { name: meta.archetype.name, line: meta.archetype.line } : undefined,
    strands,
    paths,
    chapters: chapterList,
    prizes: prizeList,
    submissions: subList,
    people: peopleObj,
    provenance: {
      nodes,
      watchedFids: [...(prov.watchedFids || [])],
      refreshedAt: fetched.refreshedAt ? normalizeISO(fetched.refreshedAt) : nowISO,
      note: offline ? [prov.note, OFFLINE_NOTE].filter(Boolean).join(" ") : prov.note,
    },
  };
  const errors = validateBook(book);
  if (errors.length) throw new CompileError(errors);
  return book;
}

/** Stable serialization used for book.json. */
export function serialize(book) {
  return `${JSON.stringify(book, null, 1)}\n`;
}

export { isoFromMs };
