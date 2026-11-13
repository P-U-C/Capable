// Refresh: read inputs, optionally read the network, compile, validate, write.
// Fail closed: any node failure, or an invalid result, writes nothing.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { validatePrize, validateSubmission } from "../../contract/validate.mjs";
import { createClient, NodeHttpError } from "./node.mjs";
import { castBody, derivePrize, isPrize, isPrizeHeadline, isResults, messageHash } from "./detect.mjs";
import { classifyReply } from "./classify.mjs";
import { parseResults } from "./results.mjs";
import { compile, CompileError, serialize, JUDGING_DAYS, validLookups } from "./compile.mjs";
import { appSummary, compileApp, sameApp } from "./compile-app.mjs";
import { castFacts, checkMessage } from "./verify.mjs";
import { DAY_MS, isoFromMs, msFromISO, toISO } from "./time.mjs";
import { firstLine, plain, truncate } from "./text.mjs";

export const CASTS_PAGES = 3;
export const REPLY_PAGES = 10;
export const PAGE_SIZE = 100;
export const MAX_USER_LOOKUPS = 100;
/** An unnamed fid is looked up again at most this often (review S19). */
export const LOOKUP_RETRY_MS = DAY_MS;
const HEARTBEAT_MS = DAY_MS;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const ANNOUNCEMENT_GLOSS = "The announcement this prize replies to.";

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/** meta, seed and chapter files from a repo root. Chapter files are read in file-name order. */
export function loadInputs(root, chaptersDir = join(root, "content/chapters")) {
  const meta = readJson(join(root, "content/book.meta.json"));
  const seedPrizes = readJson(join(root, "content/seed/prizes.json"));
  const seedSubmissions = readJson(join(root, "content/seed/submissions.json"));
  const seedPeople = readJson(join(root, "content/seed/people.json"));
  const chapters = existsSync(chaptersDir)
    ? readdirSync(chaptersDir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => {
          try {
            return readJson(join(chaptersDir, f));
          } catch (err) {
            throw new Error(`chapter file ${f} is not valid JSON: ${err.message}`);
          }
        })
    : [];
  return { meta, seedPrizes, seedSubmissions, seedPeople, chapters };
}

/**
 * App inputs from a repo root: content/app.meta.json, content/seed/works.json and
 * the lesson files (content/lessons/*.json, in file-name order).
 *
 * A lesson file that is not JSON, or whose id is not its file name, is left out
 * and listed in `invalidFiles` (with a warning), like any lesson that fails the
 * contract in compileApp: one bad file never stops the app (review S17). A
 * works.json that is not JSON is read as empty (generated captions), with a
 * warning. The app meta must parse: without it there is no app.
 */
export function loadAppInputs(root, lessonsDir = join(root, "content/lessons"), { warn = () => {} } = {}) {
  const meta = readJson(join(root, "content/app.meta.json"));
  const worksPath = join(root, "content/seed/works.json");
  const invalidFiles = [];
  let works = {};
  if (existsSync(worksPath)) {
    try {
      works = readJson(worksPath);
    } catch (err) {
      invalidFiles.push(`content/seed/works.json is not valid JSON: ${err.message}`);
      warn(`content/seed/works.json is not valid JSON (${err.message}); generated captions and ids are used`);
    }
  }
  const lessons = [];
  const files = existsSync(lessonsDir) ? readdirSync(lessonsDir).filter((f) => f.endsWith(".json")).sort() : [];
  for (const f of files) {
    let doc;
    try {
      doc = readJson(join(lessonsDir, f));
    } catch (err) {
      invalidFiles.push(`lesson file ${f} is not valid JSON: ${err.message}`);
      warn(`lesson file ${f} is not valid JSON (${err.message}); left out of the app`);
      continue;
    }
    if (doc?.id !== f.slice(0, -".json".length)) {
      invalidFiles.push(`lesson file ${f}: id must equal the file name`);
      warn(`lesson file ${f}: id ${JSON.stringify(doc?.id)?.slice(0, 60)} is not its file name; left out of the app`);
      continue;
    }
    lessons.push(doc);
  }
  return { meta, works, lessons, invalidFiles };
}

/** Where app.json goes by default: next to the book ("app.json" beside "book.json", else "<name>.app.json"). */
export function defaultAppOut(out) {
  const name = basename(out);
  return join(dirname(out), name === "book.json" ? "app.json" : `${name.replace(/\.json$/i, "")}.app.json`);
}

/** The previous app at `path`, or null. The app carries nothing forward, so an unreadable one is simply rebuilt. */
function readPreviousApp(path) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  } catch {
    return null;
  }
}

/** The previous book at `path`, or null if there is none. Unparseable JSON throws: we do not overwrite what we cannot read. */
export function readPrevious(path) {
  if (!existsSync(path)) return null;
  try {
    const b = JSON.parse(readFileSync(path, "utf8"));
    return b && typeof b === "object" ? b : null;
  } catch (err) {
    throw new Error(`previous build ${path} is not valid JSON (${err.message}); refusing to overwrite it. Delete it to rebuild from seed.`);
  }
}

/** Username and display name from userDataByFid messages (latest of each wins). */
export function personFromUserData(fid, messages) {
  const latest = {};
  for (const m of messages || []) {
    const d = m?.data;
    if (!d || d.type !== "MESSAGE_TYPE_USER_DATA_ADD" || d.fid !== fid || !d.userDataBody) continue;
    const { type, value } = d.userDataBody;
    if (typeof value !== "string") continue;
    const key = type === "USER_DATA_TYPE_USERNAME" ? "username" : type === "USER_DATA_TYPE_DISPLAY" ? "displayName" : null;
    if (!key) continue;
    if (!latest[key] || (d.timestamp ?? 0) >= latest[key].ts) latest[key] = { ts: d.timestamp ?? 0, value };
  }
  const p = { fid };
  if (latest.username && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(latest.username.value)) p.username = latest.username.value;
  if (latest.displayName) p.displayName = latest.displayName.value;
  return p.username || p.displayName ? p : null;
}

function resultsText(body) {
  const text = typeof body.text === "string" ? body.text : "";
  const extra = (body.embeds || []).map((e) => (typeof e?.url === "string" ? e.url : null)).filter((u) => u && !text.includes(u));
  return [text, ...extra].join("\n");
}

/**
 * Read the network and return the `fetched` layer for compile. Throws
 * NodeUnavailable (or NodeHttpError on a 4xx for cast reads) on failure; never
 * returns partial data.
 *
 * Trust (review S3; what each message is checked for: src/verify.mjs). With
 * more than one node configured, nothing that changes the app rests on one
 * node's word:
 *   - a new prize cast (and the announcement it replies to) and a results cast
 *     are used only when a second node returns the same cast (castFacts);
 *   - a fresh reading of an entry that a results post places is used only when
 *     a second node agrees, else the carried reading stays (or the entry waits);
 *   - a carried entry missing from a complete thread read is dropped only when a
 *     second node also has no such cast, or has it and it no longer qualifies.
 * Anything not confirmed (the second node lags, disagrees or is down) is left
 * as it was and tried again next run. With a single node, prize and results
 * casts are believed as read, and no carried entry is ever dropped.
 */
export async function fetchUpdates({ client, meta, seedPrizes, seedSubmissions, seedPeople, chapters, previous, now, warn = () => {} }) {
  const watchedFids = meta.provenance.watchedFids;
  const nowMs = msFromISO(now);
  const stats = { casts: 0, newPrizes: 0, results: 0, repliesRead: 0, prizesRead: 0, people: 0, lookups: 0, rejected: 0, unconfirmed: 0, dropped: 0, kept: 0 };
  const multi = client.nodes.length > 1;

  /** Is this message well formed (and, with dataBytes, consistent)? A message that is not is ignored. */
  const believable = (m, node, expect) => {
    const c = checkMessage(m, expect);
    if (!c.ok) {
      stats.rejected += 1;
      warn(`${node}: ignored message ${String(m?.hash).slice(0, 42)}: ${c.reason}`);
    }
    return c.ok;
  };

  // Cross-node agreement, cached per cast for the run.
  const verdicts = new Map(); // hash → "agree" | "disagree" | "missing" | "unavailable"
  async function secondOpinion(m, node) {
    const h = messageHash(m);
    if (verdicts.has(h)) return verdicts.get(h);
    let verdict = "unavailable";
    for (const w of client.witnesses(node)) {
      const r = await client.probeCast(w, m.data.fid, h);
      if (r.status === "unavailable") continue;
      if (r.status === "missing") verdict = "missing";
      else verdict = checkMessage(r.message, { fid: m.data.fid }).ok && castFacts(r.message) === castFacts(m) ? "agree" : "disagree";
      break;
    }
    verdicts.set(h, verdict);
    return verdict;
  }
  /** Use this cast? Always with one node; with more, only when a second node agrees. */
  async function confirmed(m, node, what) {
    if (!multi) return true;
    const v = await secondOpinion(m, node);
    if (v === "agree") return true;
    stats.unconfirmed += 1;
    warn(`${what} ${messageHash(m)}: not confirmed by a second node (${v}); left as it was this run`);
    return false;
  }

  // 1. The watched authors' recent casts.
  const byHash = new Map();
  const sourceOf = new Map(); // cast hash → the node that listed it
  for (const fid of watchedFids) {
    const r = await client.allCastsByFid(fid, { reverse: true, pageSize: PAGE_SIZE, maxPages: CASTS_PAGES });
    for (const m of r.messages) {
      const h = messageHash(m);
      // Only this fid's own casts: a node that lists anything else is not believed.
      if (h && castBody(m) && m.data.fid === fid && Number.isInteger(m.data.timestamp) && !byHash.has(h) && believable(m, r.node, { fid })) {
        byHash.set(h, m);
        sourceOf.set(h, r.node);
      }
    }
  }
  const own = [...byHash.values()].sort((a, b) => a.data.timestamp - b.data.timestamp || cmp(a.hash, b.hash));
  stats.casts = own.length;
  const check = (m, what) => confirmed(m, sourceOf.get(messageHash(m)), what);

  // Results posts to use this run: only confirmed ones. Results already found for a
  // prize are re-derived only from a confirmed post; otherwise they are kept.
  const resultPosts = [];
  for (const m of own.filter((x) => isResults(x, { watchedFids }))) if (await check(m, "results")) resultPosts.push(m);
  const rereadResults = new Set(resultPosts.map((m) => messageHash(m)));

  // 2. Prizes: seed (authoritative), carried from the previous build, newly detected.
  const seedHashes = new Set(seedPrizes.map((p) => p.castHash));
  const seedRelated = new Set(seedPrizes.flatMap((p) => [p.parentHash, p.context?.castHash, p.results?.castHash]).filter(Boolean));
  const known = new Map(); // castHash → non-seed prize
  for (const p of previous?.prizes || []) {
    if (seedHashes.has(p?.castHash) || validatePrize(p).length) continue;
    // A prize found under an older, looser rule (a caps "PRIZE" announcement) is not carried.
    if (p.kind === "prize" && !isPrizeHeadline(p.headline)) {
      warn(`${p.id}: carried prize no longer reads as a prize headline; dropped`);
      continue;
    }
    const c = structuredClone(p);
    delete c.status;
    // Results are re-read while their (confirmed) post is still in the feed, so they track the current submissions.
    if (c.results && rereadResults.has(c.results.castHash)) delete c.results;
    known.set(c.castHash, c);
  }
  const taken = new Set([
    ...seedPrizes.flatMap((p) => [p.id, p.chapter]),
    ...chapters.map((c) => c?.id),
    ...[...known.values()].flatMap((p) => [p.id, p.chapter]),
  ].filter(Boolean));
  for (const m of own) {
    if (!isPrize(m, { watchedFids })) continue;
    const h = messageHash(m);
    if (seedHashes.has(h) || seedRelated.has(h) || known.has(h)) continue;
    if (!(await check(m, "prize"))) continue;
    const p = derivePrize(m, { seedPrizes, taken });
    taken.add(p.id);
    known.set(h, p);
  }
  // A prize that replies to another prize-like cast by the same author: the parent is its announcement.
  const reassign = new Map(); // old chapter → new chapter
  for (const p of [...known.values()].sort((a, b) => cmp(a.postedAt, b.postedAt) || cmp(a.castHash, b.castHash))) {
    const parent = p.parentHash && known.get(p.parentHash);
    if (!parent || parent.authorFid !== p.authorFid || parent === p) continue;
    if (!p.context) p.context = { castHash: parent.castHash, headline: parent.headline, gloss: ANNOUNCEMENT_GLOSS };
    if (parent.chapter) reassign.set(parent.chapter, p.chapter);
    known.delete(parent.castHash);
  }
  // A prize that replies to the same author's own (non-prize) cast: that cast is its announcement (when a second node agrees).
  for (const p of known.values()) {
    if (p.context || !p.parentHash) continue;
    const parent = byHash.get(p.parentHash);
    if (!parent || parent.data.fid !== p.authorFid) continue;
    if (!(await check(parent, "announcement"))) continue;
    const headline = truncate(plain(firstLine(castBody(parent).text)), 200);
    if (headline) p.context = { castHash: p.parentHash, headline, gloss: ANNOUNCEMENT_GLOSS };
  }
  const prevPrizeHashes = new Set((previous?.prizes || []).map((p) => p?.castHash));
  stats.newPrizes = [...known.values()].filter((p) => !prevPrizeHashes.has(p.castHash)).length;

  // 3. Submissions: known (seed, previous), then replies for prizes still worth reading.
  const knownSubs = new Map();
  for (const s of seedSubmissions) knownSubs.set(s.hash, s);
  const carried = new Map();
  for (const s of previous?.submissions || []) {
    if (knownSubs.has(s?.hash) || validateSubmission(s).length) continue;
    const c = structuredClone(s);
    if (reassign.has(c.chapter)) c.chapter = reassign.get(c.chapter);
    carried.set(c.hash, c);
  }
  // Results found by an earlier run for a seed prize that has none in the seed are carried
  // until their post is read again (then they are re-derived).
  const prevResults = new Map((previous?.prizes || []).filter((p) => p?.results && seedHashes.has(p.castHash)).map((p) => [p.castHash, p.results]));
  const prizeView = [
    ...seedPrizes.map((p) => {
      const c = structuredClone(p);
      const r = prevResults.get(c.castHash);
      if (!c.results && r && typeof r.castHash === "string" && !rereadResults.has(r.castHash) && validatePrize({ ...c, results: r }).length === 0) c.results = structuredClone(r);
      return c;
    }),
    ...known.values(),
  ].sort((a, b) => cmp(a.postedAt, b.postedAt) || cmp(a.castHash, b.castHash));
  const prizeByChapter = new Map(prizeView.filter((p) => p.chapter).map((p) => [p.chapter, p]));
  const subsFor = (chapter, extra) => {
    const out = new Map();
    for (const src of [knownSubs, carried, extra]) for (const s of src.values()) if (s.chapter === chapter && !out.has(s.hash)) out.set(s.hash, s);
    return [...out.values()];
  };
  const fresh = new Map();
  const freshFrom = new Map(); // entry hash → { message, node } it was read from
  const complete = new Set(); // chapters whose whole reply thread was read this run
  const partial = new Set(); // chapters whose thread hit the page cap
  const readFrom = new Map(); // chapter → the node its thread was read from
  for (const p of prizeView) {
    if (p.kind !== "prize" || !p.chapter || !p.deadline) continue;
    const d = msFromISO(p.deadline);
    const recent = nowMs <= d + JUDGING_DAYS * DAY_MS;
    if (!recent && subsFor(p.chapter, fresh).length > 0) continue;
    const r = await client.allCastsByParent(p.authorFid, p.castHash, { pageSize: PAGE_SIZE, maxPages: REPLY_PAGES });
    stats.prizesRead += 1;
    stats.repliesRead += r.messages.length;
    readFrom.set(p.chapter, r.node);
    if (r.truncated) {
      warn(`${p.id}: replies truncated at ${REPLY_PAGES} pages`);
      partial.add(p.chapter);
    } else complete.add(p.chapter);
    for (const m of [...r.messages].sort((a, b) => (a?.data?.timestamp ?? 0) - (b?.data?.timestamp ?? 0) || cmp(a?.hash, b?.hash))) {
      const s = classifyReply(m, p);
      if (!s || knownSubs.has(s.hash) || fresh.has(s.hash) || !believable(m, r.node)) continue;
      fresh.set(s.hash, s);
      freshFrom.set(s.hash, { message: m, node: r.node });
    }
  }

  // A reply read again this run is classified again: the new reading replaces the carried one
  // (for an entry a results post places, only once a second node agrees: see after step 4).
  const carriedBefore = new Map(carried);
  for (const hash of [...carried.keys()]) if (fresh.has(hash)) carried.delete(hash);
  // A thread read completely says a carried (non-seed) entry is gone, or no longer an entry.
  // That is believed only when a second node agrees (review S3): it has no such cast either, or
  // its copy no longer qualifies. Otherwise (one node, a lagging or unreachable second node, a
  // thread cut off at the page cap) everything carried stays. Seed entries are never dropped.
  for (const [hash, c] of [...carried]) {
    if (!complete.has(c.chapter) || partial.has(c.chapter)) continue;
    const prize = prizeByChapter.get(c.chapter);
    let gone = false;
    let why = multi ? "no second node could be asked" : "only one node is configured";
    for (const w of multi ? client.witnesses(readFrom.get(c.chapter)) : []) {
      const r = await client.probeCast(w, c.fid, hash);
      if (r.status === "unavailable") {
        why = `${w} unavailable`;
        continue;
      }
      if (r.status === "missing") gone = true;
      else if (!checkMessage(r.message, { fid: c.fid }).ok) why = `${w} sent a message that fails the checks`;
      else if (!classifyReply(r.message, prize)) gone = true;
      else why = `${w} still has it as an entry`;
      break;
    }
    if (gone) {
      carried.delete(hash);
      stats.dropped += 1;
      warn(`${c.chapter}: entry ${hash} is no longer an entry in its prize's replies (deleted, or it no longer qualifies; a second node agrees); dropped`);
    } else {
      stats.kept += 1;
      warn(`${c.chapter}: entry ${hash} is missing from one node's complete thread; kept (${why})`);
    }
  }

  // 4. Results posts (confirmed ones only; see above).
  const seedResults = (p) => !!seedPrizes.find((s) => s.castHash === p.castHash)?.results;
  for (const m of resultPosts) {
    const h = messageHash(m);
    if (prizeView.some((p) => p.results?.castHash === h)) continue;
    const body = castBody(m);
    const text = resultsText(body);
    const parentHash = typeof body.parentCastId?.hash === "string" ? body.parentCastId.hash.toLowerCase() : null;
    const quoted = (body.embeds || []).map((e) => (typeof e?.castId?.hash === "string" ? e.castId.hash.toLowerCase() : null)).filter(Boolean);
    const prizes = prizeView.filter((p) => p.kind === "prize" && p.postedAt < toISO(m.data.timestamp));
    // The prize it replies to or quotes (or that prize's announcement); otherwise any prize whose entries it links.
    const direct = prizes.filter((p) => [p.castHash, p.parentHash, p.context?.castHash].some((x) => x && (x === parentHash || quoted.includes(x))));
    for (const p of direct.length ? direct : prizes) {
      if (seedResults(p)) continue; // the seed's results stand
      const ignore = [p.castHash, p.parentHash, p.context?.castHash].filter(Boolean);
      const parsed = parseResults(text, subsFor(p.chapter, fresh), { pool: p.pool, existing: p.results?.places, ignore });
      if (!parsed.places.length) continue;
      if (direct.length && parsed.unmatched.length) warn(`results ${h} for ${p.id}: unmatched ${parsed.unmatched.map((u) => u.link).join(", ")}`);
      if (p.results) p.results.places.push(...parsed.places);
      else p.results = { castHash: h, authorFid: m.data.fid, postedAt: toISO(m.data.timestamp), places: parsed.places };
      stats.results += 1;
    }
  }
  // A fresh reading of an entry a results post places (this run's results, carried ones or the
  // seed's) is used only when a second node agrees, unless it is the reading already carried.
  // Otherwise the carried reading stays, or a new entry waits for the next run (its place is
  // kept; the app leaves the work out until then).
  const placed = new Set([...seedPrizes, ...(previous?.prizes || []), ...prizeView].flatMap((p) => (Array.isArray(p?.results?.places) ? p.results.places : []).map((pl) => pl?.submission)));
  for (const hash of [...fresh.keys()].filter((h) => placed.has(h)).sort()) {
    const was = carriedBefore.get(hash);
    if (was && JSON.stringify(was) === JSON.stringify(fresh.get(hash))) continue;
    const { message, node } = freshFrom.get(hash);
    if (await confirmed(message, node, "placed entry")) continue;
    fresh.delete(hash);
    if (was) {
      carried.set(hash, was);
      stats.kept += 1;
    }
  }

  // 5. People: resolve usernames for fids we cannot name yet. Each unnamed fid is
  // looked up at most once a day (provenance.lookups), never-tried fids first and
  // then the longest-waiting, so a cap never starves the higher fids (review S19).
  const named = new Set();
  for (const p of Object.values(seedPeople || {})) if (p?.username) named.add(p.fid);
  const carriedPeople = Object.values(previous?.people || {}).filter((p) => p && Number.isInteger(p.fid));
  for (const p of carriedPeople) if (p.username) named.add(p.fid);
  const allSubs = [...knownSubs.values(), ...carried.values(), ...fresh.values()];
  const unnamed = [...new Set([...allSubs.map((s) => s.fid), ...prizeView.map((p) => p.authorFid), ...prizeView.map((p) => p.results?.authorFid)])]
    .filter((fid) => Number.isInteger(fid) && fid > 0 && !named.has(fid))
    .sort((a, b) => a - b);
  const lastLookup = new Map(Object.entries(validLookups(previous?.provenance?.lookups)).map(([k, v]) => [Number(k), msFromISO(v)]));
  const due = unnamed
    .filter((fid) => !lastLookup.has(fid) || nowMs - lastLookup.get(fid) >= LOOKUP_RETRY_MS)
    .sort((a, b) => (lastLookup.get(a) ?? -Infinity) - (lastLookup.get(b) ?? -Infinity) || a - b)
    .slice(0, MAX_USER_LOOKUPS);
  const resolved = [];
  const lookedUp = new Set();
  for (const fid of due) {
    try {
      const r = await client.userDataByFid(fid);
      const p = personFromUserData(
        fid,
        (r.messages || []).filter((m) => checkMessage(m, { fid }).ok),
      );
      if (p) resolved.push(p);
    } catch (err) {
      if (!(err instanceof NodeHttpError)) throw err; // no node answered: fail closed (never "nobody")
      // a 4xx is an answer: no data for this fid
    }
    lookedUp.add(fid);
  }
  stats.people = resolved.length;
  stats.lookups = lookedUp.size;
  const nowNamed = new Set(resolved.filter((p) => p.username).map((p) => p.fid));
  const lookups = {};
  for (const fid of unnamed) {
    if (nowNamed.has(fid)) continue;
    if (lookedUp.has(fid)) lookups[String(fid)] = now;
    else if (lastLookup.has(fid)) lookups[String(fid)] = isoFromMs(lastLookup.get(fid));
  }

  const prizesOut = [
    ...known.values(),
    ...prizeView.filter((p) => seedHashes.has(p.castHash) && p.results && !seedResults(p)),
  ];
  return {
    prizes: prizesOut,
    submissions: [...carried.values(), ...fresh.values()],
    people: [...carriedPeople, ...resolved],
    lookups,
    nodes: client.answeredNodes(),
    refreshedAt: now,
    stats,
  };
}

/** Book equality ignoring the timestamps that change on every run. */
export function sameContent(a, b) {
  if (!a || !b) return false;
  const strip = (x) => ({ ...x, generatedAt: null, provenance: { ...x.provenance, refreshedAt: null } });
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/**
 * The provenance an offline compile may claim: no node was read for it, so it
 * keeps the previous build's nodes and refresh time (the last network read), or
 * records none (nodes [], refreshedAt = now) when there is no usable previous build.
 * The previous build's lookup times are kept too, so an offline build never makes
 * the next online run look every unnamed fid up again.
 */
export function offlineProvenance(previous, now) {
  const p = previous?.provenance;
  const ok = p && Array.isArray(p.nodes) && p.nodes.every((n) => typeof n === "string" && /^https:\/\/[^\s<>"']+$/.test(n)) && typeof p.refreshedAt === "string" && ISO_UTC.test(p.refreshedAt);
  const base = ok ? { nodes: [...p.nodes], refreshedAt: p.refreshedAt, offline: true } : { nodes: [], refreshedAt: now, offline: true };
  const lookups = validLookups(p?.lookups);
  return Object.keys(lookups).length ? { ...base, lookups } : base;
}

/**
 * What an offline compile carries from the previous build: everything earlier
 * online runs fetched (prizes, their results, entries and people), so a rebuild
 * without the network (the deploy, the editor's check) never loses it. compile()
 * re-validates every item, lets the seed win, and drops entries whose idea is
 * gone. A prize found under the old caps-PRIZE rule is not carried (as online).
 */
export function offlineCarry(previous) {
  const prizes = (Array.isArray(previous?.prizes) ? previous.prizes : []).filter((p) => !(p?.kind === "prize" && !isPrizeHeadline(p?.headline)));
  return {
    prizes: structuredClone(prizes),
    submissions: structuredClone(Array.isArray(previous?.submissions) ? previous.submissions : []),
    people: structuredClone(Object.values(previous?.people && typeof previous.people === "object" ? previous.people : {})),
  };
}

/**
 * The app's generatedAt (review S10). The app only takes a fetched copy that is
 * strictly newer, so: the previous app's time when the content is the same (a
 * rebuild that changes nothing is not an update), else `now`, and in any case
 * later than the previous app's (the deploy compiles with the commit's time,
 * which a clock skew could put behind it).
 */
export function appGeneratedAt(previousApp, app, now) {
  const prev = typeof previousApp?.generatedAt === "string" && ISO_UTC.test(previousApp.generatedAt) ? previousApp.generatedAt : null;
  if (prev === null) return now;
  if (sameApp(previousApp, app)) return prev;
  return isoFromMs(Math.max(msFromISO(now), Math.floor(msFromISO(prev) / 1000) * 1000 + 1000));
}

/**
 * Run a refresh. Resolves to { code, summary, book, app, written, appWritten }.
 * Compiles the book and the app and validates both before writing either; never
 * writes after a node failure. Offline, it reads no node and claims none (see
 * offlineProvenance), and recompiles from the seed, the chapter and lesson files
 * and what the previous build fetched (offlineCarry). An online run that changes nothing writes nothing, except
 * the daily heartbeat. A lesson file that fails the contract is left out of the
 * app and counted; with `strictLessons` (the editor's PR check) it fails the run.
 */
export async function runRefresh({ root, out, appOut, now, offline = false, nodes, chaptersDir, lessonsDir, fetch, timeoutMs, strictLessons = false, warn = () => {} }) {
  const inputs = loadInputs(root, chaptersDir);
  const appInputs = loadAppInputs(root, lessonsDir, { warn });
  if (strictLessons && appInputs.invalidFiles.length) throw new CompileError(appInputs.invalidFiles, "app (lesson files)");
  const appPath = appOut || defaultAppOut(out);
  const previous = readPrevious(out);
  let fetched = { ...offlineCarry(previous), ...offlineProvenance(previous, now) };
  let stats = null;
  if (!offline) {
    const client = createClient({ nodes: nodes?.length ? nodes : inputs.meta.provenance.nodes, fetch, timeoutMs });
    fetched = await fetchUpdates({ client, ...inputs, previous, now, warn });
    stats = fetched.stats;
    delete fetched.stats;
  }
  const book = compile({ ...inputs, fetched, now, onWarning: warn });
  const report = { droppedLessons: [], droppedWork: 0, droppedNames: 0 };
  const compiled = compileApp({ meta: appInputs.meta, works: appInputs.works, lessons: appInputs.lessons, book, now, onWarning: warn, strictLessons, report });
  const previousApp = readPreviousApp(appPath);
  const app = { ...compiled, generatedAt: appGeneratedAt(previousApp, compiled, now) };
  const prevHashes = new Set((previous?.submissions || []).map((s) => s?.hash));
  const fresh = book.submissions.filter((s) => !prevHashes.has(s.hash)).length;
  const drafts = book.chapters.filter((c) => c.status === "draft").length;
  const counts = `${book.prizes.length} prizes, ${book.chapters.length} ideas (${drafts} drafts), ${book.submissions.length} submissions, ${fresh} new since previous file`;
  const lastRefresh = previous?.provenance?.refreshedAt;
  const stale = !lastRefresh || !/^\d{4}-/.test(lastRefresh) || Date.parse(book.generatedAt) - Date.parse(lastRefresh) >= HEARTBEAT_MS;
  const written = offline || !sameContent(previous, book) || stale;
  const appWritten = written || !sameApp(previousApp, app) || previousApp?.generatedAt !== app.generatedAt;
  if (written) writeAtomic(out, serialize(book));
  if (appWritten) writeAtomic(appPath, serialize(app));
  const files = appInputs.invalidFiles.length + report.droppedLessons.length;
  const lines = [
    written ? `refresh: wrote ${out} — ${counts}` : `refresh: unchanged, not written — ${counts}`,
    appWritten ? `refresh: wrote ${appPath} — ${appSummary(app)}` : `refresh: app unchanged, not written — ${appSummary(app)}`,
  ];
  if (files || report.droppedWork || report.droppedNames) {
    lines.push(`refresh: left out of the app (see warnings) — ${files} lesson file${files === 1 ? "" : "s"}, ${report.droppedWork} work${report.droppedWork === 1 ? "" : "s"}, ${report.droppedNames} display name${report.droppedNames === 1 ? "" : "s"}`);
  }
  return { code: 0, written, appWritten, book, app, stats, report: { ...report, invalidFiles: appInputs.invalidFiles }, summary: lines.join("\n") };
}
