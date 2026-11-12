// Refresh: read inputs, optionally read the network, compile, validate, write.
// Fail closed: any node failure, or an invalid result, writes nothing.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { validatePrize, validateSubmission } from "../../contract/validate.mjs";
import { createClient, NodeHttpError } from "./node.mjs";
import { castBody, derivePrize, isPrize, isPrizeHeadline, isResults, messageHash } from "./detect.mjs";
import { classifyReply } from "./classify.mjs";
import { parseResults } from "./results.mjs";
import { compile, serialize, JUDGING_DAYS } from "./compile.mjs";
import { appSummary, compileApp, sameApp } from "./compile-app.mjs";
import { DAY_MS, msFromISO, toISO } from "./time.mjs";
import { firstLine, plain, truncate } from "./text.mjs";

export const CASTS_PAGES = 3;
export const REPLY_PAGES = 10;
export const PAGE_SIZE = 100;
export const MAX_USER_LOOKUPS = 100;
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
 */
export function loadAppInputs(root, lessonsDir = join(root, "content/lessons")) {
  const meta = readJson(join(root, "content/app.meta.json"));
  const worksPath = join(root, "content/seed/works.json");
  const works = existsSync(worksPath) ? readJson(worksPath) : {};
  const lessons = existsSync(lessonsDir)
    ? readdirSync(lessonsDir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => {
          try {
            return readJson(join(lessonsDir, f));
          } catch (err) {
            throw new Error(`lesson file ${f} is not valid JSON: ${err.message}`);
          }
        })
    : [];
  return { meta, works, lessons };
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
 */
export async function fetchUpdates({ client, meta, seedPrizes, seedSubmissions, seedPeople, chapters, previous, now, warn = () => {} }) {
  const watchedFids = meta.provenance.watchedFids;
  const nowMs = msFromISO(now);
  const stats = { casts: 0, newPrizes: 0, results: 0, repliesRead: 0, prizesRead: 0, people: 0 };

  // 1. The watched authors' recent casts.
  const byHash = new Map();
  for (const fid of watchedFids) {
    const r = await client.allCastsByFid(fid, { reverse: true, pageSize: PAGE_SIZE, maxPages: CASTS_PAGES });
    for (const m of r.messages) {
      const h = messageHash(m);
      // Only this fid's own casts: a node that lists anything else is not believed.
      if (h && castBody(m) && m.data.fid === fid && Number.isInteger(m.data.timestamp) && !byHash.has(h)) byHash.set(h, m);
    }
  }
  const own = [...byHash.values()].sort((a, b) => a.data.timestamp - b.data.timestamp || cmp(a.hash, b.hash));
  stats.casts = own.length;

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
    // Results are re-read while their post is still in the feed, so they track the current submissions.
    if (c.results && byHash.has(c.results.castHash)) delete c.results;
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
  // A prize that replies to the same author's own (non-prize) cast: that cast is its announcement.
  for (const p of known.values()) {
    if (p.context || !p.parentHash) continue;
    const parent = byHash.get(p.parentHash);
    if (!parent || parent.data.fid !== p.authorFid) continue;
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
      if (!c.results && r && typeof r.castHash === "string" && !byHash.has(r.castHash) && validatePrize({ ...c, results: r }).length === 0) c.results = structuredClone(r);
      return c;
    }),
    ...known.values(),
  ].sort((a, b) => cmp(a.postedAt, b.postedAt) || cmp(a.castHash, b.castHash));
  const subsFor = (chapter, extra) => {
    const out = new Map();
    for (const src of [knownSubs, carried, extra]) for (const s of src.values()) if (s.chapter === chapter && !out.has(s.hash)) out.set(s.hash, s);
    return [...out.values()];
  };
  const fresh = new Map();
  const complete = new Set(); // chapters whose whole reply thread was read this run
  const partial = new Set(); // chapters whose thread hit the page cap
  for (const p of prizeView) {
    if (p.kind !== "prize" || !p.chapter || !p.deadline) continue;
    const d = msFromISO(p.deadline);
    const recent = nowMs <= d + JUDGING_DAYS * DAY_MS;
    if (!recent && subsFor(p.chapter, fresh).length > 0) continue;
    const r = await client.allCastsByParent(p.authorFid, p.castHash, { pageSize: PAGE_SIZE, maxPages: REPLY_PAGES });
    stats.prizesRead += 1;
    stats.repliesRead += r.messages.length;
    if (r.truncated) {
      warn(`${p.id}: replies truncated at ${REPLY_PAGES} pages`);
      partial.add(p.chapter);
    } else complete.add(p.chapter);
    for (const m of [...r.messages].sort((a, b) => (a?.data?.timestamp ?? 0) - (b?.data?.timestamp ?? 0) || cmp(a?.hash, b?.hash))) {
      const s = classifyReply(m, p);
      if (s && !knownSubs.has(s.hash) && !fresh.has(s.hash)) fresh.set(s.hash, s);
    }
  }
  // A reply read again this run is classified again: the new reading replaces the carried one.
  // A thread read completely is the whole truth for its prize: a carried (non-seed) entry
  // that is gone from it, or no longer an entry, is dropped. A thread cut off at the page
  // cap proves nothing, so everything carried for it stays. Seed entries are never dropped.
  stats.dropped = 0;
  for (const [hash, c] of [...carried]) {
    if (fresh.has(hash)) carried.delete(hash);
    else if (complete.has(c.chapter) && !partial.has(c.chapter)) {
      carried.delete(hash);
      stats.dropped += 1;
      warn(`${c.chapter}: entry ${hash} is no longer an entry in its prize's replies (deleted, or it no longer qualifies); dropped`);
    }
  }

  // 4. Results posts.
  const seedResults = (p) => !!seedPrizes.find((s) => s.castHash === p.castHash)?.results;
  for (const m of own.filter((x) => isResults(x, { watchedFids }))) {
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

  // 5. People: resolve usernames for fids we cannot name yet.
  const named = new Set();
  for (const p of Object.values(seedPeople || {})) if (p?.username) named.add(p.fid);
  const carriedPeople = Object.values(previous?.people || {}).filter((p) => p && Number.isInteger(p.fid));
  for (const p of carriedPeople) if (p.username) named.add(p.fid);
  const allSubs = [...knownSubs.values(), ...carried.values(), ...fresh.values()];
  const fids = [...new Set([...allSubs.map((s) => s.fid), ...prizeView.map((p) => p.authorFid), ...prizeView.map((p) => p.results?.authorFid)])]
    .filter((fid) => Number.isInteger(fid) && fid > 0 && !named.has(fid))
    .sort((a, b) => a - b)
    .slice(0, MAX_USER_LOOKUPS);
  const resolved = [];
  for (const fid of fids) {
    try {
      const r = await client.userDataByFid(fid);
      const p = personFromUserData(fid, r.messages);
      if (p) resolved.push(p);
    } catch (err) {
      if (err instanceof NodeHttpError) continue; // a 4xx is an answer: no data for this fid
      throw err;
    }
  }
  stats.people = resolved.length;

  const prizesOut = [
    ...known.values(),
    ...prizeView.filter((p) => seedHashes.has(p.castHash) && p.results && !seedResults(p)),
  ];
  return {
    prizes: prizesOut,
    submissions: [...carried.values(), ...fresh.values()],
    people: [...carriedPeople, ...resolved],
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
 */
export function offlineProvenance(previous, now) {
  const p = previous?.provenance;
  const ok = p && Array.isArray(p.nodes) && p.nodes.every((n) => typeof n === "string" && /^https:\/\/[^\s<>"']+$/.test(n)) && typeof p.refreshedAt === "string" && ISO_UTC.test(p.refreshedAt);
  return ok ? { nodes: [...p.nodes], refreshedAt: p.refreshedAt, offline: true } : { nodes: [], refreshedAt: now, offline: true };
}

/**
 * Run a refresh. Resolves to { code, summary, book, app, written, appWritten }.
 * Compiles the book and the app and validates both before writing either; never
 * writes after a node failure. Offline, it reads no node and claims none (see
 * offlineProvenance). An online run that changes nothing writes nothing, except
 * the daily heartbeat.
 */
export async function runRefresh({ root, out, appOut, now, offline = false, nodes, chaptersDir, lessonsDir, fetch, timeoutMs, warn = () => {} }) {
  const inputs = loadInputs(root, chaptersDir);
  const appInputs = loadAppInputs(root, lessonsDir);
  const appPath = appOut || defaultAppOut(out);
  const previous = readPrevious(out);
  let fetched = offlineProvenance(previous, now);
  let stats = null;
  if (!offline) {
    const client = createClient({ nodes: nodes?.length ? nodes : inputs.meta.provenance.nodes, fetch, timeoutMs });
    fetched = await fetchUpdates({ client, ...inputs, previous, now, warn });
    stats = fetched.stats;
    delete fetched.stats;
  }
  const book = compile({ ...inputs, fetched, now, onWarning: warn });
  const app = compileApp({ ...appInputs, book, now, onWarning: warn });
  const prevHashes = new Set((previous?.submissions || []).map((s) => s?.hash));
  const fresh = book.submissions.filter((s) => !prevHashes.has(s.hash)).length;
  const drafts = book.chapters.filter((c) => c.status === "draft").length;
  const counts = `${book.prizes.length} prizes, ${book.chapters.length} ideas (${drafts} drafts), ${book.submissions.length} submissions, ${fresh} new since previous file`;
  const lastRefresh = previous?.provenance?.refreshedAt;
  const stale = !lastRefresh || !/^\d{4}-/.test(lastRefresh) || Date.parse(book.generatedAt) - Date.parse(lastRefresh) >= HEARTBEAT_MS;
  const written = offline || !sameContent(previous, book) || stale;
  const appWritten = written || !sameApp(readPreviousApp(appPath), app);
  if (written) writeAtomic(out, serialize(book));
  if (appWritten) writeAtomic(appPath, serialize(app));
  const summary = [
    written ? `refresh: wrote ${out} — ${counts}` : `refresh: unchanged, not written — ${counts}`,
    appWritten ? `refresh: wrote ${appPath} — ${appSummary(app)}` : `refresh: app unchanged, not written — ${appSummary(app)}`,
  ].join("\n");
  return { code: 0, written, appWritten, book, app, stats, summary };
}
