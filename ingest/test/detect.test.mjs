// I2: prize detection from watched-author casts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateInline, validatePrize } from "../../contract/validate.mjs";
import {
  chapterIdFor,
  deadlineDays,
  derivePrize,
  draftTitle,
  firstAmount,
  headlineTopic,
  isPrize,
  isPrizeHeadline,
  isResults,
} from "../src/detect.mjs";
import { byHash, cast, meta, seedPrizes, watchedCasts } from "./helpers.mjs";

const watchedFids = meta().provenance.watchedFids;
const casts = watchedCasts();
const seed = seedPrizes();
const prizesInSeed = seed.filter((p) => p.kind === "prize");

test("fixtures carry the real headline of every seed prize, by its real hash", () => {
  for (const p of seed) assert.equal(byHash(casts, p.castHash).data.castAddBody.text.split("\n")[0], p.headline, p.id);
});

test("the real prize headlines are detected", () => {
  const named = [
    "Cloud Cartography: $1000 Prize",
    "$1000 Prize for AI Conference Organizer",
    "$1000 FOR NETWORK STATE VISUALS",
    "$2048 FOR FARCASTER CLIENTS",
    "$1024 IN PRIZES FOR VIDEOS ON TIEBOUT SORTING",
  ];
  for (const h of named) {
    assert.ok(seed.some((p) => p.headline === h), `seed has ${h}`);
    assert.ok(isPrizeHeadline(h), h);
  }
  for (const p of prizesInSeed) assert.equal(isPrize(byHash(casts, p.castHash), { watchedFids }), true, p.headline);
});

test("the Elias prize is fid 37 replying to its own announcement", () => {
  const m = byHash(casts, "0x376e04509f3f9eab6a2b506519bf303349ac87a7");
  assert.equal(m.data.castAddBody.parentCastId.fid, 37);
  assert.equal(isPrize(m, { watchedFids }), true);
  assert.equal(derivePrize(m, { seedPrizes: seed }).parentHash, "0xcd34bb7404d899df69fda5e8ca17d3f1aa1e9268");
});

test("non-prizes are excluded", () => {
  const poidh = byHash(casts, "0x5e70000000000000000000000000000000000002");
  assert.equal(poidh.data.castAddBody.text, "I just added to 's /poidh bounty!");
  assert.equal(isPrize(poidh, { watchedFids }), false, "poidh bounty note");
  assert.equal(isPrize(byHash(casts, "0x5e70000000000000000000000000000000000003"), { watchedFids }), false, "plain reply to another user, even with a $N FOR line");
  assert.equal(isPrize(byHash(casts, "0x5e70000000000000000000000000000000000006"), { watchedFids }), false, "gm reply");
  assert.equal(isPrize(byHash(casts, "0x5e70000000000000000000000000000000000005"), { watchedFids }), false, "book club note");
  assert.equal(isPrize(byHash(casts, "0x83c734e1985ad2b6f28bea2938a750981740a093"), { watchedFids }), false, "acquisition announcement");
  for (const h of ["0xb60e878ddcad01e9fcf5c5a46e65dcb735ea4533", "0xbe63072aee374bd26dda89128b141cb389e45d1a"]) {
    assert.equal(isPrize(byHash(casts, h), { watchedFids }), false, "results posts are not prizes");
  }
  const spoof = cast({ fid: 9999, hash: "0x5e70000000000000000000000000000000000901", text: "$5000 FOR FARCASTER CLIENTS" });
  assert.equal(isPrize(spoof, { watchedFids }), false, "unwatched author");
  const removed = cast({ fid: 1, hash: "0x5e70000000000000000000000000000000000902", type: "MESSAGE_TYPE_CAST_REMOVE" });
  assert.equal(isPrize(removed, { watchedFids }), false, "not a CAST_ADD");
  const badHash = cast({ fid: 1, hash: "0xZZ", text: "$100 FOR TESTS" });
  assert.equal(isPrize(badHash, { watchedFids }), false, "malformed hash");
  const lower = cast({ fid: 1, hash: "0x5e70000000000000000000000000000000000903", text: "The winners of the prize will be announced soon" });
  assert.equal(isPrize(lower, { watchedFids }), false, "lowercase 'prize' in prose");
  const parentUrl = cast({ fid: 1, hash: "0x5e70000000000000000000000000000000000904", parentUrl: "https://example.com/channel", text: "$64 FOR TEST VIDEOS" });
  assert.equal(isPrize(parentUrl, { watchedFids }), true, "a channel cast (parentUrl) counts as top-level");
});

test("award and winners announcements with a caps PRIZE are not prizes: a prize names $N in one of the SPEC forms", () => {
  const fp = byHash(casts, "0xf454b8d3e5ee2c9252a0b7574ad4942e9ba502d2");
  assert.equal(fp.data.castAddBody.text.split("\n")[0], "THE FARCASTER PRIZE");
  assert.equal(isPrize(fp, { watchedFids }), false, "the real award announcement");
  const announcement = byHash(casts, "0xcd34bb7404d899df69fda5e8ca17d3f1aa1e9268");
  assert.equal(isPrize(announcement, { watchedFids }), false, "THE RESTORATION OF FRIEND SPEECH ($2048 PRIZE): an announcement, not the prize");
  const at = (n) => `0x5e70000000000000000000000000000000000a${String(n).padStart(2, "0")}`;
  for (const [i, text] of ["THE SECOND FARCASTER PRIZE\n\nThe second Farcaster Prize goes to …", "TIEBOUT PRIZE WINNERS\n\nfarcaster.xyz/a/0x12345678", "THE COMMONS ($1024 PRIZE)", "$1024 PRIZE POOL ANNOUNCED SOON"].entries()) {
    assert.equal(isPrize(cast({ fid: 37, hash: at(i), text }), { watchedFids }), false, text);
  }
  for (const h of ["$2048 FOR FARCASTER CLIENTS", "$1024 IN PRIZES FOR VIDEOS ON TIEBOUT SORTING", "$1000 Prize for AI Conference Organizer", "Cloud Cartography: $1000 Prize", "$64 for test videos"]) {
    assert.equal(isPrizeHeadline(h), true, h);
  }
  for (const h of ["THE FARCASTER PRIZE", "PRIZE FOR VIDEOS", "Prize for the best video", "FOR CLIENTS: $1000", "$1000 TO THE WINNERS"]) assert.equal(isPrizeHeadline(h), false, h);
  // A seed match still keeps its kind and id when derived.
  const p = derivePrize(fp, { seedPrizes: seed });
  assert.equal(p.kind, "announcement");
  assert.equal(p.id, "farcaster-prize");
  assert.equal(p.chapter, undefined);
});

test("only the first line is a headline; a reply to the other watched author is not top-level", () => {
  const below = cast({ fid: 1, hash: "0x5e70000000000000000000000000000000000b01", text: "Some news first.\n$100 FOR TEST VIDEOS" });
  assert.equal(isPrize(below, { watchedFids }), false, "a prize phrase below line 1");
  const crossReply = cast({ fid: 1, hash: "0x5e70000000000000000000000000000000000b02", parent: { fid: 37, hash: "0x50184b62b4c52fd76628713562e1eda3dccaf63d" }, text: "$100 FOR TEST VIDEOS" });
  assert.equal(isPrize(crossReply, { watchedFids }), false, "fid 1 replying to fid 37");
  const selfReply = cast({ fid: 1, hash: "0x5e70000000000000000000000000000000000b03", parent: { fid: 1, hash: "0x5e70000000000000000000000000000000000b04" }, text: "$100 FOR TEST VIDEOS" });
  assert.equal(isPrize(selfReply, { watchedFids }), true, "a reply to the author's own cast");
});

test("network headlines are plain text", () => {
  const m = cast({ fid: 1, hash: "0x5e70000000000000000000000000000000000b05", text: "$64 FOR <script>alert(1)</script> {{sub:0x780d71e5b43cfe009ffcaf5ff0ac234bb711a927}} [x](javascript:alert(1)) *now*\nMake a video." });
  const p = derivePrize(m, { seedPrizes: [] });
  assert.ok(!/[<>[\]{}*]/.test(p.headline), p.headline);
  assert.deepEqual(validatePrize(p), []);
});

test("results posts", () => {
  assert.equal(isResults(byHash(casts, "0xb60e878ddcad01e9fcf5c5a46e65dcb735ea4533"), { watchedFids }), true);
  assert.equal(isResults(byHash(casts, "0xbe63072aee374bd26dda89128b141cb389e45d1a"), { watchedFids }), true);
  assert.equal(isResults(cast({ fid: 37, hash: "0x5e70000000000000000000000000000000000905", text: "One more set of winners: farcaster.xyz/a/0x12345678" }), { watchedFids }), true);
  assert.equal(isResults(cast({ fid: 4242, hash: "0x5e70000000000000000000000000000000000906", text: "Thank you to everyone who submitted!" }), { watchedFids }), false, "unwatched author");
  assert.equal(isResults(byHash(casts, "0x50184b62b4c52fd76628713562e1eda3dccaf63d"), { watchedFids }), false);
  const capsResults = cast({ fid: 1, hash: "0x5e70000000000000000000000000000000000908", text: "Thank you to everyone who submitted for THE FARCASTER PRIZE: farcaster.xyz/a/0x12345678" });
  assert.equal(isResults(capsResults, { watchedFids }), true);
  assert.equal(isPrize(capsResults, { watchedFids }), false, "a results post naming a PRIZE is still not a prize");
  // The live clients results wording has a prize headline form in its first line.
  const live = cast({ fid: 1, hash: "0x5e70000000000000000000000000000000000909", text: "Thank you to everyone who submitted, tested, and engaged with the $2048 FOR FARCASTER CLIENTS prize!\n\n1st ($2,048): https://farcaster.0xabhii.xyz" });
  assert.equal(isPrizeHeadline(live.data.castAddBody.text.split("\n")[0]), false, "a thank-you first line is never a prize headline, even when it repeats the prize's $N FOR title");
  assert.equal(isResults(live, { watchedFids }), true);
  assert.equal(isPrize(live, { watchedFids }), false, "results posts are never prizes");
  // The Tiebout results (2026-11-13, 0x3528d5aa…) opened "…who made submissions for…" and were read as a new prize.
  const tiebout = cast({
    fid: 1,
    hash: "0x3528d5aa368f08efcf37cd31a73fe63cb2fad5b0",
    text: "Thank you to everyone who made submissions for the $1024 FOR VIDEOS ON TIEBOUT SORTING prize! 46 video entries came in on time, so picking just five was hard.\n\nPrizes are headed to each winner's Farcaster wallet.\n\n1st place, $512: farcaster.xyz/chriscocreated/0xa940defb",
  });
  assert.equal(isResults(tiebout, { watchedFids }), true, "made-submissions wording is a results post");
  assert.equal(isPrize(tiebout, { watchedFids }), false);
  assert.equal(isPrizeHeadline(tiebout.data.castAddBody.text.split("\n")[0]), false);
  for (const t of ["Thank you all for the entries! farcaster.xyz/a/0x12345678", "The winners are in: farcaster.xyz/a/0x12345678", "Congrats to the winners of the $1024 FOR VIDEOS ON X prize"]) {
    const m = cast({ fid: 1, hash: "0x5e70000000000000000000000000000000000910", text: t });
    assert.equal(isResults(m, { watchedFids }), true, t);
    assert.equal(isPrize(m, { watchedFids }), false, t);
  }
  // real prize headlines still pass
  for (const h of ["$1024 IN PRIZES FOR VIDEOS ON ALBION'S SEED", "$2048 FOR FARCASTER CLIENTS", "Cloud Cartography: $1000 Prize"]) assert.equal(isPrizeHeadline(h), true, h);
});

test("seed prizes keep their ids and chapter ids; fields derive from the cast", () => {
  for (const s of prizesInSeed) {
    const p = derivePrize(byHash(casts, s.castHash), { seedPrizes: seed });
    assert.equal(p.id, s.id);
    assert.equal(p.chapter, s.chapter);
    assert.equal(p.headline, s.headline);
    assert.equal(p.postedAt, s.postedAt);
    assert.equal(p.authorFid, s.authorFid);
    assert.equal(p.deadline, s.deadline, `${s.id}: deadline parsed from the text`);
    assert.deepEqual(validatePrize(p), [], s.id);
  }
});

test("chapter ids from headlines, without the seed", () => {
  const ids = Object.fromEntries(prizesInSeed.map((s) => [s.id, derivePrize(byHash(casts, s.castHash), { seedPrizes: [] }).chapter]));
  assert.equal(ids["cloud-cartography"], "cloud-cartography");
  assert.equal(ids["ai-conference-organizer"], "ai-conference-organizer");
  assert.equal(ids["network-state-visuals"], "network-state-visuals");
  assert.equal(ids.clients, "farcaster-clients");
  assert.equal(ids.tiebout, "tiebout-sorting");
  assert.equal(ids.civility, "norbert-elias-civility");
  assert.equal(ids.nordhoff, "communistic-societies-of-the-united-states");
  assert.equal(headlineTopic("THE RESTORATION OF FRIEND SPEECH ($2048 PRIZE)"), "RESTORATION OF FRIEND SPEECH");
  assert.equal(chapterIdFor("$100 FOR COVER", "0xabcdef0000000000000000000000000000000000"), "cover-abcdef", "reserved ids get a hash suffix");
  assert.equal(chapterIdFor("$100 FOR THE END", "0x1234560000000000000000000000000000000000"), "end-pick");
  assert.equal(chapterIdFor("$100 FOR TIEBOUT SORTING", "0x1234560000000000000000000000000000000000", new Set(["tiebout-sorting"])), "tiebout-sorting-123456");
});

test("titles: Title Case, ≤ 40 chars", () => {
  assert.equal(draftTitle("$1000 FOR NETWORK STATE VISUALS"), "Network State Visuals");
  assert.equal(draftTitle("$1000 Prize for AI Conference Organizer"), "AI Conference Organizer");
  assert.equal(draftTitle("Cloud Cartography: $1000 Prize"), "Cloud Cartography");
  assert.equal(draftTitle("$2048 IN PRIZES FOR VIDEOS ON NORBERT ELIAS & CIVILITY"), "Norbert Elias & Civility");
  const long = draftTitle("$1024 IN PRIZES FOR VIDEOS ON THE COMMUNISTIC SOCIETIES OF THE UNITED STATES");
  assert.ok(long.length <= 40, long);
  assert.match(long, /^Communistic Societies of the/);
});

test("deadline, pool, deliverable", () => {
  assert.equal(deadlineDays("You have seven days."), 7);
  assert.equal(deadlineDays("Reply within three days"), 3);
  assert.equal(deadlineDays("Deadline: 5 days from now"), 5);
  assert.equal(deadlineDays("one week to submit"), 7);
  assert.equal(deadlineDays("59 seconds, no deadline given"), 3, "default 3");
  assert.equal(firstAmount("$2048 FOR FARCASTER CLIENTS"), "$2,048");
  assert.equal(firstAmount("Cloud Cartography: $1000 Prize"), "$1,000");
  const p = derivePrize(byHash(casts, "0x2ba04801ad21047363138d58a3b4e5f0dabe7942"), { seedPrizes: [] });
  assert.equal(p.pool, "$1,024");
  assert.equal(p.series, "Book club pick #2");
  assert.ok(p.deliverable.length <= 600);
  assert.ok(!p.deliverable.includes("$1024 IN PRIZES"), "the headline is not part of the deliverable");
});

test("deliverables from untrusted text are plain: no HTML, links or citation markup", () => {
  const m = cast({
    fid: 1,
    hash: "0x5e70000000000000000000000000000000000907",
    text: "$64 FOR TEST VIDEOS\n<script>alert(1)</script> Make a [video](https://evil.example) about {{sub:0x1}} things. *Really* do it.",
  });
  const p = derivePrize(m, { seedPrizes: [] });
  assert.deepEqual(validateInline(p.deliverable, "deliverable"), []);
  assert.ok(!/[<>[\]{}*]/.test(p.deliverable), p.deliverable);
  assert.deepEqual(validatePrize(p), []);
});
