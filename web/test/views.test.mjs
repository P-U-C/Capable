// W5 — every view renders from the fixture with landmarks, the unofficial
// notice, all five depth sections and the end pieces.
import test from "node:test";
import assert from "node:assert/strict";
import { renderPage, voiceCard, popover, DRAFT_BANNER, UNOFFICIAL } from "../src/views.mjs";
import { model, voicesFor, countdown, EDITORS, PUBLISHED } from "../src/model.mjs";
import { blank, markRead } from "../src/progress.mjs";
import { fixture, makeBook } from "./synthetic.mjs";

const NOW = Date.parse("2026-11-12T17:00:00Z"); // 2h 6m before the nordhoff deadline
const book = fixture();
const m = model(book);
const ctxFor = (route, extra = {}) => ({ m, route, state: blank(), depth: 2, path: EDITORS, filter: null, voiceFilter: "all", newCount: 0, now: NOW, media: "link", ...extra });
const page = (route, extra) => String(renderPage(ctxFor(route, extra)));
const ALL_ROUTES = [{ view: "cover" }, { view: "glossary" }, { view: "credits" }, { view: "about" }, ...book.chapters.map((c) => ({ view: "idea", id: c.id, section: null }))];

function landmarks(html) {
  assert.match(html, /<header class="top" role="banner">/);
  assert.match(html, /<nav [^>]*aria-label="Pages"/);
  assert.equal((html.match(/<main /g) || []).length, 1);
  assert.match(html, /<main id="main"/);
  assert.match(html, /<footer class="foot" role="contentinfo">/);
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1, "exactly one h1");
}

test("every view has landmarks, one h1 and the unofficial notice", () => {
  for (const r of ALL_ROUTES) {
    const html = page(r);
    landmarks(html);
    assert.ok(html.includes(`${UNOFFICIAL} · refreshed 12 Nov, 17:00 UTC`), `${JSON.stringify(r)} lacks the notice`);
    assert.ok(UNOFFICIAL.startsWith("Unofficial · reads public Farcaster data"));
  }
});

test("no view loads remote media: no img, no src, no iframe", () => {
  for (const r of ALL_ROUTES) {
    const html = page(r);
    assert.doesNotMatch(html, /<(img|iframe|video|audio|source|object|embed|script)\b/);
    assert.doesNotMatch(html, /\ssrc=/);
    assert.doesNotMatch(html, /\sstyle=/);
    assert.doesNotMatch(html, /\son[a-z]+=/);
    for (const h of html.matchAll(/\shref="([^"]*)"/g)) assert.match(h[1], /^(#[a-z0-9-]+|https:\/\/)/, h[1]);
  }
});

test("idea view: all five depth sections and all four end pieces exist", () => {
  for (const c of book.chapters) {
    const html = page({ view: "idea", id: c.id, section: null });
    for (const [id, d] of [["s-line", 1], ["s-minute", 2], ["s-essay", 3], ["s-source", 4], ["s-voices", 5]]) {
      assert.match(html, new RegExp(`<section class="dsec" id="${id}" data-d="${d}"`), `${c.id} ${id}`);
    }
    assert.match(html, new RegExp(`<div class="endmatter" id="s-end" data-end="${c.id}">`));
    for (const h of ["Terms", "Connections", "You, now", "Your turn"]) assert.ok(html.includes(`class="end-h">${h}</h2>`), `${c.id} ${h}`);
    assert.match(html, /<p class="kicker mono">/);
    assert.match(html, /<p class="numeral" aria-hidden="true">\d+<\/p>/);
    assert.match(html, /<nav class="pager"/);
    assert.match(html, /<nav class="depth" aria-label="Reading depth">/);
    assert.equal((html.match(/class="depth-btn"/g) || []).length, 5);
  }
});

test("the chosen depth is on the article and pressed in the depth bar", () => {
  const html = page({ view: "idea", id: "exit", section: null }, { depth: 4 });
  assert.match(html, /<article class="idea" data-depth="4"/);
  assert.match(html, /data-depth="4" aria-pressed="true" aria-current="true"/);
  assert.equal((html.match(/aria-pressed="true" aria-current="true"/g) || []).length, 1);
});

test("essay: headings, quotes, asides as sidenotes, objections, citation chips", () => {
  const html = page({ view: "idea", id: "exit", section: null });
  assert.match(html, /<h3 class="essay-h">A section heading<\/h3>/);
  assert.match(html, /<blockquote class="quote"><p>A short quotation/);
  assert.match(html, /<div class="with-note">(?:(?!<\/div>).)*<aside class="note-side"><span class="pilcrow" aria-hidden="true">¶<\/span>A margin note/s);
  assert.match(html, /The strongest objection/);
  assert.match(html, /<button type="button" class="chip" data-act="cite" data-sub="0x18490e0e613271b96f5214a0a3257a0e911b366f" aria-haspopup="dialog" aria-label="Voice: @mobeen02">M<\/button>/);
});

test("draft banner only on drafts", () => {
  assert.ok(page({ view: "idea", id: "network-state-visuals", section: null }).includes(DRAFT_BANNER.replace("'", "&#39;")));
  assert.ok(!page({ view: "idea", id: "exit", section: null }).includes('class="draft-banner"'));
});

test("open prizes count down; the countdown reads the clock it is given", () => {
  assert.equal(countdown("2026-11-12T19:06:15Z", NOW), "2h 6m left");
  assert.equal(countdown("2026-11-12T19:06:15Z", NOW - 2 * 86400e3), "2d 2h left");
  assert.equal(countdown("2026-11-12T17:00:30Z", NOW), "under a minute left");
  assert.equal(countdown("2026-11-12T16:00:00Z", NOW), null);
  const html = page({ view: "idea", id: "what-lasts", section: null });
  assert.match(html, /<span class="pill pill--open">Open<\/span> <span class="countdown mono" data-deadline="2026-11-12T19:06:15Z">2h 6m left<\/span>/);
  const later = page({ view: "idea", id: "what-lasts", section: null }, { now: Date.parse("2026-11-13T00:00:00Z") });
  assert.match(later, /data-deadline="2026-11-12T19:06:15Z">deadline passed</);
});

test("cover: note with date, figure, Begin, map, index with statuses and voices", () => {
  const html = page({ view: "cover" });
  assert.match(html, /<h1 class="cover-title">Primer<\/h1>/);
  assert.match(html, /Editor&#39;s note · as of 12 Nov/);
  assert.match(html, /<svg class="fig fig--cover"/);
  assert.match(html, /No ideas read yet/);
  assert.match(html, /<a class="btn btn--primary" href="#prologue">Begin<\/a>/);
  assert.ok(!html.includes(">Continue<"));
  assert.match(html, /<div class="map"/);
  assert.match(html, /aria-pressed="true">The editor's path<\/button>/);
  for (const pill of ["Open", "Awarded", "Draft", "Closed"]) assert.ok(html.includes(`>${pill}</span>`), pill);
  assert.match(html, /6 voices/);
  assert.match(html, /Not on the editor&#39;s path yet/);
});

test("cover: Continue and read marks once there is progress", () => {
  let state = markRead(blank(), "exit");
  state = { ...markRead(state, "friend-speech"), last: "what-lasts" };
  const html = page({ view: "cover" }, { state });
  assert.match(html, /<a class="btn" href="#what-lasts">Continue<span class="btn-sub">What Lasts<\/span><\/a>/);
  assert.match(html, /2 ideas read across 3 strands/);
  assert.equal((html.match(/class="row is-read"/g) || []).length, 2);
});

test("voices: winners first (1st, 2nd, HM), then newest", () => {
  const v = voicesFor(m, "friend-speech");
  assert.deepEqual(v.slice(0, 3).map((s) => s.place), ["1st", "2nd", "hm"]);
  const rest = v.slice(3).map((s) => Date.parse(s.postedAt));
  assert.deepEqual(rest, [...rest].sort((a, b) => b - a));
  const html = page({ view: "idea", id: "friend-speech", section: null });
  const order = [...html.matchAll(/<article class="voice" data-kind="video"(?: data-win="1")? id="v-(0x[0-9a-f]+)"/g)].map((x) => x[1]);
  assert.deepEqual(order, v.map((s) => s.hash));
  assert.match(html, /data-act="vfilter" data-f="winners"/);
});

test("voice cards: monogram, @username or fid, place, AI tag, the right action per build", () => {
  const s = book.submissions.find((x) => x.place === "1st");
  const link = String(voiceCard(ctxFor({ view: "cover" }), s));
  assert.match(link, /<span class="disc mono" aria-hidden="true">P<\/span>/);
  assert.match(link, /<span class="handle">@papa<\/span>/);
  assert.match(link, /<p class="vmeta mono">23 Oct · <span class="place">1st<\/span><\/p>/);
  assert.match(link, /Watch on Farcaster/);
  assert.ok(!link.includes("Play here"));
  const inline = String(voiceCard(ctxFor({ view: "cover" }, { media: "inline" }), s));
  assert.match(inline, /data-act="play" data-src="https:\/\/stream\.farcaster\.xyz\/[^"]+\.m3u8"/);
  assert.match(inline, /Watch on Farcaster/);
  const anon = String(voiceCard(ctxFor({ view: "cover" }), { ...s, fid: 424242, ai: true, place: undefined }));
  assert.match(anon, /<span class="handle">fid 424242<\/span>/);
  assert.match(anon, /AI-assisted/);
  const site = String(voiceCard(ctxFor({ view: "cover" }), book.submissions.find((x) => x.kind === "site")));
  for (const l of ["Site", "Repo", "Cast"]) assert.ok(site.includes(`>${l} <span aria-hidden="true">`), l);
});

test("citation popover holds the voice card", () => {
  const h = "0x780d71e5b43cfe009ffcaf5ff0ac234bb711a927";
  const html = String(popover(ctxFor({ view: "cover" }), h));
  assert.match(html, /@papa/);
  assert.match(html, /data-act="close-pop"/);
  assert.equal(String(popover(ctxFor({ view: "cover" }), "0x" + "0".repeat(40))), "");
});

test("connections: kind, linked title, why; incoming links too", () => {
  const html = page({ view: "idea", id: "exit", section: null });
  assert.match(html, /<span class="kind mono">Precondition for<\/span> <a href="#friend-speech">Friend Speech<\/a><\/p><p class="why">Cheap exit is what lets a client have house rules\.<\/p>/);
  assert.match(html, /<span class="kind mono">In tension with<\/span> <a href="#what-lasts">What Lasts<\/a>/);
});

test("you, now: facet grant and strand progress; mark as read", () => {
  const html = page({ view: "idea", id: "exit", section: null }, { state: markRead(blank(), "exit") });
  assert.match(html, /<p class="you-name">Sovereign<\/p><p class="you-grant">You can leave with your name/);
  assert.match(html, /1 of 1 idea in Tools you own/);
  assert.match(html, /data-act="unread" data-id="exit"/);
  assert.match(html, /<svg class="fig fig--small"/);
  assert.match(page({ view: "idea", id: "exit", section: null }), /data-act="read" data-id="exit"/);
});

test("your turn: prize card with headline, pool, deliverable, results and reply", () => {
  const html = page({ view: "idea", id: "exit", section: null });
  assert.match(html, /<p class="prize-head mono">\$2048 FOR FARCASTER CLIENTS<\/p>/);
  assert.match(html, /<dt class="mono">Pool<\/dt>/);
  assert.match(html, /<dt class="mono">Make<\/dt>/);
  assert.match(html, /<ol class="results">/);
  assert.match(html, /The prompt still stands as practice/);
  assert.match(html, /href="https:\/\/farcaster\.xyz\/~\/conversations\/0x50184b62b4c52fd76628713562e1eda3dccaf63d" rel="noopener noreferrer" target="_blank">Reply on Farcaster/);
  const open = page({ view: "idea", id: "what-lasts", section: null });
  assert.ok(!open.includes("still stands as practice"));
});

test("glossary: every term A–Z, each linked to its idea", () => {
  const html = page({ view: "glossary" });
  const terms = [...html.matchAll(/<div class="term"><dt>([^<]+)<\/dt>/g)].map((x) => x[1]);
  const expected = book.chapters.flatMap((c) => c.terms.map((t) => t.term));
  assert.equal(terms.length, expected.length);
  assert.deepEqual(terms, [...terms].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
  assert.match(html, /<a class="from" href="#exit">from Exit<\/a>/);
  assert.match(html, /<h2 id="g-T" class="letter-h">T<\/h2>/);
});

test("credits: N people, grouped by idea, winners marked", () => {
  const html = page({ view: "credits" });
  const n = new Set(book.submissions.map((s) => s.fid)).size;
  assert.ok(html.includes(`This atlas was written by ${n} people`));
  assert.match(html, /<a href="#friend-speech">Friend Speech<\/a>/);
  assert.match(html, /<li>@papa <span class="place mono">1st<\/span><\/li>/);
  // a person with two entries in one idea is listed once, with the best place
  const fs = html.split('id="c-friend-speech"')[1].split("</section>")[0];
  assert.equal((fs.match(/@papa/g) || []).length, 1);
});

test("about: what it is, unofficial, provenance, how updates work, license", () => {
  const html = page({ view: "about" });
  for (const s of ["Unofficial", "https://haatz.quilibrium.com", "@farcaster (fid 1)", "@balajis.eth (fid 37)", "How it stays current", "MIT", "12 Nov 2026, 17:00 UTC"]) assert.ok(html.includes(s), s);
  const withOverlay = page({ view: "about" }, { overlay: { added: 2, replaced: 1, dropped: 3 } });
  assert.match(withOverlay, /2 new, 1 updated since the snapshot; 3 left out because they failed the format checks/);
});

test("footer adds the overlay count", () => {
  assert.match(page({ view: "cover" }, { newCount: 3 }), /refreshed 12 Nov, 17:00 UTC · 3 new since snapshot/);
});

test("deep links render the same idea", () => {
  for (const s of ["essay", "source", "voices", "end"]) assert.match(page({ view: "idea", id: "exit", section: s }), /<h1 id="idea-title"/);
});

test("untrusted strings are escaped in every view", () => {
  const evil = fixture();
  const x = "<img src=x onerror=alert(1)>";
  evil.title = x;
  evil.subtitle = x;
  evil.chapters = evil.chapters.map((c) => ({ ...c, title: x, kicker: x, terms: c.terms.map((t) => ({ ...t, term: x })), source: c.source ? { ...c.source, title: x, author: x } : undefined }));
  evil.strands = evil.strands.map((s) => ({ ...s, name: x, facet: { ...s.facet, name: x } }));
  evil.prizes = evil.prizes.map((p) => ({ ...p, headline: x, pool: x }));
  evil.people = Object.fromEntries(Object.entries(evil.people).map(([k, p]) => [k, { ...p, username: x }]));
  evil.provenance = { ...evil.provenance, nodes: [x] };
  const em = model(evil);
  for (const r of ALL_ROUTES) {
    const html = String(renderPage({ ...ctxFor(r), m: em }));
    assert.ok(!html.includes("<img"), JSON.stringify(r));
    assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"), JSON.stringify(r));
  }
});

test("a large synthetic book renders every view", () => {
  const big = model(makeBook({ ideas: 40, draftsUnplaced: 3 }));
  const routes = [{ view: "cover" }, { view: "glossary" }, { view: "credits" }, ...big.chapters.map((c) => ({ view: "idea", id: c.id, section: null }))];
  for (const r of routes) landmarks(String(renderPage({ ...ctxFor(r), m: big, path: PUBLISHED })));
});

import { numeral as _numeral } from "../src/views.mjs";
test("the coda's catalogue number 999 renders as ∞; other numbers as digits", () => {
  assert.equal(_numeral(999), "∞");
  assert.equal(_numeral(4), "4");
  assert.equal(_numeral(0), "0");
});
