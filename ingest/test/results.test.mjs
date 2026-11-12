// I4: results parsing marks winners by hash prefix (or site), in order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseResults, poolTiers } from "../src/results.mjs";
import { byHash, fixture, seedPrizes, seedSubmissions } from "./helpers.mjs";

const prizes = Object.fromEntries(seedPrizes().map((p) => [p.id, p]));
const subs = seedSubmissions();
const subsFor = (chapter) => subs.filter((s) => s.chapter === chapter);
const fid1 = fixture("casts-fid1.json").messages;
const civilityPost = byHash(fid1, prizes.civility.results.castHash).data.castAddBody.text;
const clientsPost = byHash(fid1, prizes.clients.results.castHash).data.castAddBody.text;

test("the civility results post: farcaster.xyz/<user>/0x<prefix> links → the seed's winners, in order", () => {
  // The link list is rebuilt from the seed's results: one link per winner, 8-hex prefixes.
  for (const pl of prizes.civility.results.places) assert.ok(civilityPost.includes(`${pl.label.slice(1)}/${pl.submission.slice(0, 10)}`), pl.label);
  const r = parseResults(civilityPost, subsFor("friend-speech"), { pool: prizes.civility.pool });
  assert.deepEqual(r.places, prizes.civility.results.places);
  assert.deepEqual(r.unmatched, []);
});

test("the clients results post names projects by site → the seed's winners, in order", () => {
  for (const pl of prizes.clients.results.places) {
    const s = subs.find((x) => x.hash === pl.submission);
    assert.ok(clientsPost.includes(new URL(s.site).hostname), pl.label);
  }
  const r = parseResults(clientsPost, subsFor("exit"), { pool: prizes.clients.pool });
  assert.deepEqual(r.places, prizes.clients.results.places);
  assert.deepEqual(r.unmatched, []);
});

test("order decides the place: 1st, 2nd, then honorable mentions", () => {
  const text = "Thank you to everyone who submitted!\nfarcaster.xyz/tophb/0x894be0b8\nfarcaster.xyz/papa/0x780d71e5\nfarcaster.xyz/leoxcrane/0x165286a2\nfarcaster.xyz/zatweirdaj/0xe8115efc";
  const r = parseResults(text, subsFor("friend-speech"));
  assert.deepEqual(r.places.map((p) => [p.place, p.label]), [["1st", "@tophb"], ["2nd", "@papa"], ["hm", "@leoxcrane"], ["hm", "@zatweirdaj"]]);
  assert.ok(r.places.every((p) => !("amount" in p)), "no amount without a pool or an amount on the line");
});

test("prefix matching: 8+ hex, full links, duplicates, unknown prefixes", () => {
  const text = [
    "Thank you to everyone who submitted",
    "https://farcaster.xyz/papa/0x780d71e5b43cfe009ffcaf5ff0ac234bb711a927",
    "https://farcaster.xyz/papa/0x780d71e5", // same winner again
    "https://farcaster.xyz/~/conversations/0xe8115efcd588df484ae497103e5b70e0f6c5cfa3",
    "https://farcaster.xyz/nobody/0xdeadbeef", // no such submission
    "https://farcaster.xyz/short/0x894be0b", // 7 hex: too short to trust
    "https://farcaster.xyz/balajis.eth/0x376e0450", // the prize cast itself
  ].join("\n");
  const r = parseResults(text, subsFor("friend-speech"));
  assert.deepEqual(r.places.map((p) => p.submission), ["0x780d71e5b43cfe009ffcaf5ff0ac234bb711a927", "0xe8115efcd588df484ae497103e5b70e0f6c5cfa3"]);
  assert.deepEqual(r.places.map((p) => p.label), ["@papa", "fid 1075315"], "a ~/conversations link has no username; the label falls back to the fid");
  assert.deepEqual(
    r.unmatched.map((u) => u.reason),
    ["no submission with this hash prefix", "not a submission link", "no submission with this hash prefix"],
  );
});

test("pool tiers supply amounts; a pool with runners-up and no second prize has no 2nd place", () => {
  assert.deepEqual(poolTiers(prizes.civility.pool), { "1st": "$1,024", "2nd": "$512", hm: "$128" });
  assert.deepEqual(poolTiers(prizes["network-state-visuals"].pool), { "1st": "$500", hm: "$100" });
  assert.deepEqual(poolTiers(prizes.tiebout.pool), { "1st": "$512", hm: "$128" });
  const feet = subsFor("feet").filter((s) => s.kind === "video").slice(0, 3);
  const text = `Thank you to everyone who submitted!\n${feet.map((s) => `farcaster.xyz/x/${s.hash.slice(0, 10)}`).join("\n")}`;
  const r = parseResults(text, subsFor("feet"), { pool: prizes.tiebout.pool });
  assert.deepEqual(r.places.map((p) => [p.place, p.amount]), [["1st", "$512"], ["hm", "$128"], ["hm", "$128"]]);
});

test("one more set of winners continues after existing places", () => {
  const text = "One more set of winners:\nfarcaster.xyz/tophb/0x894be0b8\nfarcaster.xyz/papa/0x780d71e5";
  const existing = [{ place: "1st", submission: "0x780d71e5b43cfe009ffcaf5ff0ac234bb711a927" }, { place: "2nd", submission: "0xe8115efcd588df484ae497103e5b70e0f6c5cfa3" }];
  const r = parseResults(text, subsFor("friend-speech"), { existing });
  assert.deepEqual(r.places.map((p) => [p.place, p.submission]), [["hm", "0x894be0b8cb3ec04bf401b813f2ab58f67078d587"]]);
});

test("sites: a resubmitting author's latest entry wins; different authors on one host are ambiguous", () => {
  // sats100m.github.io/farcaster-in-3 was submitted twice by the same fid.
  const r = parseResults("Thank you to everyone who submitted: sats100m.github.io/farcaster-in-3", subsFor("exit"));
  assert.deepEqual(r.places.map((p) => p.submission), ["0x674a08d9b101e34b565bc850ee3a6bc845d5991d"]);
  const twins = [
    { hash: "0x" + "a".repeat(40), fid: 1001, postedAt: "2026-10-20T00:00:00Z", chapter: "exit", kind: "site", site: "https://shared.example.dev/a" },
    { hash: "0x" + "b".repeat(40), fid: 1002, postedAt: "2026-10-21T00:00:00Z", chapter: "exit", kind: "site", site: "https://shared.example.dev/b" },
  ];
  const amb = parseResults("Winner: shared.example.dev", twins);
  assert.deepEqual(amb.places, []);
  assert.equal(amb.unmatched[0].reason, "ambiguous site");
  const exact = parseResults("Winner: https://shared.example.dev/b", twins);
  assert.deepEqual(exact.places.map((p) => p.submission), ["0x" + "b".repeat(40)]);
  const sub = parseResults("Winner: docs.phunk.social.example.org and xkite.sahban.dev", subsFor("exit"));
  assert.deepEqual(sub.places, [], "host names only match whole");
});
