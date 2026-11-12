// Text helpers for untrusted network strings. Pure functions, no dependencies.
//
// Everything that comes from a cast is untrusted. Before any of it lands in an
// Inline field of the Book, it goes through plain(): no HTML-like markup, no
// link or citation markup, no control characters. The contract's three inline
// forms are for editors only.

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g;

/** Strip control and bidi characters; keep "\n". */
export function clean(s) {
  return String(s ?? "").replace(/\r\n?/g, "\n").replace(CONTROL, "");
}

/**
 * Plain text that is safe in an Inline field: angle brackets, square and curly
 * brackets become look-alikes or parentheses so no markup survives, asterisks
 * are dropped, whitespace is collapsed. With paragraphs, blank-line breaks are
 * kept as "\n\n"; otherwise everything is one line.
 */
export function plain(s, { paragraphs = false } = {}) {
  let t = clean(s)
    .replace(/</g, "‹")
    .replace(/>/g, "›")
    .replace(/[[{]/g, "(")
    .replace(/[\]}]/g, ")")
    .replace(/\*/g, "");
  if (paragraphs) {
    return t
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n\n");
  }
  return t.replace(/\s+/g, " ").trim();
}

/** First non-empty line, trimmed. */
export function firstLine(text) {
  for (const line of clean(text).split("\n")) if (line.trim()) return line.trim();
  return "";
}

/** Everything after the first non-empty line. */
export function afterFirstLine(text) {
  const lines = clean(text).split("\n");
  const i = lines.findIndex((l) => l.trim());
  return i < 0 ? "" : lines.slice(i + 1).join("\n");
}

/** Truncate at a word boundary to at most `max` chars, adding "…" when cut. */
export function truncate(s, max) {
  const t = String(s ?? "").trim();
  if (t.length <= max) return t;
  const room = t.slice(0, max - 1);
  const cut = room.lastIndexOf(" ");
  const base = (cut > max * 0.5 ? room.slice(0, cut) : room).replace(/[\s,;:.\-–—]+$/, "");
  return `${base}…`;
}

/** Split prose into sentences. Conservative: breaks after . ! ? followed by whitespace. */
export function sentences(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return [];
  return t.split(/(?<=[.!?]["'”’)]?)\s+(?=[^a-z])/).map((x) => x.trim()).filter(Boolean);
}

/** kebab-case slug, ASCII only, at most `max` chars, cut at a hyphen. */
export function slugify(s, max = 48) {
  let t = String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (t.length > max) {
    t = t.slice(0, max + 1);
    const cut = t.lastIndexOf("-");
    t = (cut > 0 ? t.slice(0, cut) : t.slice(0, max)).replace(/-+$/, "");
  }
  return t;
}

const SMALL = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "vs", "via", "with", "&"]);
const ACRONYMS = new Set(["AI", "API", "DAO", "DAOS", "NFT", "NFTS", "USDC", "ETH", "UBI", "VPS", "UK", "EU", "USA", "DNS", "P2P"]);

/** Title Case for a headline topic. All-caps input is re-cased; mixed case is kept. */
export function titleCase(s, max = 40) {
  const src = plain(s);
  const allCaps = !/[a-z]/.test(src) && /[A-Z]/.test(src);
  const words = src.split(" ").filter(Boolean).map((w, i) => {
    if (allCaps) {
      if (ACRONYMS.has(w.replace(/[^A-Z0-9]/g, ""))) return w;
      w = w.toLowerCase();
    }
    if (i > 0 && SMALL.has(w.toLowerCase())) return w.toLowerCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  });
  return truncate(words.join(" "), max);
}

const BARE_HOSTS = /(?:^|[\s(])((?:www\.)?(?:github\.com|farcaster\.xyz|warpcast\.com|x\.com|twitter\.com|youtu\.be|youtube\.com|[a-z0-9-]+\.github\.io|[a-z0-9-]+\.vercel\.app|[a-z0-9-]+\.netlify\.app|[a-z0-9-]+\.pages\.dev)\/[^\s<>"'()]*)/gi;

/** Parse a URL string; only https URLs come back. */
export function httpsUrl(s) {
  try {
    const u = new URL(String(s).trim());
    if (u.protocol !== "https:" || !u.hostname || u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

/** The longest URL from the network that is kept. */
export const MAX_URL_LENGTH = 2048;
// Whitespace, quotes, angle/curly/square brackets, backslash, control and bidi characters.
const UNSAFE_URL_CHARS = /[\s"'`<>{}[\]\\\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/;

/**
 * A URL from the network that is safe to keep verbatim, or null: https, parses,
 * at most MAX_URL_LENGTH characters, and none of whitespace, quotes, <, >, {, },
 * [, ], backslash or control characters. The exact string is kept (no
 * re-serialization), so it still matches what the author posted.
 */
export function safeUrl(s) {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t || t.length > MAX_URL_LENGTH || UNSAFE_URL_CHARS.test(t)) return null;
  if (!/^https:\/\//.test(t) || !httpsUrl(t)) return null;
  return t;
}

function trimUrl(u) {
  return u.replace(/[.,;:!?'")\]]+$/, "");
}

/**
 * URLs written in text, in order of appearance: explicit https:// links, plus
 * bare links on a few well-known hosts (github.com/…, farcaster.xyz/…). http://
 * links and unsafe URLs (see safeUrl) are ignored. Returns https strings,
 * de-duplicated.
 */
export function urlsInText(text) {
  const t = clean(text);
  const found = [];
  for (const m of t.matchAll(/https?:\/\/[^\s<>"']+/gi)) found.push({ at: m.index, raw: trimUrl(m[0]) });
  for (const m of t.matchAll(BARE_HOSTS)) {
    const at = m.index + m[0].indexOf(m[1]);
    const before = t.slice(Math.max(0, at - 8), at);
    if (/https?:\/\/$/i.test(before) || /:\/\/$/.test(before)) continue;
    found.push({ at, raw: `https://${trimUrl(m[1])}` });
  }
  found.sort((a, b) => a.at - b.at);
  const out = [];
  for (const f of found) {
    // Keep the exact string the author wrote (only https, only if it parses and is safe).
    const u = safeUrl(f.raw);
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

/** "$2048" / "$1,000.50" → "$2,048" / "$1,000.50". */
export function formatAmount(raw) {
  const m = /^\$?([\d,]+)(\.\d+)?$/.exec(String(raw).trim());
  if (!m) return null;
  const digits = m[1].replace(/,/g, "");
  if (!digits) return null;
  return `$${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${m[2] || ""}`;
}
