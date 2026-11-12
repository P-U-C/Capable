// A3 — home: lesson tiles in order with art, title, promise, trait, minutes and
// progress; drafts marked; the "you" panel's traits fill as lessons finish.
// Also the colour system the tiles and traits depend on.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderHome, bar } from "../src/home.mjs";
import { ordered, traitProgress, traitsComplete, logoFill, deckModel } from "../src/model.mjs";
import { shout } from "../src/cards.mjs";
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
  assert.equal((m.match(/class="scene"/g) || []).length, app.lessons.length, "every tile has its art");
});

test("draft lessons are marked new · in progress, and only drafts", () => {
  const m = String(renderHome(app, emptyState()));
  assert.equal((visibleText(m).match(/new · in progress/g) || []).length, 1);
  const draftTile = tilesOf(m).find((t) => attr(t, "data-draft") === "true");
  assert.equal(attr(draftTile, "href"), "#/l/new-topic");
});

test("tiles show progress: start, resume with a partial bar, read again when done", () => {
  let s = emptyState();
  s = recordVisit(s, "friend-speech", { index: 4, count: 17 });
  s = recordVisit(s, "own-your-exit", { index: 11, count: 13, finished: true });
  const m = String(renderHome(app, s));
  const tile = (id) => m.slice(m.indexOf(`href="#/l/${id}"`), m.indexOf("</a>", m.indexOf(`href="#/l/${id}"`)));
  assert.match(visibleText(tile("own-your-exit")), /Read again/);
  assert.match(tile("own-your-exit"), /<rect width="100" height="10"\/>/);
  assert.match(visibleText(tile("friend-speech")), /Resume/);
  assert.match(tile("friend-speech"), /<rect width="25" height="10"\/>/);
  assert.match(tile("friend-speech"), /aria-label="25 percent read"/);
  assert.match(visibleText(tile("what-lasts")), /Start/);
  assert.match(tile("what-lasts"), /aria-label="Not started"/);
  assert.match(String(bar(2, "x")), /width="100"/, "bars clamp");
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
  s = recordVisit(s, "own-your-exit", { index: 11, count: 13, finished: true });
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
  assert.match(m, /<svg class="logo"[^>]*role="img" aria-label="capable"/);
  const h1 = m.match(/<h1[\s\S]*?<\/h1>/)[0];
  assert.equal(visibleText(h1), "Become capable.");
  assert.match(h1, /<span class="key">capable\.<\/span>/);
  assert.match(visibleText(m), /one idea at a time/);
  assert.match(m, /href="#\/you"/);
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
