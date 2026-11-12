// I6: the refresh CLI (offline and against a local Snapchain stub) and the scheduled workflow.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateBook } from "../../contract/validate.mjs";
import { compile, NEW_KICKER, serialize } from "../src/compile.mjs";
import { personFromUserData } from "../src/refresh.mjs";
import { ROOT, cast, fixture, meta, readJson, runCli, sendJson, seedPeople, seedPrizes, seedSubmissions, stubServer } from "./helpers.mjs";

const NOW = "2026-11-12T17:00:00Z";
const tmp = (p) => mkdtempSync(join(tmpdir(), `primer-${p}-`));
const empty = { messages: [], nextPageToken: "" };

/** A Snapchain stub serving the fixtures. `fail(url)` → 503 for matching requests. */
function snapchain({ fail = () => false, extra = [] } = {}) {
  const fid1 = { messages: [...extra, ...fixture("casts-fid1.new-prize.json").messages, ...fixture("casts-fid1.json").messages], nextPageToken: "" };
  const replies = {
    "0x2ba04801ad21047363138d58a3b4e5f0dabe7942": fixture("replies-nordhoff.json"),
    "0x983ad3e340fbfef785e0705ff87c0e63c22bebc4": fixture("replies-cloud-cartography.json"),
    "0x5e70000000000000000000000000000000000302": fixture("replies-new-prize.json"),
  };
  return stubServer((req, res, u) => {
    if (fail(u)) return sendJson(res, 503, "unavailable");
    const fid = Number(u.searchParams.get("fid"));
    if (u.pathname === "/v1/castsByFid") {
      if (fid === 1) return sendJson(res, 200, fid1);
      if (fid === 37) return sendJson(res, 200, fixture(u.searchParams.get("pageToken") === "cGFnZTI=" ? "casts-fid37.page2.json" : "casts-fid37.page1.json"));
      return sendJson(res, 200, empty);
    }
    if (u.pathname === "/v1/castsByParent") return sendJson(res, 200, replies[u.searchParams.get("hash")] || empty);
    if (u.pathname === "/v1/userDataByFid") {
      if (fid === 900020) return sendJson(res, 200, fixture("userdata-900020.json"));
      if (fid === 900001) return sendJson(res, 400, { errCode: "bad_request.unknown_fid" });
      return sendJson(res, 200, empty);
    }
    return sendJson(res, 404, { error: "no route" });
  });
}

test("--offline exits 0 against the seed and writes a valid book equal to compile()", async () => {
  const dir = tmp("offline");
  const chapters = tmp("chapters");
  const out = join(dir, "book.json");
  const r = await runCli(["--offline", "--now", NOW, "--out", out, "--chapters", chapters]);
  assert.equal(r.code, 0, r.stderr);
  const n = seedSubmissions().length; // counts follow the planner-owned seed, which grows
  assert.match(r.stdout, new RegExp(`^refresh: wrote .*book\\.json — 9 prizes, 7 ideas \\(7 drafts\\), ${n} submissions, ${n} new since previous file\\n$`));
  const text = readFileSync(out, "utf8");
  const book = JSON.parse(text);
  assert.deepEqual(validateBook(book), []);
  const expected = compile({ meta: meta(), seedPrizes: seedPrizes(), seedSubmissions: seedSubmissions(), seedPeople: seedPeople(), chapters: [], now: NOW });
  assert.equal(text, serialize(expected));
  // Deterministic: a second run writes the same bytes.
  const again = await runCli(["--offline", "--now", NOW, "--out", out, "--chapters", chapters]);
  assert.equal(again.code, 0);
  assert.match(again.stdout, /0 new since previous file/);
  assert.equal(readFileSync(out, "utf8"), text);
});

test("bad arguments exit 2 without writing", async () => {
  const dir = tmp("args");
  const out = join(dir, "b.json");
  const cases = [
    ["--offline", "--now", "yesterday", "--out", out],
    ["--offline", "--bogus", "--out", out],
    ["--offline", "--out"],
    ["--offline", "--nodes", "ftp://x", "--out", out],
  ];
  for (const args of cases) {
    const r = await runCli(args);
    assert.equal(r.code, 2, `${args.join(" ")}: ${r.stderr}`);
    assert.match(r.stderr, /usage:/);
  }
  assert.deepEqual(readdirSync(dir), []);
});

test("online: new prizes, submissions, results and people from a node; only live prizes' replies are read", async () => {
  const node = await snapchain();
  const dir = tmp("online");
  const chapters = tmp("chapters");
  const out = join(dir, "book.json");
  try {
    const r = await runCli(["--now", NOW, "--out", out, "--nodes", node.url, "--chapters", chapters]);
    assert.equal(r.code, 0, r.stderr);
    // The seed is planner-owned and grows; which stub replies get read depends on it (zero-submission prizes are read once).
    const m = r.stdout.match(/wrote .* — 10 prizes, 8 ideas \(8 drafts\), (\d+) submissions, (\d+) new since previous file/);
    assert.ok(m, r.stdout);
    assert.equal(m[1], m[2]);
    assert.ok(Number(m[1]) > seedSubmissions().length, "the stub's new replies were added");
    const book = readJson(out);
    assert.deepEqual(validateBook(book), []);

    // Replies were read for open/judging prizes and prizes with no known submissions only.
    const parents = node.requests.filter((u) => u.startsWith("/v1/castsByParent")).map((u) => new URL(u, "http://x").searchParams.get("hash")).sort();
    assert.deepEqual(parents, [
      "0x287c8ebe82fba6b086fc7198e2a9a6b32f448139", // tiebout: judging
      "0x2ba04801ad21047363138d58a3b4e5f0dabe7942", // nordhoff: open
      "0x392626b092e05955c11c41c5df8e2fb8003ece78", // archive, no known submissions
      "0x5e70000000000000000000000000000000000302", // the new prize
      "0x753a3f7d71e12dddc03053e1ca6d78cacdc20e2e", // archive
      "0x983ad3e340fbfef785e0705ff87c0e63c22bebc4", // archive
    ]);
    assert.ok(node.requests.some((u) => u.includes("pageToken=cGFnZTI")), "castsByFid paginated");

    // The new prize replied to its own announcement: one prize, with the announcement as context.
    const prize = book.prizes.find((p) => p.castHash === "0x5e70000000000000000000000000000000000302");
    assert.equal(prize.id, "tragedy-of-the-commons");
    assert.equal(prize.status, "open");
    assert.equal(prize.deadline, "2026-11-15T15:00:00Z");
    assert.equal(prize.context.castHash, "0x5e70000000000000000000000000000000000301");
    assert.ok(!book.prizes.some((p) => p.castHash === "0x5e70000000000000000000000000000000000301"));
    assert.ok(!book.prizes.some((p) => p.castHash === "0xcd34bb7404d899df69fda5e8ca17d3f1aa1e9268"), "the seed's announcement is not a prize");
    const draft = book.chapters.find((c) => c.prize === prize.id);
    assert.equal(draft.status, "draft");
    assert.equal(draft.kicker, NEW_KICKER);
    assert.deepEqual(draft.connections, []);

    const sub = (h) => book.submissions.find((s) => s.hash === h);
    assert.deepEqual(
      { kind: sub("0x5e70000000000000000000000000000000000401").kind, gloss: sub("0x5e70000000000000000000000000000000000401").gloss, ai: sub("0x5e70000000000000000000000000000000000401").ai, chapter: sub("0x5e70000000000000000000000000000000000401").chapter },
      { kind: "video", gloss: "Video entry, 54 seconds", ai: true, chapter: "tragedy-of-the-commons" },
    );
    assert.equal(sub("0x5e70000000000000000000000000000000000101").chapter, "what-lasts");
    assert.equal(sub("0x5e70000000000000000000000000000000000201").kind, "site");
    assert.equal(sub("0x5e70000000000000000000000000000000000201").repo, "https://github.com/example-maps/cloudmap");
    for (let i = 2; i <= 7; i++) assert.equal(sub(`0x5e7000000000000000000000000000000000010${i}`), undefined, `conversation reply ${i} excluded`);
    assert.equal(sub("0x5e70000000000000000000000000000000000202"), undefined);
    // Seed glosses stand.
    for (const s of seedSubmissions()) assert.equal(sub(s.hash).gloss, s.gloss);
    // Seed results stand; the results posts in the feed were already known.
    for (const p of seedPrizes().filter((x) => x.results)) assert.deepEqual(book.prizes.find((x) => x.id === p.id).results, p.results);

    // People: resolved where the node knows them; a 4xx for one fid is an answer, not a failure.
    assert.deepEqual(book.people["900020"], { fid: 900020, username: "commons-maker", displayName: "Commons ‹b›Maker‹/b›" });
    assert.equal(book.people["900001"], undefined);
    assert.ok(node.requests.includes("/v1/userDataByFid?fid=900001"));
    assert.deepEqual(book.provenance.nodes, [], "an http node is not recorded (contract: https only)");
    assert.match(r.stderr, /not recording non-https node/);
    assert.equal(book.provenance.refreshedAt, NOW);

    // Same inputs again: nothing changed, nothing written.
    const before = readFileSync(out, "utf8");
    const again = await runCli(["--now", NOW, "--out", out, "--nodes", node.url, "--chapters", chapters]);
    assert.equal(again.code, 0, again.stderr);
    assert.match(again.stdout, /unchanged, not written .* 0 new since previous file/);
    assert.equal(readFileSync(out, "utf8"), before);

    // Previously fetched items are carried forward once their prize stops being read.
    const later = await runCli(["--now", "2026-12-20T00:00:00Z", "--out", out, "--nodes", node.url, "--chapters", chapters]);
    assert.equal(later.code, 0, later.stderr);
    const laterBook = readJson(out);
    assert.ok(laterBook.submissions.some((s) => s.hash === "0x5e70000000000000000000000000000000000101"), "kept from the previous build");
    assert.equal(laterBook.prizes.find((p) => p.id === "tragedy-of-the-commons").status, "closed");
  } finally {
    await node.close();
  }
});

test("online: a results post for a prize without results marks winners in order", async () => {
  const feet = seedSubmissions().filter((s) => s.chapter === "feet" && s.kind === "video");
  const [a, b, c] = [feet[3], feet[0], feet[7]];
  const post = cast({
    fid: 1,
    hash: "0x5e70000000000000000000000000000000000d01",
    at: "2026-11-13T12:00:00Z",
    parent: { fid: 1, hash: "0x287c8ebe82fba6b086fc7198e2a9a6b32f448139" },
    text: `Thank you to everyone who submitted videos on Tiebout sorting!\n\nFirst: farcaster.xyz/someone/${a.hash.slice(0, 10)}\nRunners-up:\nfarcaster.xyz/someone/${b.hash.slice(0, 10)}\nfarcaster.xyz/someone/${c.hash.slice(0, 10)}`,
  });
  const node = await snapchain({ extra: [post] });
  const out = join(tmp("results"), "book.json");
  try {
    const r = await runCli(["--now", "2026-11-14T00:00:00Z", "--out", out, "--nodes", node.url, "--chapters", tmp("chapters")]);
    assert.equal(r.code, 0, r.stderr);
    const book = readJson(out);
    assert.deepEqual(validateBook(book), []);
    const tiebout = book.prizes.find((p) => p.id === "tiebout");
    assert.equal(tiebout.status, "awarded");
    assert.equal(tiebout.results.castHash, post.hash);
    assert.deepEqual(
      tiebout.results.places.map((p) => [p.place, p.amount, p.submission]),
      [["1st", "$512", a.hash], ["hm", "$128", b.hash], ["hm", "$128", c.hash]],
      "the tiebout pool has runners-up and no second prize",
    );
    const place = (h) => book.submissions.find((s) => s.hash === h).place;
    assert.deepEqual([place(a.hash), place(b.hash), place(c.hash)], ["1st", "hm", "hm"]);
    assert.equal(book.prizes.find((p) => p.id === "nordhoff").results, undefined, "other prizes untouched");
  } finally {
    await node.close();
  }
});

test("online: first node 503 → second node used", async () => {
  const down = await snapchain({ fail: () => true });
  const up = await snapchain();
  const dir = tmp("failover");
  try {
    const r = await runCli(["--now", NOW, "--out", join(dir, "book.json"), "--nodes", `${down.url},${up.url}`, "--chapters", tmp("chapters")]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(down.requests.length > 0 && up.requests.length > 0);
    assert.deepEqual(readJson(join(dir, "book.json")).provenance.nodes, []);
    assert.match(r.stderr, new RegExp(`not recording non-https node ${up.url}`));
    assert.ok(!r.stderr.includes(`node ${down.url}`), "only nodes that answered are provenance");
  } finally {
    await down.close();
    await up.close();
  }
});

test("online: a node failure part-way through exits non-zero and leaves the previous build untouched", async () => {
  const good = await snapchain();
  const dir = tmp("partial");
  const out = join(dir, "book.json");
  const chapters = tmp("chapters");
  try {
    assert.equal((await runCli(["--now", NOW, "--out", out, "--nodes", good.url, "--chapters", chapters])).code, 0);
  } finally {
    await good.close();
  }
  const previous = readFileSync(out, "utf8");
  // Replies to the Nordhoff prize fail on every node; everything else answers.
  const flaky = await snapchain({ fail: (u) => u.pathname === "/v1/castsByParent" && u.searchParams.get("hash") === "0x2ba04801ad21047363138d58a3b4e5f0dabe7942" });
  try {
    const r = await runCli(["--now", "2026-11-12T18:00:00Z", "--out", out, "--nodes", flaky.url, "--chapters", chapters]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /FAILED, nothing written: node unavailable/);
    assert.equal(readFileSync(out, "utf8"), previous, "never records zero submissions for a prize it could not read");
    assert.deepEqual(readdirSync(dir), ["book.json"]);
  } finally {
    await flaky.close();
  }
});

test("an unreadable previous build is not overwritten", async () => {
  const node = await snapchain();
  const dir = tmp("corrupt");
  const out = join(dir, "book.json");
  writeFileSync(out, "{ not json");
  try {
    const r = await runCli(["--now", NOW, "--out", out, "--nodes", node.url, "--chapters", tmp("chapters")]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /refusing to overwrite/);
    assert.equal(readFileSync(out, "utf8"), "{ not json");
  } finally {
    await node.close();
  }
});

test("userDataByFid: latest username and display name win; other fids' messages are ignored", () => {
  const msgs = fixture("userdata-900020.json").messages;
  assert.deepEqual(personFromUserData(900020, msgs), { fid: 900020, username: "commons-maker", displayName: "Commons <b>Maker</b>" });
  assert.equal(personFromUserData(5, msgs), null);
});

test("the workflow runs refresh every 30 minutes and commits only content/build/", () => {
  const y = readFileSync(join(ROOT, ".github/workflows/refresh.yml"), "utf8");
  assert.match(y, /schedule:\s*\n\s*- cron: "\*\/30 \* \* \* \*"/);
  assert.match(y, /workflow_dispatch:/);
  assert.match(y, /node-version: 22/);
  assert.match(y, /run: node ingest\/bin\/refresh\.mjs --now "\$\(date -u \+%FT%TZ\)"/);
  const adds = [...y.matchAll(/git add[^\n]*/g)].map((m) => m[0]);
  assert.deepEqual(adds, ["git add -- content/build/"]);
  assert.match(y, /git status --porcelain -- content\/build\//, "commits only when content/build changed");
  assert.match(y, /cd web && npm ci && npm run build/);
  assert.match(y, /actions\/upload-pages-artifact@v\d+\n\s+with:\n\s+path: web\/dist\/hosted/);
  assert.match(y, /actions\/deploy-pages@v\d+/);
  assert.match(y, /^permissions: \{\}$/m, "no default permissions");
  for (const m of y.matchAll(/uses: ([^\s]+)/g)) assert.match(m[1], /^actions\/[a-z-]+@v\d+$/, `pinned major: ${m[1]}`);
});
