// G1: compile v2: meta + lessons + seed results + anything fetched → a valid, deterministic App.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BANNED, validateApp, validateLessonDoc } from "../../contract/validate-app.mjs";
import { compile, CompileError, serialize } from "../src/compile.mjs";
import {
  BUILD_CAPTION,
  DRAFT_IDEA,
  DRAFT_PROMISE,
  VIDEO_CAPTION,
  appSummary,
  compileApp,
  isDisplayName,
  draftLessonTitle,
  sameApp,
  videoOf,
} from "../src/compile-app.mjs";
import { derivePrize } from "../src/detect.mjs";
import { loadAppInputs } from "../src/refresh.mjs";
import { ROOT, cast, fixture, meta, seedPeople, seedPrizes, seedSubmissions } from "./helpers.mjs";

const NOW = "2026-11-12T17:00:00Z";
const appInputs = () => loadAppInputs(ROOT);
const book = (fetched = {}, now = NOW) => compile({ meta: meta(), seedPrizes: seedPrizes(), seedSubmissions: seedSubmissions(), seedPeople: seedPeople(), chapters: [], fetched, now });
const app = (over = {}) => {
  const { meta: m, works, lessons } = appInputs();
  return compileApp({ meta: m, works, lessons, book: book(), now: NOW, ...over });
};
const lessonFor = (a, topic) => a.lessons.find((l) => l.topic === topic);
const sub = (hash) => seedSubmissions().find((s) => s.hash === hash);
const PAPA = "0x780d71e5b43cfe009ffcaf5ff0ac234bb711a927";

/** Every string a reader could see in a lesson (cards, title, promise, captions). */
function readerText(lesson) {
  const cardText = lesson.cards.flatMap((c) => [c.text, c.heading, c.term, c.def, c.claim, c.reply, c.prompt, ...(c.steps || [])]);
  return [lesson.title, lesson.promise, ...cardText, ...lesson.work.map((w) => w.caption)].filter((x) => typeof x === "string");
}

test("the app validates, and carries the meta's name, citizen and traits", () => {
  const a = app();
  assert.deepEqual(validateApp(a), []);
  const m = appInputs().meta;
  assert.equal(a.version, 2);
  assert.equal(a.generatedAt, NOW);
  assert.equal(a.name, m.name);
  assert.deepEqual(a.citizen, m.citizen);
  assert.deepEqual(a.traits, m.traits);
  const numbers = a.lessons.map((l) => l.number);
  assert.deepEqual(numbers, [...numbers].sort((x, y) => x - y), "sorted by number");
  for (const l of a.lessons) for (const t of readerText(l)) assert.ok(!BANNED.test(t), `${l.id}: ${t}`);
});

test("civility: the 1st-placed video leads; 2nd and honorable mentions follow, in the results' order", () => {
  const l = lessonFor(app(), "civility");
  assert.equal(l.id, "friend-speech");
  assert.deepEqual(
    l.work.map((w) => [w.role, w.id]),
    [
      ["lead", PAPA],
      ["more", "0xe8115efcd588df484ae497103e5b70e0f6c5cfa3"], // zatweirdaj, 2nd
      ["more", "0x894be0b8cb3ec04bf401b813f2ab58f67078d587"], // tophb, hm (posted after leoxcrane)
      ["more", "0x165286a216d2eea5b0e5e114563a24b9a2777895"], // leoxcrane, hm
    ],
  );
  const lead = l.work[0];
  assert.equal(lead.kind, "video");
  assert.deepEqual(lead.video, { hls: "https://stream.farcaster.xyz/v1/video/01a16a22-526f-c3a6-4a6a-93bd99267b92.m3u8" }, "the .m3u8, not the chart link embedded first");
  assert.equal(lead.fid, 5254);
  assert.equal(lead.original, `https://farcaster.xyz/~/conversations/${PAPA}`);
  assert.equal(lead.postedAt, sub(PAPA).postedAt);
  assert.equal(lead.caption, appInputs().works.captions[PAPA], "our curated caption");
  assert.ok(l.work.every((w) => w.kind === "video" && w.video.hls && !("build" in w)));
  assert.ok(!l.work.some((w) => "place" in w), "places are never emitted");
});

test("clients: the 1st-placed build leads with its guide and repo; the others are more", () => {
  const l = lessonFor(app(), "clients");
  assert.equal(l.id, "own-your-exit");
  assert.deepEqual(
    l.work.map((w) => [w.role, w.kind, w.id.slice(0, 10)]),
    [["lead", "build", "0x34dbeae0"], ["more", "build", "0xc61d9d39"], ["more", "build", "0x09d24194"], ["more", "build", "0xe5426897"]],
  );
  assert.deepEqual(l.work[0].build, { site: "https://farcaster.0xabhii.xyz/", repo: "https://github.com/prodabhi/castyard" });
  assert.deepEqual(l.work.map((w) => w.build.site), ["https://farcaster.0xabhii.xyz/", "https://docs.phunk.social", "https://kite.sahban.dev", "https://antonpecherkin.github.io/runfcx"]);
  assert.ok(l.work.every((w) => !("video" in w)));
});

test("topics with no results have no work; the lesson still ships", () => {
  const a = app();
  for (const topic of ["tiebout", "nordhoff"]) {
    const l = lessonFor(a, topic);
    assert.ok(l, topic);
    assert.equal(l.status, "ready");
    assert.deepEqual(l.work, []);
  }
});

test("creators: everyone with work, named when known, nobody else", () => {
  const a = app();
  const fids = [...new Set(a.lessons.flatMap((l) => l.work.map((w) => w.fid)))].sort((x, y) => x - y);
  assert.deepEqual(Object.keys(a.creators), fids.map(String));
  assert.deepEqual(a.creators["5254"], { fid: 5254, username: "papa" });
  assert.deepEqual(a.creators["2391"], { fid: 2391, username: "ramitphi" });
  // a creator with no known username gets no username field (the app says "a creator")
  const people = Object.fromEntries(Object.entries(seedPeople()).filter(([k]) => k !== "2391"));
  const b = compile({ meta: meta(), seedPrizes: seedPrizes(), seedSubmissions: seedSubmissions(), seedPeople: people, chapters: [], fetched: {}, now: NOW });
  const { meta: m, works, lessons } = appInputs();
  assert.deepEqual(compileApp({ meta: m, works, lessons, book: b, now: NOW }).creators["2391"], { fid: 2391 });
  assert.ok(!("1" in a.creators) && !("37" in a.creators));
});

test("creators: a display name is emitted only when it passes (≤ 80 chars, no control characters, no banned word)", () => {
  assert.equal(isDisplayName("Papa"), true);
  for (const bad of ["", "   ", "x".repeat(81), "Pa\u0007pa", "Line\nbreak", "papa on farcaster", 42, undefined]) assert.equal(isDisplayName(bad), false, JSON.stringify(bad));
  assert.equal(isDisplayName("x".repeat(80)), true);
  const b = book();
  b.people = { ...b.people, 5254: { ...b.people["5254"], displayName: "Papa ☀" }, 1075315: { ...b.people["1075315"], displayName: "x".repeat(81) }, 266490: { ...b.people["266490"], displayName: "Tophb\u0000" } };
  const a = app({ book: b });
  assert.deepEqual(a.creators["5254"], { fid: 5254, username: "papa", displayName: "Papa ☀" });
  assert.deepEqual(a.creators["1075315"], { fid: 1075315, username: "zatweirdaj" }, "too long: left out");
  assert.deepEqual(a.creators["266490"], { fid: 266490, username: "tophb" }, "control character: left out");
  assert.deepEqual(validateApp(a), []);
});

test("a caption missing from works.json → our neutral one, never the creator's words", () => {
  const { meta: m, lessons } = appInputs();
  const a = compileApp({ meta: m, lessons, works: { topics: {}, captions: {} }, book: book(), now: NOW });
  const civ = lessonFor(a, "civility").work;
  assert.ok(civ.every((w) => w.caption === VIDEO_CAPTION || /^A short explainer, \d+ seconds$/.test(w.caption)), JSON.stringify(civ.map((w) => w.caption)));
  assert.ok(lessonFor(a, "clients").work.every((w) => w.caption === BUILD_CAPTION));
  assert.deepEqual(validateApp(a), []);

  // A fetched winner with a stated length and wordy text: the caption is fixed words plus the number.
  const tiebout = seedPrizes().find((p) => p.id === "tiebout");
  const reply = { hash: "0x5e70000000000000000000000000000000000a51", fid: 900070, postedAt: "2026-11-10T00:00:00Z", chapter: "feet", kind: "video", gloss: "Video entry, 54 seconds", seconds: 54, embeds: ["https://youtu.be/abc"], url: "https://farcaster.xyz/~/conversations/0x5e70000000000000000000000000000000000a51" };
  const results = { castHash: "0x5e70000000000000000000000000000000000a52", authorFid: 1, postedAt: "2026-11-12T12:00:00Z", places: [{ place: "1st", amount: "$512", submission: reply.hash, label: "fid 900070" }] };
  const b = book({ submissions: [reply], prizes: [{ ...tiebout, results }] });
  const w = lessonFor(compileApp({ meta: m, lessons, works: appInputs().works, book: b, now: NOW }), "tiebout").work;
  assert.deepEqual(w.map((x) => [x.role, x.caption, x.video]), [["lead", "A short explainer, 54 seconds", { external: "https://youtu.be/abc" }]]);

  // A curated caption that breaks the text rules is replaced, with a warning.
  const warnings = [];
  const bad = compileApp({ meta: m, lessons, works: { captions: { [PAPA]: "The winning entry of the prize" } }, book: book(), now: NOW, onWarning: (x) => warnings.push(x) });
  assert.equal(lessonFor(bad, "civility").work[0].caption, VIDEO_CAPTION);
  assert.ok(warnings.some((x) => /caption for 0x780d71e5/.test(x)));
});

test("video: HLS first, else mp4, else an external link; an entry with none is left out", () => {
  assert.deepEqual(videoOf({ embeds: ["https://youtu.be/a", "https://cdn.example/a.mp4", "https://video.bsky.app/watch/x/playlist.m3u8"] }), { hls: "https://video.bsky.app/watch/x/playlist.m3u8" });
  assert.deepEqual(videoOf({ embeds: ["https://stream.warpcast.com/v1/video/abc.m3u8"] }), { hls: "https://stream.warpcast.com/v1/video/abc.m3u8" });
  assert.deepEqual(videoOf({ embeds: ["https://stream.farcaster.xyz/v1/video/abc"] }), { hls: "https://stream.farcaster.xyz/v1/video/abc" });
  assert.deepEqual(videoOf({ embeds: ["https://youtu.be/a", "https://video.bsky.app/v1/a.mp4"] }), { mp4: "https://video.bsky.app/v1/a.mp4" });
  // a stream on any other host never plays inline: it becomes a link out (review S4)
  assert.deepEqual(videoOf({ embeds: ["https://youtu.be/a", "https://cdn.example/a.mp4"] }), { external: "https://youtu.be/a" });
  assert.deepEqual(videoOf({ embeds: ["https://cdn.example/a.mp4"] }), { external: "https://cdn.example/a.mp4" });
  assert.deepEqual(videoOf({ embeds: ["https://evil.example/x.m3u8"] }), { external: "https://evil.example/x.m3u8" });
  assert.deepEqual(videoOf({ embeds: ["https://example.com/page", "https://x.com/someone/status/123"] }), { external: "https://x.com/someone/status/123" });
  assert.deepEqual(videoOf({ embeds: ["https://www.youtube.com/shorts/abc"] }), { external: "https://www.youtube.com/shorts/abc" });
  assert.equal(videoOf({ embeds: ["https://gemini.google.com/share/x", "http://cdn.example/a.mp4"] }), null);

  const nordhoff = seedPrizes().find((p) => p.id === "nordhoff");
  const mk = (n, embeds, kind = "video") => ({ hash: `0x5e70000000000000000000000000000000000a6${n}`, fid: 900080 + n, postedAt: `2026-11-10T0${n}:00:00Z`, chapter: "what-lasts", kind, gloss: "Video entry", embeds, url: `https://farcaster.xyz/~/conversations/0x5e70000000000000000000000000000000000a6${n}` });
  const subs = [mk(1, ["https://gemini.google.com/share/x"]), mk(2, ["https://cdn.example/b.mp4"]), mk(3, ["https://x.com/a/status/1"], "link")];
  const results = { castHash: "0x5e70000000000000000000000000000000000a69", authorFid: 1, postedAt: "2026-11-13T12:00:00Z", places: subs.map((s, i) => ({ place: i === 0 ? "1st" : "hm", submission: s.hash, label: "x" })) };
  const warnings = [];
  const { meta: m, works, lessons } = appInputs();
  const a = compileApp({ meta: m, works, lessons, book: book({ submissions: subs, prizes: [{ ...nordhoff, results }] }), now: NOW, onWarning: (x) => warnings.push(x) });
  assert.deepEqual(lessonFor(a, "nordhoff").work.map((w) => [w.role, w.kind, w.video]), [["more", "video", { external: "https://cdn.example/b.mp4" }], ["more", "video", { external: "https://x.com/a/status/1" }]]);
  assert.ok(warnings.some((x) => /0x5e70000000000000000000000000000000000a61 has no playable video/.test(x)));
  assert.deepEqual(validateApp(a), []);
});

test("order within a role: 2nd before honorable mentions, then the results' order, then postedAt", () => {
  const civ = seedPrizes().find((p) => p.id === "civility");
  const places = civ.results.places;
  // The results list honorable mentions first and 2nd last: roles and order still follow the places.
  const shuffled = { ...civ, results: { ...civ.results, places: [places[3], places[2], places[1], places[0]] } };
  const { meta: m, works, lessons } = appInputs();
  const b = book();
  b.prizes = b.prizes.map((p) => (p.id === "civility" ? shuffled : p));
  const w = lessonFor(compileApp({ meta: m, works, lessons, book: b, now: NOW }), "civility").work;
  assert.deepEqual(w.map((x) => x.id), [places[0].submission, places[1].submission, places[3].submission, places[2].submission]);
  assert.deepEqual(w.map((x) => x.role), ["lead", "more", "more", "more"]);
});

test("a new prize with no lesson file → a valid draft lesson with no banned words", () => {
  const m = fixture("casts-fid1.new-prize.json").messages.find((x) => x.hash.endsWith("302"));
  const p = { ...derivePrize(m, { seedPrizes: seedPrizes() }), strands: ["founding"] };
  const a = app({ book: book({ prizes: [p] }) });
  assert.deepEqual(validateApp(a), []);
  const d = lessonFor(a, p.id);
  assert.ok(d, "draft present");
  const maxReady = Math.max(...appInputs().lessons.map((l) => l.number));
  assert.deepEqual(
    { id: d.id, number: d.number, status: d.status, title: d.title, promise: d.promise, trait: d.trait, minutes: d.minutes, sources: d.sources, work: d.work },
    { id: "tragedy-of-the-commons", number: maxReady + 1, status: "draft", title: "Tragedy of the Commons", promise: DRAFT_PROMISE, trait: "enduring", minutes: 1, sources: [], work: [] },
  );
  assert.deepEqual(d.cards, [{ type: "cover" }, { type: "idea", text: DRAFT_IDEA }, { type: "work", role: "lead" }, { type: "work", role: "more" }, { type: "trait" }]);
  assert.deepEqual(validateLessonDoc(d, "draft"), []);
  for (const t of readerText(d)) assert.ok(!BANNED.test(t), t);
  assert.ok(!readerText(d).some((t) => /Book club|59 seconds|\$/.test(t)), "nothing copied from the announcement");
});

test("draft titles: topic only, Title Case, ≤ 32 chars; banned or empty → 'New idea'; traits from the strands hint", () => {
  assert.equal(draftLessonTitle("$1024 IN PRIZES FOR VIDEOS ON THE TRAGEDY OF THE COMMONS"), "Tragedy of the Commons");
  assert.equal(draftLessonTitle("Cloud Cartography: $1000 Prize"), "Cloud Cartography");
  assert.equal(draftLessonTitle("$1000 Prize for AI Conference Organizer"), "AI Conference Organizer");
  assert.equal(draftLessonTitle("$2048 FOR FARCASTER CLIENTS"), "New idea", "a banned word in the topic");
  assert.equal(draftLessonTitle("$500 FOR THE BEST SUBMISSIONS"), "New idea");
  assert.equal(draftLessonTitle("$500 FOR"), "New idea", "nothing left");
  const long = draftLessonTitle("$512 FOR VIDEOS ON THE ECONOMICS OF VOLUNTARY ASSOCIATIONS AND CLUBS");
  assert.ok(long.length <= 32, long);
  for (const t of [long, draftLessonTitle("$64 FOR PRIZE WINNERS ON THE FRONTIER")]) assert.ok(!BANNED.test(t) && !/\$|\bfor\b/i.test(t.split(" ")[0]), t);

  const at = (n) => `0x5e70000000000000000000000000000000000c${String(n).padStart(2, "0")}`;
  const mk = (n, text, strands) => ({ ...derivePrize(cast({ fid: 1, hash: at(n), at: `2026-11-1${n}T10:00:00Z`, text: `${text}\n\nMake a video. Three days.` }), { seedPrizes: [] }), ...(strands ? { strands } : {}) });
  const prizes = [mk(1, "$64 FOR VIDEOS ON TOOLS", ["tools"]), mk(2, "$64 FOR VIDEOS ON TRUST", ["trust"]), mk(3, "$64 FOR VIDEOS ON CHOICE", ["choice"]), mk(4, "$64 FOR VIDEOS ON FOUNDING", ["founding"]), mk(5, "$64 FOR VIDEOS ON NOTHING IN PARTICULAR"), mk(6, "$2048 FOR FARCASTER WINNERS")];
  const a = app({ book: book({ prizes }) });
  assert.deepEqual(validateApp(a), []);
  const drafts = a.lessons.filter((l) => l.status === "draft");
  assert.deepEqual(drafts.map((l) => l.trait), ["sovereign", "civil", "mobile", "enduring", "mobile", "mobile"]);
  const banned = drafts.at(-1);
  assert.equal(banned.title, "New idea");
  assert.match(banned.id, /^new-idea-[0-9a-f]{6}$/, "a banned slug is not used as the id either");
  assert.deepEqual(drafts.map((l) => l.number), drafts.map((_, i) => drafts[0].number + i), "numbered in prize-date order");
});

test("a draft takes its id from works.json's topics map", () => {
  const m = fixture("casts-fid1.new-prize.json").messages.find((x) => x.hash.endsWith("302"));
  const p = derivePrize(m, { seedPrizes: seedPrizes() });
  const { meta: am, works, lessons } = appInputs();
  const a = compileApp({ meta: am, lessons, works: { ...works, topics: { ...works.topics, [p.id]: "the-commons" } }, book: book({ prizes: [p] }), now: NOW });
  assert.equal(lessonFor(a, p.id).id, "the-commons");
});

test("the 2024 archive prizes never become lessons", () => {
  const archive = seedPrizes().filter((p) => p.series === "Earlier prizes (2024)");
  assert.equal(archive.length, 3);
  const b = book();
  for (const p of archive) assert.ok(b.prizes.some((x) => x.id === p.id), `${p.id} is in the book`);
  const a = app();
  for (const p of archive) assert.equal(lessonFor(a, p.id), undefined, p.id);
  assert.ok(a.lessons.every((l) => l.status === "ready"), "the seed alone makes no drafts");
  assert.deepEqual(a.lessons.map((l) => l.topic).sort(), appInputs().lessons.map((l) => l.topic).sort(), "one lesson per lesson file, nothing else");
  for (const t of ["civility", "clients", "nordhoff", "tiebout"]) assert.ok(lessonFor(a, t), t);
  // A results post for an archive prize still makes no lesson.
  const cc = archive[0];
  const s = seedSubmissions().find((x) => x.chapter === cc.chapter);
  if (s) {
    const withResults = book({ prizes: [{ ...cc, results: { castHash: "0x5e70000000000000000000000000000000000a71", authorFid: 37, postedAt: "2024-10-10T00:00:00Z", places: [{ place: "1st", submission: s.hash, label: "x" }] } }] });
    assert.equal(lessonFor(app({ book: withResults }), cc.id), undefined);
  }
});

test("same inputs → byte-identical output; input order does not matter", () => {
  const m = fixture("casts-fid1.new-prize.json").messages.find((x) => x.hash.endsWith("302"));
  const fetched = { prizes: [derivePrize(m, { seedPrizes: seedPrizes() })] };
  const { meta: am, works, lessons } = appInputs();
  const one = serialize(compileApp({ meta: am, works, lessons, book: book(fetched), now: NOW }));
  const two = serialize(compileApp({ meta: am, works, lessons, book: book(structuredClone(fetched)), now: NOW }));
  assert.equal(one, two);
  const b = book(fetched);
  const shuffled = { ...b, prizes: [...b.prizes].reverse(), submissions: [...b.submissions].reverse() };
  assert.equal(serialize(compileApp({ meta: am, works, lessons: [...lessons].reverse(), book: shuffled, now: NOW })), one);
  assert.ok(sameApp(JSON.parse(one), compileApp({ meta: am, works, lessons, book: book(fetched), now: "2026-11-12T18:00:00Z" })), "only generatedAt differs");
});

test("work in a lesson file is ignored; an invalid lesson is dropped and counted, never the whole app (S17)", () => {
  const { meta: am, works, lessons } = appInputs();
  const forged = lessons.map((l) => (l.topic === "tiebout" ? { ...l, work: [{ id: PAPA, fid: 5254, role: "lead", kind: "video", caption: "x", video: { hls: "https://e.example/a.m3u8" }, original: "https://e.example", postedAt: NOW }] } : l));
  assert.deepEqual(lessonFor(compileApp({ meta: am, works, lessons: forged, book: book(), now: NOW }), "tiebout").work, []);
  // One lesson breaks the contract: it is left out with a warning and counted; the others ship.
  const bad = lessons.find((l) => l.topic === "civility");
  const broken = lessons.map((l) => (l === bad ? { ...l, title: "Win the prize" } : l));
  const warnings = [];
  const report = { droppedLessons: [], droppedWork: 0, droppedNames: 0 };
  const a = compileApp({ meta: am, works, lessons: broken, book: book(), now: NOW, onWarning: (x) => warnings.push(x), report });
  assert.deepEqual(validateApp(a), []);
  assert.deepEqual(report.droppedLessons, [bad.id]);
  assert.ok(warnings.some((x) => x.startsWith(`lesson file ${bad.id} fails the contract`) && /title/.test(x)), warnings.join("\n"));
  assert.ok(!a.lessons.some((l) => l.status === "ready" && l.topic === bad.topic), "the bad lesson is not shipped");
  for (const l of lessons.filter((x) => x !== bad)) assert.ok(a.lessons.some((x) => x.id === l.id), `${l.id} still ships`);
  // Its topic has no lesson file now, so the prize comes back as a draft.
  assert.equal(lessonFor(a, "civility").status, "draft");
  // The editor's check (strictLessons) throws instead.
  assert.throws(() => compileApp({ meta: am, works, lessons: broken, book: book(), now: NOW, strictLessons: true }), (err) => err instanceof CompileError && /compiled app \(lesson files\) is invalid/.test(err.message) && err.errors.some((e) => /title/.test(e)));
});

test("lesson files that clash, name an unknown trait, or are not objects are dropped; the first by number then id is kept, whatever the input order", () => {
  const { meta: am, works, lessons } = appInputs();
  const first = lessons.find((l) => l.id === "own-your-exit");
  const cases = [
    [{ ...first, id: "own-your-exit-again", topic: "elsewhere" }, /number: \d+ already used/],
    [{ ...first, number: 900, topic: "elsewhere" }, /id: already used/],
    [{ ...first, id: "same-topic", number: 901 }, /topic: clients already taught/],
    [{ ...first, id: "odd-trait", number: 902, topic: "odd", trait: "constructor" }, /trait: unknown trait constructor/],
    [null, /object required/],
    ["a string", /object required/],
  ];
  for (const [extra, why] of cases) {
    for (const order of [[...lessons, extra], [extra, ...lessons]]) {
      const warnings = [];
      const report = { droppedLessons: [], droppedWork: 0, droppedNames: 0 };
      const a = compileApp({ meta: am, works, lessons: order, book: book(), now: NOW, onWarning: (x) => warnings.push(x), report });
      assert.deepEqual(validateApp(a), [], JSON.stringify(extra)?.slice(0, 60));
      assert.equal(report.droppedLessons.length, 1, JSON.stringify(extra)?.slice(0, 60));
      assert.ok(warnings.some((x) => why.test(x)), `${why}: ${warnings.join(" | ")}`);
      assert.deepEqual(a.lessons.find((l) => l.id === "own-your-exit"), app().lessons.find((l) => l.id === "own-your-exit"), "the original is the one kept");
    }
  }
});

test("a work that fails the contract is left out and counted; the lesson still ships", () => {
  const nordhoff = seedPrizes().find((p) => p.id === "nordhoff");
  const entry = { hash: "0x5e70000000000000000000000000000000000a81", fid: 900081, postedAt: "2026-11-10T01:00:00Z", chapter: "what-lasts", kind: "video", gloss: "Video entry", embeds: ["https://youtu.be/ok"], url: "https://farcaster.xyz/~/conversations/0x5e70000000000000000000000000000000000a81" };
  const results = { castHash: "0x5e70000000000000000000000000000000000a89", authorFid: 1, postedAt: "2026-11-13T12:00:00Z", places: [{ place: "1st", submission: entry.hash, label: "x" }] };
  const b = book({ submissions: [entry], prizes: [{ ...nordhoff, results }] });
  b.submissions.find((s) => s.hash === entry.hash).postedAt = "yesterday"; // what a later rule could reject
  const report = { droppedLessons: [], droppedWork: 0, droppedNames: 0 };
  const warnings = [];
  const a = app({ book: b, report, onWarning: (x) => warnings.push(x) });
  assert.deepEqual(validateApp(a), []);
  assert.deepEqual(lessonFor(a, "nordhoff").work, []);
  assert.equal(report.droppedWork, 1);
  assert.ok(warnings.some((x) => /entry 0x5e70000000000000000000000000000000000a81 fails the contract/.test(x)), warnings.join("\n"));
});

test("S1: a display name with bidi isolates or other format characters is dropped with a warning; compile never throws over a name", () => {
  // The reviewer's probe: plain() used to keep U+2067, the contract rejected it, and every refresh failed.
  const probe = "Papa \u2067evil\u2069";
  for (const raw of [probe, "Pa\u200bpa", "Papa\u202e", "Papa\u2066", "Papa\u061c", "Papa\u180e", "Papa\u2028x", "Papa\u00ad", "Papa\ufeff", "Papa\ufff9"]) {
    assert.equal(isDisplayName(raw), false, JSON.stringify(raw));
    const b = book();
    b.people = { ...b.people, 5254: { ...b.people["5254"], displayName: raw } };
    const warnings = [];
    const report = { droppedLessons: [], droppedWork: 0, droppedNames: 0 };
    const a = app({ book: b, report, onWarning: (x) => warnings.push(x) });
    assert.deepEqual(a.creators["5254"], { fid: 5254, username: "papa" }, JSON.stringify(raw));
    assert.equal(report.droppedNames, 1);
    assert.ok(warnings.some((x) => /creator 5254: display name fails the contract/.test(x)));
    assert.deepEqual(validateApp(a), []);
  }
  // Through the book: a fetched name is cleaned by plain(), so it arrives without the format characters and is kept.
  const fetched = compile({ meta: meta(), seedPrizes: seedPrizes(), seedSubmissions: seedSubmissions(), seedPeople: {}, chapters: [], fetched: { people: [{ fid: 5254, username: "papa", displayName: probe }] }, now: NOW });
  assert.equal(fetched.people["5254"].displayName, "Papa evil");
  assert.equal(isDisplayName(fetched.people["5254"].displayName), true);
  assert.equal(app({ book: fetched }).creators["5254"].displayName, "Papa evil");
});

test("S18: keys from the network or a content file never read Object.prototype (constructor, __proto__, toString)", () => {
  const { meta: am, lessons } = appInputs();
  const mk = (id, hash) => ({ ...derivePrize(cast({ fid: 1, hash, at: "2026-11-11T10:00:00Z", text: "$1000 Prize for Constructor\n\nMake a video. Three days." }), { seedPrizes: [] }), id, chapter: id });
  // A prize whose id is "constructor" (the headline "$1000 Prize for Constructor" slugs to it).
  const p = mk("constructor", "0x5e70000000000000000000000000000000000c91");
  assert.equal(p.id, "constructor");
  // works.json parsed from JSON may carry own "__proto__", "constructor" and "toString" keys.
  const works = JSON.parse('{"topics":{"__proto__":"from-proto","toString":"to-string"},"captions":{"__proto__":"x","constructor":"y","toString":"z"}}');
  const b = book({ prizes: [p] });
  // Strand hints the book contract would not let through, set on the compiled book directly.
  b.prizes.find((x) => x.id === "constructor").strands = ["constructor", "__proto__", "toString", "hasOwnProperty"];
  b.people = JSON.parse(`{"__proto__":{"fid":1,"username":"evil"},"constructor":{"fid":2},${JSON.stringify(b.people).slice(1)}`);
  const a = compileApp({ meta: am, lessons, works, book: b, now: NOW });
  assert.deepEqual(validateApp(a), []);
  const d = lessonFor(a, "constructor");
  assert.equal(d.id, "constructor", "the slug, not Object");
  assert.equal(d.trait, "mobile", "no strand hint read from the prototype");
  assert.equal(Object.getPrototypeOf(a.creators), Object.prototype);
  // A topics map that names "constructor" itself is used as written.
  const mapped = compileApp({ meta: am, lessons, works: { topics: { constructor: "the-constructor" }, captions: {} }, book: book({ prizes: [p] }), now: NOW });
  assert.equal(lessonFor(mapped, "constructor").id, "the-constructor");
  // A results place that is not a place ("constructor", "toString") is ignored, never ranked.
  const civ = seedPrizes().find((x) => x.id === "civility");
  const odd = { ...civ, results: { ...civ.results, places: [...civ.results.places.map((pl, i) => (i === 1 ? { ...pl, place: "constructor" } : i === 2 ? { ...pl, place: "toString" } : pl))] } };
  const bb = book();
  bb.prizes = bb.prizes.map((x) => (x.id === "civility" ? odd : x));
  const w = lessonFor(compileApp({ meta: am, lessons, works: appInputs().works, book: bb, now: NOW }), "civility").work;
  assert.deepEqual(w.map((x) => x.id), [civ.results.places[0].submission, civ.results.places[3].submission]);
  // A lesson file with a "__proto__" key keeps it as data; nothing is polluted.
  const lesson = JSON.parse(JSON.stringify(lessons[0]).replace(/^\{/, '{"__proto__":{"polluted":true},'));
  const c = compileApp({ meta: am, lessons: [lesson, ...lessons.slice(1)], works: appInputs().works, book: book(), now: NOW });
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(c.lessons.find((l) => l.id === lesson.id)), Object.prototype);
});

test("S18: even if something polluted Object.prototype, topics, captions and people are read from their own keys only", () => {
  const { meta: am, lessons } = appInputs();
  const p = { ...derivePrize(cast({ fid: 1, hash: "0x5e70000000000000000000000000000000000c92", at: "2026-11-11T10:00:00Z", text: "$1000 Prize for Polluted Topic\n\nMake a video. Three days." }), { seedPrizes: [] }) };
  assert.equal(p.id, "polluted-topic");
  const b = book({ prizes: [p] });
  delete b.people["5254"];
  const keys = { "polluted-topic": "hijacked-id", [PAPA]: "A hijacked caption", 5254: { fid: 5254, username: "hijacker", displayName: "Hijacker" } };
  try {
    for (const [k, value] of Object.entries(keys)) Object.defineProperty(Object.prototype, k, { value, configurable: true, writable: true });
    const a = compileApp({ meta: am, lessons, works: { topics: {}, captions: {} }, book: b, now: NOW });
    assert.equal(lessonFor(a, "polluted-topic").id, "polluted-topic", "not the inherited topic mapping");
    assert.match(lessonFor(a, "civility").work[0].caption, /^A short explainer(, \d+ seconds)?$/, "our generated caption, not the inherited one");
    assert.deepEqual(a.creators["5254"], { fid: 5254 }, "not the inherited person");
  } finally {
    for (const k of Object.keys(keys)) delete Object.prototype[k];
  }
  assert.equal({}["polluted-topic"], undefined);
});

test("summary line: lessons, drafts and works per lesson", () => {
  const a = app();
  assert.equal(appSummary(a), `${a.lessons.length} lessons (0 drafts), works: ${a.lessons.map((l) => `${l.id} ${l.work.length}`).join(", ")}`);
  assert.match(appSummary(a), /own-your-exit 4, friend-speech 4, vote-with-your-feet 0, what-lasts 0/);
});

test("a draft that would be invalid (here: no number left after 999) is skipped with a warning, never emitted", () => {
  const m = fixture("casts-fid1.new-prize.json").messages.find((x) => x.hash.endsWith("302"));
  const p = derivePrize(m, { seedPrizes: seedPrizes() });
  const { meta: am, works, lessons } = appInputs();
  const full = lessons.map((l, i) => (i === lessons.length - 1 ? { ...l, number: 999 } : l));
  const warnings = [];
  const a = compileApp({ meta: am, works, lessons: full, book: book({ prizes: [p] }), now: NOW, onWarning: (x) => warnings.push(x) });
  assert.deepEqual(validateApp(a), []);
  assert.equal(lessonFor(a, p.id), undefined);
  assert.ok(warnings.some((x) => /draft for tragedy-of-the-commons skipped: .*number/.test(x)), warnings.join("\n"));
});
