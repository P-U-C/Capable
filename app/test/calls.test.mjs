// K2 (docs/SPEC-V4.md): open calls. Home's tile and the lesson's cover carry a
// small "open call · closes Sun" badge; the deck gains a "Make the explainer"
// card just before the trait card (reward, closing time in the reader's zone,
// a countdown under 48 h, the brief, entries so far, one line of how-to, the
// reply and Earn actions); inside a host the reply opens the host's composer as
// a reply to the call's post (never posting) and Earn opens as a Mini App, on
// the web both are plain links; every call surface hides once closesAt passes
// on the reader's clock. The copy allow-list itself is in safety.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeWindow, memStorage, settle, FakeEvent } from "./dom.mjs";
import { fixture, visibleText, tags, attr, attrValues, ROOT } from "./helpers.mjs";
import { validateApp } from "../../contract/validate-app.mjs";
import { CSP } from "../build.mjs";
import { boot } from "../src/shell.mjs";
import { COPY } from "../src/copy.mjs";
import { renderHome } from "../src/home.mjs";
import { renderDeck } from "../src/cards.mjs";
import { deckModel } from "../src/model.mjs";
import { resumeAt } from "../src/deck.mjs";
import { emptyState } from "../src/store.mjs";
import { openCalls, callFor, isOpen, closesWhen, closesOn, countdown, badgeText, nextClose, renderCallBody, replyInHost, openEarnInHost, EARN_URL, REPLY_PREFIX } from "../src/calls.mjs";
import { callClick } from "../src/view-calls.mjs";

const HASH = "0x39c77976ededc0946c4ee7e9e6bd25b4160265c3";
const CLOSES = "2026-11-16T01:24:23Z";
const END = Date.parse(CLOSES);
const H = 3600_000;
const NY = "America/New_York"; // EST in November: the call closes Sun 15 Nov, 8:24 pm there
const LESSON = "know-who-came-first";

const CALL = Object.freeze({
  topic: "albions-seed",
  lesson: LESSON,
  reward: "$1,024",
  closesAt: CLOSES,
  brief: "Next up in our interactive book club: Albion's Seed, by David Hackett Fischer. When was America founded?",
  kind: "video",
  entries: 30,
  castHash: HASH,
  replyUrl: `https://farcaster.xyz/~/conversations/${HASH}`,
});

/** The contract fixture plus the know-who-came-first lesson (from content/lessons) and, optionally, its open call. */
function appWith(call = CALL) {
  const a = fixture();
  const doc = JSON.parse(readFileSync(join(ROOT, "content/lessons/know-who-came-first.json"), "utf8"));
  a.lessons.push({ ...doc, number: 6, work: [] });
  if (call) a.calls = [{ ...call }];
  return a;
}

test("the fixture is a valid App (the contract's own rules for calls)", () => {
  assert.deepEqual(validateApp(appWith()), []);
  assert.deepEqual(validateApp(appWith({ ...CALL, kind: "build", entries: 0 })), []);
});

// ---- when it closes, in the reader's zone -----------------------------------------

test("badge: days away name the weekday in the reader's zone, a week or more the date", () => {
  const thu = Date.parse("2026-11-12T18:00:00Z"); // 3.3 days before
  assert.equal(closesWhen(CALL, thu, NY), "Sun");
  assert.equal(closesWhen(CALL, thu, "UTC"), "Mon", "the same moment is Monday in UTC");
  assert.equal(badgeText(CALL, thu, NY), "open call · closes Sun");
  assert.equal(closesWhen(CALL, END - 24 * H - 60_000, NY), "Sun", "just over a day: the weekday, even when it is tomorrow");
  assert.equal(closesWhen(CALL, Date.parse("2026-11-05T00:00:00Z"), NY), "15 Nov", "a week or more away: the date");
  assert.equal(closesWhen(CALL, Date.parse("2026-11-09T12:00:00Z"), NY), "Sun", "six days and a bit: still the weekday");
});

test("badge: under 24 h it says today or tomorrow with the time; under 6 h, hours; under 1 h, minutes", () => {
  assert.equal(closesWhen(CALL, Date.parse("2026-11-15T18:00:00Z"), NY), "today 8:24 pm", "1 pm in New York, 7.4 h before");
  assert.equal(badgeText(CALL, Date.parse("2026-11-15T18:00:00Z"), NY), "open call · closes today 8:24 pm");
  assert.equal(closesWhen(CALL, Date.parse("2026-11-15T18:00:00Z"), "UTC"), "tomorrow 1:24 am", "the same moment in UTC");
  assert.equal(closesWhen(CALL, END - 3.4 * H, NY), "in 3 h");
  assert.equal(badgeText(CALL, END - 3.4 * H, NY), "open call · closes in 3 h");
  assert.equal(closesWhen(CALL, END - 5.99 * H, NY), "in 5 h");
  assert.equal(closesWhen(CALL, END - 40 * 60_000, NY), "in 40 min");
  assert.equal(closesWhen(CALL, END - 30_000, NY), "in 1 min", "never 0 min");
  const onTheHour = { ...CALL, closesAt: "2026-11-16T02:00:00Z" };
  assert.equal(closesWhen(onTheHour, Date.parse("2026-11-15T18:00:00Z"), NY), "today 9 pm", "on the hour: no :00");
});

test("closed: no badge text, no countdown, not open (exactly at closesAt and after)", () => {
  for (const now of [END, END + 1, END + 30 * 24 * H]) {
    assert.equal(closesWhen(CALL, now, NY), null);
    assert.equal(badgeText(CALL, now, NY), "");
    assert.equal(countdown(CALL, now), null);
    assert.equal(isOpen(CALL, now), false);
  }
  assert.equal(isOpen(CALL, END - 1), true);
});

test("the full closing time is in the reader's zone; the countdown starts under 48 h", () => {
  assert.equal(closesOn(CALL, NY), "Sun 15 Nov, 8:24 pm");
  assert.equal(closesOn(CALL, "UTC"), "Mon 16 Nov, 1:24 am");
  assert.equal(closesOn(CALL, "Asia/Tokyo"), "Mon 16 Nov, 10:24 am");
  assert.equal(closesOn(CALL, "Not/AZone").length > 0, true, "an unknown zone falls back to the reader's own");
  assert.equal(countdown(CALL, END - 48 * H), null);
  assert.deepEqual(countdown(CALL, END - 48 * H + 60_000), { h: 47, m: 59 });
  assert.deepEqual(countdown(CALL, END - (31 * H + 23 * 60_000 + 5_000)), { h: 31, m: 23 });
  assert.deepEqual(countdown(CALL, END - 20_000), { h: 0, m: 1 });
});

test("only well-formed calls on a lesson about their topic are shown (fail closed)", () => {
  const now = END - 30 * H;
  assert.deepEqual(openCalls(appWith(), now).map((c) => c.lesson), [LESSON]);
  assert.equal(openCalls(appWith(null), now).length, 0);
  for (const bad of [
    { lesson: "nope" },
    { topic: "clients" },
    { castHash: "0xABC" },
    { replyUrl: "https://evil.example/~/conversations/" + HASH },
    { replyUrl: `http://farcaster.xyz/~/conversations/${HASH}` },
    { closesAt: "soon" },
    { kind: "essay" },
    { reward: "" },
    { brief: 7 },
  ])
    assert.equal(openCalls(appWith({ ...CALL, ...bad }), now).length, 0, JSON.stringify(bad));
  assert.equal(REPLY_PREFIX + HASH, CALL.replyUrl);
  assert.equal(nextClose(appWith(), now), END);
  assert.equal(nextClose(appWith(), END), null);
});

// ---- home ----------------------------------------------------------------------------

const tileOf = (m, id) => {
  const at = m.indexOf(`<a class="tile" href="#/l/${id}"`);
  return at < 0 ? "" : m.slice(at, m.indexOf("</a>", at));
};

test("home: the lesson's tile carries the badge (and says it in the tile's name); no other tile does", () => {
  const now = Date.parse("2026-11-12T18:00:00Z");
  const m = String(renderHome(appWith(), emptyState(), { now, timeZone: NY }));
  const t = tileOf(m, LESSON);
  assert.match(t, /data-call-badge/);
  assert.ok(visibleText(t).includes("open call · closes Sun"));
  assert.ok(visibleText(t).includes("Open call for explainers, closes Sun."), "the tile's screen-reader state names it (its art is hidden)");
  assert.equal((m.match(/data-call-badge/g) || []).length, 1, "one badge, on its own lesson");
  for (const id of ["own-your-exit", "friend-speech", "what-lasts", "new-topic"]) assert.doesNotMatch(tileOf(m, id), /data-call/, id);
  // later: hours, then minutes
  assert.ok(visibleText(String(renderHome(appWith(), emptyState(), { now: END - 3.4 * H, timeZone: NY }))).includes("open call · closes in 3 h"));
  assert.ok(visibleText(String(renderHome(appWith(), emptyState(), { now: END - 40 * 60_000, timeZone: NY }))).includes("open call · closes in 40 min"));
});

test("home: no badge without a call, and none once it has closed on the reader's clock (a stale app.json still listing it)", () => {
  assert.doesNotMatch(String(renderHome(appWith(null), emptyState(), { now: END - H })), /data-call|open call/);
  for (const now of [END, END + H]) {
    const m = String(renderHome(appWith(), emptyState(), { now, timeZone: NY }));
    assert.doesNotMatch(m, /data-call/);
    assert.doesNotMatch(visibleText(m), /open call|closes|Open call/);
  }
});

// ---- the deck ------------------------------------------------------------------------

const deckOf = (app, now, opts = {}) => {
  const model = deckModel(app, LESSON, emptyState(), { now });
  return { ...model, markup: String(renderDeck({ ...model.ctx, timeZone: NY, ...opts }, model.cards)) };
};
const cardOf = (markup, type) => {
  const at = markup.indexOf(`data-type="${type}"`);
  if (at < 0) return "";
  const start = markup.lastIndexOf("<section", at);
  return markup.slice(start, markup.indexOf("</section>", at));
};

test("deck: the Make-the-explainer card sits just before the trait card, and the cover carries the badge", () => {
  const now = Date.parse("2026-11-12T18:00:00Z");
  const { cards, markup } = deckOf(appWith(), now);
  const types = cards.map((c) => c.type);
  const at = types.indexOf("call");
  assert.equal(types.filter((t) => t === "call").length, 1);
  assert.equal(types.indexOf("call"), types.indexOf("trait") - 1, "just before the trait card");
  assert.deepEqual(types.slice(-4), ["call", "trait", "deeper", "next"]);
  assert.equal(cards.find((c) => c.type === "call").key, "call");
  const plain = deckOf(appWith(null), now).cards.map((c) => c.type);
  assert.deepEqual(types.filter((t) => t !== "call"), plain, "nothing else changes");
  const cover = cardOf(markup, "cover");
  assert.ok(visibleText(cover).includes("open call · closes Sun"));
  assert.ok(cardOf(markup, "call").includes(`aria-label="Card ${at + 1} of ${cards.length}: open call"`));
});

test("deck: the card says the reward and the closing time in the reader's zone, the brief, entries so far and how to take part", () => {
  const { markup } = deckOf(appWith(), Date.parse("2026-11-12T18:00:00Z"));
  const card = cardOf(markup, "call");
  const text = visibleText(card);
  assert.ok(text.includes("// open call"));
  assert.ok(text.includes("Make the explainer."));
  assert.ok(text.includes("$1,024 for short videos on this idea · closes Sun 15 Nov, 8:24 pm"), text);
  assert.ok(text.includes(CALL.brief));
  assert.ok(text.includes("30 entries so far"));
  assert.ok(text.includes("Make a short video, about a minute (vertical works), and post it as a reply on Farcaster."));
  assert.ok(text.includes("Reply with your video"));
  assert.ok(text.includes("See past winners in Earn ↗"));
  assert.ok(text.includes("Earn by @dylanb.eth"));
  assert.doesNotMatch(card, /data-call-left/, "no countdown three days out");
  // a build call
  const build = visibleText(cardOf(deckOf(appWith({ ...CALL, kind: "build", entries: 1 }), Date.parse("2026-11-12T18:00:00Z")).markup, "call"));
  assert.ok(build.includes("$1,024 for builds on this idea"));
  assert.ok(build.includes("1 entry so far"));
  assert.ok(build.includes("Make a build, a site or a repo, and post its link as a reply on Farcaster."));
  assert.ok(build.includes("Reply with your build"));
  assert.ok(visibleText(cardOf(deckOf(appWith({ ...CALL, entries: 0 }), END - 50 * H).markup, "call")).includes("no entries yet"));
});

test("deck: a countdown under 48 h", () => {
  const card = cardOf(deckOf(appWith(), END - (31 * H + 23 * 60_000 + 5_000)).markup, "call");
  assert.match(card, /data-call-left/);
  const text = visibleText(card);
  assert.ok(text.includes("31 h 23 min left"), "said once for screen readers");
  assert.match(text, /31 h 23 min left/);
  assert.doesNotMatch(cardOf(deckOf(appWith(), END - 48 * H).markup, "call"), /data-call-left/);
});

test("deck: no card and no cover badge without a call, or once it has closed; a reader who left on it resumes at the trait card", () => {
  for (const [app, now] of [
    [appWith(null), END - H],
    [appWith(), END],
    [appWith(), END + H],
  ]) {
    const { cards, markup } = deckOf(app, now);
    assert.ok(!cards.some((c) => c.type === "call"));
    assert.doesNotMatch(markup, /data-call|open call/);
  }
  const { cards } = deckOf(appWith(), END + 1);
  assert.equal(cards[resumeAt(cards, "call")].type, "trait");
  const open = deckOf(appWith(), END - H).cards;
  assert.equal(open[resumeAt(open, "call")].type, "call");
});

test("web: the reply opens the call's own post and Earn its app, each in a new tab without an opener", () => {
  const card = String(renderCallBody(CALL, { now: END - 50 * H, timeZone: NY }));
  const links = tags(card, "a");
  assert.equal(links.length, 2);
  const [reply, earn] = links;
  assert.equal(attr(reply, "href"), CALL.replyUrl);
  assert.equal(attr(reply, "target"), "_blank");
  assert.match(attr(reply, "rel"), /\bnoopener\b/);
  assert.equal(attr(reply, "aria-label"), COPY.callReplyA11y.video);
  assert.equal(attr(earn, "href"), EARN_URL);
  assert.equal(EARN_URL, "https://earn.dylanbrodeur.org/");
  assert.equal(attr(earn, "target"), "_blank");
  assert.match(attr(earn, "rel"), /\bnoopener\b/);
  assert.equal(tags(card, "button").length, 0);
  // inside a host: buttons the view wires to the SDK, and no new-tab links
  const host = String(renderCallBody(CALL, { now: END - 50 * H, timeZone: NY, host: true }));
  assert.equal(tags(host, "a").length, 0);
  assert.deepEqual(tags(host, "button").map((b) => (attr(b, "data-call-reply") !== null ? "reply" : "earn")), ["reply", "earn"]);
  assert.ok(visibleText(host).includes("Earn by @dylanb.eth"));
});

test("hostile call text renders as inert text", () => {
  const XSS = `<img src=x onerror=alert(1)>"'><script>alert(2)</script>`;
  const m = String(renderCallBody({ ...CALL, reward: XSS, brief: `*${XSS}*` }, { now: END - H, timeZone: NY }));
  assert.doesNotMatch(m, /<img|<script/);
  assert.ok(visibleText(m).includes(`*${XSS}*`), "the brief is plain text: no emphasis, no markup");
  for (const t of tags(m, "[a-z]+")) assert.doesNotMatch(t.replace(/"[^"]*"/g, '""'), /\son[a-z]+=|\sstyle=/i);
});

// ---- the DOM: boot, the clock, the actions -------------------------------------------------

/** A mocked IdentityAPI that is (or is not) inside a host. */
function mockIdentity(miniApp = false) {
  return {
    isMiniApp: async () => miniApp,
    ready: async () => {},
    current: () => null,
    signIn: () => Promise.reject(Object.assign(new Error("no"), { code: "network" })),
    signOut() {},
    onChange: () => () => {},
    share: async () => {},
    wallet: async () => null,
    qrSvg: () => "",
  };
}

/** A fake host SDK: records every action; composeCast/openMiniApp can be made to fail. */
function fakeSdk({ composeFails = false, openFails = false } = {}) {
  const calls = [];
  const rec = (name, fail) => async (arg) => {
    calls.push([name, arg]);
    if (fail) throw new Error(`${name} unsupported`);
    return name === "composeCast" ? { cast: null } : undefined;
  };
  return { calls, sdk: { actions: { composeCast: rec("composeCast", composeFails), openMiniApp: rec("openMiniApp", openFails), openUrl: rec("openUrl"), ready: rec("ready") } } };
}

function mount(hash, { a = appWith(), clock = { t: END - 30 * H }, miniApp = false, loadSdk, storage = memStorage(), realTime = false } = {}) {
  const win = fakeWindow({ url: `https://app.example/Capable/${hash}`, storage });
  const doc = win.document;
  const root = doc.createElement("div");
  root.setAttribute("id", "app");
  doc.body.appendChild(root);
  const data = doc.createElement("script");
  data.setAttribute("id", "app-data");
  data.textContent = JSON.stringify(a);
  doc.body.appendChild(data);
  const loads = { n: 0 };
  const sdkLoader = loadSdk
    ? () => {
        loads.n++;
        return loadSdk();
      }
    : () => {
        loads.n++;
        return Promise.reject(new Error("no SDK in this test"));
      };
  const now = realTime ? () => Date.now() + clock.offset : () => clock.t;
  const shell = boot({ win, storage, fetchImpl: async () => ({ ok: false, status: 404 }), serviceWorker: false, identity: mockIdentity(miniApp), stamps: { config: () => null, preview: undefined }, now, timeZone: NY, loadSdk: sdkLoader });
  return { win, doc, root, shell, clock, loads };
}

const click = (el) => {
  const ev = new FakeEvent("click", { bubbles: true, button: 0 });
  el.dispatchEvent(ev);
  return ev;
};
const goTo = (m, type) => {
  const i = Number(m.root.querySelector(`.deck .card[data-type="${type}"]`).dataset.i);
  m.shell.view.go(i);
  return m.root.querySelector(".card.is-active");
};

test("boot: home shows the badge; when the clock passes closesAt a check hides it (no reload, the same stale app)", async () => {
  const m = mount("#/");
  await settle();
  assert.equal(m.root.querySelectorAll("[data-call-badge]").length, 1);
  assert.ok(m.shell.calls.scheduled, "a timer waits for the moment it closes");
  m.clock.t = END + 1;
  assert.equal(m.shell.calls.check(), true);
  assert.equal(m.root.querySelectorAll("[data-call-badge]").length, 0);
  assert.doesNotMatch(visibleText(m.root.innerHTML), /open call/i);
  assert.equal(m.shell.calls.scheduled, false, "nothing left to wait for");
});

test("boot: the words move on in place as time passes (closes in 3 h → in 2 h), the view is not redrawn", async () => {
  const m = mount("#/", { clock: { t: END - 3.4 * H } });
  await settle();
  const view = m.shell.view;
  const text = () => m.root.querySelector("[data-call-badge] [data-call-text]").textContent;
  assert.equal(text(), "closes in 3 h");
  m.clock.t += H;
  assert.equal(m.shell.calls.check(), false);
  assert.equal(m.shell.view, view, "same view");
  assert.equal(text(), "closes in 2 h");
  assert.match(m.root.querySelector("[data-call-a11y]").textContent, /closes in 2 h/);
});

test("boot: a hidden page stops its timer; becoming visible again re-checks the clock (timers sleep with the tab)", async () => {
  const m = mount("#/");
  await settle();
  m.doc.visibilityState = "hidden";
  m.doc.dispatchEvent(new FakeEvent("visibilitychange"));
  assert.equal(m.shell.calls.scheduled, false);
  m.clock.t = END + 5 * 60_000; // the laptop slept through the close
  assert.equal(m.root.querySelectorAll("[data-call-badge]").length, 1, "nothing ran while hidden");
  m.doc.visibilityState = "visible";
  m.doc.dispatchEvent(new FakeEvent("visibilitychange"));
  assert.equal(m.root.querySelectorAll("[data-call-badge]").length, 0);
});

test("boot: the timer itself hides the call at the moment it closes", async () => {
  const offset = END - Date.now() - 60; // the call closes 60 ms from now on this clock
  const m = mount("#/", { clock: { offset }, realTime: true });
  await settle();
  assert.equal(m.root.querySelectorAll("[data-call-badge]").length, 1);
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(m.root.querySelectorAll("[data-call-badge]").length, 0);
});

test("boot: a lesson open on the call's card when it closes re-opens at the trait card; a lesson without the call is left alone", async () => {
  const m = mount(`#/l/${LESSON}`);
  await settle();
  goTo(m, "call");
  assert.ok(m.shell.view.call);
  m.clock.t = END + 1;
  m.shell.calls.check();
  assert.equal(m.root.querySelector(".card--call"), null);
  assert.equal(m.root.querySelector("[data-call-badge]"), null, "the cover's badge is gone too");
  assert.equal(m.root.querySelector(".card.is-active").dataset.type, "trait");
  // another lesson: the call closing elsewhere does not redraw it (a video would stop)
  const o = mount("#/l/own-your-exit");
  await settle();
  const view = o.shell.view;
  o.clock.t = END + 1;
  assert.equal(o.shell.calls.check(), true);
  assert.equal(o.shell.view, view);
});

test("web: tapping reply or Earn is a plain link: nothing is loaded, the browser opens the link in a new tab", async () => {
  const m = mount(`#/l/${LESSON}`);
  await settle();
  const card = goTo(m, "call");
  const reply = card.querySelector("[data-call-reply]");
  const earn = card.querySelector("[data-call-earn]");
  assert.equal(reply.localName, "a");
  assert.equal(reply.getAttribute("href"), CALL.replyUrl);
  assert.equal(reply.getAttribute("target"), "_blank");
  assert.match(reply.getAttribute("rel"), /noopener/);
  assert.equal(earn.getAttribute("href"), EARN_URL);
  assert.equal(click(reply).defaultPrevented, false, "the link opens");
  assert.equal(click(earn).defaultPrevented, false);
  assert.equal(m.loads.n, 0, "no SDK on the web");
});

test("inside a host: reply opens the host's composer as a reply to the call's post with a short line, only on a tap; Earn opens as a Mini App", async () => {
  const { sdk, calls } = fakeSdk();
  const m = mount(`#/l/${LESSON}`, { miniApp: true, loadSdk: async () => sdk });
  await m.shell.miniapp;
  await settle();
  // swipe through every card: nothing is composed, opened or posted by itself
  const n = m.root.querySelectorAll(".deck .card").length;
  for (let i = 0; i < n; i++) m.shell.view.go(i);
  const card = goTo(m, "call");
  assert.deepEqual(calls, [], "never on its own");
  assert.equal(m.loads.n, 0, "the SDK is not even loaded before a tap");
  const reply = card.querySelector("[data-call-reply]");
  assert.equal(reply.localName, "button", "the actions became the host's when the app learned it runs inside one");
  assert.equal(reply.textContent, "Reply with your video");
  const ev = click(reply);
  await settle();
  assert.equal(ev.defaultPrevented, true);
  assert.deepEqual(calls, [["composeCast", { text: "my explainer for capable's next lesson:", parent: { type: "cast", hash: HASH } }]], "a reply to the call's post; no embeds, no close; the reader posts");
  click(card.querySelector("[data-call-earn]"));
  await settle();
  assert.deepEqual(calls[1], ["openMiniApp", { url: "https://earn.dylanbrodeur.org/" }]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(([name]) => ["composeCast", "openMiniApp"].includes(name)), "nothing else is ever called");
});

test("inside a host: links drawn before the host answered still go through the SDK", async () => {
  const { sdk, calls } = fakeSdk();
  const card = String(renderCallBody(CALL, { now: END - H, timeZone: NY }));
  const win = fakeWindow();
  const el = win.document.createElement("div");
  el.innerHTML = card;
  win.document.body.appendChild(el);
  const a = el.querySelector("[data-call-reply]");
  const ev = new FakeEvent("click", { bubbles: true });
  assert.equal(callClick(ev, a, { app: appWith(), now: () => END - H, isMiniApp: () => true, loadSdk: async () => sdk }), true);
  assert.equal(ev.defaultPrevented, true, "the new tab is not opened inside the host");
  await settle();
  assert.equal(calls[0][0], "composeCast");
  // a host button on a page that turned out not to be a host opens the link like the web, without an opener
  const opened = [];
  const w2 = { open: (...x) => opened.push(x) };
  const host = win.document.createElement("div");
  host.innerHTML = String(renderCallBody(CALL, { now: END - H, timeZone: NY, host: true }));
  win.document.body.appendChild(host);
  const ev2 = new FakeEvent("click", { bubbles: true });
  callClick(ev2, host.querySelector("[data-call-earn]"), { app: appWith(), now: () => END - H, isMiniApp: () => false, win: w2 });
  assert.deepEqual(opened, [[EARN_URL, "_blank", "noopener,noreferrer"]]);
  // a call that closed while its card was open: nothing to reply to
  const ev3 = new FakeEvent("click", { bubbles: true });
  callClick(ev3, a, { app: appWith(), now: () => END + 1, isMiniApp: () => true, loadSdk: async () => sdk });
  assert.equal(ev3.defaultPrevented, true);
  await settle();
  assert.equal(calls.length, 1, "no compose after it closed");
});

test("inside a host: a host without the composer or Mini Apps opens the post or Earn in its browser; a failed load says so", async () => {
  const f = fakeSdk({ composeFails: true, openFails: true });
  await replyInHost(CALL, { loadSdk: async () => f.sdk, text: "x" });
  await openEarnInHost({ loadSdk: async () => f.sdk });
  assert.deepEqual(
    f.calls.map(([n, a]) => [n, n === "composeCast" ? a.parent.hash : a]),
    [
      ["composeCast", HASH],
      ["openUrl", CALL.replyUrl],
      ["openMiniApp", { url: EARN_URL }],
      ["openUrl", EARN_URL],
    ],
  );
  const m = mount(`#/l/${LESSON}`, { miniApp: true, loadSdk: () => Promise.reject(new Error("chunk 404")) });
  await m.shell.miniapp;
  await settle();
  const card = goTo(m, "call");
  click(card.querySelector("[data-call-reply]"));
  await settle();
  await settle();
  assert.equal(card.querySelector("[data-call-status]").textContent, COPY.callComposeFailed);
  assert.equal(m.loads.n, 1);
});

test("CSP: the reply, Earn, compose and openMiniApp need no new host (links are navigations; the SDK speaks postMessage)", () => {
  const dir = Object.fromEntries(CSP.split(/;\s*/).map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  for (const [k, v] of Object.entries(dir)) {
    assert.ok(!v.includes("https://farcaster.xyz"), `${k} names farcaster.xyz`);
    assert.ok(!v.some((x) => /dylanbrodeur/.test(x)), `${k} names Earn`);
  }
  assert.deepEqual(dir["frame-src"], ["'none'"], "nothing is framed");
  assert.ok(!("navigate-to" in dir), "navigations are not restricted by the policy");
});

test("the call's words stay in the call: every other surface of the same views is free of them", () => {
  const now = END - 30 * H;
  const app = appWith();
  const strip = (m) => m.replace(/<span class="call-badge[^"]*" data-call=[\s\S]*?<\/span><\/span>/g, "");
  const home = String(renderHome(app, emptyState(), { now, timeZone: NY }));
  const { markup } = deckOf(app, now);
  const outside = [strip(home).replace(/<span data-call-a11y>[^<]*<\/span>/g, ""), strip(markup).replace(/<section class="card card--call"[\s\S]*?<\/section>/, "")];
  for (const m of outside) {
    const text = visibleText(m) + " " + ["aria-label", "title", "alt"].flatMap((n) => attrValues(m, n)).join(" ");
    assert.doesNotMatch(text, /\$1,024|book club|entries|closes|farcaster|winners|reward|dylanb/i);
    assert.doesNotMatch(text, /\bEarn\b/);
  }
});
