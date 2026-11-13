// Compile v2 (docs/SPEC-APP.md, "Updates"): app meta + lesson files + the compiled
// Book (seed + anything fetched) → a contract App (contract/app.d.ts).
// Pure and deterministic: the clock is injected, sorts are total, nothing is random.
// The result passes validateApp (non-strict) or compileApp throws.
//
// One bad input never stops the whole app (docs/SWARM.md, "dropped and counted"):
// a lesson file that fails the contract, a work that fails it, or a display name
// that fails it is left out with a warning and counted in `report`. Only a broken
// app meta (or a rule this file forgot) makes the final validateApp throw. With
// `strictLessons` (the editor's PR check) a dropped lesson file throws instead.
// Every lookup keyed by a string from the network or a content file reads own
// properties only (Object.hasOwn or a Map), never Object.prototype (review S18).
//
// - Each lesson's `work` comes from its topic's results: the 1st-placed entry is
//   "lead", 2nd and honorable mentions are "more" (lead, then 2nd, then hm, each
//   in the results' order, then postedAt). Places themselves are never emitted.
// - A topic with no results has `work: []` (the app skips its slots).
// - A prize with no lesson file becomes a draft lesson, unless it is a 2024
//   archive prize. Draft text is ours and fixed; a draft that would carry a
//   banned word is skipped with a warning.
// - Captions are ours: content/seed/works.json, else a neutral generated line.
//   Never the creator's words.
// - Lesson `number` is an ordering key only. Drafts are marked status "draft";
//   the app does not count them toward trait totals.

import { BANNED, VIDEO_HOSTS, isDisplayName as contractDisplayName, isHttps, validateApp, validateLessonDoc, validateText, validateWork } from "../../contract/validate-app.mjs";
import { CompileError } from "./compile.mjs";
import { headlineTopic } from "./detect.mjs";
import { slugify, titleCase } from "./text.mjs";
import { normalizeISO } from "./time.mjs";

export const DRAFT_PROMISE = "A new idea, just arrived. The full lesson is on its way.";
export const DRAFT_IDEA = "Short explainers on this idea are collected below; the full lesson is being written.";
export const DRAFT_TITLE_FALLBACK = "New idea";
export const VIDEO_CAPTION = "A short explainer";
export const BUILD_CAPTION = "A guide to building it yourself";
/** Book strand (a prize's `strands` hint) → the trait a draft lesson builds. */
export const STRAND_TRAITS = Object.freeze({ tools: "sovereign", trust: "civil", choice: "mobile", founding: "enduring" });
export const DEFAULT_TRAIT = "mobile";
const ARCHIVE_SERIES = /^Earlier prizes\b/i;
const TITLE_MAX = 32;

const ROLE_RANK = { "1st": 0, "2nd": 1, hm: 2 };
const LESSON_KEYS = ["id", "number", "status", "title", "promise", "trait", "minutes", "cards", "sources", "topic", "work"];
const WORK_KEYS = ["id", "fid", "role", "kind", "caption", "video", "build", "original", "postedAt"];
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** obj[key] if it is obj's own property; never a value inherited from Object.prototype ("constructor", "toString", …). */
export const own = (obj, key) => (obj !== null && typeof obj === "object" && Object.hasOwn(obj, key) ? obj[key] : undefined);

const put = (out, k, v) => Object.defineProperty(out, k, { value: v, enumerable: true, writable: true, configurable: true });

function ordered(obj, keys) {
  const out = {};
  for (const k of keys) if (own(obj, k) !== undefined) put(out, k, obj[k]);
  for (const k of Object.keys(obj).sort()) if (!Object.hasOwn(out, k) && obj[k] !== undefined) put(out, k, obj[k]);
  return out;
}

function urlParts(s) {
  try {
    const u = new URL(s);
    return { host: u.hostname.toLowerCase().replace(/^www\.|^m\.|^mobile\./, ""), path: u.pathname.toLowerCase() };
  } catch {
    return null;
  }
}

const isHls = (s) => {
  const u = urlParts(s);
  return !!u && (/\.m3u8$/.test(u.path) || u.host === "stream.farcaster.xyz" || u.host === "stream.warpcast.com");
};
const isMp4 = (s) => {
  const u = urlParts(s);
  return !!u && /\.mp4$/.test(u.path);
};
const isExternal = (s) => {
  const u = urlParts(s);
  if (!u) return false;
  if (u.host === "youtube.com") return /^\/shorts\/[\w-]+/.test(u.path) || u.path === "/watch";
  if (u.host === "youtu.be") return /^\/[\w-]+/.test(u.path);
  if (u.host === "bsky.app") return /^\/profile\/[^/]+\/post\/[^/]+/.test(u.path);
  if (u.host === "video.bsky.app" || u.host === "media.firefly.land") return true;
  if (u.host === "x.com" || u.host === "twitter.com") return /^\/[^/]+\/status\/\d+/.test(u.path);
  return false;
};

const inlineHost = (s) => VIDEO_HOSTS.includes(urlParts(s)?.host);

/**
 * The playable video of a submission: { hls } from the first HLS embed, else { mp4 }, else { external }; null if none.
 * Only streams on contract VIDEO_HOSTS play inline; an HLS/mp4 link anywhere else becomes an external link (review S4).
 */
export function videoOf(sub) {
  const embeds = (Array.isArray(sub?.embeds) ? sub.embeds : []).filter(isHttps);
  const hls = embeds.find((e) => isHls(e) && inlineHost(e));
  if (hls) return { hls };
  const mp4 = embeds.find((e) => isMp4(e) && inlineHost(e));
  if (mp4) return { mp4 };
  const external = embeds.find(isExternal) || embeds.find((e) => isHls(e) || isMp4(e));
  return external ? { external } : null;
}

/** The guide and repo of a build submission: { site?, repo? }; null if neither is https. */
export function buildOf(sub) {
  const b = {};
  if (isHttps(sub?.site)) b.site = sub.site;
  if (isHttps(sub?.repo)) b.repo = sub.repo;
  return b.site || b.repo ? b : null;
}

/** Our neutral caption for a work: fixed words, never the creator's. */
export function generatedCaption(sub, kind) {
  if (kind === "build") return BUILD_CAPTION;
  return Number.isInteger(sub?.seconds) && sub.seconds > 0 ? `${VIDEO_CAPTION}, ${sub.seconds} seconds` : VIDEO_CAPTION;
}

/** A lesson title from a prize headline: its topic without amounts or prize wording, Title Case, ≤ 32 chars; "New idea" if nothing clean is left. */
export function draftLessonTitle(headline) {
  const topic = headlineTopic(String(headline || ""))
    .replace(/\$\s?[\d,]+(?:\.\d+)?(?:\s*(?:k|usdc|usd))?/gi, " ")
    .replace(/\b(?:in\s+)?prizes?\b/gi, " ")
    .replace(/^\s*for\b/i, " ")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const title = topic ? titleCase(topic, TITLE_MAX) : "";
  if (!title || title.length > TITLE_MAX || validateText(title, "title").length) return DRAFT_TITLE_FALLBACK;
  return title;
}

/** The trait a draft builds: the first strand hint with a trait, else "mobile" (or the first trait). */
export function draftTrait(prize, traitIds) {
  for (const s of Array.isArray(prize?.strands) ? prize.strands : []) {
    const t = own(STRAND_TRAITS, s);
    if (t && traitIds.has(t)) return t;
  }
  return traitIds.has(DEFAULT_TRAIT) ? DEFAULT_TRAIT : [...traitIds][0];
}

/**
 * A display name the app may show: the contract's own rule (non-empty, ≤ 80
 * chars, no control or invisible format characters: contract isDisplayName,
 * FORMAT_CHARS) and, as it is reader-facing, no banned word. Otherwise it is left
 * out (with a warning) and the creator shows as "@username" or "a creator"; a
 * display name never stops a compile (review S1).
 */
export function isDisplayName(d) {
  return contractDisplayName(d) && !BANNED.test(d);
}

const isArchive = (prize) => typeof prize?.series === "string" && ARCHIVE_SERIES.test(prize.series);

/**
 * The work on a topic, from its prize's results: lead (1st), then more (2nd, then
 * honorable mentions), each in the results' order, then postedAt.
 */
export function workFor(prize, { subsByHash, captions = {}, warn = () => {}, report }) {
  const places = Array.isArray(prize?.results?.places) ? prize.results.places : [];
  const ranked = places
    .map((pl, i) => ({ pl, i, sub: subsByHash.get(pl?.submission) }))
    .filter(({ pl, sub }) => {
      if (own(ROLE_RANK, pl?.place) === undefined) return false;
      if (!sub) warn(`${prize.id}: placed entry ${pl?.submission} is not in the book; left out of the app`);
      return !!sub;
    })
    .sort((a, b) => ROLE_RANK[a.pl.place] - ROLE_RANK[b.pl.place] || a.i - b.i || cmp(a.sub.postedAt, b.sub.postedAt) || cmp(a.sub.hash, b.sub.hash));
  const out = [];
  const seen = new Set();
  for (const { pl, sub } of ranked) {
    if (seen.has(sub.hash)) continue;
    seen.add(sub.hash);
    const kind = sub.kind === "site" ? "build" : "video";
    const media = kind === "build" ? buildOf(sub) : videoOf(sub);
    if (!media) {
      warn(`${prize.id}: entry ${sub.hash} has no playable ${kind === "build" ? "site or repo" : "video"}; left out of the app`);
      continue;
    }
    let caption = own(captions, sub.hash);
    if (typeof caption === "string" && validateText(caption, "caption", { maxLen: 120 }).length) {
      warn(`${prize.id}: caption for ${sub.hash} fails the text rules; using a generated one`);
      caption = undefined;
    }
    const w = {
      id: sub.hash,
      fid: sub.fid,
      role: pl.place === "1st" ? "lead" : "more",
      kind,
      caption: typeof caption === "string" ? caption : generatedCaption(sub, kind),
      [kind === "build" ? "build" : "video"]: media,
      original: sub.url,
      postedAt: sub.postedAt,
    };
    const errs = validateWork(w, `${prize.id}: work ${sub.hash}`);
    if (errs.length) {
      warn(`${prize.id}: entry ${sub.hash} fails the contract; left out of the app (${errs.slice(0, 3).join("; ")})`);
      if (report) report.droppedWork += 1;
      continue;
    }
    out.push(ordered(w, WORK_KEYS));
  }
  return out;
}

/** A draft lesson for a prize that has no lesson file. Fixed text only. */
export function draftLesson(prize, { id, number, traitIds }) {
  return {
    id,
    number,
    status: "draft",
    title: draftLessonTitle(prize.headline),
    promise: DRAFT_PROMISE,
    trait: draftTrait(prize, traitIds),
    minutes: 1,
    cards: [{ type: "cover" }, { type: "idea", text: DRAFT_IDEA }, { type: "work", role: "lead" }, { type: "work", role: "more" }, { type: "trait" }],
    sources: [],
    topic: prize.id,
  };
}

/** A stable order for lesson docs whatever order the files came in: number, id, topic, then the whole doc. */
function lessonOrder(a, b) {
  const n = (d) => (Number.isInteger(d?.number) ? d.number : Number.MAX_SAFE_INTEGER);
  return n(a) - n(b) || cmp(String(a?.id), String(b?.id)) || cmp(String(a?.topic), String(b?.topic)) || cmp(JSON.stringify(a), JSON.stringify(b));
}

/** Why a lesson file cannot ship ([] if it can): the contract's LessonDoc rules, a known trait, and no id, number or topic another kept lesson already has. */
export function lessonProblems(doc, { traitIds, kept }) {
  const where = `lesson ${typeof doc?.id === "string" ? doc.id.slice(0, 60) : "(no id)"}`;
  const errs = validateLessonDoc(doc, where);
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return errs;
  if (!traitIds.has(doc.trait)) errs.push(`${where}.trait: unknown trait ${String(doc.trait).slice(0, 40)}`);
  for (const k of kept) {
    if (k.id === doc.id) errs.push(`${where}.id: already used by another lesson file`);
    if (k.number === doc.number) errs.push(`${where}.number: ${doc.number} already used by lesson ${k.id}`);
    if (k.topic === doc.topic) errs.push(`${where}.topic: ${String(doc.topic).slice(0, 60)} already taught by lesson ${k.id}`);
  }
  return errs;
}

/**
 * @param {object} input
 * @param {object} input.meta        content/app.meta.json (name, citizen, traits)
 * @param {object[]} input.lessons   content/lessons/*.json (LessonDoc)
 * @param {{topics?:Record<string,string>, captions?:Record<string,string>}} [input.works] content/seed/works.json
 * @param {object} input.book        the compiled Book (prizes with results, submissions, people)
 * @param {string} input.now         ISO-8601 UTC; the injected clock
 * @param {(msg:string)=>void} [input.onWarning]
 * @param {boolean} [input.strictLessons] throw (CompileError) instead of dropping a lesson file that fails
 * @param {{droppedLessons:string[], droppedWork:number, droppedNames:number}} [input.report] filled in with what was left out
 */
export function compileApp({ meta, lessons = [], works = {}, book, now, onWarning = () => {}, strictLessons = false, report = { droppedLessons: [], droppedWork: 0, droppedNames: 0 } }) {
  if (!meta || typeof meta !== "object") throw new TypeError("compileApp: app meta is required");
  if (!book || typeof book !== "object") throw new TypeError("compileApp: a compiled book is required");
  for (const [k, v] of [["droppedLessons", []], ["droppedWork", 0], ["droppedNames", 0]]) if (!Object.hasOwn(report, k)) report[k] = v;
  const warn = (m) => onWarning(m);
  const nowISO = normalizeISO(now);
  const traits = structuredClone(meta.traits || []);
  const traitIds = new Set(traits.map((t) => t?.id));
  const plainObject = (v) => (v !== null && typeof v === "object" && !Array.isArray(v) ? v : {});
  const topics = plainObject(own(works, "topics"));
  const captions = plainObject(own(works, "captions"));
  const prizes = Array.isArray(book.prizes) ? book.prizes : [];
  const prizesById = new Map(prizes.map((p) => [p?.id, p]));
  const subsByHash = new Map((Array.isArray(book.submissions) ? book.submissions : []).map((s) => [s?.hash, s]));
  const work = (topic) => {
    const p = prizesById.get(topic);
    return p ? workFor(p, { subsByHash, captions, warn, report }) : [];
  };

  // Lesson files: as written, plus work from their topic (any `work` in a file is replaced: it is never written by hand).
  // A file that fails the contract is dropped and counted, never the whole app (review S17).
  const docs = [];
  const problems = [];
  for (const d of (Array.isArray(lessons) ? lessons : []).map((l) => structuredClone(l)).sort(lessonOrder)) {
    const errs = lessonProblems(d, { traitIds, kept: docs });
    if (errs.length) {
      const id = typeof d?.id === "string" ? d.id.slice(0, 60) : "(no id)";
      problems.push(...errs);
      report.droppedLessons.push(id);
      warn(`lesson file ${id} fails the contract; left out of the app (${errs.slice(0, 4).join("; ")})`);
      continue;
    }
    docs.push(d);
  }
  if (strictLessons && problems.length) throw new CompileError(problems, "app (lesson files)");
  const out = docs.map((d) => ({ ...d, work: work(d.topic) }));

  // Drafts: every prize (not the 2024 archive) whose topic has no lesson file.
  const covered = new Set(docs.map((d) => d.topic));
  const usedIds = new Set(docs.map((d) => d.id));
  const usedNumbers = new Set(docs.map((d) => d.number));
  let next = docs.reduce((m, d) => Math.max(m, d.number), 0) + 1;
  const waiting = prizes
    .filter((p) => p?.kind === "prize" && typeof p.id === "string" && !covered.has(p.id) && !isArchive(p))
    .sort((a, b) => cmp(a.postedAt, b.postedAt) || cmp(a.id, b.id));
  for (const p of waiting) {
    const mapped = own(topics, p.id);
    let id = (typeof mapped === "string" && mapped) || slugify(headlineTopic(p.headline || ""), 40) || p.id;
    if (BANNED.test(id.replace(/-/g, " ")) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) id = `new-idea-${String(p.castHash || "").slice(2, 8) || "x"}`;
    if (usedIds.has(id)) id = `${id}-${String(p.castHash || "").slice(2, 8) || "x"}`;
    while (usedNumbers.has(next)) next += 1;
    const draft = draftLesson(p, { id, number: next, traitIds });
    const errs = validateLessonDoc(draft, `draft ${id}`);
    if (errs.length || usedIds.has(id)) {
      warn(`draft for ${p.id} skipped: ${errs.join("; ") || `id ${id} already used`}`);
      continue;
    }
    usedIds.add(id);
    usedNumbers.add(next);
    out.push({ ...draft, work: work(p.id) });
    next += 1;
  }

  const lessonList = out.sort((a, b) => cmp(a.number, b.number) || cmp(a.id, b.id)).map((l) => ordered(l, LESSON_KEYS));

  // Creators: everyone with work in the app, named when the book knows them and the name passes the contract.
  const people = plainObject(book.people);
  const fids = [...new Set(lessonList.flatMap((l) => l.work.map((w) => w.fid)))].sort((a, b) => a - b);
  const creators = {};
  for (const fid of fids) {
    const p = own(people, String(fid));
    const c = { fid };
    if (typeof p?.username === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(p.username)) c.username = p.username;
    if (isDisplayName(p?.displayName)) c.displayName = p.displayName;
    else if (p?.displayName !== undefined) {
      report.droppedNames += 1;
      warn(`creator ${fid}: display name fails the contract; left out (shown by username)`);
    }
    creators[String(fid)] = c;
  }

  const app = {
    version: 2,
    generatedAt: nowISO,
    name: meta.name,
    citizen: meta.citizen ? { name: meta.citizen.name, line: meta.citizen.line } : undefined,
    traits,
    lessons: lessonList,
    creators,
  };
  if (meta.stamps) app.stamps = { chainId: meta.stamps.chainId, address: meta.stamps.address ?? null }; // v3
  const errors = validateApp(app);
  if (errors.length) throw new CompileError(errors, "app");
  return app;
}

/** App equality ignoring generatedAt. */
export function sameApp(a, b) {
  if (!a || !b) return false;
  return JSON.stringify({ ...a, generatedAt: null }) === JSON.stringify({ ...b, generatedAt: null });
}

/** One line: lessons (drafts) and works per lesson. */
export function appSummary(app) {
  const drafts = app.lessons.filter((l) => l.status === "draft").length;
  const per = app.lessons.map((l) => `${l.id} ${l.work.length}`).join(", ");
  return `${app.lessons.length} lessons (${drafts} draft${drafts === 1 ? "" : "s"}), works: ${per}`;
}
