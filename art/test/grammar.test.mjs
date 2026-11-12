// R1 grammar: palette-only colours, no external references, ≤ 16 KB, valid
// XML, accessible names, no banned words, fail-closed inputs, and the stamp is
// the contract's badgeSvg itself.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { corpus } from "./corpus.mjs";
import { parseXml } from "./xml.mjs";
import { seal, iconSvg, lessonScene, portrait, stamp, art, ALLOWED } from "../index.mjs";
import { badgeSvg } from "../../contract/badge-art.mjs";
import { BANNED } from "../../contract/banned.mjs";

const COLOR_ATTRS = ["fill", "stroke", "stop-color", "flood-color", "lighting-color", "color"];
const FORBIDDEN_ELEMENTS = ["image", "script", "foreignObject", "style", "a", "iframe", "feImage", "use", "link", "audio", "video", "font-face"];
const LIMIT = 16 * 1024;

/** Every problem with one SVG under the grammar rules. `extra` is the caller's trait colour, if any. */
export function grammarProblems(svg, extra = null) {
  const allowed = new Set([...ALLOWED, ...(extra ? [extra.toUpperCase()] : [])]);
  const p = [];
  const doc = parseXml(svg);
  p.push(...doc.errors.map((e) => `xml: ${e}`));
  if (doc.elements[0]?.name !== "svg") p.push("root is not <svg>");
  if (doc.elements[0]?.attrs.xmlns !== "http://www.w3.org/2000/svg") p.push("root lacks the SVG namespace");
  const bytes = Buffer.byteLength(svg, "utf8");
  if (bytes > LIMIT) p.push(`size ${bytes} > ${LIMIT}`);
  for (const e of doc.elements) {
    if (FORBIDDEN_ELEMENTS.includes(e.name)) p.push(`forbidden element <${e.name}>`);
    for (const [k, v] of Object.entries(e.attrs)) {
      if (k === "style") p.push(`style attribute on <${e.name}>`);
      if (/^on/i.test(k)) p.push(`event handler ${k}`);
      if ((k === "href" || k === "xlink:href") && !v.startsWith("#")) p.push(`external ${k}=${v}`);
      for (const m of v.matchAll(/url\(([^)]*)\)/g)) if (!/^#[\w-]+$/.test(m[1])) p.push(`external url(${m[1]})`);
      if (COLOR_ATTRS.includes(k) && v !== "none" && !/^url\(#[\w-]+\)$/.test(v) && !allowed.has(v)) p.push(`colour ${k}="${v}" on <${e.name}> is not in the palette`);
    }
  }
  const rest = svg.replace(' xmlns="http://www.w3.org/2000/svg"', "");
  if (/https?:|data:|javascript:|@import|\/\/[a-z]/i.test(rest)) p.push("external reference in the text");
  for (const m of rest.matchAll(/#[0-9a-fA-F]{6}\b/g)) if (!allowed.has(m[0].toUpperCase()) || m[0] !== m[0].toUpperCase()) p.push(`colour literal ${m[0]} not in the palette (uppercase)`);
  if (/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i.test(rest)) p.push("functional colour notation");
  return p;
}

test("every generator output in the corpus obeys the grammar", () => {
  const all = corpus();
  assert.ok(all.length >= 120, `corpus has ${all.length} entries`);
  for (const [name, extra, fn] of all) assert.deepEqual(grammarProblems(fn(), extra), [], name);
});

test("1,000 scenes and 1,000 portraits obey the grammar (colour, refs, ≤ 16 KB, XML)", () => {
  let maxScene = 0;
  let maxPortrait = 0;
  for (let i = 0; i < 1000; i++) {
    const c = ["#18C8F0", "#FF1FC8", "#5CF27E", "#FFE11A", "#B48CFF"][i % 5];
    const s = lessonScene({ lessonId: `grammar-${i}`, color: c });
    const probs = grammarProblems(s, c);
    assert.deepEqual(probs, [], `scene grammar-${i}`);
    maxScene = Math.max(maxScene, s.length);
    const pt = portrait({ seed: `g${i}` });
    assert.deepEqual(grammarProblems(pt), [], `portrait g${i}`);
    maxPortrait = Math.max(maxPortrait, pt.length);
  }
  assert.ok(maxScene <= LIMIT && maxPortrait <= LIMIT, `max scene ${maxScene}, max portrait ${maxPortrait}`);
});

test("the grammar check catches what it claims to (rule inverted → flagged)", () => {
  const base = seal({ mode: "logo" });
  assert.deepEqual(grammarProblems(base), []);
  const cases = {
    "off-palette colour": base.replace('fill="#161616"', 'fill="#123456"'),
    "lowercase colour": base.replace('fill="#161616"', 'fill="#161616" stroke="#ff1fc8"'),
    "named colour": base.replace('fill="#161616"', 'fill="red"'),
    "functional colour": base.replace('fill="#161616"', 'fill="rgb(1,2,3)"'),
    "external image": base.replace("</svg>", '<image href="https://x.test/a.png"/></svg>'),
    "external url()": base.replace('fill="#161616"', 'fill="url(https://x.test/p.svg#a)"'),
    "data uri": base.replace("</svg>", '<path d="M0 0" data-x="data:text/html,hi"/></svg>'),
    "style attr": base.replace("<circle ", '<circle style="fill:red" '),
    "unbalanced": base.replace("</svg>", ""),
    "bare ampersand": base.replace("<title>capable</title>", "<title>a & b</title>"),
    "too big": base.replace("</svg>", `<path d="${"M0 0".repeat(5000)}"/></svg>`),
  };
  for (const [what, svg] of Object.entries(cases)) assert.ok(grammarProblems(svg).length > 0, `${what} should be flagged`);
});

test("accessible: titled pieces are role=img with <title>; untitled scenes are hidden", () => {
  const titled = lessonScene({ lessonId: "a", color: "#18C8F0", title: 'Own <Your> "Exit" & go' });
  assert.match(titled, /^<svg [^>]*role="img"[^>]*aria-label="Own &lt;Your&gt; &quot;Exit&quot; &amp; go"/);
  assert.match(titled, /<title>Own &lt;Your&gt; &quot;Exit&quot; &amp; go<\/title>/);
  assert.deepEqual(parseXml(titled).errors, []);
  const plain = lessonScene({ lessonId: "a", color: "#18C8F0" });
  assert.match(plain, /^<svg [^>]*aria-hidden="true"/);
  assert.doesNotMatch(plain, /role="img"|<title>/);
  for (const svg of [seal({ mode: "logo" }), seal({ mode: "lockup" }), seal({ mode: "favicon" }), iconSvg({ size: 192 }), portrait({ seed: "1" })]) {
    assert.match(svg, /^<svg [^>]*role="img"[^>]*aria-label="[^"]+"[^>]*><title>[^<]+<\/title>/);
  }
  assert.match(portrait({ seed: "1", title: "Ada's portrait" }), /aria-label="Ada&#39;s portrait"/);
  assert.match(portrait({ seed: "1", title: "" }), /^<svg [^>]*aria-hidden="true"/);
  // control characters never reach the XML
  assert.deepEqual(parseXml(lessonScene({ lessonId: "a", color: "#18C8F0", title: "a\u0001b\u000Bc" })).errors, []);
});

test("no generated text names the platform or the contests (BANNED)", () => {
  for (const [name, , fn] of corpus()) {
    if (name.startsWith("scene ") && /own-your-exit|friend-speech|vote-with|what-lasts/.test(name)) continue; // caller titles
    const text = fn().replace(/<[^>]*>/g, " ") + " " + [...fn().matchAll(/="([^"]*)"/g)].map((m) => m[1]).join(" ");
    assert.doesNotMatch(text, BANNED, name);
  }
});

test("inputs fail closed: bad colours, empty ids and unknown modes throw", () => {
  assert.throws(() => lessonScene({ lessonId: "x", color: "red" }), TypeError);
  assert.throws(() => lessonScene({ lessonId: "x", color: "#12345" }), TypeError);
  assert.throws(() => lessonScene({ lessonId: "x", color: "#123456; fill:url(http://x)" }), TypeError);
  assert.throws(() => lessonScene({ lessonId: "", color: "#18C8F0" }), TypeError);
  assert.throws(() => lessonScene({ color: "#18C8F0" }), TypeError);
  assert.throws(() => portrait({ seed: "" }), TypeError);
  assert.throws(() => portrait({ seed: "x", color: "blue" }), TypeError);
  assert.throws(() => seal({ mode: "banner" }), TypeError);
  assert.throws(() => seal({ mode: "logo", size: -1 }), TypeError);
  assert.throws(() => iconSvg({ size: 0 }), TypeError);
  // lowercase trait colours (as app/src/art.mjs traitColor returns) are accepted and uppercased
  assert.equal(lessonScene({ lessonId: "x", color: "#18c8f0" }), lessonScene({ lessonId: "x", color: "#18C8F0" }));
});

test("stamp is contract/badge-art.mjs badgeSvg, imported not copied, and matches the parity vectors", () => {
  assert.equal(stamp, badgeSvg);
  assert.equal(art.stamp, badgeSvg);
  const vectors = JSON.parse(readFileSync(new URL("../../contract/fixtures/badge-vectors.json", import.meta.url), "utf8")).vectors;
  for (const v of vectors) assert.equal(stamp(v.input), v.svg);
  const src = readFileSync(new URL("../index.mjs", import.meta.url), "utf8");
  assert.match(src, /from "\.\.\/contract\/badge-art\.mjs"/);
  assert.doesNotMatch(src, /stroke-dasharray="25 75"/, "the badge renderer is not duplicated here");
});

test("ArtAPI shape: seal, lessonScene, portrait, stamp are functions", () => {
  for (const k of ["seal", "lessonScene", "portrait", "stamp"]) assert.equal(typeof art[k], "function", k);
});
