// I3: submission classification from replies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSubmission } from "../../contract/validate.mjs";
import { classifyReply, isBuildPrize, isVideoUrl } from "../src/classify.mjs";
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
