// I5: compile meta + seed + chapters + fetched → a valid, deterministic Book with drafts and statuses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBook, validateInline } from "../../contract/validate.mjs";
import { ARCHIVE_THREAD, CompileError, NEW_KICKER, NEW_THREAD, OFFLINE_NOTE, compile, prizeStatus, serialize } from "../src/compile.mjs";
import { derivePrize } from "../src/detect.mjs";
import { classifyReply } from "../src/classify.mjs";
import { fixture, meta, sampleBook, seedPeople, seedPrizes, seedSubmissions } from "./helpers.mjs";

const NOW = "2026-11-12T17:00:00Z";
const base = (over = {}) => ({
  meta: meta(),
  seedPrizes: seedPrizes(),
  seedSubmissions: seedSubmissions(),
  seedPeople: seedPeople(),
  chapters: [],
  fetched: {},
  now: NOW,
  ...over,
});
const sampleChapters = () => sampleBook().chapters.filter((c) => c.status === "published");
const newPrizeCast = () => fixture("casts-fid1.new-prize.json").messages.find((m) => m.hash.endsWith("302"));
const newPrize = () => derivePrize(newPrizeCast(), { seedPrizes: seedPrizes() });
const day = 86_400_000;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

test("same inputs twice → byte-identical output", () => {
  const fetched = { prizes: [newPrize()], submissions: fixture("replies-new-prize.json").messages.map((m) => classifyReply(m, newPrize())), people: [{ fid: 900020, username: "commons-maker" }] };
  const a = serialize(compile(base({ chapters: sampleChapters(), fetched })));
  const b = serialize(compile(base({ chapters: sampleChapters(), fetched: structuredClone(fetched) })));
  assert.equal(a, b);
  // Input order does not matter either.
  const shuffled = base({
    seedPrizes: seedPrizes().reverse(),
    seedSubmissions: seedSubmissions().reverse(),
    chapters: sampleChapters().reverse(),
    fetched: { ...structuredClone(fetched), prizes: [...fetched.prizes].reverse() },
  });
  assert.equal(serialize(compile(shuffled)), a);
});

test("no chapter files: every prize becomes a draft, the three 2024 archive prizes included, and the book validates", () => {
  const book = compile(base());
  assert.deepEqual(validateBook(book), []);
  const prizes = seedPrizes().filter((p) => p.kind === "prize");
  for (const p of prizes) {
    const c = book.chapters.find((x) => x.id === p.chapter);
    assert.ok(c, `draft for ${p.id}`);
    assert.equal(c.status, "draft");
    assert.equal(c.kind, "chapter");
    assert.equal(c.prize, p.id);
    assert.deepEqual(c.connections, []);
    assert.deepEqual(c.strands, p.strands, `${p.id}: strands from the prize hint`);
    assert.deepEqual(c.objections, []);
    assert.deepEqual(c.terms, []);
    assert.equal(c.minute, p.deliverable);
    assert.deepEqual(c.essay, [{ type: "p", text: p.deliverable }]);
    assert.ok(c.title.length <= 40 && c.line.length <= 200);
    assert.deepEqual(c.practice.action, { label: "Reply on Farcaster", url: `https://farcaster.xyz/~/conversations/${p.castHash}` });
  }
  for (const id of ["cloud-cartography", "ai-conference-organizer", "network-state-visuals"]) {
    const c = book.chapters.find((x) => x.id === id);
    assert.equal(c.kicker, "From the archive · 2024");
    assert.equal(c.thread, ARCHIVE_THREAD);
  }
  const feet = book.chapters.find((x) => x.id === "feet");
  assert.equal(feet.kicker, NEW_KICKER);
  assert.equal(feet.thread, NEW_THREAD);
  assert.equal(feet.title, "Tiebout Sorting");
  // Numbered 1.. by prize date; no prologue or coda without files.
  assert.deepEqual(book.chapters.map((c) => c.number), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(book.chapters.map((c) => c.id), ["cloud-cartography", "ai-conference-organizer", "network-state-visuals", "exit", "friend-speech", "feet", "what-lasts"]);
  // The editor's path keeps only ideas in this book.
  assert.deepEqual(book.paths.find((p) => p.id === "editors-path").chapters, ["exit", "friend-speech", "feet", "what-lasts"]);
  for (const c of book.chapters) {
    assert.ok(Array.isArray(c.strands) && Array.isArray(c.connections));
  }
  assert.equal(book.generatedAt, NOW);
  assert.equal(book.provenance.refreshedAt, NOW);
  assert.deepEqual(book.provenance.nodes, [], "nothing was read: the configured nodes are not claimed");
  assert.equal(book.provenance.note, `${meta().provenance.note} ${OFFLINE_NOTE}`);
  assert.deepEqual(book.thesis, meta().thesis);
});

test("provenance names only the nodes actually read", () => {
  const online = compile(base({ fetched: { nodes: ["https://node.example"], refreshedAt: "2026-11-12T16:59:00Z" } }));
  assert.deepEqual(online.provenance.nodes, ["https://node.example"]);
  assert.equal(online.provenance.refreshedAt, "2026-11-12T16:59:00Z");
  assert.equal(online.provenance.note, meta().provenance.note);
  const offlineKept = compile(base({ fetched: { nodes: ["https://node.example"], refreshedAt: "2026-11-10T00:00:00Z", offline: true } }));
  assert.deepEqual(offlineKept.provenance.nodes, ["https://node.example"]);
  assert.match(offlineKept.provenance.note, /Offline compile/);
  assert.deepEqual(compile(base({ fetched: { nodes: [] } })).provenance.nodes, [], "a run where no https node answered");
});

test("submissions with the same postedAt are ordered by hash, whatever the input order", () => {
  const at = "2026-11-10T00:00:00Z";
  const mk = (n) => ({ hash: `0x5e70000000000000000000000000000000000b${n}`, fid: 900030, postedAt: at, chapter: "feet", kind: "video", gloss: "Video entry", embeds: ["https://youtu.be/x"], url: `https://farcaster.xyz/~/conversations/0x5e70000000000000000000000000000000000b${n}` });
  const [x, y, z] = [mk("11"), mk("12"), mk("13")];
  const one = compile(base({ fetched: { submissions: [z, x, y] } }));
  const two = compile(base({ fetched: { submissions: [y, z, x] } }));
  assert.equal(serialize(one), serialize(two));
  const ours = one.submissions.filter((s) => s.postedAt === at).map((s) => s.hash);
  assert.deepEqual(ours, [x.hash, y.hash, z.hash]);
});

test("a fetched submission whose idea is not in the book is dropped, not a broken book", () => {
  const warnings = [];
  const orphan = { hash: "0x5e70000000000000000000000000000000000b21", fid: 900030, postedAt: NOW, chapter: "gone-prize", kind: "video", gloss: "Video entry", embeds: ["https://youtu.be/x"], url: "https://farcaster.xyz/~/conversations/0x5e70000000000000000000000000000000000b21" };
  const book = compile(base({ fetched: { submissions: [orphan] }, onWarning: (m) => warnings.push(m) }));
  assert.deepEqual(validateBook(book), []);
  assert.ok(!book.submissions.some((s) => s.hash === orphan.hash));
  assert.ok(warnings.some((w) => /gone-prize is not in this book/.test(w)));
});

test("chapter files cover their prizes; drafts number after the highest non-coda idea", () => {
  const book = compile(base({ chapters: sampleChapters() }));
  assert.deepEqual(validateBook(book), []);
  const byId = Object.fromEntries(book.chapters.map((c) => [c.id, c]));
  for (const id of ["exit", "friend-speech", "what-lasts"]) assert.equal(byId[id].status, "published");
  assert.equal(byId.feet.status, "draft", "tiebout has no chapter file in the sample");
  assert.deepEqual(
    book.chapters.map((c) => [c.number, c.id]),
    [[0, "prologue"], [1, "exit"], [2, "friend-speech"], [4, "what-lasts"], [5, "cloud-cartography"], [6, "ai-conference-organizer"], [7, "network-state-visuals"], [8, "feet"], [99, "next-pick"]],
  );
  assert.deepEqual(book.paths[0].chapters, ["prologue", "exit", "friend-speech", "feet", "what-lasts", "next-pick"]);
});

test("a new prize (fetched) → draft present, open, and the book validates", () => {
  const p = newPrize();
  const book = compile(base({ chapters: sampleChapters(), fetched: { prizes: [p] } }));
  assert.deepEqual(validateBook(book), []);
  const prize = book.prizes.find((x) => x.castHash === p.castHash);
  assert.equal(prize.status, "open");
  const c = book.chapters.find((x) => x.prize === p.id);
  assert.equal(c.id, "tragedy-of-the-commons");
  assert.equal(c.status, "draft");
  assert.equal(c.number, 9, "after the archive drafts and feet");
  assert.equal(c.kicker, NEW_KICKER);
  assert.equal(c.title, "Tragedy of the Commons");
  assert.deepEqual(c.strands, [], "no hint → unplaced");
  assert.deepEqual(c.connections, []);
  assert.match(c.line, /^Book club pick #3\./);
});

test("status: open, judging up to 14 days after the deadline, closed after, awarded with results", () => {
  const deadline = Date.parse("2026-11-11T21:34:58Z");
  const p = { kind: "prize", deadline: "2026-11-11T21:34:58Z" };
  assert.equal(prizeStatus(p, deadline - 1000), "open");
  assert.equal(prizeStatus(p, deadline), "judging");
  assert.equal(prizeStatus(p, deadline + 14 * day), "judging");
  assert.equal(prizeStatus(p, deadline + 14 * day + 1000), "closed");
  assert.equal(prizeStatus({ ...p, results: { castHash: "0x" + "1".repeat(40), postedAt: NOW, places: [] } }, deadline - 1000), "awarded");

  // Through compile: the tiebout prize 30 days past its deadline, no results → closed.
  const later = compile(base({ now: iso(deadline + 30 * day) }));
  assert.equal(later.prizes.find((x) => x.id === "tiebout").status, "closed");
  assert.equal(later.prizes.find((x) => x.id === "nordhoff").status, "closed", "29 days past its deadline");
  const nordhoffJudging = compile(base({ now: "2026-11-20T00:00:00Z" }));
  assert.equal(nordhoffJudging.prizes.find((x) => x.id === "nordhoff").status, "judging");
  assert.equal(later.prizes.find((x) => x.id === "clients").status, "awarded");
  const atSeedTime = compile(base());
  assert.deepEqual(
    Object.fromEntries(atSeedTime.prizes.filter((x) => x.kind === "prize").map((x) => [x.id, x.status])),
    { "cloud-cartography": "closed", "ai-conference-organizer": "closed", "network-state-visuals": "closed", clients: "awarded", civility: "awarded", tiebout: "judging", nordhoff: "open" },
  );
  assert.equal(atSeedTime.prizes.find((x) => x.id === "acquisition").status, undefined, "announcements carry no status");
});

test("archive kicker only for picks posted more than a year before now", () => {
  const p = newPrize();
  const nearlyAYear = compile(base({ now: "2027-11-12T14:59:59Z", fetched: { prizes: [p] } }));
  assert.equal(nearlyAYear.chapters.find((c) => c.prize === p.id).kicker, NEW_KICKER);
  const overAYear = compile(base({ now: "2027-11-12T15:00:01Z", fetched: { prizes: [p] } }));
  assert.equal(overAYear.chapters.find((c) => c.prize === p.id).kicker, "From the archive · 2026");
});

test("seed is authoritative; fetched items add new hashes, results and people", () => {
  const seedSub = seedSubmissions().find((s) => s.chapter === "feet" && s.kind === "video");
  const tiebout = seedPrizes().find((p) => p.id === "tiebout");
  const clients = seedPrizes().find((p) => p.id === "clients");
  const fresh = { hash: "0x5e70000000000000000000000000000000000b01", fid: 900030, postedAt: "2026-11-10T00:00:00Z", chapter: "feet", kind: "video", gloss: "Video entry", embeds: ["https://youtu.be/x"], url: "https://farcaster.xyz/~/conversations/0x5e70000000000000000000000000000000000b01" };
  const results = { castHash: "0x5e70000000000000000000000000000000000b02", authorFid: 1, postedAt: "2026-11-12T12:00:00Z", places: [{ place: "1st", amount: "$512", submission: fresh.hash, label: "fid 900030" }] };
  const book = compile(
    base({
      fetched: {
        prizes: [
          { ...tiebout, headline: "changed by fetch", results },
          { ...clients, results: { ...results, places: [] } },
        ],
        submissions: [{ ...seedSub, gloss: "Video entry" }, fresh],
        people: [{ fid: 5254, username: "someone-else" }, { fid: 900030, username: "fresh-voice", displayName: "Fresh <i>Voice</i>" }, { fid: 900031, username: "Not Valid!" }],
      },
    }),
  );
  assert.deepEqual(validateBook(book), []);
  const t = book.prizes.find((p) => p.id === "tiebout");
  assert.equal(t.headline, tiebout.headline, "seed headline stands");
  assert.deepEqual(t.results, results, "results added where the seed has none");
  assert.equal(t.status, "awarded");
  assert.deepEqual(book.prizes.find((p) => p.id === "clients").results, clients.results, "seed results stand");
  assert.equal(book.submissions.find((s) => s.hash === seedSub.hash).gloss, seedSub.gloss, "seed gloss stands");
  assert.equal(book.submissions.find((s) => s.hash === fresh.hash).place, "1st", "winner marked from results");
  assert.equal(book.people["5254"].username, "papa", "seed username stands");
  assert.deepEqual(book.people["900030"], { fid: 900030, username: "fresh-voice", displayName: "Fresh ‹i›Voice‹/i›" });
  assert.deepEqual(book.people["900031"], { fid: 900031 }, "invalid username dropped");
  assert.equal(book.submissions.length, seedSubmissions().length + 1);
  const order = book.submissions.map((s) => `${s.postedAt} ${s.hash}`);
  assert.deepEqual(order, [...order].sort(), "submissions sorted by postedAt then hash");
});

test("invalid fetched items are dropped with a warning; network text never becomes markup", () => {
  const warnings = [];
  const p = { ...newPrize(), deliverable: "Make a [video](https://evil.example) <b>now</b> about {{sub:0x1}} things." };
  const bad = { hash: "0x5e70000000000000000000000000000000000c01", fid: 1, postedAt: NOW, chapter: "feet", kind: "video", gloss: "x", embeds: ["http://insecure.example/a.mp4"], url: "https://farcaster.xyz/~/conversations/0x5e70000000000000000000000000000000000c01" };
  const book = compile(base({ fetched: { prizes: [p], submissions: [bad] }, onWarning: (m) => warnings.push(m) }));
  assert.ok(!book.submissions.some((s) => s.hash === bad.hash));
  assert.ok(warnings.some((w) => /dropped fetched submission/.test(w)));
  assert.ok(warnings.some((w) => /dropped fetched prize/.test(w)), "a deliverable with HTML fails validatePrize and is dropped");
  const p2 = { ...newPrize(), deliverable: "Make a [video](https://evil.example) about *this* now." };
  const book2 = compile(base({ fetched: { prizes: [p2] } }));
  const c = book2.chapters.find((x) => x.prize === p2.id);
  for (const t of [c.line, c.minute, c.essay[0].text, c.practice.prompt]) {
    assert.deepEqual(validateInline(t, "draft"), []);
    assert.ok(!/\]\(|\*/.test(t), `no link or emphasis markup from the network: ${t}`);
  }
});

test("every ChapterDoc carries strands and connections; links to ideas not in the book are dropped", () => {
  const exit = sampleChapters().find((c) => c.id === "exit");
  const lean = { ...exit };
  delete lean.strands;
  const withGhost = { ...sampleChapters().find((c) => c.id === "friend-speech"), connections: [{ to: "ghost-idea", kind: "echoes", why: "Not here yet." }, { to: "exit", kind: "builds-on", why: "Exit first." }] };
  const warnings = [];
  const book = compile(base({ chapters: [lean, withGhost], onWarning: (m) => warnings.push(m) }));
  assert.deepEqual(validateBook(book), []);
  assert.deepEqual(book.chapters.find((c) => c.id === "exit").strands, []);
  assert.deepEqual(book.chapters.find((c) => c.id === "friend-speech").connections.map((x) => x.to), ["exit"]);
  assert.ok(warnings.some((w) => /ghost-idea/.test(w)));
});

test("an editor's path with no ideas left falls back to every idea by number", () => {
  const m = meta();
  m.paths = [{ ...m.paths[0], chapters: ["nowhere"] }, { id: "other", name: "Other", line: "Another route.", chapters: ["nowhere"] }];
  const book = compile(base({ meta: m }));
  assert.deepEqual(book.paths.map((p) => p.id), ["editors-path"]);
  assert.deepEqual(book.paths[0].chapters, book.chapters.map((c) => c.id));
});

test("an invalid chapter file makes compile throw with the errors", () => {
  const broken = { ...sampleChapters().find((c) => c.id === "exit"), title: "x".repeat(41) };
  assert.throws(() => compile(base({ chapters: [broken] })), (err) => err instanceof CompileError && err.errors.some((e) => /title/.test(e)));
  const dup = sampleChapters().find((c) => c.id === "exit");
  assert.throws(() => compile(base({ chapters: [dup, { ...dup }] })), CompileError);
});
