// A4 — safety: every string from app.json is escaped, only https URLs become
// links or media, external links open safely, no inline handlers or style
// attributes are rendered, and no app chrome mentions a BANNED word.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BANNED } from "../../contract/validate-app.mjs";
import { esc, html, safeUrl, rich, extLink, isSafe } from "../src/html.mjs";
import { COPY, allCopy } from "../src/copy.mjs";
import { renderHome } from "../src/home.mjs";
import { renderDeck } from "../src/cards.mjs";
import { renderSheet, worksFor } from "../src/work.mjs";
import { deckModel } from "../src/model.mjs";
import { emptyState, recordVisit } from "../src/store.mjs";
import { SCENE_LABELS } from "../src/art.mjs";
import { fixture, lessonOf, tags, attr, attrValues, visibleText, APP_DIR } from "./helpers.mjs";

const XSS = `<img src=x onerror=alert(1)>"'><script>alert(2)</script>\`{{x}}`;
const BAD_URLS = ["javascript:alert(1)", "http://example.com/x", "data:text/html,<b>x</b>", "//example.com/x", "/relative", "https://exa mple.com", 'https://example.com/"onmouseover="x', "https://example.com/<x>", "vbscript:x", " https://example.com"];

/** The fixture with every free-text field and URL replaced by something hostile. */
function hostileApp() {
  const app = fixture();
  app.name = XSS;
  app.citizen = { name: XSS, line: XSS };
  app.traits.forEach((t) => {
    t.name = XSS;
    t.grant = `*${XSS}*`;
  });
  app.lessons.forEach((l, i) => {
    l.title = XSS;
    l.promise = XSS;
    l.cards.forEach((c) => {
      for (const k of ["text", "heading", "term", "def", "claim", "reply", "prompt"]) if (k in c) c[k] = `${XSS} *${XSS}*`;
      if (c.steps) c.steps = c.steps.map(() => XSS);
    });
    l.sources = [{ title: XSS, author: XSS, year: 2000, note: XSS, url: BAD_URLS[i % BAD_URLS.length] }];
    l.work.forEach((w, j) => {
      w.caption = XSS;
      w.original = BAD_URLS[(i + j) % BAD_URLS.length];
      if (w.video) w.video = { hls: BAD_URLS[(j + 1) % BAD_URLS.length], external: BAD_URLS[(j + 2) % BAD_URLS.length] };
      if (w.build) w.build = { site: BAD_URLS[(j + 3) % BAD_URLS.length], repo: BAD_URLS[(j + 4) % BAD_URLS.length] };
    });
  });
  for (const c of Object.values(app.creators)) {
    c.username = XSS;
    c.displayName = XSS;
  }
  return app;
}

/** Every real opening tag. User text cannot add any: its "<" is always escaped. */
/** Quoted values are blanked so only attribute names are checked (values are escaped text). */
const openingTags = (m) => [...m.matchAll(/<[a-zA-Z][^>]*>/g)].map((x) => x[0].replace(/"[^"]*"/g, '""'));

/** Every view the app can show, as markup. */
function everyView(app, state = emptyState()) {
  const out = [String(renderHome(app, state))];
  for (const l of app.lessons) {
    const { cards, ctx } = deckModel(app, l.id, state);
    out.push(String(renderDeck(ctx, cards)));
    for (const w of worksFor(l, "more")) out.push(String(renderSheet(app, l, w, { hue: ctx.hue, uid: "s" })));
  }
  return out;
}

test("esc and the html tag escape everything that could become markup", () => {
  assert.equal(esc(`<a href="x" onclick='y'>&\``), "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&#96;");
  assert.equal(String(html`<p title="${'"><b>'}">${"<i>"}</p>`), '<p title="&quot;&gt;&lt;b&gt;">&lt;i&gt;</p>');
  assert.equal(String(html`${["<a>", html`<b>ok</b>`]}`), "&lt;a&gt;<b>ok</b>");
  assert.equal(String(html`${null}${undefined}${false}${true}`), "");
  assert.equal(isSafe("<b>"), false, "plain strings are never trusted");
});

test("rich text allows *emphasis* and nothing else", () => {
  assert.equal(String(rich("a *b* c")), "a <em>b</em> c");
  assert.equal(String(rich("*<b>x</b>*")), "<em>&lt;b&gt;x&lt;/b&gt;</em>");
  assert.equal(String(rich("2 * 3 = 6")), "2 * 3 = 6");
  assert.equal(String(rich("[x](javascript:alert(1))")), "[x](javascript:alert(1))");
});

test("only https URLs survive; external links open safely", () => {
  assert.equal(safeUrl("https://example.com/a?b=c&d=e#f"), "https://example.com/a?b=c&d=e#f");
  for (const u of BAD_URLS) assert.equal(safeUrl(u), null, u);
  assert.equal(safeUrl(42), null);
  assert.equal(String(extLink("javascript:alert(1)", "x")), "", "a bad URL renders no link at all");
  const a = String(extLink("https://example.com", "go"));
  assert.equal(a, '<a class="" href="https://example.com" target="_blank" rel="noopener noreferrer">go</a>');
});

test("hostile content renders as inert text in every view", () => {
  for (const m of everyView(hostileApp())) {
    assert.doesNotMatch(m, /<script|<img|<iframe|<object|<embed/i);
    for (const t of openingTags(m)) {
      assert.doesNotMatch(t, /\son[a-z]+\s*=/i, `no inline event handlers: ${t}`);
      assert.doesNotMatch(t, /\sstyle\s*=/i, `no style attributes (the CSP has no unsafe-inline): ${t}`);
    }
    assert.doesNotMatch(m, /javascript:|vbscript:|data:text/i);
    assert.ok(visibleText(m).includes("<img src=x onerror=alert(1)>"), "the text is shown, escaped");
    for (const t of tags(m, "a")) {
      const href = attr(t, "href");
      assert.ok(/^#\/[a-z0-9/-]*$/.test(href) || /^https:\/\//.test(href), `href ${href}`);
      if (href.startsWith("https://")) {
        assert.equal(attr(t, "target"), "_blank", t);
        assert.equal(attr(t, "rel"), "noopener noreferrer", t);
      }
    }
    for (const s of attrValues(m, "src")) assert.fail(`unexpected src ${s}`);
  }
});

test("hostile content: no invalid username is ever shown as a credit", () => {
  const all = everyView(hostileApp()).map(visibleText).join(" ");
  assert.doesNotMatch(all, /by @/);
  assert.match(all, /by a creator/);
});

test("the real fixture renders only https and in-app links", () => {
  let s = emptyState();
  s = recordVisit(s, "own-your-exit", { index: 11, count: 13, finished: true });
  for (const m of everyView(fixture(), s)) {
    for (const t of openingTags(m)) assert.doesNotMatch(t, /\son[a-z]+\s*=|\sstyle\s*=/i, t);
    for (const t of tags(m, "a")) assert.match(attr(t, "href"), /^(#\/|https:\/\/)/);
  }
});

test("app chrome never uses a BANNED word (the contract's list)", () => {
  for (const s of allCopy()) assert.doesNotMatch(s, BANNED, s);
  for (const s of Object.values(SCENE_LABELS)) assert.doesNotMatch(s, BANNED, s);
  // rendered views of the fixture: visible text and every accessible label
  let s = emptyState();
  s = recordVisit(s, "friend-speech", { index: 3, count: 17 });
  for (const m of everyView(fixture(), s)) {
    assert.doesNotMatch(visibleText(m), BANNED);
    for (const name of ["aria-label", "title", "alt", "aria-valuetext", "placeholder"]) for (const v of attrValues(m, name)) assert.doesNotMatch(v, BANNED, `${name}="${v}"`);
  }
});

test("chrome copy stays out of the contest's vocabulary in the source too", () => {
  // Strings in source files, other than imports, URLs and comments, are chrome.
  const dir = join(APP_DIR, "src");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".mjs"))) {
    const src = readFileSync(join(dir, f), "utf8")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const strings = [...src.matchAll(/"([^"\\\n]*)"|`([^`\\]*)`/g)].map((m) => m[1] ?? m[2]).filter((x) => x && !/^https?:\/\//.test(x) && !/^\.\.?\//.test(x));
    for (const str of strings) assert.doesNotMatch(str, BANNED, `${f}: "${str}"`);
  }
});

test("markup reaches the DOM only through the escaping templates", () => {
  const dir = join(APP_DIR, "src");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".mjs"))) {
    const src = readFileSync(join(dir, f), "utf8");
    for (const m of src.matchAll(/(innerHTML\s*=|insertAdjacentHTML\([^,]+,)\s*([^;]+);/g)) assert.match(m[2].trim(), /^String\(render[A-Z]\w*\(/, `${f}: ${m[0]}`);
    assert.doesNotMatch(src, /outerHTML\s*=|document\.write|new Function|eval\(/, f);
    assert.doesNotMatch(src, /setAttribute\(\s*["']style["']|setAttribute\(\s*["']on/, f);
  }
  assert.equal(COPY.by("@x"), "by @x");
});
