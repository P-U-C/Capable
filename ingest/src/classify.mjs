// Submission classification for replies to a prize cast (docs/SPEC.md, "Live updates").
// Pure: no clock, no network. Glosses are ours and neutral; never the author's words.

import { toISO } from "./time.mjs";
import { clean, httpsUrl, urlsInText } from "./text.mjs";
import { castBody, messageHash, isResults } from "./detect.mjs";

const BUILD_WORDS = /\b(microsites?|repos?|repository|github|open[- ]source|source code|tool)\b/i;
const ENTRY_WORDS = /\b(entry|entries|submission|submitting|submitted|submit)\b/i;
const PROMO_WORDS = /\b(claim (?:your|now|here|free|the drop|tokens?|rewards?|airdrop)|airdrop|giveaway|presale|whitelist|allowlist|free mint|mint now|mint here|referral|promo code|use (?:my )?code)\b/i;
const AI_DISCLOSED =
  /\b(ai[- ]generated|ai[- ]made|made (?:with|using) ai|generated (?:with|using|by) ai|created (?:with|using) ai|(?:with|using|via) ai tools?|ai (?:video|voice|voiceover|visuals|narration|animation|avatar)|sora|veo ?\d?|kling|heygen|synthesia|elevenlabs|runway(?:ml)?|hailuo|midjourney|pika labs)\b/i;

// Hosts that are never a project's microsite.
const NOT_A_SITE = /(^|\.)(farcaster\.xyz|warpcast\.com|x\.com|twitter\.com|t\.co|github\.com|youtube\.com|youtu\.be|bsky\.app|video\.bsky\.app|media\.firefly\.land|stream\.farcaster\.xyz|imagedelivery\.net|imgur\.com|i\.imgur\.com|linktr\.ee|t\.me|telegram\.me|discord\.gg|discord\.com|instagram\.com|tiktok\.com|zora\.co|opensea\.io|wa\.me|bit\.ly|tinyurl\.com|paragraph\.xyz|mirror\.xyz|substack\.com|medium\.com)$/i;

/** Is this https URL a playable video, per the spec's host list? */
export function isVideoUrl(s) {
  const u = httpsUrl(s);
  if (!u) return false;
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, "");
  const path = u.pathname.toLowerCase();
  if (host === "stream.farcaster.xyz") return true;
  if (/\.(m3u8|mp4)$/.test(path)) return true;
  if (host === "youtube.com" && (/^\/shorts\/[\w-]+/.test(path) || (path === "/watch" && u.searchParams.has("v")))) return true;
  if (host === "youtu.be" && /^\/[\w-]+/.test(path)) return true;
  if (host === "video.bsky.app") return true;
  if (host === "bsky.app" && /^\/profile\/[^/]+\/post\/[^/]+/.test(path)) return true;
  if (host === "media.firefly.land") return true;
  return false;
}

/** https://github.com/<owner>/<repo>, or null. */
export function repoUrl(s) {
  const u = httpsUrl(s);
  if (!u || u.hostname.toLowerCase().replace(/^www\./, "") !== "github.com") return null;
  const [owner, repo] = u.pathname.split("/").filter(Boolean);
  if (!owner || !repo || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
  if (["orgs", "settings", "sponsors", "marketplace", "topics", "features"].includes(owner.toLowerCase())) return null;
  return `https://github.com/${owner}/${repo.replace(/\.git$/i, "")}`;
}

/** A farcaster.xyz/<user>/0x… cast link (a vouch), or null. */
export function voucherUrl(s) {
  const u = httpsUrl(s);
  if (!u || u.hostname.toLowerCase().replace(/^www\./, "") !== "farcaster.xyz") return null;
  return /^\/(?!~\/)[a-z0-9][a-z0-9._-]*\/0x[0-9a-f]{8,40}\/?$/i.test(u.pathname) ? s : null;
}

/** A project microsite: any https URL that is not a known platform, repo or media host. */
export function siteUrl(s) {
  const u = httpsUrl(s);
  if (!u || isVideoUrl(s)) return null;
  if (NOT_A_SITE.test(u.hostname.toLowerCase())) return null;
  if (/\.(png|jpe?g|gif|webp|svg|pdf)$/i.test(u.pathname)) return null;
  return s;
}

/** An x.com / twitter.com status link. */
export function xStatusUrl(s) {
  const u = httpsUrl(s);
  if (!u) return null;
  const host = u.hostname.toLowerCase().replace(/^www\.|^mobile\./, "");
  return (host === "x.com" || host === "twitter.com") && /^\/[^/]+\/status\/\d+/.test(u.pathname) ? s : null;
}

/** Is this a build prize (sites and repos count as entries)? */
export function isBuildPrize(prize) {
  if (!prize) return false;
  if (prize.id === "clients") return true;
  return BUILD_WORDS.test(`${prize.deliverable || ""}`);
}

/** Seconds stated in the text: "54 s", "54s", "54 sec", "54 seconds". */
export function statedSeconds(text) {
  const m = /(?:^|[^\w$.,:])(\d{1,3})\s?(?:s|sec|secs|seconds?)\b/i.exec(clean(text));
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 1 && n <= 600 ? n : undefined;
}

function hostLabel(s) {
  const u = httpsUrl(s);
  return u ? u.hostname.toLowerCase().replace(/^www\./, "") : "";
}

function nameFrom(repo, site) {
  if (repo) return repo.split("/").pop().slice(0, 80);
  if (site) return hostLabel(site).slice(0, 80);
  return undefined;
}

/**
 * Classify a reply to a prize cast. Returns a contract Submission, or null when
 * the reply is conversation ("Gm", emoji, promo links, plain comments).
 */
export function classifyReply(message, prize) {
  const body = castBody(message);
  const hash = messageHash(message);
  const fid = message?.data?.fid;
  if (!body || !hash || !Number.isInteger(fid) || fid <= 0 || !Number.isInteger(message.data.timestamp)) return null;
  if (!prize || !prize.chapter) return null;
  // The prize's own author (thread updates) and results posts are not entries.
  if (fid === prize.authorFid) return null;
  if (isResults(message, { watchedFids: [fid] })) return null;

  const text = clean(body.text);
  const embedUrls = (Array.isArray(body.embeds) ? body.embeds : [])
    .map((e) => (e && typeof e.url === "string" ? e.url.trim() : null))
    .filter((u) => u && httpsUrl(u) && /^https:\/\//.test(u) && !/[\s<>"']/.test(u));
  const textUrls = urlsInText(text).filter((u) => !embedUrls.includes(u));
  const all = [...embedUrls, ...textUrls];

  const base = {
    hash,
    fid,
    postedAt: toISO(message.data.timestamp),
    chapter: prize.chapter,
  };
  const finish = (s) => {
    const out = { ...base, ...s, url: `https://farcaster.xyz/~/conversations/${hash}` };
    if (AI_DISCLOSED.test(text)) out.ai = true;
    return out;
  };

  const build = isBuildPrize(prize);
  const promo = PROMO_WORDS.test(text);

  if (build) {
    const repo = all.map(repoUrl).find(Boolean);
    const site = promo ? undefined : all.map(siteUrl).find(Boolean);
    if (repo || site) {
      const voucher = all.map(voucherUrl).find(Boolean);
      const keep = all.filter((u) => embedUrls.includes(u) || u === site || repoUrl(u) === repo || u === voucher);
      const name = nameFrom(repo, site);
      const s = { kind: "site", gloss: `Build entry: ${name}`, embeds: keep, name };
      if (site) s.site = site;
      if (repo) s.repo = repo;
      if (voucher) s.voucher = voucher;
      return finish(s);
    }
  }

  const video = all.find(isVideoUrl);
  if (video) {
    const seconds = statedSeconds(text);
    const s = { kind: "video", gloss: seconds ? `Video entry, ${seconds} seconds` : "Video entry", embeds: embedUrls.includes(video) ? embedUrls : [...embedUrls, video] };
    if (seconds) s.seconds = seconds;
    return finish(s);
  }

  const x = all.map(xStatusUrl).find(Boolean);
  if (x && ENTRY_WORDS.test(text) && !promo) {
    return finish({ kind: "link", gloss: "Entry hosted off-platform", embeds: embedUrls.includes(x) ? embedUrls : [...embedUrls, x] });
  }

  return null;
}
