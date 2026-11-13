// The DOM halves, driven through a small fake DOM (test/dom.mjs; review S7):
// the deck saves and resumes progress, finishes only ready lessons, pauses
// and releases video, keeps autoplay muted and thrifty, and leaves through
// the shell; the shell keeps history tidy (Back from home leaves the app),
// sends unknown lessons home, titles each view and takes changed updates.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeWindow, memStorage, settle, press, pointer, FakeEvent } from "./dom.mjs";
import { fixture, lessonOf } from "./helpers.mjs";
import { mountDeck } from "../src/view-deck.mjs";
import { boot } from "../src/shell.mjs";
import { openStore, storageKey } from "../src/store.mjs";
import { deckCards } from "../src/deck.mjs";
import { paintIn } from "../src/paint.mjs";
import { sceneSvg } from "../src/art.mjs";

const app = fixture();

/** A deck mounted in a fresh fake window. */
function deck(lessonId, { storage = memStorage(), reduced = false, connection, nativeHls = true, a = app, onClose = () => {}, onLink = () => {} } = {}) {
  const win = fakeWindow({ storage, connection, nativeHls });
  const doc = win.document;
  const root = doc.createElement("div");
  root.setAttribute("id", "app");
  doc.body.appendChild(root);
  const store = openStore(storage, { key: storageKey("/Capable/") });
  const view = mountDeck(root, { app: a, lessonId, store, reduced, onClose, onLink });
  const cards = deckCards(lessonOf(a, lessonId));
  const at = (type, nth = 0) => cards.map((c, i) => [c, i]).filter(([c]) => c.type === type)[nth][1];
  const saved = () => JSON.parse(storage.getItem(storageKey("/Capable/")) || "null");
  const active = () => root.querySelector(".card.is-active");
  return { win, doc, root, store, view, cards, at, saved, active, storage };
}

const videoOf = (root, i) => root.querySelectorAll(".card")[i].querySelector("video");

test("the deck saves where the reader is, by card key, and a second visit resumes there (M59)", async () => {
  const d = deck("friend-speech");
  assert.equal(d.view.index, 0);
  assert.equal(d.active().dataset.key, "cover-0");
  press(d.doc, "ArrowRight");
  press(d.doc, "ArrowRight");
  press(d.doc, "ArrowRight");
  assert.equal(d.view.index, 3);
  const s = d.saved();
  assert.equal(s.at["friend-speech"], d.cards[3].key, "saved as a card key, not an index");
  assert.ok(s.furthest["friend-speech"] > 0);
  assert.equal(d.doc.activeElement, d.active(), "focus moves to the card");
  assert.equal(d.root.querySelector("[aria-live]"), null, "no second announcement");
  d.view.destroy();
  const again = deck("friend-speech", { storage: d.storage });
  assert.equal(again.view.index, 3, "resumed on the same card");
  assert.equal(again.active().dataset.key, d.cards[3].key);
  again.view.destroy();
});

test("a resumed card is found by key even when work arrives in front of it (review S12)", () => {
  const storage = memStorage();
  const bare = { ...app, lessons: app.lessons.map((l) => (l.id === "friend-speech" ? { ...l, work: [] } : l)) };
  const d = deck("friend-speech", { storage, a: bare });
  const idea = d.at("idea", 2);
  d.view.go(idea);
  d.view.destroy();
  const withWork = deck("friend-speech", { storage });
  assert.equal(withWork.active().dataset.key, "idea-2");
  assert.notEqual(withWork.view.index, idea, "the index moved; the key held");
  withWork.view.destroy();
});

test("reaching the trait card finishes a ready lesson; End skips past it; a draft is never recorded done (review S11, U15)", () => {
  const d = deck("own-your-exit");
  press(d.doc, "End");
  assert.equal(d.view.index, d.cards.length - 1);
  assert.equal(d.saved().done["own-your-exit"], undefined, "jumping to the end earns nothing");
  press(d.doc, "ArrowLeft");
  press(d.doc, "ArrowLeft");
  assert.equal(d.active().dataset.type, "trait");
  assert.equal(d.saved().done["own-your-exit"], true);
  d.view.destroy();

  const draft = deck("new-topic");
  draft.view.go(draft.at("trait"));
  assert.equal(draft.active().dataset.type, "trait");
  assert.equal(draft.saved().done["new-topic"], undefined, "a draft read to its trait card is not done");
  assert.ok(draft.saved().at["new-topic"], "its place is still remembered");
  draft.view.destroy();
});

test("video: autoplay is muted; the video a swipe leaves is paused; leaving releases every player (M42, M60)", async () => {
  const d = deck("friend-speech");
  const lead = d.at("lead");
  d.view.go(lead);
  await settle();
  const v = videoOf(d.root, lead);
  assert.ok(v, "a <video> is made when the card shows");
  assert.equal(v.paused, false, "it plays");
  assert.equal(v.muted, true, "never with sound on its own");
  assert.equal(v.preload, "none");
  assert.match(v.src, /^https:\/\/stream\./);
  d.view.go(lead + 1);
  assert.equal(v.paused, true, "swiping away pauses it (M42)");
  assert.ok(v.isConnected, "a neighbour keeps its player");
  d.view.go(lead + 3);
  assert.equal(v.parentNode, null, "players more than a card away are released");
  d.view.go(lead);
  await settle();
  const v2 = videoOf(d.root, lead);
  assert.notEqual(v2, v);
  assert.equal(v2.paused, false);
  d.view.destroy();
  assert.equal(v2.paused, true, "leaving the deck stops it (M60)");
  assert.equal(v2.parentNode, null, "and removes it");
  assert.equal(v2.hasAttribute("src"), false, "and drops its source");
  assert.equal(d.doc.listenerCount("keydown"), 0, "no key handler left behind");
});

test("video: Space and K play and pause; a middle tap too; an explicit start may use the reader's sound setting (review U5)", async () => {
  const storage = memStorage();
  const d = deck("friend-speech", { storage });
  const lead = d.at("lead");
  d.view.go(lead);
  await settle();
  const v = videoOf(d.root, lead);
  press(d.doc, " ");
  await settle();
  assert.equal(v.paused, true, "Space pauses on a video card");
  assert.equal(d.view.index, lead, "and does not move on");
  press(d.doc, "k");
  await settle();
  assert.equal(v.paused, false, "K plays");
  const bar = d.active().querySelector(".vframe__bar");
  assert.ok(d.active().querySelector(".vframe").classList.contains("is-started"), "the controls show once started");
  const toggle = bar.querySelector("[data-toggle]");
  assert.equal(toggle.getAttribute("aria-label"), "Pause");
  toggle.click();
  await settle();
  assert.equal(v.paused, true, "the visible button pauses");
  assert.equal(toggle.getAttribute("aria-label"), "Play");
  // the scrub bar seeks, and keeps its own arrow keys
  const scrub = bar.querySelector("[data-scrub]");
  scrub.value = "500";
  scrub.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  assert.equal(v.currentTime, v.duration / 2);
  scrub.focus();
  press(d.doc, "ArrowRight");
  assert.equal(d.view.index, lead, "arrows on the scrub bar do not change card");
  // a middle tap plays and pauses
  d.active().focus();
  const stage = d.root.querySelector(".deck__stage");
  stage.layout.width = 300;
  pointer(stage, "pointerdown", { clientX: 150, clientY: 100, timeStamp: 1000 });
  pointer(stage, "pointerup", { clientX: 150, clientY: 100, timeStamp: 1080 });
  await settle();
  assert.equal(v.paused, false, "a middle tap plays");
  // text cards: Space still moves on
  d.view.go(0);
  press(d.doc, " ");
  assert.equal(d.view.index, 1);
  d.view.destroy();

  // a reader who turned sound on: autoplay stays muted, an explicit start uses sound
  const s = openStore(storage, { key: storageKey("/Capable/") });
  s.setSound(true);
  const e = deck("friend-speech", { storage, connection: { saveData: true } });
  e.view.go(lead);
  await settle();
  assert.equal(videoOf(e.root, lead), null, "Save-Data: nothing starts or loads on its own");
  e.active().querySelector("[data-play]").click();
  await settle();
  const w = videoOf(e.root, lead);
  assert.equal(w.paused, false);
  assert.equal(w.muted, false, "the reader pressed play and wants sound");
  e.view.destroy();
});

test("video: no autoplay with reduced motion or on a slow or cellular link (review S14)", async () => {
  for (const opts of [{ reduced: true }, { connection: { effectiveType: "3g" } }, { connection: { type: "cellular" } }]) {
    const d = deck("friend-speech", opts);
    d.view.go(d.at("lead"));
    await settle();
    assert.equal(videoOf(d.root, d.at("lead")), null, JSON.stringify(opts));
    d.view.destroy();
  }
});

test("practice ticks are saved by step id; ticking every step shows the done stamp (review S12, U17)", () => {
  const d = deck("friend-speech");
  const i = d.at("practice");
  d.view.go(i);
  const steps = d.active().querySelectorAll(".step");
  assert.ok(steps.length >= 2);
  const stamp = d.active().querySelector("[data-practice-done]");
  assert.equal(stamp.hasAttribute("data-on"), false);
  steps[0].click();
  assert.equal(steps[0].getAttribute("aria-pressed"), "true");
  const key = `friend-speech/${d.cards[i].key}`;
  assert.deepEqual(d.saved().ticks[key], [d.cards[i].stepIds[0]]);
  for (const b of steps.slice(1)) b.click();
  assert.equal(stamp.hasAttribute("data-on"), true, "all done: the stamp shows");
  steps[0].click();
  assert.equal(stamp.hasAttribute("data-on"), false);
  d.view.destroy();
  const again = deck("friend-speech", { storage: d.storage });
  again.view.go(i);
  const b = again.active().querySelectorAll(".step");
  assert.deepEqual(
    b.map((x) => x.getAttribute("aria-pressed")),
    b.map((_, n) => (n === 0 ? "false" : "true")),
    "ticks come back",
  );
  again.view.destroy();
});

test("leaving goes through the shell: the close button and Esc call onClose, in-deck links call onLink", () => {
  const calls = [];
  const d = deck("own-your-exit", { onClose: () => calls.push("close"), onLink: (h) => calls.push(h) });
  const close = d.root.querySelector(".deck__close");
  const ev = new FakeEvent("click", { bubbles: true });
  close.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true, "the link does not push a history entry itself");
  press(d.doc, "Escape");
  d.view.go(d.cards.length - 1);
  d.active().querySelector('a.btn--primary[href^="#/l/"]').click();
  d.active().querySelector('a.btn[href="#/"]').click();
  assert.deepEqual(calls, ["close", "close", "#/l/friend-speech", "#/"]);
  d.view.destroy();
});

test("gestures: the scrub bar never swipes; a mouse drag on text selects instead of moving the card (review U16)", () => {
  const d = deck("friend-speech");
  const stage = d.root.querySelector(".deck__stage");
  stage.layout.width = 300;
  d.view.go(d.at("idea", 1));
  const start = d.view.index;
  // a touch swipe moves on
  pointer(stage, "pointerdown", { clientX: 250, clientY: 100, timeStamp: 0 });
  pointer(stage, "pointermove", { clientX: 120, clientY: 102, timeStamp: 40 });
  pointer(stage, "pointerup", { clientX: 60, clientY: 102, timeStamp: 80 });
  assert.equal(d.view.index, start + 1);
  // a mouse drag that starts on text is a selection
  d.view.go(d.at("story"));
  const story = d.view.index;
  const text = d.active().querySelector("[data-selectable] p");
  pointer(text, "pointerdown", { pointerType: "mouse", clientX: 250, clientY: 100, timeStamp: 200 });
  pointer(text, "pointermove", { pointerType: "mouse", clientX: 120, clientY: 102, timeStamp: 240 });
  pointer(text, "pointerup", { pointerType: "mouse", clientX: 60, clientY: 102, timeStamp: 280 });
  assert.equal(d.view.index, story, "no swipe");
  d.view.go(d.at("lead"));
  const scrub = d.active().querySelector("[data-scrub]");
  pointer(scrub, "pointerdown", { clientX: 250, clientY: 100, timeStamp: 400 });
  pointer(scrub, "pointermove", { clientX: 100, clientY: 100, timeStamp: 440 });
  pointer(scrub, "pointerup", { clientX: 60, clientY: 100, timeStamp: 480 });
  assert.equal(d.view.index, d.at("lead"), "dragging the scrub bar seeks, never swipes");
  d.view.destroy();
});

test("the more sheet hides the arrows, plays on request and is released on close", async () => {
  const d = deck("friend-speech");
  d.view.go(d.at("more"));
  const thumb = d.active().querySelector("[data-open]");
  thumb.click();
  await settle();
  const deckEl = d.root.querySelector(".deck");
  assert.ok(deckEl.classList.contains("has-sheet"));
  const sheet = deckEl.querySelector(".sheet");
  const v = sheet.querySelector("video");
  assert.equal(v.paused, false);
  assert.equal(d.doc.activeElement, sheet.querySelector("[data-close-sheet]"));
  press(d.doc, "Escape");
  assert.equal(deckEl.querySelector(".sheet"), null);
  assert.equal(deckEl.classList.contains("has-sheet"), false);
  assert.equal(v.paused, true);
  assert.equal(v.parentNode, null);
  assert.equal(d.doc.activeElement, thumb, "focus returns to the thumbnail");
  d.view.destroy();
});

// ---- the shell: routing, history, titles, updates ---------------------------

/** Boot the app in a fake window at `hash`. */
function app_(hash = "#/", { storage = memStorage(), fetchImpl, a = app } = {}) {
  const win = fakeWindow({ url: `https://app.example/Capable/${hash}`, storage });
  const doc = win.document;
  const root = doc.createElement("div");
  root.setAttribute("id", "app");
  doc.body.appendChild(root);
  const data = doc.createElement("script");
  data.setAttribute("id", "app-data");
  data.textContent = JSON.stringify(a);
  doc.body.appendChild(data);
  const shell = boot({ win, storage, fetchImpl: fetchImpl ?? (async () => ({ ok: false, status: 404 })), serviceWorker: false });
  return { win, doc, root, shell };
}

test("history: a lesson opened from home and closed leaves one entry, so Back from home leaves the app (review U4)", async () => {
  const { win, doc, root, shell } = app_("#/");
  assert.equal(shell.view.lessonId, undefined);
  assert.equal(doc.title, "capable");
  win.location.hash = "#/l/own-your-exit"; // a tile tap
  await settle();
  assert.equal(shell.view.lessonId, "own-your-exit");
  assert.equal(doc.title, "Own Your Exit · capable", "each lesson titles the page (review U11)");
  assert.equal(win.history.length, 2);
  press(doc, "Escape");
  await settle();
  assert.equal(root.querySelector(".deck"), null, "home again");
  assert.equal(win.location.hash, "#/");
  assert.equal(win.history.index, 0, "back on the first entry: one more Back leaves the app");
  assert.equal(doc.activeElement, root.querySelector('.tile[data-lesson="own-your-exit"]'), "focus returns to the lesson's tile");
  // Forward re-opens the lesson; the close button behaves like Esc
  win.history.forward();
  await settle();
  assert.equal(shell.view.lessonId, "own-your-exit");
  root.querySelector(".deck__close").click();
  await settle();
  assert.equal(win.history.index, 0);
  assert.equal(win.location.hash, "#/");
});

test("history: moving to the next lesson replaces the entry, and closing it still goes straight home", async () => {
  const { win, doc, root, shell } = app_("#/");
  win.location.hash = "#/l/own-your-exit";
  await settle();
  shell.view.go(deckCards(lessonOf(app, "own-your-exit")).length - 1);
  root.querySelector('.card.is-active a.btn--primary[href^="#/l/"]').click();
  await settle();
  assert.equal(shell.view.lessonId, "friend-speech");
  assert.equal(win.history.length, 2, "no entry was added");
  press(doc, "Escape");
  await settle();
  assert.equal(win.location.hash, "#/");
  assert.equal(win.history.index, 0);
  // "See your traits" from the last hand-off lands on the you panel, also without growing the stack
  win.location.hash = "#/l/what-lasts";
  await settle();
  shell.follow("#/you");
  await settle();
  assert.equal(win.location.hash, "#/you");
  assert.equal(root.querySelector(".deck"), null);
  assert.equal(win.history.length, 2);
});

test("history: a lesson reached by a deep link is replaced by home when closed", async () => {
  const { win, doc, root } = app_("#/l/what-lasts");
  assert.ok(root.querySelector(".deck"));
  press(doc, "Escape");
  await settle();
  assert.equal(win.location.hash, "#/");
  assert.equal(win.history.length, 1, "replaced, not pushed: Back leaves the app");
  assert.ok(root.querySelector(".home"));
});

test("an unknown lesson link goes home in place of the bad entry (M56)", () => {
  const { win, root, shell } = app_("#/l/no-such-lesson");
  assert.equal(win.location.hash, "#/");
  assert.equal(win.history.length, 1);
  assert.ok(root.querySelector(".home .tiles"), "home is rendered, not a blank page");
  assert.equal(shell.route.view, "home");
});

test("progress is kept under the app's base path (review S23)", async () => {
  const storage = memStorage();
  const { win, doc } = app_("#/", { storage });
  win.location.hash = "#/l/what-lasts";
  await settle();
  press(doc, "ArrowRight");
  assert.deepEqual([...storage.map.keys()], ["capable.progress@/Capable/"]);
});

test("an update with the same stamp but new content re-renders home (review S10)", async () => {
  const edited = fixture();
  edited.lessons[0].promise = "A promise the editor just rewrote.";
  const { root, shell } = app_("#/", { fetchImpl: async () => ({ ok: true, json: async () => edited }) });
  assert.equal(await shell.updated, true);
  assert.match(root.querySelector('.tile[data-lesson="own-your-exit"] .tile__promise').textContent, /editor just rewrote/);
});

// ---- colour and art ids ------------------------------------------------------

test("paint sets trait colours only for numeric hues (M54)", () => {
  const doc = fakeWindow().document;
  doc.body.innerHTML = '<div data-hue="195"><span data-hue="abc"></span><span data-hue="1e999"></span></div>';
  paintIn(doc.body);
  const [good, bad, huge] = [doc.body.querySelector('[data-hue="195"]'), doc.body.querySelector('[data-hue="abc"]'), doc.body.querySelector('[data-hue="1e999"]')];
  assert.equal(good.style.getPropertyValue("--trait"), "#18c8f0");
  assert.equal(bad.style.getPropertyValue("--trait"), "", "not a number: left alone");
  assert.equal(huge.style.getPropertyValue("--trait"), "", "not finite: left alone");
});

test("SVG ids are sanitised, whatever the uid (M47)", () => {
  const svg = String(sceneSvg("seed", 52, 'X Y"<z>/../é'));
  const ids = [...svg.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(ids.length > 0);
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/, id);
});
