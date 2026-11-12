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

// Places come from the labels in the post, so a link that matches nothing (or two
// submissions) never moves another winner up.
test("the real civility post with the 2nd-place entry missing: the honorable mentions stay hm, at $128", () => {
  const missing = subsFor("friend-speech").filter((s) => !s.hash.startsWith("0xe8115efc"));
  const r = parseResults(civilityPost, missing, { pool: prizes.civility.pool });
  assert.deepEqual(
    r.places.map((p) => [p.place, p.amount, p.label]),
    [["1st", "$1,024", "@papa"], ["hm", "$128", "@tophb"], ["hm", "$128", "@leoxcrane"]],
  );
  assert.deepEqual(r.unmatched, [{ link: "farcaster.xyz/zatweirdaj/0xe8115efc", reason: "no submission with this hash prefix" }]);
  assert.deepEqual(r.ambiguous, []);
});

test("an ambiguous 8-hex prefix is not assigned, is reported, and moves no one", () => {
  const civ = subsFor("friend-speech");
  const second = civ.find((s) => s.hash.startsWith("0xe8115efc"));
  const twin = { ...second, hash: `0xe8115efc${"0".repeat(32)}`, fid: 4242 };
  const r = parseResults(civilityPost, [...civ, twin], { pool: prizes.civility.pool });
  assert.deepEqual(r.places.map((p) => [p.place, p.label]), [["1st", "@papa"], ["hm", "@tophb"], ["hm", "@leoxcrane"]]);
  assert.ok(!r.places.some((p) => p.submission === second.hash || p.submission === twin.hash), "neither twin is placed");
  assert.deepEqual(r.ambiguous, [{ link: "farcaster.xyz/zatweirdaj/0xe8115efc", reason: "ambiguous hash prefix", candidates: [twin.hash, second.hash].sort() }]);
  assert.deepEqual(r.unmatched.map((u) => u.reason), ["ambiguous hash prefix"]);

  // A post with no labels at all is read in order, and the ambiguous link still holds its slot.
  const feet = subsFor("feet").filter((s) => s.kind === "video");
  const twins = [0, 1].map((i) => ({ ...feet[0], hash: `0xabcdef01${String(i).repeat(32)}` }));
  const text = `Thank you to everyone who submitted!\nfarcaster.xyz/a/0xabcdef01\nfarcaster.xyz/b/${feet[1].hash.slice(0, 10)}\nfarcaster.xyz/c/${feet[2].hash.slice(0, 10)}`;
  const ordered = parseResults(text, [...feet, ...twins], { pool: prizes.tiebout.pool });
  assert.deepEqual(ordered.places.map((p) => [p.place, p.amount, p.submission]), [["hm", "$128", feet[1].hash], ["hm", "$128", feet[2].hash]], "1st stays with the ambiguous link");
  assert.equal(ordered.ambiguous.length, 1);
});

test("an unknown link in an unlabeled post keeps its slot", () => {
  const text = "Thank you to everyone who submitted!\nfarcaster.xyz/papa/0x780d71e5\nfarcaster.xyz/zatweirdaj/0xdeadbeef\nfarcaster.xyz/tophb/0x894be0b8";
  const r = parseResults(text, subsFor("friend-speech"), { pool: prizes.civility.pool });
  assert.deepEqual(r.places.map((p) => [p.place, p.amount, p.label]), [["1st", "$1,024", "@papa"], ["hm", "$128", "@tophb"]], "tophb was an honorable mention, not 2nd");
  assert.deepEqual(r.unmatched.map((u) => u.link), ["farcaster.xyz/zatweirdaj/0xdeadbeef"]);
});

test("labels decide the place, not the order the links come in", () => {
  const text = [
    "Thank you to everyone who submitted!",
    "Honourable mentions: farcaster.xyz/tophb/0x894be0b8 and farcaster.xyz/leoxcrane/0x165286a2",
    "Second: farcaster.xyz/zatweirdaj/0xe8115efc",
    "First place: farcaster.xyz/papa/0x780d71e5",
  ].join("\n");
  const r = parseResults(text, subsFor("friend-speech"), { pool: prizes.civility.pool });
  assert.deepEqual(
    r.places.map((p) => [p.place, p.amount, p.label]),
    [["hm", "$128", "@tophb"], ["hm", "$128", "@leoxcrane"], ["2nd", "$512", "@zatweirdaj"], ["1st", "$1,024", "@papa"]],
  );
  // HM, 1st and 2nd as short labels; a label after a link on its line is that link's own; the amount on the label's line wins.
  const short = "Thank you to everyone who submitted!\nfarcaster.xyz/tophb/0x894be0b8 (HM)\nfarcaster.xyz/papa/0x780d71e5 — 1st ($1,000)\nfarcaster.xyz/zatweirdaj/0xe8115efc (2nd)";
  assert.deepEqual(
    parseResults(short, subsFor("friend-speech"), { pool: prizes.civility.pool }).places.map((p) => [p.place, p.amount, p.label]),
    [["hm", "$128", "@tophb"], ["1st", "$1,000", "@papa"], ["2nd", "$512", "@zatweirdaj"]],
  );
});

test("'first' in prose is not a label; a link with no label in a labelled post is reported, not placed", () => {
  const prose = "Thank you to everyone who submitted to our first prize! farcaster.xyz/papa/0x780d71e5\nfarcaster.xyz/tophb/0x894be0b8";
  assert.deepEqual(parseResults(prose, subsFor("friend-speech")).places.map((p) => [p.place, p.label]), [["1st", "@papa"], ["2nd", "@tophb"]]);
  const text = "Thank you to everyone who submitted! farcaster.xyz/papa/0x780d71e5\nHonorable mention: farcaster.xyz/tophb/0x894be0b8";
  const r = parseResults(text, subsFor("friend-speech"), { pool: prizes.civility.pool });
  assert.deepEqual(r.places.map((p) => [p.place, p.label]), [["hm", "@tophb"]]);
  assert.deepEqual(r.unmatched, [{ link: "farcaster.xyz/papa/0x780d71e5", reason: "no place label for this link" }]);
});

test("the live clients wording (https links, a path after the host) gives the seed's winners", () => {
  const text = "Thank you to everyone who submitted, tested, and engaged with the $2048 FOR FARCASTER CLIENTS prize!\n\n1st ($2,048): https://farcaster.0xabhii.xyz\n2nd ($512): https://docs.phunk.social\nHonorable mentions ($128): https://kite.sahban.dev/guide and https://antonpecherkin.github.io/runfcx";
  const r = parseResults(text, subsFor("exit"), { pool: prizes.clients.pool });
  assert.deepEqual(r.places, prizes.clients.results.places);
  assert.deepEqual(r.unmatched, []);
});

test("a prefix must start the hash; links to the prize itself are skipped when ignored", () => {
  const papa = "0x780d71e5b43cfe009ffcaf5ff0ac234bb711a927";
  const middle = `0x${papa.slice(10, 18)}`; // 8 hex from the middle of papa's hash
  const r = parseResults(`Thank you to everyone who submitted!\nfarcaster.xyz/papa/${middle}`, subsFor("friend-speech"));
  assert.deepEqual(r.places, []);
  assert.deepEqual(r.unmatched.map((u) => u.reason), ["no submission with this hash prefix"]);
  const withPrize = "Thank you to everyone who submitted to farcaster.xyz/balajis.eth/0x376e0450 !\nfarcaster.xyz/papa/0x780d71e5\nfarcaster.xyz/tophb/0x894be0b8";
  const ignored = parseResults(withPrize, subsFor("friend-speech"), { pool: prizes.civility.pool, ignore: [prizes.civility.castHash] });
  assert.deepEqual(ignored.places.map((p) => [p.place, p.label]), [["1st", "@papa"], ["2nd", "@tophb"]]);
  assert.deepEqual(ignored.unmatched, []);
});
