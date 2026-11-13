// A3 — home: lesson tiles in order with art, title, promise, trait, minutes and
// progress; drafts marked; the "you" panel's traits fill as lessons finish.
// Also the colour system the tiles and traits depend on.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderHome, bar, upNext } from "../src/home.mjs";
import { ordered, traitProgress, traitsComplete, logoFill, deckModel } from "../src/model.mjs";
import { shout, renderDeck } from "../src/cards.mjs";
import { fakeWindow, memStorage, settle } from "./dom.mjs";
import { openSeen, seenKey } from "../src/seen.mjs";
import { boot } from "../src/shell.mjs";
import { COPY } from "../src/copy.mjs";
import { emptyState, recordVisit } from "../src/store.mjs";
import { traitColor, contrast, CANDY, BG, INK, SURFACE, SLATE, MAGENTA, sceneKey, sceneSvg, SCENE_KEYS, logoSvg, confetti } from "../src/art.mjs";
import { fixture, tags, attr, visibleText, APP_DIR } from "./helpers.mjs";

const app = fixture();
const tilesOf = (markup) => tags(markup, "a").filter((t) => / class="tile"/.test(t));

test("one tile per lesson, in reading order, each linking to its deck", () => {
  const m = String(renderHome(app, emptyState()));
  const tiles = tilesOf(m);
  assert.deepEqual(
    tiles.map((t) => attr(t, "href")),
    ["#/l/own-your-exit", "#/l/friend-speech", "#/l/what-lasts", "#/l/new-topic"],
  );
  const text = visibleText(m);
  for (const l of app.lessons) {
    assert.ok(text.includes(l.promise), l.id);
    assert.ok(text.includes(`${l.minutes} min`), l.id);
  }
  for (const t of app.traits) assert.ok(text.includes(t.name));
  // reading position, not the raw number (the fixture skips 3)
  assert.deepEqual(
    ordered(app).map((x) => x.position),
    [1, 2, 3, 4],
  );
  assert.match(text, /\/\/ 03/);
  assert.equal((m.match(/class="scene[ "]/g) || []).length, app.lessons.length, "every tile has its art");
  assert.equal((m.match(/class="scene scene--gen"/g) || []).length, 1, "the draft has no hand-drawn scene: the art grammar draws one (P2)");
});

test("draft lessons are marked new · in progress, and only drafts", () => {
  const m = String(renderHome(app, emptyState()));
  assert.equal((visibleText(m).match(/new · in progress/g) || []).length, 1);
  const draftTile = tilesOf(m).find((t) => attr(t, "data-draft") === "true");
  assert.equal(attr(draftTile, "href"), "#/l/new-topic");
});

test("tiles show progress: not started, resume with a partial bar, a quiet read again when done (review U2, U12)", () => {
  let s = emptyState();
  s = recordVisit(s, "friend-speech", { key: "idea-1", index: 4, count: 17 });
  s = recordVisit(s, "own-your-exit", { key: "trait-0", index: 11, count: 13, finished: true });
  const m = String(renderHome(app, s));
  const at = (id) => m.indexOf(`<a class="tile" href="#/l/${id}"`);
  const tile = (id) => m.slice(at(id), m.indexOf("</a>", at(id)));
  const tag = (id) => tilesOf(m).find((t) => attr(t, "href") === `#/l/${id}`);
  // finished: quiet, with a white "Read again", a done sticker and no bar
  assert.equal(attr(tag("own-your-exit"), "data-look"), "done");
  assert.match(visibleText(tile("own-your-exit")), /Read again/);
  assert.match(tile("own-your-exit"), /class="btn tile__cta"/);
  assert.match(tile("own-your-exit"), /class="sticker tile__done"/);
  assert.doesNotMatch(tile("own-your-exit"), /class="bar"/);
  // started and up next: a partial bar with an ink edge, the magenta button
  assert.equal(attr(tag("friend-speech"), "data-look"), "next");
  assert.match(visibleText(tile("friend-speech")), /Resume/);
  assert.match(tile("friend-speech"), /<rect width="25" height="10"\/><line class="bar__edge" x1="25" x2="25"/);
  assert.match(tile("friend-speech"), /aria-label="25 percent read"/);
  assert.match(tile("friend-speech"), /class="btn btn--primary tile__cta"/);
  // not started: no empty bar, the words instead, and a white button (magenta is for the lesson up next only)
  assert.equal(attr(tag("what-lasts"), "data-look"), "todo");
  assert.match(visibleText(tile("what-lasts")), /not started/);
  assert.doesNotMatch(tile("what-lasts"), /class="bar"/);
  assert.match(tile("what-lasts"), /class="btn tile__cta"/);
  assert.equal((m.match(/btn--primary tile__cta/g) || []).length, 1, "one magenta tile button");
  assert.match(String(bar(2, "x")), /width="100"/, "bars clamp");
  assert.doesNotMatch(String(bar(1, "x")), /bar__edge/, "a full bar needs no edge");
});

test("tiles name themselves by title and state, describe themselves by promise, and hide the art and slashes (review U11)", () => {
  const m = String(renderHome(app, emptyState()));
  const t = tilesOf(m).find((x) => attr(x, "href") === "#/l/own-your-exit");
  assert.equal(attr(t, "aria-labelledby"), "t-own-your-exit-title t-own-your-exit-state");
  assert.equal(attr(t, "aria-describedby"), "t-own-your-exit-promise");
  assert.match(m, /<h2 class="shout tile__title" data-n="\d+" id="t-own-your-exit-title">/);
  assert.match(m, /<span class="sr-only" id="t-own-your-exit-state">Lesson 1\. Not started\. 4 min\.<\/span>/);
  assert.match(m, /<p class="tile__promise" id="t-own-your-exit-promise">/);
  assert.match(m, /<div class="frame frame--scene tile__art" aria-hidden="true">/);
  // every "//" a reader sees is decoration that screen readers skip, on home and in every deck
  let s = recordVisit(emptyState(), "friend-speech", { key: "idea-1", index: 4, count: 17 });
  const views = [m, String(renderHome(app, s)), ...app.lessons.map((l) => String(renderDeck(deckModel(app, l.id, s).ctx, deckModel(app, l.id, s).cards)))];
  for (const markup of views) {
    const doc = fakeWindow().document;
    doc.body.innerHTML = markup;
    const texts = [];
    const walk = (n) => n.childNodes.forEach((c) => (c.nodeType === 3 ? texts.push(c) : walk(c)));
    walk(doc.body);
    const hidden = (n) => {
      for (let x = n.parentNode; x && x.nodeType === 1; x = x.parentNode) if (x.getAttribute("aria-hidden") === "true") return true;
      return false;
    };
    const loud = texts.filter((t) => t.data.includes("//") && !hidden(t));
    assert.deepEqual(loud.map((t) => t.data), [], "slashes a screen reader would read out");
    for (const el of doc.body.querySelectorAll("[aria-label]")) assert.doesNotMatch(el.getAttribute("aria-label"), /\/\//);
  }
  assert.match(m, /<span class="slashes" aria-hidden="true">\/\/ <\/span>you/);
});

test("first run: home says what this is and where to start, above the lessons (review U1)", () => {
  const m = String(renderHome(app, emptyState()));
  const head = m.slice(0, m.indexOf("</header>"));
  assert.ok(visibleText(head).includes(app.citizen.line), "the citizen line is in the intro, not only in the you panel");
  assert.match(visibleText(head), /3 lessons · 4 min each · 3 traits to earn/, "ready lessons only: the draft is not counted");
  const cta = tags(head, "a").find((t) => /intro__cta/.test(attr(t, "class")));
  assert.equal(attr(cta, "href"), "#/l/own-your-exit");
  assert.match(attr(cta, "class"), /btn--primary/);
  assert.equal(attr(cta, "aria-label"), "Start lesson 01: Own Your Exit");
  assert.match(visibleText(head), /Start lesson 01/);
  assert.match(visibleText(head), /\/\/ passport 0\/4 /, "the chip: the passport and the count, short enough for 320px (review T19)");
});

test("returning: home points to the next unread lesson; when all are read it says so (review U2)", () => {
  const finish = (s, id) => recordVisit(s, id, { key: "trait-0", index: 9, count: 10, finished: true });
  let s = finish(emptyState(), "own-your-exit");
  let head = String(renderHome(app, s)).split("</header>")[0];
  let cta = tags(head, "a").find((t) => /intro__cta/.test(attr(t, "class")));
  assert.equal(attr(cta, "href"), "#/l/friend-speech");
  assert.match(visibleText(head), /Start lesson 02/);
  s = recordVisit(s, "friend-speech", { key: "idea-1", index: 4, count: 17 });
  head = String(renderHome(app, s)).split("</header>")[0];
  assert.match(visibleText(head), /Continue lesson 02/);
  assert.equal(upNext(app, s).lesson.id, "friend-speech");
  // a finished draft never becomes "up next", and finishing every ready lesson ends the list
  for (const id of ["friend-speech", "what-lasts"]) s = finish(s, id);
  assert.equal(upNext(app, s), null);
  head = String(renderHome(app, s)).split("</header>")[0];
  assert.match(visibleText(head), /all caught up/);
  cta = tags(head, "a").find((t) => /intro__cta/.test(attr(t, "class")));
  assert.equal(attr(cta, "href"), "#/passport", "see your traits: the passport (v3)");
  assert.doesNotMatch(attr(cta, "class"), /btn--primary/);
});

test("the you panel lists every trait, filling as its lessons finish", () => {
  let s = emptyState();
  let tp = traitProgress(app, s);
  assert.deepEqual(
    tp.map((t) => [t.trait.id, t.done, t.total]),
    [
      ["sovereign", 0, 1],
      ["civil", 0, 1],
      ["mobile", 0, 0], // its only lesson is a draft, which never counts
      ["enduring", 0, 1],
    ],
  );
  s = recordVisit(s, "own-your-exit", { key: "trait-0", index: 11, count: 13, finished: true });
  tp = traitProgress(app, s);
  assert.equal(tp[0].fraction, 1);
  assert.equal(traitsComplete(tp), 1);
  const m = String(renderHome(app, s));
  const you = m.slice(m.indexOf('<section class="you"'));
  assert.equal(tags(you, "li").length, app.traits.length);
  assert.match(you, /aria-label="Sovereign: 1 of 1 lesson finished"/);
  assert.match(you, /aria-label="Civil: 0 of 1 lesson finished"/);
  assert.match(visibleText(you), /1 of 4/);
  assert.match(visibleText(you), new RegExp(app.citizen.line));
  for (const t of app.traits) assert.ok(visibleText(you).includes(t.grant));
  // a trait with no lessons yet says so
  const extra = { ...app, traits: [...app.traits, { id: "kind", name: "Kind", grant: "You help.", hue: 30 }] };
  assert.match(visibleText(String(renderHome(extra, s))), /no lessons yet/);
});

test("home leads with the logo and BECOME CAPABLE, one idea at a time", () => {
  const m = String(renderHome(app, emptyState()));
  assert.match(m, /<span class="home__logo"[^>]*><svg class="lockup"[^>]*role="img" aria-label="capable"/, "the seal and wordmark from the art grammar (U18)");
  const h1 = m.match(/<h1[\s\S]*?<\/h1>/)[0];
  assert.equal(visibleText(h1), "Become capable.");
  assert.match(h1, /<span class="key">capable\.<\/span>/);
  assert.match(visibleText(m), /one idea at a time/);
  assert.match(m, /<a class="sticker home__you" href="#\/passport"/, "the you chip opens the passport (P1)");
});

test("shout: the last word is the key word, with a full stop unless punctuated", () => {
  assert.equal(String(shout("Own Your Exit")), '<h2 class="shout" data-n="5">Own Your <span class="key">Exit.</span></h2>');
  assert.match(String(shout("Why leave?")), /<span class="key">leave\?<\/span>/);
  assert.match(String(shout("Manners Make Strangers Safe")), /data-n="9"/, "fits the longest word");
});

test("trait colours: the four candies are exact, any other hue is a readable candy", () => {
  assert.equal(traitColor(195), "#18c8f0");
  assert.equal(traitColor(312), "#ff1fc8");
  assert.equal(traitColor(135), "#5cf27e");
  assert.equal(traitColor(52), "#ffe11a");
  for (let h = 0; h < 360; h++) {
    const c = traitColor(h);
    assert.match(c, /^#[0-9a-f]{6}$/);
    assert.ok(contrast(INK, c) >= 4.5, `ink on hue ${h} (${c}) is ${contrast(INK, c).toFixed(2)}`);
  }
  assert.ok(contrast("#ffffff", MAGENTA) >= 3, "white primary-button text passes AA as large text");
  for (const bgc of [BG, SURFACE]) {
    assert.ok(contrast(INK, bgc) >= 7);
    assert.ok(contrast(SLATE, bgc) >= 4.5, "slate small print");
  }
});

test("tokens.css and art.mjs agree on the palette", () => {
  const css = readFileSync(join(APP_DIR, "src/tokens.css"), "utf8");
  const v = (name) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))[1].toLowerCase();
  assert.equal(v("bg"), BG);
  assert.equal(v("ink"), INK);
  assert.equal(v("surface"), SURFACE);
  assert.equal(v("slate"), SLATE);
  assert.deepEqual(["cyan", "magenta", "lime", "yellow"].map(v), CANDY.map((c) => c.hex));
});

test("each lesson gets its scene; drafts and unknown lessons get the seed", () => {
  for (const id of ["own-your-exit", "friend-speech", "vote-with-your-feet", "what-lasts"]) assert.equal(sceneKey({ id, status: "ready" }), id);
  assert.equal(sceneKey({ id: "own-your-exit", status: "draft" }), "seed");
  assert.equal(sceneKey({ id: "new-topic", status: "ready" }), "seed");
  for (const k of SCENE_KEYS) {
    const s = String(sceneSvg(k, 52, `t-${k}`));
    assert.match(s, /^<svg class="scene" viewBox="0 0 320 240"/);
    assert.match(s, /fill="#ffe11a"/, `${k} uses the trait colour`);
    assert.match(s, /fill="#5b6488"|fill="url\(#ht-/, `${k} uses slate`);
    assert.doesNotMatch(s, /style=|<script|<text/);
  }
  const a = String(sceneSvg("seed", 52, "one"));
  const b = String(sceneSvg("seed", 52, "two"));
  assert.notEqual(a.match(/id="ht-[^"]+"/)[0], b.match(/id="ht-[^"]+"/)[0], "ids are unique per instance");
});

test("the logo fills in with lessons; confetti is seeded and stays in its zones", () => {
  assert.equal(logoFill(0, 4), 0);
  assert.equal(logoFill(1, 4), 2);
  assert.equal(logoFill(4, 4), 7);
  assert.equal(logoFill(1, 40), 1, "the first lesson always shows a letter");
  assert.equal(logoFill(3, 0), 0);
  const empty = String(logoSvg({ filled: 0, outline: true }));
  const full = String(logoSvg({ filled: 7 }));
  assert.doesNotMatch(empty, /#18c8f0|#ff1fc8/);
  assert.match(full, /#18c8f0/);
  const { ctx } = deckModel(app, "own-your-exit", emptyState());
  assert.equal(ctx.doneAfter, 1, "the trait card counts this lesson");
  assert.equal(ctx.totalLessons, 3, "out of the ready lessons only");
  const zone = { x: 0.6, y: 0.1, w: 0.3, h: 0.5 };
  const bits = confetti("seed-a", [zone], 10);
  assert.deepEqual(bits, confetti("seed-a", [zone], 10), "same seed, same confetti");
  assert.notDeepEqual(bits, confetti("seed-b", [zone], 10));
  for (const b of bits) {
    assert.ok(b.x >= 60 && b.x <= 90 && b.y >= 10 && b.y <= 60, JSON.stringify(b));
    assert.ok(b.size >= 6 && b.size <= 12);
  }
});

// ---- review T10: what's new since the last visit ----------------------------------------

const workIds = (l) => l.work.map((w) => w.id);

test("what's new: a first visit takes everything as seen; later, a lesson not seen is new and a lesson with new works counts them, until it's opened", () => {
  const storage = memStorage();
  const seen = openSeen(storage, { key: seenKey("/Capable/") });
  assert.deepEqual(seen.news(app), { lessons: new Set(), works: new Map() }, "nothing recorded yet: nothing is new");
  assert.equal(seen.baseline(app), true);
  assert.equal(seen.baseline(app), false, "only once");
  assert.deepEqual(seen.news(app), { lessons: new Set(), works: new Map() }, "a newcomer sees no 'new' stickers");
  // the next visit: friend-speech was added, and own-your-exit gained a work since
  const before = { v: 1, lessons: Object.fromEntries(app.lessons.filter((l) => l.id !== "friend-speech").map((l) => [l.id, workIds(l)])) };
  before.lessons["own-your-exit"] = workIds(app.lessons[0]).slice(1);
  const s2 = memStorage({ [seenKey("/Capable/")]: JSON.stringify(before) });
  const again = openSeen(s2, { key: seenKey("/Capable/") });
  const news = again.news(app);
  assert.deepEqual([...news.lessons], ["friend-speech"]);
  assert.deepEqual([...news.works], [["own-your-exit", 1]]);
  const m = String(renderHome(app, emptyState(), { news }));
  const tileOf = (id) => m.slice(m.indexOf(`data-lesson="${id}"`), m.indexOf("</li>", m.indexOf(`data-lesson="${id}"`)));
  assert.match(tileOf("friend-speech"), new RegExp(`<span class="sticker tile__new">${COPY.newSticker}</span>`));
  assert.match(tileOf("own-your-exit"), new RegExp(`<span class="sticker tile__new">${COPY.newWorks(1)}</span>`));
  assert.doesNotMatch(tileOf("what-lasts"), /tile__new/);
  assert.ok(visibleText(tileOf("friend-speech")).includes(COPY.newA11y), "said to screen readers too");
  const line = m.match(/<a class="pixel intro__new" href="([^"]+)">([\s\S]*?)<\/a>/);
  assert.equal(line[1], "#/l/own-your-exit", "the intro links the first lesson with something new, in reading order");
  assert.equal(visibleText(line[2]), `${COPY.whatsNew(2)}: Own Your Exit`);
  // opened: seen
  again.markLesson(app.lessons.find((l) => l.id === "friend-speech"));
  again.markLesson(app.lessons[0]);
  assert.deepEqual(again.news(app), { lessons: new Set(), works: new Map() });
  assert.doesNotMatch(String(renderHome(app, emptyState(), { news: again.news(app) })), /tile__new|intro__new/);
  // hostile storage is dropped
  const bad = openSeen(memStorage({ k: JSON.stringify({ v: 1, lessons: { "../x": ["a"], ok: "nope", fine: ["<b>", "0xab"] } }) }), { key: "k" });
  assert.deepEqual(bad.get(), { v: 1, lessons: { fine: ["0xab"] } });
  assert.equal(openSeen(memStorage({ k: "{" }), { key: "k" }).get(), null);
});

test("what's new through the shell: home shows it on return, and opening the lesson clears it", async () => {
  const before = { v: 1, lessons: Object.fromEntries(app.lessons.filter((l) => l.id !== "what-lasts").map((l) => [l.id, workIds(l)])) };
  const storage = memStorage({ [seenKey("/Capable/")]: JSON.stringify(before) });
  const win = fakeWindow({ url: "https://app.example/Capable/#/", storage });
  const doc = win.document;
  const root = doc.createElement("div");
  root.setAttribute("id", "app");
  doc.body.appendChild(root);
  const data = doc.createElement("script");
  data.setAttribute("id", "app-data");
  data.textContent = JSON.stringify(app);
  doc.body.appendChild(data);
  boot({ win, storage, fetchImpl: async () => ({ ok: false, status: 404 }), serviceWorker: false });
  assert.equal(root.querySelector('.tile[data-lesson="what-lasts"] .tile__new').textContent, COPY.newSticker);
  assert.ok(root.querySelector(".intro__new"));
  win.location.hash = "#/l/what-lasts";
  await settle();
  win.location.hash = "#/";
  await settle();
  assert.equal(root.querySelector(".tile__new"), null);
  assert.equal(root.querySelector(".intro__new"), null);
  // a brand-new reader: nothing is new
  const fresh = memStorage();
  const w2 = fakeWindow({ url: "https://app.example/Capable/#/", storage: fresh });
  const r2 = w2.document.createElement("div");
  r2.setAttribute("id", "app");
  w2.document.body.appendChild(r2);
  const d2 = w2.document.createElement("script");
  d2.setAttribute("id", "app-data");
  d2.textContent = JSON.stringify(app);
  w2.document.body.appendChild(d2);
  boot({ win: w2, storage: fresh, fetchImpl: async () => ({ ok: false, status: 404 }), serviceWorker: false });
  assert.equal(r2.querySelector(".tile__new"), null);
});
