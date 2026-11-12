// I6: the refresh CLI (offline and against a local Snapchain stub) and the scheduled workflow.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { validateBook } from "../../contract/validate.mjs";
import { compile, NEW_KICKER, OFFLINE_NOTE, serialize } from "../src/compile.mjs";
import { DEFAULT_TIMEOUT_MS, NodeUnavailable } from "../src/node.mjs";
import { loadAppInputs, personFromUserData, REPLY_PAGES, runRefresh } from "../src/refresh.mjs";
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
 */
function snapchain({ fail = () => false, extra = [], replies: over = {}, endless = [], without = [] } = {}) {
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

/** The workflow file as lines, and one job's or step's block by its header line. */
function workflow() {
  const text = readFileSync(join(ROOT, ".github/workflows/refresh.yml"), "utf8");
  const lines = text.split("\n");
  const block = (header) => {
    const i = lines.findIndex((l) => l.trimEnd() === header);
    assert.ok(i >= 0, `no line ${header.trim()}`);
    const indent = lines[i].search(/\S/);
    const out = [lines[i]];
    for (const l of lines.slice(i + 1)) {
      if (l.trim() && l.search(/\S/) <= indent) break;
      out.push(l);
    }
    return out;
  };
  return { text, lines, block };
}

test("the workflow runs refresh every 30 minutes and commits only content/build/", () => {
  const { text: y } = workflow();
  assert.match(y, /schedule:\s*\n\s*- cron: "\*\/30 \* \* \* \*"/);
  assert.match(y, /workflow_dispatch:/);
  assert.match(y, /node-version: 22/);
  const adds = [...y.matchAll(/git add[^\n]*/g)].map((m) => m[0]);
  assert.deepEqual(adds, ["git add -- content/build/"]);
  assert.match(y, /git status --porcelain -- content\/build\//, "commits only when content/build changed");
  assert.match(y, /cd app && npm ci && npm test && npm run build/);
  assert.match(y, /actions\/upload-pages-artifact@v\d+\n\s+with:\n\s+path: app\/dist/);
  assert.match(y, /actions\/deploy-pages@v\d+/);
  assert.match(y, /^permissions: \{\}$/m, "no default permissions");
  for (const m of y.matchAll(/uses: ([^\s]+)/g)) assert.match(m[1], /^actions\/[a-z-]+@v\d+$/, `pinned major: ${m[1]}`);
});

test("the workflow reads the network, fails loudly, never overlaps, and commits and pushes only content/build/", () => {
  const { text: y, lines, block } = workflow();
  // The refresh step: exactly the online command, nothing appended (no --offline); a push only redeploys.
  const step = block("      - name: Refresh content/build from public nodes");
  assert.deepEqual(step.map((l) => l.trim()).filter(Boolean), ["- name: Refresh content/build from public nodes", "if: github.event_name != 'push'", 'run: node ingest/bin/refresh.mjs --now "$(date -u +%FT%TZ)"']);
  assert.ok(!/--offline/.test(y), "the scheduled job never compiles offline");
  // A failure fails the job, so nothing is committed or deployed.
  assert.ok(!/continue-on-error/.test(y), "no continue-on-error anywhere");
  assert.ok(!/\|\|\s*true/.test(y), "no `|| true`");
  // One run at a time, and a queued run is not cancelled.
  assert.match(y, /^concurrency:\n  group: [\w-]+\n  cancel-in-progress: false$/m);
  // The commit takes only what was added (content/build/), never every tracked change.
  const commits = lines.map((l) => l.trim()).filter((l) => /\bgit\b.*\bcommit\b/.test(l));
  assert.deepEqual(commits, ['git commit -m "ingest: refresh content/build"']);
  for (const l of lines) {
    assert.ok(!/\bgit\b.*\bcommit\b.*(\s-[a-zA-Z]*a[a-zA-Z]*\b|--all\b|--include\b|\s--\s)/.test(l), `commit -a / --all: ${l.trim()}`);
    assert.ok(!/\bgit\b.*\bpush\b.*(--force|\s-f\b|--mirror|\s\+\S)/.test(l), `force push: ${l.trim()}`);
    assert.ok(!/\bgit\b.*\b(reset --hard|push --delete)\b/.test(l), l.trim());
  }
  const pushes = lines.map((l) => l.trim()).filter((l) => /\bgit\b.*\bpush\b/.test(l));
  assert.deepEqual(pushes, ['git push origin "HEAD:$GITHUB_REF_NAME"']);
  // The job checks out the branch head, so a queued run starts from the latest book.json.
  const job = block("  refresh:");
  assert.ok(job.some((l) => l.replace(/\s+#.*$/, "").trim() === "ref: ${{ github.ref_name }}"), "refresh job checks out the branch head");
  // Deploy only after a successful refresh.
  assert.ok(block("  deploy:").some((l) => l.trim() === "needs: refresh"));
  // Commits happen on scheduled (and manual) runs only, never on a push.
  const commit = block("      - name: Commit content/build/ if it changed").map((l) => l.trim());
  assert.ok(commit.includes("if: github.event_name != 'push'"), "a push never commits");
  assert.ok(commit.includes("id: commit"));
});

test("G2: the workflow builds and tests the app, deploys app/dist to Pages, and never deploys web/", () => {
  const { text: y, block } = workflow();
  // Triggers: every 30 minutes, on demand, and on merges to main that touch what the app is built from.
  const on = block("on:").map((l) => l.trim()).filter(Boolean);
  assert.deepEqual(on, ["on:", "schedule:", '- cron: "*/30 * * * *"', "workflow_dispatch:", "push:", "branches: [main]", "paths:", '- "app/**"', '- "content/**"', '- "contract/**"', '- "ingest/**"']);
  // The deploy job: after the refresh, on a change, a push or a manual run; read-only contents.
  const deploy = block("  deploy:").map((l) => l.replace(/\s+#.*$/, "").trim()).filter(Boolean);
  assert.ok(deploy.includes("needs: refresh"));
  assert.ok(deploy.includes("if: needs.refresh.outputs.changed == 'true' || github.event_name != 'schedule'"), "scheduled runs deploy only on change; pushes and manual runs always");
  const perms = deploy.slice(deploy.indexOf("permissions:") + 1, deploy.indexOf("permissions:") + 4);
  assert.deepEqual(perms, ["contents: read", "pages: write", "id-token: write"]);
  // Steps, in order: the branch head, Node 22, the app's tests and build, then the Pages artifact from app/dist and the deploy.
  const steps = deploy.slice(deploy.indexOf("steps:") + 1);
  const at = (line) => {
    const i = steps.indexOf(line);
    assert.ok(i >= 0, `deploy step line missing: ${line}`);
    return i;
  };
  const order = [
    at("- uses: actions/checkout@v5"),
    at("ref: ${{ github.ref_name }}"),
    at("node-version: 22"),
    at("run: cd app && npm ci && npm test && npm run build"),
    at("- uses: actions/upload-pages-artifact@v5"),
    at("path: app/dist"),
    at("uses: actions/deploy-pages@v5"),
  ];
  assert.deepEqual(order, [...order].sort((p, q) => p - q), "build, then upload, then deploy");
  assert.equal(steps[order[5] - 1], "with:");
  // The legacy atlas is never built or deployed.
  const code = y.split("\n").map((l) => l.replace(/(^|\s)#.*$/, "")).join("\n"); // comments may name it
  assert.ok(!/\bweb\b/.test(code), "no web/ build or deploy");
  assert.equal([...y.matchAll(/upload-pages-artifact/g)].length, 1, "one Pages artifact");
  assert.equal([...y.matchAll(/deploy-pages/g)].length, 1, "one deploy");
  // The refresh job holds the only write permission, and it only commits content/build/.
  const refresh = block("  refresh:").map((l) => l.trim());
  assert.deepEqual(refresh.slice(refresh.indexOf("permissions:") + 1, refresh.indexOf("permissions:") + 2).map((l) => l.replace(/\s+#.*$/, "")), ["contents: write"]);
  assert.equal([...y.matchAll(/contents: write/g)].length, 1);
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

test("online: a rate-limited first node (429) → the second node is used", async () => {
  const limited = await snapchain({ fail: () => 429 });
  const up = await snapchain();
  const out = join(tmp("429"), "book.json");
  try {
    const r = await runCli(["--now", NOW, "--out", out, "--nodes", `${limited.url},${up.url}`, "--chapters", tmp("chapters")]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(limited.requests.length > 0 && up.requests.length > 0);
    assert.ok(readJson(out).prizes.some((p) => p.id === "tragedy-of-the-commons"));
  } finally {
    await limited.close();
    await up.close();
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

test("online: a deleted entry leaves the book when its thread is read completely; seed entries never do", async () => {
  const chapters = tmp("chapters");
  const out = join(tmp("deleted"), "book.json");
  const nordhoff = fixture("replies-nordhoff.json").messages;
  const gone = cast({ fid: 900040, hash: "0x5e70000000000000000000000000000000000e01", at: "2026-11-10T01:00:00Z", parent: { fid: 1, hash: NORDHOFF }, text: "Mine, 50 seconds", embeds: [{ url: "https://youtu.be/gone" }] });
  const has = (h) => readJson(out).submissions.some((s) => s.hash === h);
  const seedNordhoff = seedSubmissions().filter((s) => s.chapter === "what-lasts").map((s) => s.hash);
  const run = async (opts, now) => {
    const node = await snapchain(opts);
    try {
      return await runCli(["--now", now, "--out", out, "--nodes", node.url, "--chapters", chapters]);
    } finally {
      await node.close();
    }
  };
  const first = await run({ replies: { [NORDHOFF]: [...nordhoff, gone] } }, NOW);
  assert.equal(first.code, 0, first.stderr);
  assert.ok(has(gone.hash), "the entry was live");
  // The thread is read to its end and the entry is gone: it leaves the book (and the file is rewritten).
  const second = await run({ replies: { [NORDHOFF]: nordhoff } }, "2026-11-12T17:30:00Z");
  assert.equal(second.code, 0, second.stderr);
  assert.match(second.stdout, /^refresh: wrote /);
  assert.ok(!has(gone.hash), "a deleted entry is dropped");
  assert.match(second.stderr, /0x5e70000000000000000000000000000000000e01 is no longer an entry/);
  for (const h of seedNordhoff) assert.ok(has(h), `seed entry ${h} stays though the stub does not list it`);
  assert.ok(has(nordhoff[0].hash), "entries still in the thread stay");
  // Back again, then a read cut off at the page cap: nothing carried is dropped.
  assert.equal((await run({ replies: { [NORDHOFF]: [...nordhoff, gone] } }, "2026-11-12T18:00:00Z")).code, 0);
  assert.ok(has(gone.hash));
  const capped = await run({ replies: { [NORDHOFF]: nordhoff }, endless: [NORDHOFF] }, "2026-11-12T18:30:00Z");
  assert.equal(capped.code, 0, capped.stderr);
  assert.match(capped.stderr, new RegExp(`nordhoff: replies truncated at ${REPLY_PAGES} pages`));
  assert.ok(has(gone.hash), "an incomplete read keeps everything");
  for (const h of seedNordhoff) assert.ok(has(h));
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

  // A broken lesson file: exit 1, and neither file is touched.
  const lessons = tmp("lessons");
  cpSync(join(ROOT, "content/lessons"), lessons, { recursive: true });
  const out = join(dir, "book.json");
  const before = [readFileSync(out, "utf8"), readFileSync(custom, "utf8")];
  const name = readdirSync(lessons).find((f) => f.endsWith(".json"));
  writeFileSync(join(lessons, name), JSON.stringify({ ...readJson(join(lessons, name)), promise: "Win the prize before the deadline." }));
  // A later clock, so anything written would differ from what is there.
  const r = await runCli(["--offline", "--now", "2026-11-12T18:00:00Z", "--out", out, "--app-out", custom, "--chapters", chapters, "--lessons", lessons]);
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /FAILED, nothing written: compiled app is invalid/);
  assert.deepEqual([readFileSync(out, "utf8"), readFileSync(custom, "utf8")], before, "the valid book is not written either");
  writeFileSync(join(lessons, name), "{ not json");
  const r2 = await runCli(["--offline", "--now", "2026-11-12T18:00:00Z", "--out", out, "--app-out", custom, "--chapters", chapters, "--lessons", lessons]);
  assert.equal(r2.code, 1);
  assert.match(r2.stderr, /lesson file .* is not valid JSON/);
  assert.deepEqual([readFileSync(out, "utf8"), readFileSync(custom, "utf8")], before);
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
