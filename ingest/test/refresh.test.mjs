// I6: the refresh CLI (offline and against a local Snapchain stub) and the scheduled workflow.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { validateBook } from "../../contract/validate.mjs";
import { compile, NEW_KICKER, OFFLINE_NOTE, serialize, validLookups } from "../src/compile.mjs";
import { DEFAULT_TIMEOUT_MS, NodeHttpError, NodeUnavailable } from "../src/node.mjs";
import { appGeneratedAt, fetchUpdates, loadAppInputs, MAX_USER_LOOKUPS, offlineCarry, offlineProvenance, personFromUserData, REPLY_PAGES, runRefresh } from "../src/refresh.mjs";
import { compileApp } from "../src/compile-app.mjs";
import { validateApp } from "../../contract/validate-app.mjs";
import { derivePrize } from "../src/detect.mjs";
import { classifyReply } from "../src/classify.mjs";
import { ROOT, cast, fixture, meta, readJson, runCli, sampleBook, sendJson, seedPeople, seedPrizes, seedSubmissions, stubServer } from "./helpers.mjs";

const NOW = "2026-11-12T17:00:00Z";
const tmp = (p) => mkdtempSync(join(tmpdir(), `primer-${p}-`));
const empty = { messages: [], nextPageToken: "" };

const NORDHOFF = "0x2ba04801ad21047363138d58a3b4e5f0dabe7942";

/**
 * A Snapchain stub serving the fixtures.
 *   fail(url)  → true for a 503, or an HTTP status to answer with
 *   extra      → casts added to fid 1's listing
 *   replies    → { castHash: messages[] } replacing a prize's replies
 *   endless    → cast hashes whose reply listing never ends (always a nextPageToken)
 *   without    → cast hashes left out of fid 1's listing
 *   byId       → { castHash: message | null } answers for castById (null: 404); by default
 *                castById finds any cast this stub lists (fid 1, fid 37, replies), else 404
 */
function snapchain({ fail = () => false, extra = [], replies: over = {}, endless = [], without = [], byId = {} } = {}) {
  const fid1 = { messages: [...extra, ...fixture("casts-fid1.new-prize.json").messages, ...fixture("casts-fid1.json").messages].filter((m) => !without.includes(m.hash)), nextPageToken: "" };
  const replies = {
    [NORDHOFF]: fixture("replies-nordhoff.json"),
    "0x983ad3e340fbfef785e0705ff87c0e63c22bebc4": fixture("replies-cloud-cartography.json"),
    "0x5e70000000000000000000000000000000000302": fixture("replies-new-prize.json"),
  };
  for (const [h, messages] of Object.entries(over)) replies[h] = { messages, nextPageToken: "" };
  return stubServer((req, res, u) => {
    const failed = fail(u);
    if (failed) return sendJson(res, failed === true ? 503 : failed, { errCode: "stub" });
    if (u.pathname === "/v1/castsByParent" && endless.includes(u.searchParams.get("hash"))) {
      return sendJson(res, 200, { ...(replies[u.searchParams.get("hash")] || empty), nextPageToken: `p${Number(u.searchParams.get("pageToken")?.slice(1) || 0) + 1}` });
    }
    const fid = Number(u.searchParams.get("fid"));
    if (u.pathname === "/v1/castsByFid") {
      if (fid === 1) return sendJson(res, 200, fid1);
      if (fid === 37) return sendJson(res, 200, fixture(u.searchParams.get("pageToken") === "cGFnZTI=" ? "casts-fid37.page2.json" : "casts-fid37.page1.json"));
      return sendJson(res, 200, empty);
    }
    if (u.pathname === "/v1/castsByParent") return sendJson(res, 200, replies[u.searchParams.get("hash")] || empty);
    if (u.pathname === "/v1/castById") {
      const h = u.searchParams.get("hash");
      const listed = [...fid1.messages, ...fixture("casts-fid37.page1.json").messages, ...fixture("casts-fid37.page2.json").messages, ...Object.values(replies).flatMap((r) => r.messages)];
      const m = Object.hasOwn(byId, h) ? byId[h] : listed.find((x) => x.hash === h && x.data.fid === fid);
      return m ? sendJson(res, 200, m) : sendJson(res, 404, { errCode: "not_found" });
    }
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
  assert.match(r.stdout, new RegExp(`^refresh: wrote .*book\\.json — 9 prizes, 7 ideas \\(7 drafts\\), ${n} submissions, ${n} new since previous file\\nrefresh: wrote .*/app\\.json — \\d+ lessons \\(\\d+ drafts?\\), works: .*\\n$`));
  const text = readFileSync(out, "utf8");
  const book = JSON.parse(text);
  assert.deepEqual(validateBook(book), []);
  const expected = compile({ meta: meta(), seedPrizes: seedPrizes(), seedSubmissions: seedSubmissions(), seedPeople: seedPeople(), chapters: [], now: NOW });
  assert.equal(text, serialize(expected));
  // The app is written beside it, from the same book.
  const appText = readFileSync(join(dir, "app.json"), "utf8");
  assert.deepEqual(validateApp(JSON.parse(appText)), []);
  const { meta: appMeta, works, lessons } = loadAppInputs(ROOT);
  assert.equal(appText, serialize(compileApp({ meta: appMeta, works, lessons, book: expected, now: NOW })));
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
    // Archive prizes are read only while the (planner-owned, growing) seed has no submissions for them.
    const seedCount = (id) => seedSubmissions().filter((x) => x.chapter === seedPrizes().find((p) => p.id === id).chapter).length;
    const archive = { "ai-conference-organizer": "0x392626b092e05955c11c41c5df8e2fb8003ece78", "network-state-visuals": "0x753a3f7d71e12dddc03053e1ca6d78cacdc20e2e", "cloud-cartography": "0x983ad3e340fbfef785e0705ff87c0e63c22bebc4" };
    assert.deepEqual(parents, [
      "0x287c8ebe82fba6b086fc7198e2a9a6b32f448139", // tiebout: judging
      "0x2ba04801ad21047363138d58a3b4e5f0dabe7942", // nordhoff: open
      "0x5e70000000000000000000000000000000000302", // the new prize
      ...Object.entries(archive).filter(([id]) => seedCount(id) === 0).map(([, h]) => h),
    ].sort());
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
    if (parents.includes(archive["cloud-cartography"])) {
      assert.equal(sub("0x5e70000000000000000000000000000000000201").kind, "site");
      assert.equal(sub("0x5e70000000000000000000000000000000000201").repo, "https://github.com/example-maps/cloudmap");
    } else assert.equal(sub("0x5e70000000000000000000000000000000000201"), undefined, "a thread that is not live is not re-read");
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
  // Later the results post has scrolled out of the feed: the results found earlier stay.
  const later = await snapchain();
  try {
    const r = await runCli(["--now", "2026-11-14T01:00:00Z", "--out", out, "--nodes", later.url, "--chapters", tmp("chapters")]);
    assert.equal(r.code, 0, r.stderr);
    const tiebout = readJson(out).prizes.find((p) => p.id === "tiebout");
    assert.equal(tiebout.status, "awarded");
    assert.deepEqual(tiebout.results.places.map((p) => [p.place, p.submission]), [["1st", a.hash], ["hm", b.hash], ["hm", c.hash]]);
  } finally {
    await later.close();
  }
});

test("online: a new prize's results are read again while the post is in the feed, so a winner captured later is placed", async () => {
  const PRIZE = "0x5e70000000000000000000000000000000000302";
  const entries = fixture("replies-new-prize.json").messages;
  const late = cast({ fid: 900050, hash: "0xa7e5000000000000000000000000000000000e51", at: "2026-11-13T10:00:00Z", parent: { fid: 1, hash: PRIZE }, text: "Mine", embeds: [{ url: "https://youtu.be/late" }] });
  const post = cast({
    fid: 1,
    hash: "0x5e70000000000000000000000000000000000d02",
    at: "2026-11-16T12:00:00Z",
    parent: { fid: 1, hash: PRIZE },
    text: `Thank you to everyone who submitted videos on the commons!\n\nFirst ($512): farcaster.xyz/x/${late.hash.slice(0, 10)}\nRunners-up ($128): farcaster.xyz/y/${entries[0].hash.slice(0, 10)}`,
  });
  const out = join(tmp("late-winner"), "book.json");
  const chapters = tmp("chapters");
  const run = async (replies, now) => {
    const node = await snapchain({ extra: [post], replies: { [PRIZE]: replies } });
    try {
      return await runCli(["--now", now, "--out", out, "--nodes", node.url, "--chapters", chapters]);
    } finally {
      await node.close();
    }
  };
  const first = await run(entries, "2026-11-16T13:00:00Z");
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stderr, /unmatched farcaster\.xyz\/x\/0xa7e50000/);
  const places = () => readJson(out).prizes.find((p) => p.castHash === PRIZE).results.places.map((p) => [p.place, p.amount, p.submission]);
  assert.deepEqual(places(), [["hm", "$128", entries[0].hash]], "the missing winner does not move the runner-up to 1st");
  const second = await run([...entries, late], "2026-11-16T13:30:00Z");
  assert.equal(second.code, 0, second.stderr);
  assert.deepEqual(places(), [["1st", "$512", late.hash], ["hm", "$128", entries[0].hash]]);
  // The new prize's draft lesson carries the work: the late winner leads.
  const draft = readJson(join(dirname(out), "app.json")).lessons.find((l) => l.topic === "tragedy-of-the-commons");
  assert.deepEqual(draft.work.map((w) => [w.role, w.id, w.caption]), [["lead", late.hash, "A short explainer"], ["more", entries[0].hash, "A short explainer, 54 seconds"]]);
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
  const previousApp = readFileSync(join(dir, "app.json"), "utf8");
  // Replies to the Nordhoff prize fail on every node; everything else answers.
  const flaky = await snapchain({ fail: (u) => u.pathname === "/v1/castsByParent" && u.searchParams.get("hash") === "0x2ba04801ad21047363138d58a3b4e5f0dabe7942" });
  try {
    const r = await runCli(["--now", "2026-11-12T18:00:00Z", "--out", out, "--nodes", flaky.url, "--chapters", chapters]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /FAILED, nothing written: node unavailable/);
    assert.equal(readFileSync(out, "utf8"), previous, "never records zero submissions for a prize it could not read");
    assert.equal(readFileSync(join(dir, "app.json"), "utf8"), previousApp);
    assert.deepEqual(readdirSync(dir), ["app.json", "book.json"]);
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

/** A workflow file as text and lines, and one job's or step's block by its header line. */
function workflow(name = "refresh.yml") {
  const text = readFileSync(join(ROOT, ".github/workflows", name), "utf8");
  const lines = text.split("\n");
  const block = (header) => {
    const i = lines.findIndex((l) => l.trimEnd() === header);
    assert.ok(i >= 0, `${name}: no line ${header.trim()}`);
    const indent = lines[i].search(/\S/);
    const out = [lines[i]];
    for (const l of lines.slice(i + 1)) {
      if (l.trim() && l.search(/\S/) <= indent) break;
      out.push(l);
    }
    return out;
  };
  /** A block's lines, trimmed, without comments or blank lines. */
  const flat = (header) => block(header).map((l) => l.replace(/\s+#.*$/, "").trim()).filter(Boolean);
  /** Every `run:` script in the file (one-line or block), as text. */
  const runs = () => {
    const out = [];
    lines.forEach((l, i) => {
      const m = /^(\s*)(?:- )?run: ?(.*)$/.exec(l);
      if (!m) return;
      if (m[2] !== "|") return out.push(m[2]);
      const body = [];
      for (const x of lines.slice(i + 1)) {
        if (x.trim() && x.search(/\S/) <= m[1].length + (l.trimStart().startsWith("- ") ? 2 : 0)) break;
        body.push(x);
      }
      out.push(body.join("\n"));
    });
    return out;
  };
  /** The permissions a job holds, as "key: value" lines. */
  const perms = (job) => {
    const b = flat(`  ${job}:`);
    const i = b.indexOf("permissions:");
    assert.ok(i >= 0, `${name}: job ${job} sets its permissions`);
    const out = [];
    for (const l of b.slice(i + 1)) {
      if (!/^[a-z-]+: (read|write|none)$/.test(l)) break;
      out.push(l);
    }
    return out;
  };
  return { text, lines, block, flat, runs, perms };
}
const WORKFLOWS = ["refresh.yml", "deploy.yml", "editor.yml", "editor-merge.yml"];

test("S15: every workflow pins actions by commit SHA, starts with no permissions, keeps no token on disk, and puts no ${{ }} in a script", () => {
  assert.deepEqual(readdirSync(join(ROOT, ".github/workflows")).sort(), [...WORKFLOWS].sort(), "no other workflow");
  for (const name of WORKFLOWS) {
    const w = workflow(name);
    assert.match(w.text, /^permissions: \{\}$/m, `${name}: no default permissions`);
    const uses = [...w.text.matchAll(/uses: ([^\n]+)/g)].map((m) => m[1]);
    assert.ok(uses.length > 0, name);
    for (const u of uses) assert.match(u, /^actions\/(checkout|setup-node|upload-pages-artifact|deploy-pages)@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, `${name}: pinned by full SHA with a version comment: ${u}`);
    const checkouts = w.lines.filter((l) => /uses: actions\/checkout@/.test(l)).length;
    assert.equal([...w.text.matchAll(/persist-credentials: false/g)].length, checkouts, `${name}: every checkout leaves no token in .git/config`);
    for (const r of w.runs()) assert.ok(!r.includes("${{"), `${name}: an expression inside a script is an injection risk: ${r.slice(0, 80)}`);
    assert.ok(!/continue-on-error/.test(w.text), `${name}: no continue-on-error`);
    assert.ok(!/\|\|\s*true/.test(w.text), `${name}: no || true`);
    assert.ok(!/pull_request_target/.test(w.text), `${name}: never pull_request_target`);
    assert.ok(!/secrets\./.test(w.text), `${name}: no secrets beyond the job token`);
    // Same pins everywhere.
    for (const u of uses) {
      const [action] = u.split("@");
      for (const other of WORKFLOWS) for (const v of [...workflow(other).text.matchAll(new RegExp(`uses: (${action.replace("/", "\\/")}@[^\\n]+)`, "g"))]) assert.equal(v[1], u, `${action} pinned the same in ${name} and ${other}`);
    }
  }
  // Only refresh.yml commits or pushes, and only content/build/ (review S9: one writer).
  for (const name of WORKFLOWS.filter((n) => n !== "refresh.yml")) {
    const code = workflow(name).runs().join("\n");
    assert.ok(!/\bgit\b[^\n]*\b(commit|push|add)\b/.test(code), `${name} never commits or pushes`);
  }
});

test("refresh.yml: every 30 minutes and on demand, reads the network, commits only content/build/ with the token in that step alone, then deploys if Pages is behind (S2)", () => {
  const w = workflow("refresh.yml");
  assert.deepEqual(w.flat("on:"), ["on:", "schedule:", '- cron: "7,22,37,52 * * * *"', "workflow_dispatch:"], "no push trigger: deploys live in deploy.yml");
  assert.match(w.text, /^concurrency:\n  group: refresh\n  cancel-in-progress: false$/m);
  // The refresh step: exactly the online command, nothing appended (no --offline).
  const step = w.flat("      - name: Refresh content/build from public nodes");
  assert.deepEqual(step, ["- name: Refresh content/build from public nodes", 'run: node ingest/bin/refresh.mjs --now "$(date -u +%FT%TZ)"']);
  assert.ok(!/--offline/.test(w.text), "the scheduled job never compiles offline");
  // The job holds contents: write only; the token reaches only the commit step.
  assert.deepEqual(w.perms("refresh"), ["contents: write"]);
  const job = w.flat("  refresh:");
  assert.ok(job.includes("ref: ${{ github.ref_name }}"), "checks out the branch head, so a queued run starts from the latest book.json");
  assert.ok(job.includes("persist-credentials: false"));
  const commit = w.flat("      - name: Commit content/build/ if it changed");
  assert.ok(commit.includes("GITHUB_TOKEN: ${{ github.token }}"));
  assert.equal([...w.text.matchAll(/github\.token/g)].length, 2, "the commit step and the deploy check, nothing else");
  const script = commit.join("\n");
  assert.match(script, /git status --porcelain -- content\/build\//, "commits only when content/build changed");
  assert.deepEqual([...script.matchAll(/git add[^\n]*/g)].map((m) => m[0]), ["git add -- content/build/"]);
  assert.deepEqual(commit.filter((l) => /\bgit\b.*\bcommit\b/.test(l)), ['git commit -m "ingest: refresh content/build"']);
  assert.deepEqual(commit.filter((l) => /\bgit\b.*\bpush\b/.test(l)).map((l) => l.replace(/^if /, "").replace(/; then$/, "")), ['git -c "http.https://github.com/.extraheader=$auth" push origin "HEAD:$GITHUB_REF_NAME"']);
  assert.ok(commit.some((l) => l === 'git -c "http.https://github.com/.extraheader=$auth" pull --rebase origin "$GITHUB_REF_NAME"'), "rebases onto editor merges before pushing");
  for (const l of w.lines) {
    assert.ok(!/\bgit\b.*\bcommit\b.*(\s-[a-zA-Z]*a[a-zA-Z]*\b|--all\b|--include\b|\s--\s)/.test(l), `commit -a / --all: ${l.trim()}`);
    assert.ok(!/\bgit\b.*\bpush\b.*(--force|\s-f\b|--mirror|\s\+\S)/.test(l), `force push: ${l.trim()}`);
    assert.ok(!/\bgit\b.*\b(reset --hard|push --delete)\b/.test(l), l.trim());
  }
  assert.match(script, /^exit 1$/m, "a push that keeps failing fails the job");
  // Then: deploy if Pages is behind main, even after a failed refresh.
  const deploy = w.flat("  deploy:");
  assert.ok(deploy.includes("needs: refresh"));
  assert.ok(deploy.includes("if: ${{ !cancelled() }}"), "a node outage never holds back an editor's publish");
  assert.deepEqual(w.perms("deploy"), ["contents: read", "deployments: read", "actions: write"]);
  assert.ok(deploy.includes('run: node ingest/bin/deploy-if-behind.mjs --ref "$GITHUB_REF_NAME" --workflow deploy.yml'));
  assert.ok(!/upload-pages-artifact|deploy-pages|npm /.test(w.text), "building and deploying is deploy.yml's job");
  assert.ok(!/\bweb\b/.test(w.runs().join("\n")), "no web/ build or deploy");
});

test("deploy.yml: its own concurrency group; compiles app.json from the sources (offline, the commit's time) before testing and building; read-only build, deploy-only deploy (S2, S9, S10, S15)", () => {
  const w = workflow("deploy.yml");
  assert.deepEqual(w.flat("on:"), ["on:", "push:", "branches: [main]", "paths:", '- "app/**"', '- "content/**"', '- "contract/**"', '- "ingest/**"', "workflow_dispatch:"]);
  assert.match(w.text, /^concurrency:\n  group: deploy\n  cancel-in-progress: false$/m, "not the refresh group: a refresh never holds a deploy");
  assert.deepEqual(w.perms("build"), ["contents: read"]);
  assert.deepEqual(w.perms("deploy"), ["pages: write", "id-token: write"]);
  const build = w.flat("  build:");
  const steps = build.slice(build.indexOf("steps:") + 1);
  const at = (line) => {
    const i = steps.indexOf(line);
    assert.ok(i >= 0, `build step line missing: ${line}`);
    return i;
  };
  const order = [
    at("- uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09"),
    at("persist-credentials: false"),
    at("node-version: 22"),
    at('run: node ingest/bin/refresh.mjs --offline --now "$(date -u -d "@$(git log -1 --format=%ct)" +%FT%TZ)"'),
    at("run: cd app && npm ci && npm test && npm run build"),
    at("- uses: actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9"),
    at("path: app/dist"),
  ];
  assert.deepEqual(order, [...order].sort((p, q) => p - q), "compile, then test and build, then upload");
  assert.ok(!build.some((l) => /^ref:/.test(l)), "builds the commit the run was started for");
  const deploy = w.flat("  deploy:");
  assert.ok(deploy.includes("needs: build"));
  assert.ok(deploy.includes("name: github-pages"));
  assert.deepEqual(deploy.filter((l) => /^(- )?(uses|run):/.test(l)), ["uses: actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346"], "the job with pages/id-token runs nothing else");
  assert.equal([...w.text.matchAll(/upload-pages-artifact/g)].length, 1);
  assert.equal([...w.text.matchAll(/deploy-pages@/g)].length, 1);
  assert.ok(!/\bweb\b/.test(w.runs().join("\n")), "the legacy atlas is never built or deployed");
});

test("editor.yml: a same-repo editor/* pull request is checked read-only: its own head, which must contain main's head; paths, every lesson strict, tests, a strict compile, the app (S9, S16, S17, V4)", () => {
  const w = workflow("editor.yml");
  assert.deepEqual(w.flat("on:"), ["on:", "pull_request:", "branches: [main]"]);
  const job = w.flat("  validate:");
  assert.ok(job.includes("if: startsWith(github.head_ref, 'editor/') && github.event.pull_request.head.repo.full_name == github.repository"), "only this repository's editor/ branches");
  assert.deepEqual(w.perms("validate"), ["contents: read"]);
  assert.ok(!/: write/.test(w.text), "it runs the pull request's content, so it can write nothing");
  // V4: the branch's head itself (not GitHub's test merge with an older main), with main's current head beside it.
  assert.ok(job.includes("ref: ${{ github.event.pull_request.head.sha }}"), "checks the pull request's head");
  assert.ok(job.includes("fetch-depth: 0"), "the branch's history and origin/main, for the containment check");
  assert.ok(!job.some((l) => /^fetch-depth: [1-9]/.test(l)));
  const runs = w.runs();
  const at = (cmd) => {
    const i = runs.indexOf(cmd);
    assert.ok(i >= 0, `editor.yml runs ${cmd}`);
    return i;
  };
  const order = [
    at('node ingest/bin/editor-check.mjs current --base "origin/$BASE_REF" --head HEAD'),
    at('node ingest/bin/editor-check.mjs paths --branch "$HEAD_REF" --diff "origin/$BASE_REF...HEAD"'),
    at("node contract/validate-app.mjs --strict content/lessons/*.json"),
    at("node --test contract/test/*.test.mjs && node --test ingest/test/"),
    at(`node ingest/bin/refresh.mjs --offline --strict-lessons --now "$(node -p 'require("./content/build/book.json").generatedAt')"`),
    at("node contract/validate-app.mjs --strict content/build/app.json"),
    at("cd app && npm ci && npm test && npm run build"),
  ];
  assert.deepEqual(order, [...order].sort((p, q) => p - q), "containment first: nothing is checked against an older main");
  assert.equal(order[0], 0, "the first script");
  assert.ok(w.flat("      - name: The branch contains main's current head").includes("BASE_REF: ${{ github.base_ref }}"), "main's name reaches the script as data");
  const paths = w.flat("      - name: Only lesson files and content/seed/works.json change");
  assert.ok(paths.includes("HEAD_REF: ${{ github.head_ref }}") && paths.includes("BASE_REF: ${{ github.base_ref }}"), "the branch name reaches the script as data");
  assert.ok(!/HEAD\^1|refs\/pull\//.test(w.runs().join("\n")), "never the test merge commit");
});

test("editor-merge.yml: after editor.yml passes, main's rules check the pull request, its commits and its paths; it squash-merges the checked head only while main is still contained and every link is allowed, else comments and holds; no pull-request code runs (S2, S16, V4, V5, V25)", () => {
  const w = workflow("editor-merge.yml");
  assert.deepEqual(w.flat("on:"), ["on:", "workflow_run:", "workflows: [editor]", "types: [completed]", 'branches: ["editor/*"]']);
  const job = w.block("  merge:").join("\n");
  for (const cond of ["github.event.workflow_run.conclusion == 'success'", "github.event.workflow_run.event == 'pull_request'", "github.event.workflow_run.head_repository.full_name == github.repository", "startsWith(github.event.workflow_run.head_branch, 'editor/')", "vars.EDITOR_LOGIN != ''"]) assert.ok(job.includes(cond), cond);
  assert.deepEqual(w.perms("merge"), ["contents: write", "pull-requests: write", "actions: write"]);
  const flat = w.flat("  merge:");
  assert.ok(flat.includes("ref: ${{ github.event.repository.default_branch }}"), "checks out main, never the pull request");
  assert.ok(!/head_sha \}\}[^\n]*\n[^\n]*persist|ref: \$\{\{ github\.event\.workflow_run\.head/.test(w.text), "never checks out the pull request's head");
  const code = w.runs().join("\n");
  assert.ok(!/\bnpm\b|node --test|refresh\.mjs|validate-app|git (checkout|switch|reset|worktree)\b/.test(code), "runs nothing that could load pull-request code, and never puts its files in the working tree");
  assert.deepEqual([...code.matchAll(/node ([^\s]+)/g)].map((m) => m[1]), ["pr", "paths", "ready"].map(() => "ingest/bin/editor-check.mjs"), "main's editor-check.mjs (pr, paths, ready) is the only program it runs");
  const lines = code.split("\n").map((l) => l.trim());
  const at = (pred, what) => {
    const i = lines.findIndex(pred);
    assert.ok(i >= 0, what);
    return i;
  };
  const merge = at((l) => l === 'merged="$(gh api -X PUT "repos/$REPO/pulls/$PR/merge" -f merge_method=squash -f sha="$HEAD_SHA" --jq .sha)"', "squash-merges only the checked head");
  const order = [
    at((l) => l === 'gh api "repos/$REPO/pulls/$PR" > "$RUNNER_TEMP/pull.json"', "reads the pull request"),
    at((l) => l === 'gh api "repos/$REPO/pulls/$PR/commits?per_page=100" > "$RUNNER_TEMP/commits.json"', "reads its commits (V25)"),
    at((l) => l === 'node ingest/bin/editor-check.mjs pr --file "$RUNNER_TEMP/pull.json" --commits "$RUNNER_TEMP/commits.json" --repo "$REPO" --branch "$HEAD_BRANCH" --head-sha "$HEAD_SHA" --editor "$EDITOR_LOGIN" --base "$BASE"', "checks author, commits, branch and head"),
    at((l) => l === 'git -c "http.https://github.com/.extraheader=$auth" fetch --no-tags origin "$HEAD_SHA"', "fetches the head's objects only"),
    at((l) => l === 'node ingest/bin/editor-check.mjs paths --branch "$HEAD_BRANCH" --diff "origin/$BASE...$HEAD_SHA"', "checks the paths with main's script"),
    at((l) => l === 'git -c "http.https://github.com/.extraheader=$auth" fetch --no-tags origin "+refs/heads/$BASE:refs/remotes/origin/$BASE"', "reads main's head again, just before deciding"),
    at((l) => l === 'if node ingest/bin/editor-check.mjs ready --base "origin/$BASE" --head "$HEAD_SHA" --out "$RUNNER_TEMP/hold.md"; then', "decides: main still contained, every link allowed (V4, V5)"),
    merge,
    at((l) => l === 'tree="$(gh api "repos/$REPO/git/commits/$merged" --jq .tree.sha)"', "reads the merged tree"),
    at((l) => l === 'if [ "$tree" != "$(git rev-parse "$HEAD_SHA^{tree}")" ]; then', "the merged tree is the checked tree"),
    at((l) => l === 'gh api -X POST "repos/$REPO/actions/workflows/deploy.yml/dispatches" -f ref="$BASE"', "dispatches the deploy"),
    at((l) => l === "else", "otherwise"),
    at((l) => l === "code=$?", "keeps ready's exit code"),
    at((l) => l === 'if [ "$code" -ne 1 ]; then exit "$code"; fi', "a check that could not run fails the job"),
    at((l) => l === 'gh api -X POST "repos/$REPO/issues/$PR/comments" -F "body=@$RUNNER_TEMP/hold.md" > /dev/null', "holds it for a person with ready's comment, read from a file (no pull-request text in the script)"),
  ];
  assert.deepEqual(order, [...order].sort((p, q) => p - q));
  assert.equal(lines.filter((l) => /pulls\/\$PR\/merge/.test(l)).length, 1, "one merge call, inside the ready branch");
  assert.equal(lines.filter((l) => /dispatches/.test(l)).length, 1, "one deploy dispatch, after the tree check");
  assert.equal(lines.slice(merge, order[11]).filter((l) => l === "exit 1").length, 1, "a merged tree that is not the checked tree fails the job before the deploy");
  assert.ok(!/merge_method=(merge|rebase)|--admin|auto_merge|enablePullRequestAutoMerge/.test(code), "squash only, never around the rules");
  assert.equal([...code.matchAll(/set -eu/g)].length, w.runs().filter((r) => r.includes("\n")).length, "every script stops at the first failure");
});

test("a 4xx on a prize's replies fails the run; it is never read as zero replies", async () => {
  const good = await snapchain();
  const dir = tmp("replies-4xx");
  const out = join(dir, "book.json");
  const chapters = tmp("chapters");
  try {
    assert.equal((await runCli(["--now", NOW, "--out", out, "--nodes", good.url, "--chapters", chapters])).code, 0);
  } finally {
    await good.close();
  }
  const previous = readFileSync(out, "utf8");
  const previousApp = readFileSync(join(dir, "app.json"), "utf8");
  const refusing = await snapchain({ fail: (u) => u.pathname === "/v1/castsByParent" && u.searchParams.get("hash") === NORDHOFF && 400 });
  try {
    const r = await runCli(["--now", "2026-11-12T18:00:00Z", "--out", out, "--nodes", refusing.url, "--chapters", chapters]);
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /FAILED, nothing written: node refused a request/);
    assert.equal(readFileSync(out, "utf8"), previous);
    assert.equal(readFileSync(join(dir, "app.json"), "utf8"), previousApp);
    assert.deepEqual(readdirSync(dir), ["app.json", "book.json"]);
  } finally {
    await refusing.close();
  }
});

test("online: a rate-limited first node (429) → the second node is used; a new prize waits for a second node to confirm it", async () => {
  const limited = await snapchain({ fail: () => 429 });
  const up = await snapchain();
  const out = join(tmp("429"), "book.json");
  try {
    const r = await runCli(["--now", NOW, "--out", out, "--nodes", `${limited.url},${up.url}`, "--chapters", tmp("chapters")]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(limited.requests.length > 0 && up.requests.length > 0);
    assert.equal(limited.requests.length, 1, "demoted after its first failure: never asked again this run (S19)");
    assert.ok(!up.requests.some((u) => u.startsWith("/v1/castById")), "a node never confirms itself");
    assert.ok(!readJson(out).prizes.some((p) => p.id === "tragedy-of-the-commons"), "only one node has vouched for it");
    assert.match(r.stderr, /prize 0x5e70000000000000000000000000000000000302: not confirmed by a second node \(unavailable\)/);
  } finally {
    await limited.close();
    await up.close();
  }
  // Both nodes up and agreeing: the prize is used.
  const a = await snapchain();
  const b = await snapchain();
  try {
    const r = await runCli(["--now", NOW, "--out", out, "--nodes", `${a.url},${b.url}`, "--chapters", tmp("chapters")]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(b.requests.includes("/v1/castById?fid=1&hash=0x5e70000000000000000000000000000000000302"), "asked the second node");
    assert.ok(readJson(out).prizes.some((p) => p.id === "tragedy-of-the-commons"));
  } finally {
    await a.close();
    await b.close();
  }
});
test("the refresh engine, called as the CLI calls it, gives each request the 5 s default timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  let started;
  const fetching = new Promise((resolve) => (started = resolve));
  const hang = (url, opts) => {
    signal = opts.signal;
    started();
    return new Promise((resolve, reject) => opts.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  };
  const run = runRefresh({ root: ROOT, out: join(tmp("timeout"), "book.json"), now: NOW, nodes: ["https://hang.example"], chaptersDir: tmp("chapters"), fetch: hang }).catch((e) => e);
  await fetching;
  assert.equal(DEFAULT_TIMEOUT_MS, 5000);
  t.mock.timers.tick(DEFAULT_TIMEOUT_MS - 1);
  assert.equal(signal.aborted, false, "not before 5 s");
  t.mock.timers.tick(1);
  assert.equal(signal.aborted, true, "at 5 s");
  const err = await run;
  assert.ok(err instanceof NodeUnavailable, String(err));
  assert.match(err.message, /timeout after 5000 ms/);
});

test("an invalid chapter file fails the run and leaves the previous book byte-identical", async () => {
  const dir = tmp("invalid-chapter");
  const out = join(dir, "book.json");
  const chapters = tmp("chapters");
  assert.equal((await runCli(["--offline", "--now", NOW, "--out", out, "--chapters", chapters])).code, 0);
  const previous = readFileSync(out, "utf8");
  const previousApp = readFileSync(join(dir, "app.json"), "utf8");
  const broken = { ...sampleBook().chapters.find((c) => c.id === "exit"), title: "x".repeat(41) };
  writeFileSync(join(chapters, "exit.json"), JSON.stringify(broken));
  for (const args of [["--offline"], []]) {
    const node = args.length ? null : await snapchain();
    try {
      const r = await runCli([...args, "--now", NOW, "--out", out, "--chapters", chapters, ...(node ? ["--nodes", node.url] : [])]);
      assert.equal(r.code, 1, r.stderr);
      assert.match(r.stderr, /FAILED, nothing written: compiled book is invalid/);
      assert.equal(readFileSync(out, "utf8"), previous);
      assert.equal(readFileSync(join(dir, "app.json"), "utf8"), previousApp);
      assert.deepEqual(readdirSync(dir), ["app.json", "book.json"], "no temp files");
    } finally {
      await node?.close();
    }
  }
});

test("online: an unchanged book is not rewritten until it is a day old (heartbeat)", async () => {
  const node = await snapchain();
  const out = join(tmp("heartbeat"), "book.json");
  const chapters = tmp("chapters");
  const at = (iso) => runCli(["--now", iso, "--out", out, "--nodes", node.url, "--chapters", chapters]);
  try {
    // After the Nordhoff deadline (19:06:15Z) and before any other status changes.
    assert.equal((await at("2026-11-12T20:00:00Z")).code, 0);
    const first = readFileSync(out, "utf8");
    const hourLater = await at("2026-11-12T21:00:00Z");
    assert.match(hourLater.stdout, /unchanged, not written/);
    assert.equal(readFileSync(out, "utf8"), first);
    const nearlyADay = await at("2026-11-13T19:59:59Z");
    assert.match(nearlyADay.stdout, /unchanged, not written/);
    assert.equal(readFileSync(out, "utf8"), first);
    const dayLater = await at("2026-11-13T20:00:00Z");
    assert.match(dayLater.stdout, /^refresh: wrote /);
    assert.equal(readJson(out).provenance.refreshedAt, "2026-11-13T20:00:00Z");
  } finally {
    await node.close();
  }
});

test("--offline never claims a network read: previous provenance is kept, or none is recorded", async () => {
  const chapters = tmp("chapters");
  // No previous build: no nodes, refreshed now, and the note says it was an offline compile.
  const fresh = join(tmp("offline-prov"), "book.json");
  assert.equal((await runCli(["--offline", "--now", NOW, "--out", fresh, "--chapters", chapters])).code, 0);
  const a = readJson(fresh).provenance;
  assert.deepEqual(a.nodes, []);
  assert.equal(a.refreshedAt, NOW);
  assert.ok(a.note.endsWith(OFFLINE_NOTE), a.note);
  assert.match(a.note, /offline compile/i);
  assert.ok(a.note.startsWith(meta().provenance.note), "the unofficial notice stays");
  // A previous network build: its nodes and refresh time are the last network read, so they stay.
  const dir = tmp("offline-prev");
  const out = join(dir, "book.json");
  const prev = compile({ meta: meta(), seedPrizes: seedPrizes(), seedSubmissions: seedSubmissions(), seedPeople: seedPeople(), chapters: [], fetched: { nodes: ["https://node.example"], refreshedAt: "2026-11-10T08:00:00Z" }, now: "2026-11-10T08:00:00Z" });
  assert.deepEqual(prev.provenance.nodes, ["https://node.example"]);
  assert.equal(prev.provenance.note, meta().provenance.note, "an online build carries the plain note");
  writeFileSync(out, serialize(prev));
  assert.equal((await runCli(["--offline", "--now", NOW, "--out", out, "--chapters", chapters])).code, 0);
  const b = readJson(out);
  assert.deepEqual(b.provenance.nodes, ["https://node.example"]);
  assert.equal(b.provenance.refreshedAt, "2026-11-10T08:00:00Z");
  assert.equal(b.generatedAt, NOW);
  assert.ok(b.provenance.note.endsWith(OFFLINE_NOTE));
  // A previous build with unusable provenance: back to none.
  writeFileSync(out, JSON.stringify({ ...prev, provenance: { ...prev.provenance, nodes: ["http://insecure.example"] } }));
  assert.equal((await runCli(["--offline", "--now", NOW, "--out", out, "--chapters", chapters])).code, 0);
  assert.deepEqual(readJson(out).provenance.nodes, []);
  assert.equal(readJson(out).provenance.refreshedAt, NOW);
});

test("online: a deleted entry leaves the book only when a second node agrees it is gone (S3); seed entries never do", async () => {
  const chapters = tmp("chapters");
  const out = join(tmp("deleted"), "book.json");
  const nordhoff = fixture("replies-nordhoff.json").messages;
  const gone = cast({ fid: 900040, hash: "0x5e70000000000000000000000000000000000e01", at: "2026-11-10T01:00:00Z", parent: { fid: 1, hash: NORDHOFF }, text: "Mine, 50 seconds", embeds: [{ url: "https://youtu.be/gone" }] });
  const has = (h) => readJson(out).submissions.some((s) => s.hash === h);
  const seedNordhoff = seedSubmissions().filter((s) => s.chapter === "what-lasts").map((s) => s.hash);
  /** Run against node A (and node B, if given): each is a snapchain() option set. */
  const run = async (a, b, now) => {
    const nodes = [await snapchain(a), ...(b ? [await snapchain(b)] : [])];
    try {
      const r = await runCli(["--now", now, "--out", out, "--nodes", nodes.map((n) => n.url).join(","), "--chapters", chapters]);
      return { ...r, requests: nodes.map((n) => n.requests) };
    } finally {
      for (const n of nodes) await n.close();
    }
  };
  const live = { replies: { [NORDHOFF]: [...nordhoff, gone] } };
  const without = { replies: { [NORDHOFF]: nordhoff } };
  const first = await run(live, live, NOW);
  assert.equal(first.code, 0, first.stderr);
  assert.ok(has(gone.hash), "the entry was live");
  // Node A reads the thread to its end without the entry, and node B has no such cast either: it leaves the book.
  const second = await run(without, without, "2026-11-12T17:30:00Z");
  assert.equal(second.code, 0, second.stderr);
  assert.match(second.stdout, /^refresh: wrote /);
  assert.ok(!has(gone.hash), "a deleted entry is dropped");
  assert.ok(second.requests[1].includes(`/v1/castById?fid=900040&hash=${gone.hash}`), "node B was asked about it");
  assert.match(second.stderr, /0x5e70000000000000000000000000000000000e01 is no longer an entry .*a second node agrees/);
  for (const h of seedNordhoff) assert.ok(has(h), `seed entry ${h} stays though the stub does not list it`);
  assert.ok(has(nordhoff[0].hash), "entries still in the thread stay");
  // Back again. Node A (lagging) lacks it, node B still has it: one node's word is not enough.
  assert.equal((await run(live, live, "2026-11-12T18:00:00Z")).code, 0);
  assert.ok(has(gone.hash));
  const lagging = await run(without, live, "2026-11-12T18:10:00Z");
  assert.equal(lagging.code, 0, lagging.stderr);
  assert.ok(has(gone.hash), "kept: node B still has it as an entry");
  assert.match(lagging.stderr, /entry 0x5e70000000000000000000000000000000000e01 is missing from one node's complete thread; kept \(.* still has it as an entry\)/);
  // Node B is down: kept.
  const down = await run(without, { ...without, fail: (u) => u.pathname === "/v1/castById" }, "2026-11-12T18:20:00Z");
  assert.equal(down.code, 0, down.stderr);
  assert.ok(has(gone.hash), "kept: no second node could confirm");
  assert.match(down.stderr, /entry 0x5e70000000000000000000000000000000000e01 is missing from one node's complete thread; kept \((no second node could be asked|.* unavailable)\)/);
  // Only one node is configured: never dropped on its word alone.
  const single = await run(without, null, "2026-11-12T18:25:00Z");
  assert.equal(single.code, 0, single.stderr);
  assert.ok(has(gone.hash));
  assert.match(single.stderr, /kept \(only one node is configured\)/);
  // A read cut off at the page cap proves nothing: kept, and no node is even asked.
  const capped = await run({ ...without, endless: [NORDHOFF] }, without, "2026-11-12T18:30:00Z");
  assert.equal(capped.code, 0, capped.stderr);
  assert.match(capped.stderr, new RegExp(`nordhoff: replies truncated at ${REPLY_PAGES} pages`));
  assert.ok(has(gone.hash), "an incomplete read keeps everything");
  assert.ok(!capped.requests[1].some((u) => u.includes(gone.hash)), "nothing to confirm");
  for (const h of seedNordhoff) assert.ok(has(h));
  // Node B has it, but its copy no longer qualifies as an entry (here: no video any more): dropped.
  const noVideo = { ...gone, data: { ...gone.data, castAddBody: { ...gone.data.castAddBody, embeds: [] } } };
  const changed = await run(without, { ...without, byId: { [gone.hash]: noVideo } }, "2026-11-12T18:40:00Z");
  assert.equal(changed.code, 0, changed.stderr);
  assert.ok(!has(gone.hash), "the second node's copy is not an entry");
});
test("online: a node's listing is believed only for what it was asked", async () => {
  // Under fid 1's listing, a cast signed as fid 37 that would otherwise be a new prize.
  const stray = cast({ fid: 37, hash: "0x5e70000000000000000000000000000000000f01", at: "2026-11-12T10:00:00Z", text: "$4096 FOR STRAY PRIZES\n\nMake a video. Three days." });
  const node = await snapchain({ extra: [stray] });
  const out = join(tmp("stray"), "book.json");
  try {
    assert.equal((await runCli(["--now", NOW, "--out", out, "--nodes", node.url, "--chapters", tmp("chapters")])).code, 0);
    assert.ok(!readJson(out).prizes.some((p) => p.castHash === stray.hash));
  } finally {
    await node.close();
  }
});

test("online: a prize carried from a build made under the old caps-PRIZE rule is dropped, with its draft and entries", async () => {
  const award = cast({ fid: 37, hash: "0x5e70000000000000000000000000000000000f11", at: "2026-11-11T10:00:00Z", text: "THE SECOND FARCASTER PRIZE\n\nThe second Farcaster Prize goes to someone. Three days." });
  const old = derivePrize(award, { seedPrizes: seedPrizes() });
  assert.equal(old.kind, "prize");
  const entry = { hash: "0x5e70000000000000000000000000000000000f12", fid: 900060, postedAt: "2026-11-11T11:00:00Z", chapter: old.chapter, kind: "video", gloss: "Video entry", embeds: ["https://youtu.be/old"], url: "https://farcaster.xyz/~/conversations/0x5e70000000000000000000000000000000000f12" };
  const prev = compile({ meta: meta(), seedPrizes: seedPrizes(), seedSubmissions: seedSubmissions(), seedPeople: seedPeople(), chapters: [], fetched: { prizes: [old], submissions: [entry], nodes: [] }, now: NOW });
  assert.ok(prev.chapters.some((c) => c.id === old.chapter) && prev.submissions.some((x) => x.hash === entry.hash));
  const out = join(tmp("old-rule"), "book.json");
  writeFileSync(out, serialize(prev));
  const node = await snapchain();
  try {
    const r = await runCli(["--now", NOW, "--out", out, "--nodes", node.url, "--chapters", tmp("chapters")]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /second-farcaster-prize: carried prize no longer reads as a prize headline; dropped/);
    const book = readJson(out);
    assert.deepEqual(validateBook(book), []);
    assert.ok(!book.prizes.some((p) => p.castHash === award.hash));
    assert.ok(!book.chapters.some((c) => c.id === old.chapter));
    assert.ok(!book.submissions.some((x) => x.hash === entry.hash));
  } finally {
    await node.close();
  }
});

test("a temp file left by a crashed write is ignored by git in content/build/", () => {
  const ignore = readFileSync(join(ROOT, "content/build/.gitignore"), "utf8").split("\n").map((l) => l.trim());
  assert.ok(ignore.includes("*.tmp-*"), "book.json.tmp-<pid> is never committed by `git add -- content/build/`");
});

test("online: a reply read again is classified again; the new reading replaces the carried one", async () => {
  const nordhoff = seedPrizes().find((p) => p.castHash === NORDHOFF);
  const m = fixture("replies-nordhoff.json").messages.find((x) => x.data.fid === 900001);
  const now = classifyReply(m, nordhoff);
  assert.equal(now.gloss, "Video entry, 49 seconds");
  assert.ok(!seedSubmissions().some((x) => x.hash === now.hash), "a fetched entry, not a seed one");
  const stale = { ...now, gloss: "Video entry", embeds: [...now.embeds, "https://old.example/thumb.png"] };
  delete stale.seconds;
  const prev = compile({ meta: meta(), seedPrizes: seedPrizes(), seedSubmissions: seedSubmissions(), seedPeople: seedPeople(), chapters: [], fetched: { submissions: [stale], nodes: [] }, now: NOW });
  assert.equal(prev.submissions.find((x) => x.hash === now.hash).gloss, "Video entry");
  const out = join(tmp("reread"), "book.json");
  writeFileSync(out, serialize(prev));
  const node = await snapchain();
  try {
    assert.equal((await runCli(["--now", NOW, "--out", out, "--nodes", node.url, "--chapters", tmp("chapters")])).code, 0);
    const got = readJson(out).submissions.find((x) => x.hash === now.hash);
    assert.equal(got.gloss, "Video entry, 49 seconds");
    assert.equal(got.seconds, 49);
    assert.deepEqual(got.embeds, now.embeds);
  } finally {
    await node.close();
  }
});

test("app.json: written beside the book (or at --app-out), validated, and both files fail closed together", async () => {
  const chapters = tmp("chapters");
  // Beside a book.json → app.json; beside any other name → <name>.app.json; --app-out wins.
  const dir = tmp("app-paths");
  assert.equal((await runCli(["--offline", "--now", NOW, "--out", join(dir, "atlas.json"), "--chapters", chapters])).code, 0);
  const custom = join(tmp("app-custom"), "nested", "my-app.json");
  assert.equal((await runCli(["--offline", "--now", NOW, "--out", join(dir, "book.json"), "--app-out", custom, "--chapters", chapters])).code, 0);
  assert.deepEqual(readdirSync(dir).sort(), ["atlas.app.json", "atlas.json", "book.json"]);
  assert.deepEqual(validateApp(readJson(custom)), []);
  assert.equal(readFileSync(custom, "utf8"), readFileSync(join(dir, "atlas.app.json"), "utf8"), "same inputs, same app");

  // A broken lesson file is left out of the app with a warning and counted (S17); --strict-lessons fails instead, writing nothing.
  const lessons = tmp("lessons");
  cpSync(join(ROOT, "content/lessons"), lessons, { recursive: true });
  const out = join(dir, "book.json");
  const name = readdirSync(lessons).find((f) => f.endsWith(".json"));
  const lessonId = name.replace(/\.json$/, "");
  writeFileSync(join(lessons, name), JSON.stringify({ ...readJson(join(lessons, name)), promise: "Win the prize before the deadline." }));
  const strictBefore = [readFileSync(out, "utf8"), readFileSync(custom, "utf8")];
  // A later clock, so anything written would differ from what is there.
  const strict = await runCli(["--offline", "--strict-lessons", "--now", "2026-11-12T18:00:00Z", "--out", out, "--app-out", custom, "--chapters", chapters, "--lessons", lessons]);
  assert.equal(strict.code, 1, strict.stderr);
  assert.match(strict.stderr, /FAILED, nothing written: compiled app \(lesson files\) is invalid/);
  assert.deepEqual([readFileSync(out, "utf8"), readFileSync(custom, "utf8")], strictBefore, "neither file is written");
  const r = await runCli(["--offline", "--now", "2026-11-12T18:00:00Z", "--out", out, "--app-out", custom, "--chapters", chapters, "--lessons", lessons]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, new RegExp(`warning: lesson file ${lessonId} fails the contract; left out of the app .*promise`));
  assert.match(r.stdout, /\nrefresh: left out of the app \(see warnings\) — 1 lesson file, 0 works, 0 display names\n$/);
  const appAfter = readJson(custom);
  assert.deepEqual(validateApp(appAfter), []);
  assert.ok(!appAfter.lessons.some((l) => l.id === lessonId && l.status === "ready"), "the broken lesson is not shipped");
  assert.equal(appAfter.lessons.filter((l) => l.status === "ready").length, readdirSync(lessons).length - 1, "the others are");
  // Not JSON at all, or an id that is not the file name: the same.
  for (const [content, why] of [["{ not json", /lesson file .* is not valid JSON/], [JSON.stringify({ ...readJson(join(ROOT, "content/lessons", name)), id: "another-id" }), /is not its file name/]]) {
    writeFileSync(join(lessons, name), content);
    const r2 = await runCli(["--offline", "--now", "2026-11-12T18:00:00Z", "--out", out, "--app-out", custom, "--chapters", chapters, "--lessons", lessons]);
    assert.equal(r2.code, 0, r2.stderr);
    assert.match(r2.stderr, why);
    assert.match(r2.stdout, /left out of the app .* 1 lesson file/);
    const before = [readFileSync(out, "utf8"), readFileSync(custom, "utf8")];
    const r3 = await runCli(["--offline", "--strict-lessons", "--now", "2026-11-12T19:00:00Z", "--out", out, "--app-out", custom, "--chapters", chapters, "--lessons", lessons]);
    assert.equal(r3.code, 1);
    assert.match(r3.stderr, /FAILED, nothing written: compiled app \(lesson files\) is invalid/);
    assert.match(r3.stderr, why);
    assert.deepEqual([readFileSync(out, "utf8"), readFileSync(custom, "utf8")], before);
  }
});

test("online: a new prize becomes a draft lesson; an unchanged app is not rewritten; a lesson edit rewrites only the app", async () => {
  const node = await snapchain();
  const dir = tmp("app-online");
  const out = join(dir, "book.json");
  const chapters = tmp("chapters");
  const lessons = tmp("lessons");
  cpSync(join(ROOT, "content/lessons"), lessons, { recursive: true });
  const run = (now) => runCli(["--now", now, "--out", out, "--nodes", node.url, "--chapters", chapters, "--lessons", lessons]);
  try {
    const first = await run(NOW);
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /\nrefresh: wrote .*\/app\.json — \d+ lessons \(1 draft\), works: .*tragedy-of-the-commons 0\n$/);
    const app = readJson(join(dir, "app.json"));
    assert.deepEqual(validateApp(app), []);
    const draft = app.lessons.find((l) => l.topic === "tragedy-of-the-commons");
    assert.equal(draft.status, "draft");
    assert.equal(draft.title, "Tragedy of the Commons");
    assert.equal(draft.number, Math.max(...app.lessons.filter((l) => l.status === "ready").map((l) => l.number)) + 1);
    assert.ok(!app.lessons.some((l) => ["cloud-cartography", "ai-conference-organizer", "network-state-visuals"].includes(l.topic)), "no archive lessons");

    const appBefore = readFileSync(join(dir, "app.json"), "utf8");
    const bookBefore = readFileSync(out, "utf8");
    const again = await run("2026-11-12T17:30:00Z");
    assert.match(again.stdout, /^refresh: unchanged, not written .*\nrefresh: app unchanged, not written — /);
    assert.equal(readFileSync(join(dir, "app.json"), "utf8"), appBefore);

    // An editor improves a lesson: the app is rebuilt, the book is left alone.
    const name = readdirSync(lessons).find((f) => f.endsWith(".json"));
    const l = readJson(join(lessons, name));
    writeFileSync(join(lessons, name), JSON.stringify({ ...l, minutes: l.minutes === 15 ? 14 : l.minutes + 1 }));
    const edited = await run("2026-11-12T18:00:00Z");
    assert.equal(edited.code, 0, edited.stderr);
    assert.match(edited.stdout, /^refresh: unchanged, not written .*\nrefresh: wrote .*\/app\.json — /);
    assert.equal(readFileSync(out, "utf8"), bookBefore);
    assert.equal(readJson(join(dir, "app.json")).generatedAt, "2026-11-12T18:00:00Z");
  } finally {
    await node.close();
  }
});

test("S3: with two nodes, a new prize the second node lacks, or reads differently, is not used", async () => {
  const PRIZE = "0x5e70000000000000000000000000000000000302";
  const real = fixture("casts-fid1.new-prize.json").messages.find((m) => m.hash === PRIZE);
  const forged = { ...real, data: { ...real.data, castAddBody: { ...real.data.castAddBody, text: "$4096 FOR SOMETHING ELSE ENTIRELY\n\nThree days." } } };
  for (const [byId, verdict] of [[{ [PRIZE]: null }, "missing"], [{ [PRIZE]: forged }, "disagree"]]) {
    const a = await snapchain();
    const b = await snapchain({ byId });
    const out = join(tmp(`prize-${verdict}`), "book.json");
    try {
      const r = await runCli(["--now", NOW, "--out", out, "--nodes", `${a.url},${b.url}`, "--chapters", tmp("chapters")]);
      assert.equal(r.code, 0, r.stderr);
      assert.ok(!readJson(out).prizes.some((p) => p.castHash === PRIZE), verdict);
      assert.match(r.stderr, new RegExp(`prize ${PRIZE}: not confirmed by a second node \\(${verdict}\\)`));
      assert.ok(!readJson(join(dirname(out), "app.json")).lessons.some((l) => l.topic === "tragedy-of-the-commons"), "no draft lesson either");
    } finally {
      await a.close();
      await b.close();
    }
  }
});

test("S3: a results post is used only when a second node confirms it; until then results found earlier stay", async () => {
  const feet = seedSubmissions().filter((s) => s.chapter === "feet" && s.kind === "video");
  const post = cast({ fid: 1, hash: "0x5e70000000000000000000000000000000000d11", at: "2026-11-13T12:00:00Z", parent: { fid: 1, hash: "0x287c8ebe82fba6b086fc7198e2a9a6b32f448139" }, text: `Thank you to everyone who submitted videos on Tiebout sorting!\n\nFirst: farcaster.xyz/someone/${feet[0].hash.slice(0, 10)}` });
  const out = join(tmp("results-confirm"), "book.json");
  const chapters = tmp("chapters");
  const run = async (byId, now) => {
    const a = await snapchain({ extra: [post] });
    const b = await snapchain({ extra: [post], byId });
    try {
      return await runCli(["--now", now, "--out", out, "--nodes", `${a.url},${b.url}`, "--chapters", chapters]);
    } finally {
      await a.close();
      await b.close();
    }
  };
  const tiebout = () => readJson(out).prizes.find((p) => p.id === "tiebout");
  const lagging = await run({ [post.hash]: null }, "2026-11-14T00:00:00Z");
  assert.equal(lagging.code, 0, lagging.stderr);
  assert.equal(tiebout().results, undefined, "one node's results post is not believed");
  assert.match(lagging.stderr, /results 0x5e70000000000000000000000000000000000d11: not confirmed by a second node \(missing\)/);
  assert.equal((await run({}, "2026-11-14T00:30:00Z")).code, 0);
  assert.deepEqual(tiebout().results.places.map((p) => [p.place, p.submission]), [["1st", feet[0].hash]]);
  // The post is still in the feed but the second node now lags: the results found earlier stay (no flapping).
  const again = await run({ [post.hash]: null }, "2026-11-14T01:00:00Z");
  assert.equal(again.code, 0, again.stderr);
  assert.deepEqual(tiebout().results.places.map((p) => [p.place, p.submission]), [["1st", feet[0].hash]]);
});

test("S3: a message whose dataBytes do not hash to its hash, or say something else, is ignored; a consistent one is used", async () => {
  const [prize] = fixture("signed-messages.json").messages;
  const tampered = { ...structuredClone(prize), hash: "0x5e70000000000000000000000000000000000f21" };
  const lying = structuredClone(prize);
  lying.data.castAddBody.text = "$4096 FOR VIDEOS ON SOMETHING THE BYTES DO NOT SAY\n\nThree days.";
  const [, reply] = fixture("signed-messages.json").messages;
  const badReply = { ...structuredClone(reply), hash: "0x5e70000000000000000000000000000000000f23" };
  const node = await snapchain({ extra: [lying, tampered, prize], replies: { [prize.hash]: [badReply, reply] } }); // the forged copy first: rejected, it does not shadow the genuine one
  const out = join(tmp("databytes"), "book.json");
  try {
    const r = await runCli(["--now", NOW, "--out", out, "--nodes", node.url, "--chapters", tmp("chapters")]);
    assert.equal(r.code, 0, r.stderr);
    const prizes = readJson(out).prizes;
    assert.ok(prizes.some((p) => p.castHash === prize.hash && p.id === "verified-casts"), "the consistent message is a prize");
    assert.ok(!prizes.some((p) => p.castHash === tampered.hash));
    assert.match(r.stderr, new RegExp(`ignored message ${tampered.hash}: hash is not BLAKE3 of dataBytes`));
    assert.ok(!prizes.some((p) => /SOMETHING THE BYTES/.test(p.headline)));
    assert.match(r.stderr, /data does not match dataBytes/);
    // Replies are checked the same way: the consistent entry is in, the tampered one is not.
    const subs = readJson(out).submissions;
    assert.ok(subs.some((x) => x.hash === reply.hash && x.kind === "video"), "the verified reply is an entry");
    assert.ok(!subs.some((x) => x.hash === badReply.hash));
    assert.match(r.stderr, new RegExp(`ignored message ${badReply.hash}: hash is not BLAKE3 of dataBytes`));
  } finally {
    await node.close();
  }
});

test("S3: a new reading of a placed entry needs a second node; otherwise the carried reading stays", async () => {
  const nordhoff = seedPrizes().find((p) => p.id === "nordhoff");
  const orig = cast({ fid: 900045, hash: "0x5e70000000000000000000000000000000000e45", at: "2026-11-10T02:00:00Z", parent: { fid: 1, hash: NORDHOFF }, text: "Mine, 40 seconds", embeds: [{ url: "https://youtu.be/original" }] });
  const changed = { ...orig, data: { ...orig.data, castAddBody: { ...orig.data.castAddBody, embeds: [{ url: "https://youtu.be/swapped" }] } } };
  const entry = classifyReply(orig, nordhoff);
  const results = { castHash: "0x5e70000000000000000000000000000000000e49", authorFid: 1, postedAt: "2026-11-12T12:00:00Z", places: [{ place: "1st", amount: "$512", submission: entry.hash, label: "fid 900045" }] };
  const prev = compile({ meta: meta(), seedPrizes: seedPrizes(), seedSubmissions: seedSubmissions(), seedPeople: seedPeople(), chapters: [], fetched: { submissions: [entry], prizes: [{ ...nordhoff, results }], nodes: [] }, now: NOW });
  const out = join(tmp("placed"), "book.json");
  const chapters = tmp("chapters");
  const run = async (byId) => {
    writeFileSync(out, serialize(prev));
    const replies = { [NORDHOFF]: [...fixture("replies-nordhoff.json").messages, changed] };
    const a = await snapchain({ replies });
    const b = await snapchain({ replies, byId });
    try {
      return await runCli(["--now", NOW, "--out", out, "--nodes", `${a.url},${b.url}`, "--chapters", chapters]);
    } finally {
      await a.close();
      await b.close();
    }
  };
  const embeds = () => readJson(out).submissions.find((s) => s.hash === entry.hash).embeds;
  const disagree = await run({ [orig.hash]: orig });
  assert.equal(disagree.code, 0, disagree.stderr);
  assert.deepEqual(embeds(), ["https://youtu.be/original"], "the second node still has the original");
  assert.match(disagree.stderr, /placed entry 0x5e70000000000000000000000000000000000e45: not confirmed by a second node \(disagree\)/);
  assert.equal(readJson(join(dirname(out), "app.json")).lessons.find((l) => l.topic === "nordhoff").work[0].video.external, "https://youtu.be/original");
  const agree = await run({});
  assert.equal(agree.code, 0, agree.stderr);
  assert.deepEqual(embeds(), ["https://youtu.be/swapped"], "both nodes read it so: the new reading is used");
});

/** A client double for fetchUpdates: nothing new on the network; user lookups are recorded. */
function quietClient({ nodes = ["https://a.example"], users = {}, failUsers = null } = {}) {
  const calls = [];
  const listing = async () => ({ messages: [], pages: 1, truncated: false, node: nodes[0] });
  return {
    calls,
    nodes,
    allCastsByFid: listing,
    allCastsByParent: listing,
    userDataByFid: async (fid) => {
      calls.push(fid);
      if (failUsers) throw failUsers(fid);
      return { messages: users[fid] || [] };
    },
    answeredNodes: () => nodes,
    witnesses: () => [],
    probeCast: async () => ({ status: "unavailable" }),
  };
}

test("S19: an unnamed fid is looked up at most once a day; never-tried and longest-waiting fids go first, so the cap starves no one", async () => {
  const nordhoff = seedPrizes().find((p) => p.id === "nordhoff");
  const extra = Array.from({ length: 120 }, (_, i) => classifyReply(cast({ fid: 900100 + i, hash: `0x5e7000000000000000000000000000000000${(0x1000 + i).toString(16)}`, at: "2026-11-10T03:00:00Z", parent: { fid: 1, hash: NORDHOFF }, text: "Mine", embeds: [{ url: "https://youtu.be/x" }] }), nordhoff));
  const base = { meta: meta(), seedPrizes: seedPrizes(), seedSubmissions: seedSubmissions(), seedPeople: seedPeople(), chapters: [] };
  const fetchAt = async (client, now, previous) => fetchUpdates({ ...base, client, now, previous });
  const prev = (lookups, people = {}) => ({ prizes: [], submissions: extra, people, provenance: { nodes: [], refreshedAt: NOW, ...(lookups ? { lookups } : {}) } });
  const T = "2026-11-12T00:00:00Z";
  const one = quietClient();
  const r1 = await fetchAt(one, T, prev());
  assert.equal(one.calls.length, MAX_USER_LOOKUPS, "capped");
  assert.deepEqual(one.calls, [...one.calls].sort((a, b) => a - b), "never-tried fids by fid");
  const unnamed = Object.keys(r1.lookups).length;
  assert.equal(unnamed, MAX_USER_LOOKUPS, "every lookup is remembered");
  assert.ok(Object.values(r1.lookups).every((t) => t === T));
  // An hour later: only the fids never tried, none of the others.
  const two = quietClient();
  const r2 = await fetchAt(two, "2026-11-12T01:00:00Z", prev(r1.lookups));
  assert.ok(two.calls.length > 0 && two.calls.length < MAX_USER_LOOKUPS, `${two.calls.length}`);
  assert.ok(two.calls.every((fid) => !(String(fid) in r1.lookups)), "nothing looked up again within a day");
  assert.ok(two.calls.includes(900219), "the highest fid is reached");
  assert.equal(Object.keys(r2.lookups).length, MAX_USER_LOOKUPS + two.calls.length);
  // A day after the first run: the longest-waiting go first; the cap still holds.
  const three = quietClient();
  const r3 = await fetchAt(three, "2026-11-13T00:30:00Z", prev(r2.lookups));
  assert.deepEqual(three.calls.sort((a, b) => a - b), one.calls, "the fids tried first are retried first");
  assert.equal(r3.lookups[String(two.calls[0])], "2026-11-12T01:00:00Z", "the others keep their time");
  // Longest-waiting first, even when those are the highest fids: no fid is starved by the cap.
  const all = Object.keys(r2.lookups).map(Number).sort((a, b) => a - b);
  const highest = all.slice(-20);
  const skewed = Object.fromEntries(all.map((fid) => [fid, highest.includes(fid) ? "2026-11-09T00:00:00Z" : "2026-11-10T00:00:00Z"]));
  const six = quietClient();
  await fetchAt(six, "2026-11-12T00:00:00Z", prev(skewed));
  assert.equal(six.calls.length, MAX_USER_LOOKUPS);
  for (const fid of highest) assert.ok(six.calls.includes(fid), `the longest-waiting fid ${fid} is looked up`);
  assert.ok(!six.calls.includes(all[MAX_USER_LOOKUPS - highest.length]), "a more recently tried fid waits");
  // A fid that gets a username leaves the list and is never looked up again; one that is only renamed stays.
  const [named, displayOnly] = [one.calls[0], one.calls[1]];
  const users = {
    [named]: [{ data: { type: "MESSAGE_TYPE_USER_DATA_ADD", fid: named, timestamp: 9, userDataBody: { type: "USER_DATA_TYPE_USERNAME", value: "found-one" } }, hash: "0x" + "d".repeat(40) }],
    [displayOnly]: [{ data: { type: "MESSAGE_TYPE_USER_DATA_ADD", fid: displayOnly, timestamp: 9, userDataBody: { type: "USER_DATA_TYPE_DISPLAY", value: "Just A Name" } }, hash: "0x" + "e".repeat(40) }],
  };
  const four = quietClient({ users });
  const r4 = await fetchAt(four, "2026-11-14T01:00:00Z", prev(r3.lookups));
  assert.ok(!(String(named) in r4.lookups));
  assert.equal(r4.lookups[String(displayOnly)], "2026-11-14T01:00:00Z");
  assert.ok(r4.people.some((p) => p.fid === named && p.username === "found-one"));
  const five = quietClient();
  await fetchAt(five, "2026-11-16T00:00:00Z", prev(r4.lookups, { [named]: { fid: named, username: "found-one" } }));
  assert.ok(!five.calls.includes(named));
  // The lookup times reach book.json (provenance.lookups) and survive an offline compile.
  const book = compile({ ...base, fetched: { ...r1, nodes: [] }, now: T });
  assert.deepEqual(book.provenance.lookups, r1.lookups);
  assert.deepEqual(Object.keys(book.provenance.lookups), Object.keys(r1.lookups).sort((a, b) => a - b), "in fid order");
  assert.deepEqual(validateBook(book), []);
  assert.deepEqual(offlineProvenance(book, "2026-11-13T00:00:00Z").lookups, r1.lookups);
  assert.deepEqual(validLookups({ 12: "2026-11-12T00:00:00.500Z", x: NOW, 0: NOW, 7: "soon", constructor: NOW }), { 12: "2026-11-12T00:00:00Z" });
});

test("M41: a user lookup no node answers fails the run (never read as 'nobody'); a 4xx is an answer", async () => {
  const base = { meta: meta(), seedPrizes: seedPrizes(), seedSubmissions: seedSubmissions(), seedPeople: seedPeople(), chapters: [], now: NOW, previous: null };
  await assert.rejects(fetchUpdates({ ...base, client: quietClient({ failUsers: (fid) => new NodeUnavailable(`/v1/userDataByFid?fid=${fid}`, [{ node: "https://a.example", reason: "HTTP 503" }]) }) }), NodeUnavailable);
  const answered = quietClient({ failUsers: (fid) => new NodeHttpError("https://a.example", `/v1/userDataByFid?fid=${fid}`, 400, "unknown fid") });
  const r = await fetchUpdates({ ...base, client: answered });
  assert.ok(answered.calls.length > 0);
  assert.equal(Object.keys(r.lookups).length, answered.calls.length, "an answered lookup is remembered");
  // Through the CLI: nothing written.
  const node = await snapchain({ fail: (u) => u.pathname === "/v1/userDataByFid" });
  const dir = tmp("users-down");
  try {
    const res = await runCli(["--now", NOW, "--out", join(dir, "book.json"), "--nodes", node.url, "--chapters", tmp("chapters")]);
    assert.equal(res.code, 1, res.stderr);
    assert.match(res.stderr, /FAILED, nothing written: node unavailable .*userDataByFid/);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    await node.close();
  }
});

test("S10: the app's generatedAt moves when, and only when, its content changes, and always forward", () => {
  const { meta: am, works, lessons } = loadAppInputs(ROOT);
  const b = compile({ meta: meta(), seedPrizes: seedPrizes(), seedSubmissions: seedSubmissions(), seedPeople: seedPeople(), chapters: [], now: NOW });
  const prev = compileApp({ meta: am, works, lessons, book: b, now: "2026-11-12T18:00:00Z" });
  const same = compileApp({ meta: am, works, lessons, book: b, now: "2026-11-12T17:00:00Z" });
  const edited = compileApp({ meta: am, works: { ...works, captions: { ...works.captions, "0x780d71e5b43cfe009ffcaf5ff0ac234bb711a927": "A different line about the piece" } }, lessons, book: b, now: NOW });
  assert.equal(appGeneratedAt(null, same, NOW), NOW, "no previous app: now");
  assert.equal(appGeneratedAt(prev, same, "2026-11-12T17:00:00Z"), "2026-11-12T18:00:00Z", "same content: the previous time, even with an older clock");
  assert.equal(appGeneratedAt(prev, same, "2026-11-20T00:00:00Z"), "2026-11-12T18:00:00Z", "same content: the previous time, even with a newer clock");
  assert.equal(appGeneratedAt(prev, edited, "2026-11-12T19:00:00Z"), "2026-11-12T19:00:00Z", "changed: now");
  assert.equal(appGeneratedAt(prev, edited, "2026-11-12T17:00:00Z"), "2026-11-12T18:00:01Z", "changed, older clock: just after the previous");
  assert.equal(appGeneratedAt({ ...prev, generatedAt: "2026-11-12T18:00:00.700Z" }, edited, NOW), "2026-11-12T18:00:01Z");
  assert.equal(appGeneratedAt({ ...prev, generatedAt: "garbage" }, edited, NOW), NOW);
});

test("S10: an offline rebuild with an older clock still gives an edited app a newer generatedAt; an unchanged one is byte-identical", async () => {
  const dir = tmp("s10");
  const out = join(dir, "book.json");
  const lessons = tmp("lessons");
  cpSync(join(ROOT, "content/lessons"), lessons, { recursive: true });
  const at = (now) => runCli(["--offline", "--now", now, "--out", out, "--chapters", tmp("chapters"), "--lessons", lessons]);
  assert.equal((await at("2026-11-12T18:00:00Z")).code, 0);
  const first = readFileSync(join(dir, "app.json"), "utf8");
  assert.equal((await at("2026-11-12T17:00:00Z")).code, 0);
  assert.equal(readFileSync(join(dir, "app.json"), "utf8"), first, "same content, same bytes");
  const name = readdirSync(lessons)[0];
  const l = readJson(join(lessons, name));
  writeFileSync(join(lessons, name), JSON.stringify({ ...l, minutes: l.minutes === 15 ? 14 : l.minutes + 1 }));
  assert.equal((await at("2026-11-12T17:00:00Z")).code, 0);
  assert.equal(readJson(join(dir, "app.json")).generatedAt, "2026-11-12T18:00:01Z", "newer than what readers have");
});

test("--offline carries what earlier online runs fetched (the deploy and the editor's check rebuild without losing it)", async () => {
  const m = fixture("casts-fid1.new-prize.json").messages.find((x) => x.hash.endsWith("302"));
  const p = derivePrize(m, { seedPrizes: seedPrizes() });
  const entry = classifyReply(fixture("replies-new-prize.json").messages[0], p);
  assert.ok(entry);
  const results = { castHash: "0x5e70000000000000000000000000000000000e59", authorFid: 1, postedAt: "2026-11-16T12:00:00Z", places: [{ place: "1st", amount: "$512", submission: entry.hash, label: "x" }] };
  const prev = compile({ meta: meta(), seedPrizes: seedPrizes(), seedSubmissions: seedSubmissions(), seedPeople: seedPeople(), chapters: [], fetched: { prizes: [{ ...p, results }], submissions: [entry], people: [{ fid: entry.fid, username: "fetched-one" }], nodes: ["https://node.example"], refreshedAt: NOW }, now: NOW });
  const dir = tmp("carry");
  const out = join(dir, "book.json");
  writeFileSync(out, serialize(prev));
  const r = await runCli(["--offline", "--now", "2026-11-17T00:00:00Z", "--out", out, "--chapters", tmp("chapters")]);
  assert.equal(r.code, 0, r.stderr);
  const book = readJson(out);
  assert.deepEqual(validateBook(book), []);
  assert.deepEqual(book.prizes.find((x) => x.castHash === p.castHash).results, results);
  assert.ok(book.submissions.some((s) => s.hash === entry.hash));
  assert.equal(book.people[String(entry.fid)].username, "fetched-one");
  assert.deepEqual(book.provenance.nodes, ["https://node.example"], "still the last network read");
  const lesson = readJson(join(dir, "app.json")).lessons.find((l) => l.topic === p.id);
  assert.equal(lesson.status, "draft");
  assert.deepEqual(lesson.work.map((w) => [w.role, w.id]), [["lead", entry.hash]]);
  // A prize from the old caps-PRIZE rule is not carried offline either.
  const award = derivePrize(cast({ fid: 37, hash: "0x5e70000000000000000000000000000000000f31", at: "2026-11-11T10:00:00Z", text: "THE SECOND FARCASTER PRIZE\n\nGoes to someone." }), { seedPrizes: seedPrizes() });
  assert.equal(offlineCarry({ prizes: [award, p] }).prizes.length, 1);
});
