// I3: submission classification from replies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSubmission } from "../../contract/validate.mjs";
import { classifyReply, isBuildPrize, isVideoUrl, MAX_EMBEDS } from "../src/classify.mjs";
import { safeUrl } from "../src/text.mjs";
import { cast, fixture, seedPrizes, seedSubmissions } from "./helpers.mjs";

const prizes = Object.fromEntries(seedPrizes().map((p) => [p.id, p]));
const subs = seedSubmissions();
const reply = (prize, over = {}) =>
  cast({ fid: 424242, hash: "0x5e70000000000000000000000000000000000a01", at: "2026-11-11T00:00:00Z", parent: { fid: prize.authorFid, hash: prize.castHash }, ...over });

test("build prizes: clients and the open-source 2024 tools; video prizes are not", () => {
  for (const id of ["clients", "cloud-cartography", "ai-conference-organizer", "network-state-visuals"]) assert.equal(isBuildPrize(prizes[id]), true, id);
  for (const id of ["civility", "tiebout", "nordhoff"]) assert.equal(isBuildPrize(prizes[id]), false, id);
});

test("video hosts → video", () => {
  const urls = {
    "stream.farcaster.xyz": "https://stream.farcaster.xyz/v1/video/01a1c1f6-cf80-4bba-c972-812a484972b1.m3u8",
    "any .m3u8": "https://cdn.example.net/hls/master.m3u8",
    ".mp4": "https://files.example.org/clip.mp4?sig=1",
    "youtube shorts": "https://youtube.com/shorts/abc_DEF-123",
    "youtube watch": "https://www.youtube.com/watch?v=abc123",
    "youtu.be": "https://youtu.be/abc123",
    "video.bsky.app": "https://video.bsky.app/watch/did%3Aplc%3Axyz/bafkrei/playlist.m3u8",
    "bsky post": "https://bsky.app/profile/someone.bsky.social/post/3kxyz",
    firefly: "https://media.firefly.land/post_m3u8/75240fe0/75240fe0.m3u8",
  };
  for (const [label, url] of Object.entries(urls)) {
    assert.equal(isVideoUrl(url), true, label);
    const s = classifyReply(reply(prizes.nordhoff, { embeds: [{ url }] }), prizes.nordhoff);
    assert.equal(s?.kind, "video", label);
    assert.deepEqual(s.embeds, [url]);
    assert.deepEqual(validateSubmission(s), [], label);
  }
  for (const url of ["https://youtube.com/@channel", "https://bsky.app/profile/someone", "http://stream.farcaster.xyz/v1/video/x.m3u8", "https://example.com/page"]) {
    assert.equal(isVideoUrl(url), false, url);
  }
});

test("video hosts count by host, not only by a .m3u8 suffix", () => {
  const byHost = {
    "stream.farcaster.xyz": "https://stream.farcaster.xyz/v1/video/01a1c1f6-cf80-4bba-c972-812a484972b1",
    "media.firefly.land": "https://media.firefly.land/post_video/75240fe0-b4f0-44a4-9a59-e14813f30f42",
    "video.bsky.app": "https://video.bsky.app/watch/did%3Aplc%3As7bw7bibbd4mwaq7v53plbcd/bafkreic23zmsbblb7gy6u7ltcp6npyznsorkxdij7owdrsbnau3hpw7oru",
  };
  for (const [label, url] of Object.entries(byHost)) {
    assert.ok(!/\.(m3u8|mp4)$/.test(new URL(url).pathname), `${label}: no suffix to fall back on`);
    assert.equal(isVideoUrl(url), true, label);
    assert.equal(classifyReply(reply(prizes.nordhoff, { embeds: [{ url }] }), prizes.nordhoff)?.kind, "video", label);
  }
  // 2024 videos were on stream.warpcast.com, by their .m3u8 path.
  const warpcast = "https://stream.warpcast.com/v1/video/1f6c2a4e-9d3b-4c1a-8e7f-0a1b2c3d4e5f.m3u8";
  assert.equal(isVideoUrl(warpcast), true);
  assert.equal(classifyReply(reply(prizes["network-state-visuals"], { text: "My submission", embeds: [{ url: warpcast }] }), prizes["network-state-visuals"])?.kind, "video");
  assert.equal(isVideoUrl("https://stream.farcaster.xyz.evil.example/v1/video/x"), false, "a look-alike host");
});

test("every real seed video entry classifies as video with the seed's hash, fid, time, chapter, embeds and url", () => {
  const videos = subs.filter((s) => s.kind === "video");
  assert.ok(videos.length > 50);
  for (const s of videos) {
    const prize = Object.values(prizes).find((p) => p.chapter === s.chapter);
    const m = cast({ fid: s.fid, hash: s.hash, at: s.postedAt, parent: { fid: prize.authorFid, hash: prize.castHash }, embeds: s.embeds.map((url) => ({ url })), text: "" });
    const got = classifyReply(m, prize);
    assert.equal(got?.kind, "video", s.hash);
    for (const k of ["hash", "fid", "postedAt", "chapter", "url"]) assert.equal(got[k], s[k], `${s.hash} ${k}`);
    assert.deepEqual(got.embeds, s.embeds);
    assert.equal(got.gloss, "Video entry");
    assert.deepEqual(validateSubmission(got), []);
  }
});

test("glosses are ours and neutral; seconds and AI disclosure are read from the text", () => {
  const replies = fixture("replies-nordhoff.json").messages;
  const [a, b, c, d] = replies.map((m) => classifyReply(m, prizes.nordhoff));
  assert.equal(a.gloss, "Video entry, 54 seconds");
  assert.equal(a.seconds, 54);
  assert.equal(a.ai, true);
  assert.equal(b.gloss, "Video entry, 57 seconds");
  assert.equal(b.ai, undefined);
  assert.equal(c.gloss, "Video entry");
  assert.equal(c.seconds, undefined);
  assert.equal(d.gloss, "Video entry, 49 seconds");
  assert.ok(!/Shakers|entry:/i.test(d.gloss.replace("Video entry", "")), "no author words in the gloss");
  const inText = classifyReply(reply(prizes.nordhoff, { text: "Mine: https://youtu.be/abc", embeds: [{ url: "https://imagedelivery.net/x/thumb/original" }] }), prizes.nordhoff);
  assert.deepEqual(inText.embeds, ["https://imagedelivery.net/x/thumb/original", "https://youtu.be/abc"], "a video linked in the text is kept");
  const fiftyNine = classifyReply(reply(prizes.nordhoff, { text: "Here is my 59-second video", embeds: [{ url: "https://youtu.be/x1" }] }), prizes.nordhoff);
  assert.equal(fiftyNine.seconds, undefined, "the prompt's '59-second' format is not a stated length");
});

test("site + repo on a build prize → site, with site, repo and voucher extracted", () => {
  const sites = subs.filter((s) => s.kind === "site" && s.embeds.length);
  assert.ok(sites.length >= 20);
  for (const s of sites) {
    // At most two URL embeds per cast; the rest are written in the text.
    const m = cast({
      fid: s.fid,
      hash: s.hash,
      at: s.postedAt,
      parent: { fid: prizes.clients.authorFid, hash: prizes.clients.castHash },
      embeds: s.embeds.slice(0, 2).map((url) => ({ url })),
      text: `My submission. ${s.embeds.slice(2).join(" ")}`,
    });
    const got = classifyReply(m, prizes.clients);
    assert.equal(got?.kind, "site", s.hash);
    assert.equal(got.site, s.site, `${s.hash} site`);
    assert.equal(got.repo, s.repo, `${s.hash} repo`);
    assert.equal(got.voucher, s.voucher, `${s.hash} voucher`);
    assert.match(got.gloss, /^Build entry: \S+/);
    assert.deepEqual(got.embeds, s.embeds, `${s.hash} embeds`);
    assert.deepEqual(validateSubmission(got), [], s.hash);
  }
  const textOnly = classifyReply(reply(prizes["cloud-cartography"], { text: "Entry: github.com/example-maps/cloudmap and https://cloudmap.example.dev/" }), prizes["cloud-cartography"]);
  assert.equal(textOnly.kind, "site");
  assert.equal(textOnly.repo, "https://github.com/example-maps/cloudmap");
  assert.equal(textOnly.site, "https://cloudmap.example.dev/");
  assert.equal(textOnly.name, "cloudmap");
  assert.equal(textOnly.gloss, "Build entry: cloudmap");
});

test("an x.com status link counts only when the text calls it an entry", () => {
  const url = "https://x.com/someone/status/2119561034826727591";
  const entry = classifyReply(reply(prizes.tiebout, { text: "My entry is on X, upload failed here", embeds: [{ url }] }), prizes.tiebout);
  assert.equal(entry.kind, "link");
  assert.equal(entry.gloss, "Entry hosted off-platform");
  assert.deepEqual(entry.embeds, [url]);
  assert.equal(classifyReply(reply(prizes.tiebout, { text: "Interesting thread", embeds: [{ url }] }), prizes.tiebout), null);
});

test("conversation is excluded: Gm, emoji, promo links, bare text, images, quotes", () => {
  const replies = fixture("replies-nordhoff.json").messages.slice(4);
  assert.equal(replies.length, 6);
  for (const m of replies) assert.equal(classifyReply(m, prizes.nordhoff), null, m.data.castAddBody.text || "quote");
  const cases = [
    ["Gm", []],
    ["gm gm ☀️", []],
    ["🔥", []],
    ["Claim your airdrop now", ["https://free-drop.example/claim"]],
    ["Free mint for prize hunters", ["https://mint.example/now"]],
    ["This is a thoughtful prompt, can't wait to see the entries", []],
    ["Check my profile", ["https://linktr.ee/someone"]],
  ];
  for (const [text, urls] of cases) {
    for (const prize of [prizes.clients, prizes.nordhoff]) {
      assert.equal(classifyReply(reply(prize, { text, embeds: urls.map((url) => ({ url })) }), prize), null, `${prize.id}: ${text}`);
    }
  }
});

test("a microsite on a video prize is not an entry", () => {
  assert.equal(classifyReply(reply(prizes.nordhoff, { text: "My notes", embeds: [{ url: "https://notes.example.dev/" }] }), prizes.nordhoff), null);
  // Even when the text calls it an entry, and even with a repo: only build prizes take sites.
  assert.equal(classifyReply(reply(prizes.nordhoff, { text: "My entry: https://notes.example.dev/ code at https://github.com/someone/notes" }), prizes.nordhoff), null);
});

test("promo links are conversation even when the text uses entry words", () => {
  for (const text of ["Free mint for every submission: https://mint.example/now", "Submit your wallet, claim your airdrop: https://free-drop.example/claim"]) {
    assert.equal(classifyReply(reply(prizes.clients, { text }), prizes.clients), null, text);
  }
});

test("the prize author's own replies and results posts are never entries", () => {
  const own = cast({ fid: 1, hash: "0x5e70000000000000000000000000000000000a02", parent: { fid: 1, hash: prizes.nordhoff.castHash }, embeds: [{ url: "https://youtu.be/x" }], text: "Example" });
  assert.equal(classifyReply(own, prizes.nordhoff), null);
  const results = cast({ fid: 7, hash: "0x5e70000000000000000000000000000000000a03", parent: { fid: 37, hash: prizes.clients.castHash }, text: "Thank you to everyone who submitted! https://kite.sahban.dev" });
  assert.equal(classifyReply(results, prizes.clients), null);
});

test("untrusted embeds: non-https and malformed URLs are ignored", () => {
  const m = reply(prizes.nordhoff, { embeds: [{ url: "javascript:alert(1)" }, { url: "http://cdn.example.net/a.mp4" }, { url: "not a url" }] });
  assert.equal(classifyReply(m, prizes.nordhoff), null);
  const mixed = classifyReply(reply(prizes.nordhoff, { embeds: [{ url: "http://cdn.example.net/a.mp4" }, { url: "https://cdn.example.net/b.mp4" }] }), prizes.nordhoff);
  assert.deepEqual(mixed.embeds, ["https://cdn.example.net/b.mp4"]);
});

import { repoUrl as _repoUrl } from "../src/classify.mjs";
test("replit projects count as repos (2024 prizes were built on Replit)", () => {
  assert.equal(_repoUrl("https://replit.com/@dexhunter/cloud-cartography?v=1"), "https://replit.com/@dexhunter/cloud-cartography");
  assert.equal(_repoUrl("https://replit.com/pricing"), null);
});

test("build prizes: a lone ordinary link is not an entry; a site needs a repo or the text calling it an entry", () => {
  const clients = prizes.clients;
  const news = classifyReply(reply(clients, { text: "<b>gm</b> great read https://www.theblock.co/news/x" }), clients);
  assert.equal(news, null, "a news article");
  assert.equal(classifyReply(reply(clients, { text: "my blog", embeds: [{ url: "https://someone.example/blog" }] }), clients), null, "a blog");
  for (const text of ["My entry: https://myclient.example.dev", "Submission for the prize https://myclient.example.dev", "Microsite: https://myclient.example.dev", "Tutorial and quickstart here https://myclient.example.dev"]) {
    const s = classifyReply(reply(clients, { text }), clients);
    assert.equal(s?.kind, "site", text);
    assert.equal(s.site, "https://myclient.example.dev");
  }
  const withRepo = classifyReply(reply(clients, { text: "here you go", embeds: [{ url: "https://myclient.example.dev" }, { url: "https://github.com/someone/myclient" }] }), clients);
  assert.equal(withRepo?.kind, "site", "a repo makes it an entry without entry words");
  assert.equal(withRepo.site, "https://myclient.example.dev");
  assert.equal(withRepo.repo, "https://github.com/someone/myclient");
  const replit = classifyReply(reply(prizes["cloud-cartography"], { text: "mine", embeds: [{ url: "https://replit.com/@someone/cloudmap" }] }), prizes["cloud-cartography"]);
  assert.equal(replit?.repo, "https://replit.com/@someone/cloudmap");
});

const HOSTILE_URLS = [
  "https://evil.example/a)](javascript:alert(1",
  "https://evil.example/{{sub:0x1}}/*x*/[a](b",
  'https://evil.example/a"onmouseover="alert(1)',
  "https://evil.example/a'b",
  "https://evil.example/a<b>",
  "https://evil.example/a\\b",
  "https://evil.example/a\tb",
  "https://evil.example/a\u202eb",
  `https://site.example/${"x".repeat(2049 - "https://site.example/".length)}`,
  `https://youtu.be/${"x".repeat(10_000)}`,
];

test("URLs from the network: over 2048 chars or with markup characters are dropped", () => {
  assert.equal(`https://site.example/${"x".repeat(2049 - "https://site.example/".length)}`.length, 2049);
  for (const bad of HOSTILE_URLS) {
    assert.equal(safeUrl(bad), null, bad.slice(0, 60));
    const asEmbed = classifyReply(reply(prizes.nordhoff, { embeds: [{ url: bad }, { url: "https://youtu.be/ok" }] }), prizes.nordhoff);
    assert.deepEqual(asEmbed.embeds, ["https://youtu.be/ok"], bad.slice(0, 60));
    // In text a URL ends at whitespace or a quote; whatever is kept must be safe.
    const inText = classifyReply(reply(prizes.clients, { text: `My submission: ${bad}` }), prizes.clients);
    for (const u of [...(inText?.embeds || []), inText?.site].filter(Boolean)) {
      assert.equal(safeUrl(u), u, `text: ${bad.slice(0, 60)} kept ${u.slice(0, 60)}`);
      assert.ok(u.length <= 2048);
    }
  }
  for (const bad of ["https://evil.example/a)](javascript:alert(1", "https://evil.example/{{sub:0x1}}/*x*/[a](b", HOSTILE_URLS[8], HOSTILE_URLS[9]]) {
    assert.equal(classifyReply(reply(prizes.clients, { text: `My submission: ${bad}` }), prizes.clients), null, `text: ${bad.slice(0, 60)}`);
  }
  const atLimit = `https://site.example/${"x".repeat(2048 - "https://site.example/".length)}`;
  assert.equal(atLimit.length, 2048);
  assert.equal(safeUrl(atLimit), atLimit);
  assert.equal(classifyReply(reply(prizes.clients, { text: `My submission: ${atLimit}` }), prizes.clients)?.site, atLimit);
  // Exact strings are kept (no re-serialization).
  assert.equal(safeUrl(" https://Example.com/a%20b?x=1#y "), "https://Example.com/a%20b?x=1#y");
});

test("embeds are de-duplicated and capped at 8, keeping the URL the entry rests on", () => {
  const dup = classifyReply(reply(prizes.nordhoff, { embeds: [{ url: "https://youtu.be/a" }, { url: "https://youtu.be/a" }] }), prizes.nordhoff);
  assert.deepEqual(dup.embeds, ["https://youtu.be/a"]);
  const many = Array.from({ length: 12 }, (_, i) => `https://img.example/${i}.png`);
  const capped = classifyReply(reply(prizes.nordhoff, { embeds: [...many, "https://youtu.be/late"].map((url) => ({ url })) }), prizes.nordhoff);
  assert.equal(MAX_EMBEDS, 8);
  assert.equal(capped.embeds.length, 8);
  assert.ok(capped.embeds.includes("https://youtu.be/late"), "the video is kept");
  assert.deepEqual(capped.embeds.slice(0, 7), many.slice(0, 7), "the cast's own embeds first, in order");
  const site = classifyReply(reply(prizes.clients, { embeds: many.map((url) => ({ url })), text: "My submission https://myclient.example.dev https://github.com/someone/myclient" }), prizes.clients);
  assert.equal(site.embeds.length, 8);
  assert.ok(site.embeds.includes("https://myclient.example.dev") && site.embeds.includes("https://github.com/someone/myclient"));
  assert.deepEqual(validateSubmission(site), []);
});

test("only a direct reply to the prize cast (hash and author) can be an entry", () => {
  const video = [{ url: "https://youtu.be/x" }];
  assert.equal(classifyReply(reply(prizes.nordhoff, { embeds: video }), prizes.nordhoff)?.kind, "video");
  const elsewhere = reply(prizes.nordhoff, { embeds: video, parent: { fid: 9, hash: "0x5e70000000000000000000000000000000000c09" } });
  assert.equal(classifyReply(elsewhere, prizes.nordhoff), null, "a reply to some other cast");
  const otherPrize = reply(prizes.nordhoff, { embeds: video, parent: { fid: prizes.tiebout.authorFid, hash: prizes.tiebout.castHash } });
  assert.equal(classifyReply(otherPrize, prizes.nordhoff), null, "a reply to another prize");
  const wrongFid = reply(prizes.nordhoff, { embeds: video, parent: { fid: 37, hash: prizes.nordhoff.castHash } });
  assert.equal(classifyReply(wrongFid, prizes.nordhoff), null, "the right hash under the wrong author");
  const topLevel = cast({ fid: 424242, hash: "0x5e70000000000000000000000000000000000c0a", embeds: video });
  assert.equal(classifyReply(topLevel, prizes.nordhoff), null, "not a reply at all");
  const upper = reply(prizes.nordhoff, { embeds: video, parent: { fid: 1, hash: prizes.nordhoff.castHash.toUpperCase().replace("0X", "0x") } });
  assert.equal(classifyReply(upper, prizes.nordhoff)?.kind, "video", "hash case does not matter");
});
