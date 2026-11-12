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

test("caps PRIZE casts are prizes by the rule; seed matches keep their kind and id", () => {
  const fp = byHash(casts, "0xf454b8d3e5ee2c9252a0b7574ad4942e9ba502d2");
  assert.equal(isPrize(fp, { watchedFids }), true);
  const p = derivePrize(fp, { seedPrizes: seed });
  assert.equal(p.kind, "announcement");
  assert.equal(p.id, "farcaster-prize");
  assert.equal(p.chapter, undefined);
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
