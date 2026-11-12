// Results parsing (docs/SPEC.md, "Live updates"). Pure: no clock, no network.
//
// A results post names winners with links. Two kinds of link mark a submission:
//   - farcaster.xyz/<user>/0x<8+ hex> (or …/~/conversations/0x…): the
//     submission whose hash starts with that prefix;
//   - a project's site (the clients results post names projects by site): the
//     submission whose `site` host appears in the text, or whose repo does.
//
// The place comes from the label the post gives it ("1st place ($1,024): …",
// "2nd", "Honorable mentions ($128 each):", "HM", "Runners-up:"). A label
// heads the links after it until the next label; a label written after a link
// on the same line ("… (1st)") is that link's own. Only a post with no place
// labels at all is read in order: 1st, 2nd, then honorable mentions. Either
// way, a link that matches no submission, or more than one, keeps its slot:
// it is reported and never moves another winner up.

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

const AMOUNT = /\$[\d,]*\d(?:\.\d+)?/g;

// Place labels. "shaped" labels count only where they read as a label: at the
// start of a line, in parentheses, or followed by ":" or a dash. "first" in
// prose ("our first prize!") is not a label.
const LABELS = [
  { place: "1st", re: /\b(?:1st|first)(?:\s+(?:place|prize))?(?![\w-]|\.\w)|\bgrand\s+prize\b/gi, shaped: true },
  { place: "2nd", re: /\b(?:2nd|second)(?:\s+(?:place|prize))?(?![\w-]|\.\w)/gi, shaped: true },
  { place: "hm", re: /\bhonou?rable\s+mentions?\b|\brunners?[- ]ups?\b/gi, shaped: false },
  { place: "hm", re: /\bHMs?\b/g, shaped: false },
];

const lineStartAt = (t, i) => t.lastIndexOf("\n", i - 1) + 1;
const lineEndAt = (t, i) => {
  const e = t.indexOf("\n", i);
  return e < 0 ? t.length : e;
};

function labelShaped(t, start, end) {
  if (!/\p{L}/u.test(t.slice(lineStartAt(t, start), start))) return true; // the line starts with it
  if (t[start - 1] === "(") return true; // "(1st)"
  return /^\s*(?:\([^()\n]{0,40}\)\s*)?(?:[:–—]|-(?=\s)|$)/.test(t.slice(end, lineEndAt(t, end)));
}

/** Place labels in `t`, outside the given [start, end) ranges, in text order. */
function placeLabels(t, excluded) {
  const out = [];
  for (const { place, re, shaped } of LABELS) {
    for (const m of t.matchAll(re)) {
      const at = m.index;
      const end = at + m[0].length;
      if (excluded.some(([a, b]) => at < b && end > a)) continue;
      if (shaped && !labelShaped(t, at, end)) continue;
      out.push({ at, end, place });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

function amountsOnLine(t, i) {
  return [...new Set([...lineAt(t, i).matchAll(AMOUNT)].map((x) => formatAmount(x[0])))];
}

/**
 * @param {string} text  results post text (embed URLs may be appended)
 * @param {object[]} submissions  the prize's submissions
 * @param {{ pool?: string, existing?: {place:string, submission:string}[], ignore?: string[] }} [opts]
 *   `ignore`: cast hashes that are not entries (the prize itself, its announcement); links to them are skipped.
 * @returns {{
 *   places: {place:"1st"|"2nd"|"hm", amount?:string, submission:string, label:string}[],
 *   unmatched: {link:string, reason:string}[],
 *   ambiguous: {link:string, reason:string, candidates:string[]}[],
 * }}
 *   `unmatched` lists every link that placed no one (ambiguous ones included);
 *   `ambiguous` repeats the ones that matched more than one submission.
 */
export function parseResults(text, submissions, { pool, existing = [], ignore = [] } = {}) {
  const t = clean(text);
  const lower = t.toLowerCase();
  const subs = (submissions || []).filter((s) => s && typeof s.hash === "string");
  const ignored = (ignore || []).filter((h) => typeof h === "string").map((h) => h.toLowerCase());
  // Every link that names an entry, matched or not, keeps a slot: { at, end, link, submission?, user?, key, reason?, candidates? }
  const slots = [];
  const unmatched = []; // { at, link, reason }
  const ambiguous = []; // { at, link, reason, candidates }
  const claimed = []; // [start, end) ranges already explained

  const miss = (slot, reason, cands) => {
    slot.reason = reason;
    unmatched.push({ at: slot.at, link: slot.link, reason });
    if (cands && cands.length > 1) {
      slot.candidates = cands.map((s) => s.hash).sort();
      ambiguous.push({ at: slot.at, link: slot.link, reason, candidates: slot.candidates });
    }
  };

  for (const m of t.matchAll(CAST_LINK)) {
    const prefix = m[2].toLowerCase();
    const link = m[0];
    claimed.push([m.index, m.index + link.length]);
    const cands = subs.filter((s) => s.hash.startsWith(prefix));
    if (!cands.length && ignored.some((h) => h.startsWith(prefix))) continue; // the prize itself, not an entry
    const slot = { at: m.index, end: m.index + link.length, link, user: m[1] || null, key: `prefix:${prefix}` };
    if (cands.length === 1) slot.submission = cands[0];
    else miss(slot, cands.length ? "ambiguous hash prefix" : "no submission with this hash prefix", cands);
    slots.push(slot);
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
      const slot = { at: o.start, end, link: t.slice(o.start, end), user: null, key: `site:${host}${rest}` };
      if (s) slot.submission = s;
      else miss(slot, "ambiguous site", cands);
      slots.push(slot);
    }
  }
  for (const [repo, cands] of [...byRepo].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    for (const o of occurrences(lower, repo)) {
      if (inClaimed(o.at)) continue;
      const s = pick(cands, "");
      claimed.push([o.start, o.end]);
      const slot = { at: o.start, end: o.end, link: t.slice(o.start, o.end), user: null, key: `repo:${repo}` };
      if (s) slot.submission = s;
      else miss(slot, "ambiguous repo", cands);
      slots.push(slot);
    }
  }

  // Any other link is reported, never guessed at, and holds no slot.
  const urlRanges = [];
  for (const m of t.matchAll(ANY_URL)) {
    urlRanges.push([m.index, m.index + m[0].length]);
    if (!inClaimed(m.index)) unmatched.push({ at: m.index, link: m[0], reason: "not a submission link" });
  }

  slots.sort((a, b) => a.at - b.at);
  const tiers = poolTiers(pool);
  const prior = existing || [];
  const taken = new Set(prior.map((p) => p.submission));
  const places = [];
  const award = (slot, place, amount) => {
    const s = slot.submission;
    taken.add(s.hash);
    const label = plain(s.name || (slot.user ? `@${slot.user}` : "") || hostOf(s.site || "") || `fid ${s.fid}`).slice(0, 80);
    places.push(amount ? { place, amount, submission: s.hash, label } : { place, submission: s.hash, label });
  };
  const oneAmount = (...lines) => {
    for (const i of lines) {
      const a = amountsOnLine(t, i);
      if (a.length === 1) return a[0];
    }
    return null;
  };

  const labels = placeLabels(t, [...claimed, ...urlRanges]);
  if (labels.length) {
    // A label after a slot on the same line, with no slot after it on that line, is that slot's own.
    const own = new Map(); // slot → label
    const headings = [];
    for (const lab of labels) {
      const ls = lineStartAt(t, lab.at);
      const sameLine = slots.filter((x) => lineStartAt(t, x.at) === ls);
      const before = sameLine.filter((x) => x.end <= lab.at);
      const after = sameLine.filter((x) => x.at >= lab.end);
      if (before.length && !after.length) {
        const slot = before[before.length - 1];
        if (!own.has(slot)) own.set(slot, lab);
      } else headings.push(lab);
    }
    let section = null;
    let h = 0;
    for (const slot of slots) {
      while (h < headings.length && headings[h].at < slot.at) section = headings[h++];
      if (!slot.submission) continue; // reported above; its label is used up, nobody moves
      const lab = own.get(slot) || section;
      if (!lab) {
        unmatched.push({ at: slot.at, link: slot.link, reason: "no place label for this link" });
        continue;
      }
      if (taken.has(slot.submission.hash)) continue; // the same winner linked again
      if (lab.place !== "hm" && prior.some((p) => p.place === lab.place)) {
        unmatched.push({ at: slot.at, link: slot.link, reason: `${lab.place} already awarded` });
        continue;
      }
      award(slot, lab.place, oneAmount(slot.at, lab.at) || tiers[lab.place]);
    }
  } else {
    // No labels: in order. Every slot takes the next place, matched or not.
    let hasFirst = prior.some((p) => p.place === "1st");
    // A pool that names honorable mentions/runners-up but no second prize has no 2nd place.
    let hasSecond = prior.some((p) => p.place === "2nd") || (Object.keys(tiers).length > 0 && !tiers["2nd"] && !!tiers.hm);
    const seen = new Set();
    for (const slot of slots) {
      const key = slot.submission ? slot.submission.hash : slot.key;
      if (seen.has(key) || (slot.submission && taken.has(slot.submission.hash))) continue;
      seen.add(key);
      let place;
      if (!hasFirst) {
        place = "1st";
        hasFirst = true;
      } else if (!hasSecond) {
        place = "2nd";
        hasSecond = true;
      } else place = "hm";
      if (slot.submission) award(slot, place, oneAmount(slot.at) || tiers[place]);
    }
  }
  const out = (xs) => xs.sort((a, b) => a.at - b.at).map(({ at, ...rest }) => rest);
  return { places, unmatched: out(unmatched), ambiguous: out(ambiguous) };
}
