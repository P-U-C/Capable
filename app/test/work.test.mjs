// A2 — work slots: lead and more render the creators' work, empty slots are
// skipped, video plays HLS inline (native or lazily-loaded hls.js) with a
// fallback link, and builds show the guide and the code.
import test from "node:test";
import assert from "node:assert/strict";
import { creatorName, worksFor, pickSource, fallbackUrl, renderLead, renderMore, renderSheet } from "../src/work.mjs";
import { createPlayer, loadHls, resetHlsLoader, HLS_URL } from "../src/player.mjs";
import { renderDeck } from "../src/cards.mjs";
import { deckModel } from "../src/model.mjs";
import { emptyState } from "../src/store.mjs";
import { fixture, lessonOf, tags, attr, visibleText, fakeFrame, fakeDoc, fakeHls, tick } from "./helpers.mjs";

const app = fixture();
const fs = lessonOf(app, "friend-speech");
const oye = lessonOf(app, "own-your-exit");
const lead = worksFor(fs, "lead")[0];
const opts = { hue: 312, uid: "t" };

test("creators are credited by @username, or as a creator", () => {
  assert.equal(creatorName(app, 5254), "@papa");
  assert.equal(creatorName(app, 2391), "a creator", "known fid without a username");
  assert.equal(creatorName(app, 999999), "a creator", "unknown fid");
  assert.equal(creatorName({ creators: { 1: { fid: 1, username: "<b>x</b>" } } }, 1), "a creator", "an invalid username is never shown");
});

test("worksFor keeps compile's order and filters by role", () => {
  assert.deepEqual(
    worksFor(fs, "more").map((w) => w.fid),
    [1075315, 266490, 266418],
  );
  assert.equal(worksFor(fs, "lead").length, 1);
  assert.deepEqual(worksFor(lessonOf(app, "what-lasts"), "lead"), []);
  assert.deepEqual(worksFor({}, "lead"), []);
});

test("pickSource: native HLS on Safari, mp4 directly, hls.js otherwise, external last", () => {
  const hls = "https://s.example/v.m3u8";
  const mp4 = "https://s.example/v.mp4";
  const ext = "https://s.example/watch";
  assert.deepEqual(pickSource({ hls }, { nativeHls: true }), { mode: "native", url: hls });
  assert.deepEqual(pickSource({ hls }, { nativeHls: false }), { mode: "hlsjs", url: hls });
  assert.deepEqual(pickSource({ hls, mp4 }, { nativeHls: false }), { mode: "file", url: mp4 }, "no hls.js needed when an mp4 exists");
  assert.deepEqual(pickSource({ hls, mp4 }, { nativeHls: true }), { mode: "native", url: hls });
  assert.deepEqual(pickSource({ external: ext }), { mode: "external", url: ext });
  assert.deepEqual(pickSource({ hls: "http://s.example/v.m3u8", mp4: "javascript:alert(1)" }).mode, "none", "only https");
  assert.equal(pickSource(undefined).mode, "none");
});

test("the lead video renders full-bleed 9:16 with credit, original link and a fallback", () => {
  const m = String(renderLead(app, fs, lead, opts));
  assert.match(m, /class="vframe" data-work="0x780d71e5b43cfe009ffcaf5ff0ac234bb711a927"/);
  assert.equal(tags(m, "video").length, 0, "the <video> is created on first play, not in markup");
  const text = visibleText(m);
  assert.match(text, /by @papa/);
  assert.match(text, /original ↗/);
  assert.match(text, /watch the original ↗/);
  assert.match(text, /tap to unmute/);
  assert.match(text, /Is a trustworthy society built on politeness, or on predictability\?/);
  const links = tags(m, "a");
  const original = links.find((t) => attr(t, "class") === "credit__link");
  assert.equal(attr(original, "href"), lead.original);
  const fallback = links.find((t) => /btn/.test(attr(t, "class")));
  assert.equal(attr(fallback, "href"), fallbackUrl(lead));
  for (const a of links) {
    assert.equal(attr(a, "target"), "_blank");
    assert.equal(attr(a, "rel"), "noopener noreferrer");
  }
  assert.ok(tags(m, "button").every((b) => attr(b, "type") === "button"));
});

test("a build renders its caption with open the guide and see the code", () => {
  const w = worksFor(oye, "lead")[0];
  const m = String(renderLead(app, oye, w, opts));
  const text = visibleText(m);
  assert.match(text, /by @0xabhii/);
  assert.match(text, /open the guide ↗/);
  assert.match(text, /see the code ↗/);
  const hrefs = tags(m, "a").map((t) => attr(t, "href"));
  assert.ok(hrefs.includes(w.build.site) && hrefs.includes(w.build.repo) && hrefs.includes(w.original));
  assert.doesNotMatch(m, /class="vframe"/, "no video frame for a build");
  const repoOnly = String(renderLead(app, oye, { ...w, build: { repo: w.build.repo } }, opts));
  assert.doesNotMatch(visibleText(repoOnly), /open the guide/);
  assert.match(visibleText(repoOnly), /see the code ↗/);
});

test("the more slot stacks every other take, each credited, videos open in a sheet", () => {
  const more = worksFor(fs, "more");
  const m = String(renderMore(app, fs, more, opts));
  assert.equal(tags(m, "li").length, 3);
  const text = visibleText(m);
  for (const u of ["@zatweirdaj", "@tophb", "@leoxcrane"]) assert.match(text, new RegExp(`by ${u}`));
  assert.deepEqual(
    tags(m, "button").map((b) => attr(b, "data-open")),
    more.map((w) => w.id),
  );
  const builds = String(renderMore(app, oye, worksFor(oye, "more"), opts));
  assert.match(visibleText(builds), /by a creator/, "fid 2391 has no username");
  assert.match(visibleText(builds), /open the guide ↗/);
  const sheet = String(renderSheet(app, fs, more[0], opts));
  assert.match(sheet, /role="dialog" aria-modal="true"/);
  assert.match(sheet, /data-close-sheet aria-label="Close video"/);
});

test("decks render lead and more only when that work exists", () => {
  const render = (id) => {
    const { cards, ctx } = deckModel(app, id, emptyState());
    return String(renderDeck(ctx, cards));
  };
  const full = render("friend-speech");
  assert.equal((full.match(/class="vframe"/g) || []).length, 1);
  assert.match(full, /data-type="lead"/);
  assert.match(full, /data-type="more"/);
  const none = render("what-lasts");
  assert.doesNotMatch(none, /data-type="lead"|data-type="more"|vframe|\/\/ watch|\/\/ more/);
  const build = render("own-your-exit");
  assert.match(build, /\/\/ build/);
});

test("HLS through hls.js is loaded lazily, once, from cdnjs 1.5.x", async () => {
  assert.match(HLS_URL, /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/hls\.js\/1\.5\.\d+\/hls\.min\.js$/);
  resetHlsLoader();
  const appended = [];
  const listeners = {};
  const win = {};
  const doc = {
    createElement: () => ({ addEventListener: (t, f) => (listeners[t] = f), remove() {} }),
    head: { appendChild: (s) => appended.push(s) },
  };
  const { Hls } = fakeHls();
  const p1 = loadHls({ doc, win });
  const p2 = loadHls({ doc, win });
  assert.equal(p1, p2, "one load in flight is shared");
  assert.equal(appended.length, 1);
  assert.equal(appended[0].src, HLS_URL);
  assert.equal(appended[0].crossOrigin, "anonymous");
  win.Hls = Hls;
  listeners.load();
  assert.equal(await p1, Hls);
  assert.equal(await loadHls({ doc, win }), Hls, "already loaded: no new script");
  assert.equal(appended.length, 1);

  // a failed load rejects and can be retried later
  resetHlsLoader();
  const win2 = {};
  const p3 = loadHls({ doc, win: win2 });
  listeners.error();
  await assert.rejects(p3);
  loadHls({ doc, win: win2 }).catch(() => {});
  assert.equal(appended.length, 3, "a retry adds a fresh script");
  resetHlsLoader();
});

test("player: native HLS needs no loader; hls.js loads only on first play", async () => {
  const native = fakeFrame();
  let loads = 0;
  const load = async () => {
    loads++;
    return fakeHls().Hls;
  };
  const doc1 = fakeDoc();
  const p1 = createPlayer(native, lead.video, { doc: doc1, nativeHls: true, load });
  assert.equal(p1.mode, "native");
  p1.play({ muted: true });
  const v1 = doc1.made.find((e) => e.tag === "video");
  assert.equal(v1.src, lead.video.hls);
  assert.equal(v1.muted, true);
  assert.equal(v1.attrs.playsinline, "");
  assert.equal(loads, 0);

  const { Hls, instances } = fakeHls();
  const frame = fakeFrame();
  const doc2 = fakeDoc();
  const p2 = createPlayer(frame, lead.video, { doc: doc2, nativeHls: false, load: async () => (loads++, Hls) });
  assert.equal(p2.mode, "hlsjs");
  assert.equal(doc2.made.length, 0, "nothing is created before play");
  assert.equal(loads, 0, "hls.js is not requested before play");
  p2.play({ muted: true });
  await tick();
  assert.equal(loads, 1);
  assert.equal(instances.length, 1);
  assert.equal(instances[0].url, lead.video.hls);
  assert.equal(instances[0].media, doc2.made[0]);
  assert.ok(doc2.made[0].playCalls.length >= 1, "plays once attached");
  p2.pause();
  assert.equal(doc2.made[0].paused, true);
  p2.play({ muted: true });
  await tick();
  assert.equal(loads, 1, "a second play does not load again");
  p2.destroy();
  assert.equal(instances[0].destroyed, true);
  assert.equal(doc2.made[0].removed, true);
});

test("player: any failure shows the poster and the fallback link", async () => {
  // loader fails
  const f1 = fakeFrame();
  const states = [];
  const p1 = createPlayer(f1, lead.video, { doc: fakeDoc(), load: () => Promise.reject(new Error("offline")), onState: (s) => states.push(s) });
  p1.play();
  await tick();
  assert.ok(f1.classes.has("is-error"));
  assert.equal(states.at(-1), "error");
  // hls.js reports a fatal error
  const { Hls, instances } = fakeHls();
  const f2 = fakeFrame();
  const p2 = createPlayer(f2, lead.video, { doc: fakeDoc(), load: async () => Hls });
  p2.play();
  await tick();
  instances[0].handlers.hlsError("hlsError", { fatal: false });
  assert.ok(!f2.classes.has("is-error"), "non-fatal errors are hls.js's to recover");
  instances[0].handlers.hlsError("hlsError", { fatal: true });
  assert.ok(f2.classes.has("is-error"));
  // the browser can't run hls.js at all
  const f3 = fakeFrame();
  createPlayer(f3, lead.video, { doc: fakeDoc(), load: async () => fakeHls({ supported: false }).Hls }).play();
  await tick();
  assert.ok(f3.classes.has("is-error"));
  // the media element errors (native path)
  const f4 = fakeFrame();
  const d4 = fakeDoc();
  createPlayer(f4, lead.video, { doc: d4, nativeHls: true }).play();
  d4.made[0].emit("error");
  assert.ok(f4.classes.has("is-error"));
  assert.equal(d4.made[0].removed, true);
  // only an external page: no player at all
  const f5 = fakeFrame();
  const d5 = fakeDoc();
  createPlayer(f5, { external: "https://example.com/watch" }, { doc: d5 }).play();
  assert.ok(f5.classes.has("is-error"));
  assert.equal(d5.made.length, 0);
});

test("player: muted autoplay; sound falls back to muted when the browser blocks it", async () => {
  const f = fakeFrame();
  const d = fakeDoc({ playRejects: "NotAllowedError" });
  const p = createPlayer(f, lead.video, { doc: d, nativeHls: true });
  p.play({ muted: false });
  await tick();
  await tick();
  const v = d.made[0];
  assert.deepEqual(
    v.playCalls.map((c) => c.muted),
    [false, true],
  );
  assert.equal(p.muted, true);
  assert.ok(f.classes.has("is-muted"));
  p.setMuted(false);
  assert.equal(v.muted, false);
  v.emit("playing");
  assert.ok(f.classes.has("is-playing"));
});
