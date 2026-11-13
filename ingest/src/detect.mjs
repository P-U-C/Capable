// Prize and results detection from watched-author casts (docs/SPEC.md, "Live updates").
// Pure functions: no clock, no network.

import { toISO, addDaysISO } from "./time.mjs";
import { clean, plain, firstLine, afterFirstLine, sentences, truncate, slugify, titleCase, formatAmount } from "./text.mjs";

export const DEFAULT_WATCHED_FIDS = [1, 37];
const HASH = /^0x[0-9a-f]{40}$/;

// A prize headline (docs/SPEC.md): the first line names a dollar amount in one
// of these forms. A caps "PRIZE" alone is not enough: award and winners
// announcements ("THE FARCASTER PRIZE", "TIEBOUT PRIZE WINNERS") are not prizes.
const PRIZE_FOR = /\$[\d,]+\s+(IN PRIZES\s+)?FOR\b/i; // "$2048 FOR …", "$1024 IN PRIZES FOR …"
const PRIZE_PRIZE_FOR = /\$[\d,]+(?:\.\d+)?\s+Prizes?\s+for\b/i; // "$1000 Prize for AI Conference Organizer"
const TOPIC_COLON_PRIZE = /:\s*\$[\d,]+(?:\.\d+)?\s+Prizes?\b/i; // "Cloud Cartography: $1000 Prize"

// A results post. The first form seen was "Thank you to everyone who submitted…"; the Tiebout results
// (2026-11-13) opened "Thank you to everyone who made submissions for the $1024 FOR VIDEOS ON …" and,
// missed here, was then read as a new prize. So any thank-you-to-everyone opener counts, and so do the
// usual winners openers.
const RESULTS_START = /^(?:thank you(?: so much)?(?: to)? (?:everyone|all)\b|one more set of winners|(?:and )?the winners (?:are|of)\b|congrat(?:s|ulations) to (?:the |our |all )?winners)/i;
// A first line that announces results or awards is never a prize headline, even when it repeats the prize's own
// "$1024 FOR …" title ("…submissions for the $1024 FOR VIDEOS ON TIEBOUT SORTING prize!").
const NOT_A_PRIZE = /^thank you\b|\bwinners?\b|\b(?:1st|first) place\b|\bsubmissions? for the\b/i;

/** The cast body of a CAST_ADD message, or null. */
export function castBody(message) {
  const d = message?.data;
  if (!d || d.type !== "MESSAGE_TYPE_CAST_ADD" || !d.castAddBody || typeof d.castAddBody !== "object") return null;
  return d.castAddBody;
}

/** Lowercase full hash of a message, or null if it is not a well-formed cast hash. */
export function messageHash(message) {
  const h = typeof message?.hash === "string" ? message.hash.toLowerCase() : "";
  return HASH.test(h) ? h : null;
}

function watched(message, watchedFids) {
  const fid = message?.data?.fid;
  return Number.isInteger(fid) && watchedFids.includes(fid);
}

/** Top-level (no parent, or a channel parentUrl), or a reply to the same author's own cast. */
export function isTopLevelOrSelfReply(message) {
  const body = castBody(message);
  if (!body) return false;
  const parent = body.parentCastId;
  if (!parent) return true;
  return Number(parent.fid) === message.data.fid;
}

/** Does this first line read like a prize headline? */
export function isPrizeHeadline(line) {
  const l = String(line || "");
  if (NOT_A_PRIZE.test(l.trim())) return false;
  return PRIZE_FOR.test(l) || PRIZE_PRIZE_FOR.test(l) || TOPIC_COLON_PRIZE.test(l);
}

/** A watched author's results post. */
export function isResults(message, { watchedFids = DEFAULT_WATCHED_FIDS } = {}) {
  const body = castBody(message);
  if (!body || !watched(message, watchedFids) || !messageHash(message)) return false;
  return RESULTS_START.test(clean(body.text).trim());
}

/**
 * A watched author's prize cast: the first line is a prize headline, and the
 * cast is top-level or replies to the same author's own cast (the Elias prize is
 * fid 37 replying to its own announcement). Results posts are never prizes.
 */
export function isPrize(message, { watchedFids = DEFAULT_WATCHED_FIDS } = {}) {
  const body = castBody(message);
  if (!body || !watched(message, watchedFids) || !messageHash(message)) return false;
  if (!Number.isInteger(message.data.timestamp)) return false;
  if (isResults(message, { watchedFids })) return false;
  if (!isTopLevelOrSelfReply(message)) return false;
  return isPrizeHeadline(firstLine(body.text));
}

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30,
};

/** Submission window in days from cast text: "seven days", "3 days", "one week". Default 3. */
export function deadlineDays(text) {
  const t = clean(text).toLowerCase();
  const m = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty)[\s-]+(days?|weeks?)\b/.exec(t);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
    const days = m[2].startsWith("week") ? n * 7 : n;
    if (days >= 1 && days <= 60) return days;
  }
  if (/\ba week\b/.test(t)) return 7;
  return 3;
}

/** The first dollar amount in the text, formatted "$2,048". */
export function firstAmount(text) {
  const m = /\$[\d,]*\d(?:\.\d+)?/.exec(clean(text));
  return m ? formatAmount(m[0]) : null;
}

/**
 * The topic of a prize headline, without the amount and prize boilerplate:
 * "$1024 IN PRIZES FOR VIDEOS ON TIEBOUT SORTING" → "TIEBOUT SORTING",
 * "Cloud Cartography: $1000 Prize" → "Cloud Cartography".
 */
export function headlineTopic(headline) {
  let t = plain(headline);
  t = t.replace(/\(\s*\$[\d,.]+\s*(?:USDC\s*)?PRIZES?\s*\)/gi, " "); // "($2048 PRIZE)"
  t = t.replace(/^\s*\$[\d,.]+\s*(?:USDC\s+)?(?:IN\s+PRIZES?\s+)?(?:PRIZES?\s+)?FOR\s+/i, ""); // "$N [IN PRIZES] FOR", "$N Prize for"
  t = t.replace(/\s*[:\-–—]\s*\$[\d,.]+\s*(?:USDC\s+)?(?:Prizes?|Bounty)?\s*[!.]*\s*$/i, ""); // "Topic: $1000 Prize"
  t = t.replace(/^(?:VIDEOS?|SHORT VIDEOS?|ESSAYS?)\s+(?:ON|ABOUT)\s+/i, ""); // "VIDEOS ON …"
  t = t.replace(/^(?:the|a|an)\s+/i, "");
  t = t.replace(/[\s:–—-]+$/g, "").replace(/\s+/g, " ").trim();
  return t;
}

const RESERVED = new Set(["settings", "sidebar", "customize", "upgrade", "downloads", "cover", "glossary", "credits", "about", "prologue", "next-pick"]);

/** A valid, unused chapter/prize id for a headline. */
export function chapterIdFor(headline, castHash, taken = new Set()) {
  let id = slugify(headlineTopic(headline)) || "pick";
  if (/-(voices|essay|source|end)$/.test(id) || /^(voices|essay|source|end)$/.test(id)) id = `${id}-pick`;
  if (RESERVED.has(id) || taken.has(id)) id = `${id}-${String(castHash || "").slice(2, 8) || "x"}`;
  return id;
}

/** Plain-text deliverable: the first ~2 sentences after the headline, ≤ 600 chars. */
export function deliverableFrom(text) {
  const body = plain(afterFirstLine(text));
  if (!body) return null;
  return truncate(sentences(body).slice(0, 2).join(" "), 600) || null;
}

/**
 * Derive a Prize from a prize cast. Prizes already in the seed are matched by
 * castHash and keep their seed ids and chapter ids (the seed is authoritative;
 * compile merges it over this). `taken` holds ids already in use.
 */
export function derivePrize(message, { seedPrizes = [], taken = new Set() } = {}) {
  const body = castBody(message);
  const castHash = messageHash(message);
  if (!body || !castHash) throw new TypeError("derivePrize: not a cast");
  const text = clean(body.text);
  const headline = truncate(plain(firstLine(text)), 200) || "Untitled pick";
  const postedAt = toISO(message.data.timestamp);
  const seed = seedPrizes.find((p) => p.castHash === castHash);
  const id = seed ? seed.id : chapterIdFor(headline, castHash, taken);
  const prize = {
    id,
    kind: seed ? seed.kind : "prize",
    castHash,
    authorFid: message.data.fid,
    postedAt,
    headline,
  };
  if (seed?.chapter || !seed) prize.chapter = seed ? seed.chapter : id;
  const parent = body.parentCastId;
  if (parent && typeof parent.hash === "string" && HASH.test(parent.hash.toLowerCase())) prize.parentHash = parent.hash.toLowerCase();
  const pool = firstAmount(text);
  if (pool) prize.pool = pool;
  const deliverable = deliverableFrom(text);
  if (deliverable) prize.deliverable = deliverable;
  if (prize.kind === "prize") prize.deadline = addDaysISO(postedAt, deadlineDays(text));
  if (/\bbook club\b/i.test(text)) {
    const m = /\bbook club pick\s*#?\s*(\d{1,3})\b/i.exec(text);
    prize.series = m ? `Book club pick #${m[1]}` : "Book club";
  }
  return prize;
}

/** Title for an auto-drafted idea: the headline topic, Title Case, ≤ 40 chars. */
export function draftTitle(headline) {
  return titleCase(headlineTopic(headline) || headline, 40) || "Untitled pick";
}
