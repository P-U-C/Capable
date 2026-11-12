// Results parsing (docs/SPEC.md, "Live updates"). Pure: no clock, no network.
//
// A results post names winners with links, in order: 1st, 2nd, then honorable
// mentions. Two kinds of link mark a submission:
//   - farcaster.xyz/<user>/0x<8+ hex> (or …/~/conversations/0x…): the
//     submission whose hash starts with that prefix;
//   - a project's site (the clients results post names projects by site): the
//     submission whose `site` host appears in the text, or whose repo does.

import { clean, plain, httpsUrl, formatAmount } from "./text.mjs";

const CAST_LINK = /(?:https?:\/\/)?(?:www\.)?(?:farcaster\.xyz|warpcast\.com)\/(?:~\/conversations|([a-z0-9][a-z0-9._-]*))\/(0x[0-9a-f]{8,40})(?![0-9a-z])/gi;
const ANY_URL = /https?:\/\/[^\s<>"']+/gi;
const PLATFORM_HOSTS = new Set(["farcaster.xyz", "warpcast.com", "github.com", "x.com", "twitter.com", "youtube.com", "youtu.be", "bsky.app"]);

/** "$1,024 first · $512 second · $128 honorable mentions" → { "1st": "$1,024", "2nd": "$512", hm: "$128" } */
export function poolTiers(pool) {
  const tiers = {};
  for (const m of String(pool || "").matchAll(/(\$[\d,]*\d(?:\.\d+)?)\s+(?:grand prize|first|1st|second|2nd|honou?rable|runners?[- ]up)/gi)) {
    const word = m[0].slice(m[1].length).trim().toLowerCase();
    const place = /^(first|1st|grand)/.test(word) ? "1st" : /^(second|2nd)/.test(word) ? "2nd" : "hm";
    if (!tiers[place]) tiers[place] = formatAmount(m[1]);
  }
  return tiers;
}

function hostOf(url) {
  const u = httpsUrl(url);
  return u ? u.hostname.toLowerCase().replace(/^www\./, "") : null;
}

function pathOf(url) {
  const u = httpsUrl(url);
  return u ? u.pathname.replace(/\/+$/, "").toLowerCase() : "";
}

/**
 * Every place `needle` (a host name, or host/path) occurs in `hay` as a whole
 * name, with the start of the link it belongs to (an "https://" or "www."
 * written before it is part of the link).
 */
function occurrences(hay, needle) {
  const out = [];
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) return out;
    from = i + needle.length;
    let start = i;
    if (hay.slice(i - 4, i) === "www.") start = i - 4;
    const before = hay[start - 1] || " ";
    const after = hay.slice(i + needle.length, i + needle.length + 2);
    const okBefore = !/[a-z0-9.\-@_]/.test(before);
    const okAfter = !/^[a-z0-9\-_]/.test(after) && !/^\.[a-z0-9]/.test(after);
    if (!okBefore || !okAfter) continue;
    if (/https?:\/\/$/.test(hay.slice(Math.max(0, start - 8), start))) start = hay.lastIndexOf("http", start);
    out.push({ start, at: i, end: i + needle.length });
  }
}

function lineAt(text, index) {
  const start = text.lastIndexOf("\n", index - 1) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end < 0 ? text.length : end);
}

/** Pick one submission from candidates sharing a host or repo; null if genuinely ambiguous. */
function pick(cands, linkPath) {
  if (cands.length <= 1) return cands[0] || null;
  if (linkPath) {
    const exact = cands.filter((s) => pathOf(s.site) === linkPath);
    if (exact.length === 1) return exact[0];
  }
  const fids = new Set(cands.map((s) => s.fid));
  if (fids.size !== 1) return null;
  // One author resubmitted: the latest entry is the one that stands.
  return [...cands].sort((a, b) => (a.postedAt < b.postedAt ? 1 : a.postedAt > b.postedAt ? -1 : a.hash < b.hash ? 1 : -1))[0];
}

/**
 * @param {string} text  results post text (embed URLs may be appended)
 * @param {object[]} submissions  the prize's submissions
 * @param {{ pool?: string, existing?: {place:string, submission:string}[] }} [opts]
 * @returns {{ places: {place:"1st"|"2nd"|"hm", amount?:string, submission:string, label:string}[], unmatched: {link:string, reason:string}[] }}
 */
export function parseResults(text, submissions, { pool, existing = [] } = {}) {
  const t = clean(text);
  const lower = t.toLowerCase();
  const subs = (submissions || []).filter((s) => s && typeof s.hash === "string");
  const hits = []; // { at, end, submission, user, link }
  const unmatched = [];
  const claimed = []; // [start, end) ranges already explained

  for (const m of t.matchAll(CAST_LINK)) {
    const prefix = m[2].toLowerCase();
    const link = m[0];
    claimed.push([m.index, m.index + link.length]);
    const cands = subs.filter((s) => s.hash.startsWith(prefix));
    if (cands.length === 1) hits.push({ at: m.index, submission: cands[0], user: m[1] || null, link });
    else unmatched.push({ at: m.index, link, reason: cands.length ? "ambiguous hash prefix" : "no submission with this hash prefix" });
  }

  // Sites and repos named in the text.
  const byHost = new Map();
  const byRepo = new Map();
  for (const s of subs) {
    const h = s.site && hostOf(s.site);
    if (h && !PLATFORM_HOSTS.has(h)) byHost.set(h, [...(byHost.get(h) || []), s]);
    const r = s.repo && httpsUrl(s.repo) ? s.repo.replace(/^https:\/\/(www\.)?/i, "").replace(/\/+$/, "").toLowerCase() : null;
    if (r) byRepo.set(r, [...(byRepo.get(r) || []), s]);
  }
  const inClaimed = (i) => claimed.some(([a, b]) => i >= a && i < b);
  for (const [host, cands] of [...byHost].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    for (const o of occurrences(lower, host)) {
      if (inClaimed(o.at)) continue;
      const rest = /^[^\s,;)]*/.exec(lower.slice(o.end))[0].replace(/[.!?]+$/, "");
      const end = o.end + rest.length;
      const s = pick(cands, rest.replace(/\/+$/, ""));
      claimed.push([o.start, end]);
      if (s) hits.push({ at: o.start, submission: s, user: null, link: t.slice(o.start, end) });
      else unmatched.push({ at: o.start, link: t.slice(o.start, end), reason: "ambiguous site" });
    }
  }
  for (const [repo, cands] of [...byRepo].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    for (const o of occurrences(lower, repo)) {
      if (inClaimed(o.at)) continue;
      const s = pick(cands, "");
      claimed.push([o.start, o.end]);
      if (s) hits.push({ at: o.start, submission: s, user: null, link: t.slice(o.start, o.end) });
      else unmatched.push({ at: o.start, link: t.slice(o.start, o.end), reason: "ambiguous repo" });
    }
  }

  // Any other link is reported, never guessed at.
  for (const m of t.matchAll(ANY_URL)) {
    if (!inClaimed(m.index)) unmatched.push({ at: m.index, link: m[0], reason: "not a submission link" });
  }

  hits.sort((a, b) => a.at - b.at);
  const tiers = poolTiers(pool);
  const taken = new Set((existing || []).map((p) => p.submission));
  let hasFirst = (existing || []).some((p) => p.place === "1st");
  // A pool that names honorable mentions/runners-up but no second prize has no 2nd place.
  let hasSecond = (existing || []).some((p) => p.place === "2nd") || (Object.keys(tiers).length > 0 && !tiers["2nd"] && !!tiers.hm);
  const places = [];
  for (const h of hits) {
    if (taken.has(h.submission.hash)) continue;
    taken.add(h.submission.hash);
    let place;
    if (!hasFirst) {
      place = "1st";
      hasFirst = true;
    } else if (!hasSecond) {
      place = "2nd";
      hasSecond = true;
    } else place = "hm";
    const lineAmounts = [...new Set([...lineAt(t, h.at).matchAll(/\$[\d,]*\d(?:\.\d+)?/g)].map((x) => formatAmount(x[0])))];
    const amount = lineAmounts.length === 1 ? lineAmounts[0] : tiers[place];
    const s = h.submission;
    const label = plain(s.name || (h.user ? `@${h.user}` : "") || hostOf(s.site || "") || `fid ${s.fid}`).slice(0, 80);
    places.push(amount ? { place, amount, submission: s.hash, label } : { place, submission: s.hash, label });
  }
  return { places, unmatched: unmatched.sort((a, b) => a.at - b.at).map(({ link, reason }) => ({ link, reason })) };
}
