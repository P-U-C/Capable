// S1 / M48: ingest strips every character the app's contract rejects, so a name or headline from the network can never stop a compile.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FORMAT_CHARS, isDisplayName, validateText } from "../../contract/validate-app.mjs";
import { clean, firstLine, plain, safeUrl, urlsInText } from "../src/text.mjs";

// One of each kind the contract names (contract/validate-app.mjs FORMAT_CHARS).
const FORMAT = {
  "C0 control": "\u0001",
  "vertical tab": "\u000b",
  "form feed": "\u000c",
  DEL: "\u007f",
  "C1 control": "\u0085",
  "soft hyphen": "­",
  "Arabic letter mark": "؜",
  "Mongolian vowel separator": "᠎",
  "zero-width space": "​",
  "zero-width joiner": "‍",
  "left-to-right mark": "‎",
  "right-to-left mark": "‏",
  "left-to-right embedding": "‪",
  "right-to-left override": "‮",
  "word joiner": "⁠",
  "invisible plus": "⁤",
  "left-to-right isolate": "⁦",
  "right-to-left isolate": "⁧",
  "first strong isolate": "⁨",
  "pop directional isolate": "⁩",
  "inhibit symmetric swapping": "⁪",
  "nominal digit shapes": "⁯",
  BOM: "﻿",
  "interlinear annotation": "￹",
};

test("clean() strips every control and format character the contract rejects, and keeps newline and tab", () => {
  for (const [what, ch] of Object.entries(FORMAT)) {
    assert.ok(FORMAT_CHARS.test(ch), `${what} is in the contract's class`);
    const out = clean(`a${ch}b${ch}`);
    assert.equal(out, "ab", what);
    assert.ok(!FORMAT_CHARS.test(out), what);
  }
  // Every code point the contract's class matches, in the BMP, is gone after clean().
  let all = "";
  for (let c = 0; c < 0x10000; c++) if (c < 0xd800 || c > 0xdfff) if (FORMAT_CHARS.test(String.fromCharCode(c))) all += String.fromCharCode(c);
  assert.ok(all.length > 90, `${all.length} characters`);
  assert.ok(!FORMAT_CHARS.test(clean(all)));
  assert.equal(clean(all), "\n\n\n", "only U+2028 and U+2029 leave anything: the line breaks they stand for");
  assert.equal(clean("a\tb\nc"), "a\tb\nc", "newline and tab stay");
  assert.equal(clean("a\r\nb\rc"), "a\nb\nc");
});

test("line and paragraph separators split lines (a headline stays a headline) and never survive", () => {
  assert.equal(clean("one two three"), "one\ntwo\n\nthree");
  assert.equal(firstLine("$500 FOR VIDEOS ON X Make a video."), "$500 FOR VIDEOS ON X");
  assert.equal(plain("a b"), "a b");
});

test("the reviewer's probe: a display name with bidi isolates comes out of plain() as a name the contract accepts", () => {
  const probe = "Papa ⁧evil⁩";
  assert.equal(isDisplayName(probe), false, "the raw name fails the contract");
  const cleaned = plain(probe);
  assert.equal(cleaned, "Papa evil");
  assert.equal(isDisplayName(cleaned), true);
  for (const ch of Object.values(FORMAT)) {
    const t = plain(`Name ${ch}here${ch}`);
    assert.equal(isDisplayName(t), true, JSON.stringify(ch));
    assert.deepEqual(validateText(t, "x"), [], JSON.stringify(ch));
  }
});

test("a URL carrying a format character is not kept", () => {
  for (const ch of ["​", "⁦", "‮", "­", "﻿"]) {
    assert.equal(safeUrl(`https://example.com/a${ch}b`), null, JSON.stringify(ch));
  }
  assert.equal(safeUrl("https://example.com/ab"), "https://example.com/ab");
  // In text, clean() runs first, so the link is read without the hidden character.
  assert.deepEqual(urlsInText("see https://example.com/a⁧b now"), ["https://example.com/ab"]);
});
