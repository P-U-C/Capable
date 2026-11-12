// W1 — the inline renderer renders only the three markups, and everything else inert.
import test from "node:test";
import assert from "node:assert/strict";
import { inline, paras, plain, tokens } from "../src/inline.mjs";
import { html, esc, safeUrl } from "../src/html.mjs";

const H = "0x" + "ab12".repeat(10);
const r = (t, ctx) => String(inline(t, ctx));
const ALLOWED_TAGS = new Set(["a", "em", "button", "span", "p"]);

/** Every tag in the output is one the renderer is allowed to emit, and every href is https. */
function assertInert(out) {
  for (const m of out.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)) assert.ok(ALLOWED_TAGS.has(m[1].toLowerCase()), `unexpected tag <${m[1]}> in ${out}`);
  for (const m of out.matchAll(/\shref="([^"]*)"/g)) assert.match(m[1], /^https:\/\//, `non-https href in ${out}`);
  // Inside any tag: only known attributes, never an event handler.
  for (const tag of out.matchAll(/<[a-zA-Z][^>]*>/g)) {
    assert.doesNotMatch(tag[0], /\son[a-z]+\s*=/i, `event handler attribute in ${tag[0]}`);
    for (const a of tag[0].matchAll(/\s([a-zA-Z-]+)=/g)) assert.ok(["href", "rel", "target", "class", "type", "data-sub", "aria-label"].includes(a[1]), `attribute ${a[1]} in ${tag[0]}`);
  }
  for (const m of out.matchAll(/<a\s[^>]*>/g)) {
    assert.match(m[0], /rel="noopener noreferrer"/);
    assert.match(m[0], /target="_blank"/);
  }
}

test("plain text is escaped", () => {
  assert.equal(r(`a & b < c > d "e" 'f'`), "a &amp; b &lt; c &gt; d &quot;e&quot; &#39;f&#39;");
  assert.equal(esc("<`>"), "&lt;&#96;&gt;");
});

test("<script> renders as text", () => {
  const out = r("<script>alert(1)</script>");
  assert.equal(out, "&lt;script&gt;alert(1)&lt;/script&gt;");
  assertInert(out);
  const p = String(paras("hi\n\n<script>alert(1)</script>"));
  assert.ok(!p.includes("<script"));
});

test("emphasis renders as <em>", () => {
  assert.equal(r("a *b c* d"), "a <em>b c</em> d");
  assert.equal(r("*x*"), "<em>x</em>");
});

test("https links render with rel and target", () => {
  const out = r("see [the book](https://example.com/a?b=1&c=2) now");
  assert.match(out, /^see <a href="https:\/\/example\.com\/a\?b=1&amp;c=2" rel="noopener noreferrer" target="_blank">the book<span class="sr-only"> \(opens in a new tab\)<\/span><\/a> now$/);
  assertInert(out);
});

test("javascript:, http:, data:, protocol-relative and upper-case schemes stay literal", () => {
  for (const url of ["javascript:alert(1)", "http://example.com", "data:text/html,hi", "//evil.example", "HTTPS://example.com", "https:/x", " https://x.com", "ftp://x", "jav&#x61;script:alert(1)"]) {
    const out = r(`[x](${url})`);
    assert.ok(!out.includes("<a"), `${url} became a link: ${out}`);
    assert.ok(!out.includes("href"), out);
    assertInert(out);
  }
});

test("a link URL cannot break out of its attribute", () => {
  for (const t of [
    `[x](https://a.com" onmouseover="alert(1))`,
    `[x](https://a.com'onfocus='alert(1))`,
    "[x](https://a.com`x`)",
    "[x](https://a.com\\\"x)",
    `[x](https://a.com<script>)`,
    `[x](https://a.com\nb)`,
  ]) {
    const out = r(t);
    assert.ok(!/<a /.test(out), `became a link: ${out}`);
    assertInert(out);
  }
});

test("link labels are escaped plain text", () => {
  const out = r("[<img src=x onerror=alert(1)>](https://x.com)");
  assert.ok(out.startsWith('<a href="https://x.com"'));
  assert.ok(out.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assertInert(out);
});

test("a citation chip renders a keyboard-reachable button for a full lower-case hash", () => {
  const out = r(`claim {{sub:${H}}}.`);
  assert.match(out, new RegExp(`^claim <button type="button" class="chip" data-sub="${H}"[^>]*>·</button>\\.$`));
  const custom = r(`{{sub:${H}}}`, { chip: (h) => html`<button data-sub="${h}">P</button>` });
  assert.equal(custom, `<button data-sub="${H}">P</button>`);
});

test("malformed citations render inert", () => {
  for (const t of [
    "{{sub:0x123}}",
    `{{sub:${H.toUpperCase().replace("0X", "0x")}}}`,
    `{{sub:${H}0}}`,
    `{{ sub:${H} }}`,
    `{{sub:${H}}`,
    `{sub:${H}}`,
    `{{sub:${H.slice(2)}}}`,
    `{{sub:0x${"g".repeat(40)}}}`,
    `{{sub:${H}" onclick="x}}`,
    "{{script}}",
  ]) {
    const out = r(t);
    assert.ok(!out.includes("<button"), `chip from ${t}: ${out}`);
    assertInert(out);
  }
});

test("unclosed markup is literal", () => {
  assert.equal(r("*abc"), "*abc");
  assert.equal(r("abc*"), "abc*");
  assert.equal(r("[abc](https://x.com"), "[abc](https://x.com");
  assert.equal(r("[abc]https://x.com)"), "[abc]https://x.com)");
  assert.equal(r("[abc"), "[abc");
  assert.equal(r("* spaced *"), "* spaced *");
  assert.equal(r("2 * 3 * 4"), "2 * 3 * 4");
});

test("nested markup does not nest", () => {
  // a link inside emphasis stays text
  assert.equal(r("*see [a](https://x.com)*"), "<em>see [a](https://x.com)</em>");
  // emphasis inside a link label stays text
  const out = r("[*a*](https://x.com)");
  assert.ok(out.startsWith('<a href="https://x.com"') && out.includes(">*a*<"), out);
  assert.ok(!out.includes("<em>"));
  // a chip inside a link label or emphasis stays text
  assert.ok(!r(`[{{sub:${H}}}](https://x.com)`).includes("<button"));
  assert.ok(!r(`*{{sub:${H}}}*`).includes("<button"));
  // brackets inside a label break the link
  assert.ok(!r("[a [b] c](https://x.com)").includes("<a "));
  // double asterisks never produce nested em
  const bold = r("**bold**");
  assert.equal((bold.match(/<em>/g) || []).length, 1);
  assertInert(bold);
});

test("paragraphs split on blank lines; single newlines are spaces", () => {
  assert.equal(String(paras("one\n\ntwo")), "<p>one</p><p>two</p>");
  assert.equal(String(paras("one\ntwo")), "<p>one two</p>");
  assert.equal(String(paras("one\n \n\n\ntwo\n")), "<p>one</p><p>two</p>");
  assert.equal(String(paras("")), "");
  assert.equal(String(paras(null)), "");
});

test("non-string input renders nothing", () => {
  for (const v of [null, undefined, 3, {}, ["<b>"]]) assert.equal(r(v), "");
});

test("links and chips can be turned off (index rows, labels)", () => {
  assert.equal(r(`[a](https://x.com) {{sub:${H}}}`, { links: false, chips: false }), "a ");
  assert.equal(plain(`*a* [b](https://x.com) {{sub:${H}}} <c>`), "a b <c>");
});

test("tokens are exactly the three markups", () => {
  assert.deepEqual(
    tokens(`x *y* [z](https://q.com) {{sub:${H}}}`).map((t) => t.t),
    ["text", "em", "text", "link", "text", "sub"],
  );
});

test("safeUrl accepts only https", () => {
  assert.equal(safeUrl("https://a.com/x"), "https://a.com/x");
  for (const u of ["http://a.com", "javascript:x", "https://a.com/\"x", "https://a b", "", null, 5]) assert.equal(safeUrl(u), null);
});

test("fuzz: random markup soup never yields a disallowed tag, handler or non-https href", () => {
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const parts = ["*", "[", "]", "(", ")", "{{", "}}", "sub:", H, "0x", "https://", "http://", "javascript:", "<", ">", "\"", "'", "`", "a", " ", "\n", "\n\n", "script", "onerror=", "&", "x.com", "img", "/", "\\"];
  for (let i = 0; i < 3000; i++) {
    let s = "";
    const n = 1 + Math.floor(rand() * 18);
    for (let k = 0; k < n; k++) s += parts[Math.floor(rand() * parts.length)];
    assertInert(String(paras(s)));
    assertInert(r(s));
  }
});
