// Quality bar: text colour pairs in styles.css pass WCAG AA (4.5:1) in light and dark.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2];
  return out;
}
const light = tokens(css.match(/:root\s*\{([\s\S]*?)\}/)[1]);
const dark = tokens(css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)\}/)[1]);

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// Every foreground/background pair the stylesheet uses for text.
const PAIRS = [["ink", "paper"], ["ink", "paper-2"], ["ink-2", "paper"], ["ink-2", "paper-2"], ["rubric", "paper"], ["rubric", "paper-2"], ["paper", "ink"]];

test("tokens match DESIGN.md", () => {
  assert.equal(light.paper.toLowerCase(), "#f3efe6");
  assert.equal(light.rubric.toLowerCase(), "#b3412a");
  assert.equal(dark.paper.toLowerCase(), "#14130f");
  assert.equal(dark.rubric.toLowerCase(), "#e2674a");
});

for (const [name, t] of [["light", light], ["dark", dark]]) {
  test(`${name}: text pairs pass AA`, () => {
    for (const [fg, bg] of PAIRS) {
      const r = ratio(t[fg], t[bg]);
      assert.ok(r >= 4.5, `${name} ${fg} on ${bg}: ${r.toFixed(2)}:1`);
    }
  });
}
