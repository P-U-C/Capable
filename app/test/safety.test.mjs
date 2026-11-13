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
import { SCENE_LABELS, TEMPLATE_LABELS } from "../src/art.mjs";
import { renderPassport, renderPublic, renderSignIn } from "../src/passport.mjs";
import { renderStampAct } from "../src/cards.mjs";
import { preview } from "../src/stamps/index.mjs";
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

/**
 * docs/SPEC-V3.md "Independence, amended": identity UI may name the sign-in
 * provider, and only these copy keys are identity UI: the sign-in button, the
 * sheet's title and explainer (and its "open on this phone" link), the share
 * label and the handle line. Nothing else may.
 */
const IDENTITY_KEYS = ["signIn", "signInTitle", "signInScan", "signInOpenHere", "shareLabel", "handleLine"];
const SAMPLE_ARGS = [[3, 7], ["a creator"], [0.5, false], [1, 2], ["Civil", 1, 2], [{ lessons: 4, minutes: [3, 4], traits: 4 }], ["ada"]];
const samples = (v) => {
  const out = [];
  const walk = (x) => {
    if (typeof x === "string") out.push(x);
    else if (typeof x === "function")
      for (const a of SAMPLE_ARGS) {
        try {
          out.push(String(x(...a)));
        } catch {
          /* not this shape */
        }
      }
    else if (x && typeof x === "object") Object.values(x).forEach(walk);
  };
  walk(v);
  return out;
};
/** Rendered identity copy, removed before a view's text is checked. */
const identityText = (username = "ada") => [COPY.signIn, COPY.signInTitle, COPY.signInScan, COPY.signInOpenHere, COPY.shareLabel, COPY.handleLine(username)];
const ws = (t) => String(t).replace(/\s+/g, " ");
const withoutIdentity = (text, username) => identityText(username).reduce((t, s) => t.split(ws(s)).join(" "), ws(text));

const ADA = { fid: 3, username: "ada", displayName: "Ada", pfpUrl: "https://img.example/ada.png", source: "siwf", verifications: ["0x1111111111111111111111111111111111111111"], signedInAt: "2026-11-12T10:00:00Z" };

/** The v3 views: passport signed out and in, a public passport in each state, the sign-in sheet in each phase, the trait card's stamp in each state. */
function citizenViews(app, state = emptyState(), identity = ADA) {
  const base = { app, state, localId: "a".repeat(40), holder: "0x2222222222222222222222222222222222222222", preview };
  const out = [String(renderPassport({ ...base, identity: null })), String(renderPassport({ ...base, identity })), String(renderPassport({ ...base, identity, onChain: new Map([[0, { tokenId: 5, holder: base.holder }]]), sent: { civil: { explorerUrl: `https://basescan.org/tx/0x${"ab".repeat(32)}` } } }))];
  for (const status of ["loading", "ok", "error", "off"]) out.push(String(renderPublic({ app, address: base.holder, status, owned: status === "ok" ? [{ tokenId: 9, stampId: 1 }] : [], preview })));
  out.push(String(renderSignIn({ phase: "waiting" })), String(renderSignIn({ phase: "code", url: "https://farcaster.xyz/~/siwf?channelToken=x", qr: "" })));
  for (const code of ["timeout", "cancelled", "rejected", "verify-failed", "network"]) out.push(String(renderSignIn({ phase: "error", code })));
  for (const a of [{ phase: "saved" }, { phase: "draft" }, { phase: "mint" }, { phase: "busy", step: "network" }, { phase: "busy", step: "account" }, { phase: "busy", step: "confirm" }, { phase: "sent", explorerUrl: `https://basescan.org/tx/0x${"cd".repeat(32)}` }, { phase: "held" }])
    out.push(String(renderStampAct(a)));
  for (const code of ["rejected", "wrong-chain", "offline", "no-account", "failed"]) out.push(String(renderStampAct({ phase: "error", code })));
  return out;
}

test("identity copy: exactly the six allow-listed keys name the sign-in provider, and every other key is BANNED-clean (P3)", () => {
  const naming = Object.keys(COPY).filter((k) => samples(COPY[k]).some((x) => BANNED.test(x)));
  assert.deepEqual(naming.sort(), [...IDENTITY_KEYS].sort(), "the allow-list is exact: no other key names it, and each allow-listed key is identity UI that does");
  for (const [k, v] of Object.entries(COPY)) if (!IDENTITY_KEYS.includes(k)) for (const x of samples(v)) assert.doesNotMatch(x, BANNED, `${k}: ${x}`);
  // the allow-listed copy names the provider and nothing else from the list
  for (const k of IDENTITY_KEYS) for (const x of samples(COPY[k])) assert.deepEqual([...x.matchAll(new RegExp(BANNED.source, "gi"))].map((m) => m[0].toLowerCase()), ["farcaster"], `${k}: ${x}`);
  // allCopy() still covers everything (functions sampled)
  assert.ok(allCopy().includes(COPY.signIn));
});

test("app chrome never uses a BANNED word (the contract's list)", () => {
  const allowed = new Set(IDENTITY_KEYS.flatMap((k) => samples(COPY[k])));
  for (const s of allCopy()) if (!allowed.has(s)) assert.doesNotMatch(s, BANNED, s);
  for (const s of Object.values(SCENE_LABELS)) assert.doesNotMatch(s, BANNED, s);
  for (const s of Object.values(TEMPLATE_LABELS)) assert.doesNotMatch(s, BANNED, s);
  // rendered views of the fixture: visible text and every accessible label, outside the identity copy
  let s = emptyState();
  s = recordVisit(s, "friend-speech", { index: 3, count: 17 });
  s = recordVisit(s, "own-your-exit", { index: 11, count: 13, finished: true });
  for (const m of [...everyView(fixture(), s), ...citizenViews(fixture(), s)]) {
    assert.doesNotMatch(withoutIdentity(visibleText(m)), BANNED);
    for (const name of ["aria-label", "title", "alt", "aria-valuetext", "placeholder"]) for (const v of attrValues(m, name)) assert.doesNotMatch(withoutIdentity(v), BANNED, `${name}="${v}"`);
  }
  // the identity copy shows only where it belongs: the sign-in control, the sheet, share, the handle line
  const signedOut = citizenViews(fixture(), s)[0];
  assert.ok(visibleText(signedOut).includes(COPY.signIn));
  for (const m of everyView(fixture(), s)) assert.doesNotMatch(visibleText(m), BANNED, "home and lessons never name it");
});

test("hostile identity data renders as inert text on the passport and the home chip", () => {
  const hostile = { ...ADA, displayName: XSS, username: "ada", pfpUrl: "javascript:alert(1)" };
  const app = fixture();
  for (const m of [String(renderPassport({ app, state: emptyState(), identity: hostile, localId: "b".repeat(40), holder: "0x2222222222222222222222222222222222222222", preview })), String(renderHome(app, emptyState(), { who: { identity: hostile } }))]) {
    assert.doesNotMatch(m, /<script|<img|<iframe/i, "a non-https picture is never shown");
    for (const t of openingTags(m)) assert.doesNotMatch(t, /\son[a-z]+\s*=|\sstyle\s*=/i, t);
    assert.doesNotMatch(m, /javascript:/i);
  }
  assert.ok(visibleText(String(renderPassport({ app, state: emptyState(), identity: hostile, localId: "b".repeat(40), holder: "0x2222222222222222222222222222222222222222", preview }))).includes("<img src=x onerror=alert(1)>"), "the name is shown, escaped");
  const good = String(renderPassport({ app, state: emptyState(), identity: ADA, localId: "b".repeat(40), holder: "0x2222222222222222222222222222222222222222", preview }));
  const imgs = tags(good, "img");
  assert.equal(imgs.length, 1);
  assert.equal(attr(imgs[0], "src"), ADA.pfpUrl);
  assert.equal(attr(imgs[0], "referrerpolicy"), "no-referrer");
});

test("chrome copy stays out of the contest's vocabulary in the source too", () => {
  // Strings in source files, other than imports, URLs and comments, are chrome.
  // copy.mjs: the six identity keys (and only they, one line each) are allow-listed.
  const dir = join(APP_DIR, "src");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".mjs"))) {
    let src = readFileSync(join(dir, f), "utf8")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    if (f === "copy.mjs") {
      const lines = src.match(new RegExp(`^\\s*(?:${IDENTITY_KEYS.join("|")}):.*$`, "gm")) || [];
      assert.deepEqual(lines.map((l) => l.trim().split(":")[0]).sort(), [...IDENTITY_KEYS].sort(), "one line per identity key");
      src = src.replace(new RegExp(`^\\s*(?:${IDENTITY_KEYS.join("|")}):.*$`, "gm"), "");
    }
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
