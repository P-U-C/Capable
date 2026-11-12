// R1 favicon legibility: rasterize the favicon at 16 and 32 px in headless
// Chromium (art/test/raster.py, Python Playwright) and check, pixel by pixel,
// that the ring's four quarters, the head, the shoulders and the paper disc
// between them come out as distinct colours. Skips with a clear message when
// Python Playwright or Chromium is unavailable.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { seal, FAVICON, CANDIES, INK, PAPER } from "../index.mjs";

const SCRIPT = fileURLToPath(new URL("./raster.py", import.meta.url));
const F = FAVICON;
const mid = (F.ring[0] + F.ring[1]) / 2;
/** Sample points in favicon units (64-unit grid). */
const POINTS = {
  head: [F.head.cx, F.head.cy],
  shoulders: [32, 46],
  disc: [F.head.cx - F.head.r - 3.5, F.head.cy],
  top: [32, 32 - mid],
  right: [32 + mid, 32],
  bottom: [32, 32 + mid],
  left: [32 - mid, 32],
  gap: [32, (F.head.cy + F.head.r + F.shoulders.top) / 2],
};
const EXPECT = { top: CANDIES[0], right: CANDIES[1], bottom: CANDIES[2], left: CANDIES[3] };

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const nearest = (px) => [...CANDIES, INK, PAPER].reduce((best, c) => (dist(px, rgb(c)) < dist(px, rgb(best)) ? c : best));

function rasterize(items) {
  const r = spawnSync("python3", [SCRIPT], { input: JSON.stringify({ items }), encoding: "utf8", timeout: 90_000 });
  if (r.error?.code === "ENOENT") return { skip: "python3 is not installed" };
  if (r.status === 3) return { skip: r.stdout.trim() || "rasterizer unavailable" };
  if (r.status !== 0) throw new Error(`raster.py failed (${r.status}): ${r.stdout}${r.stderr}`);
  return { items: JSON.parse(r.stdout).items };
}

test("favicon is legible at 16 px and 32 px (rendered check)", (t) => {
  const sizes = [16, 32];
  const names = Object.keys(POINTS);
  const items = sizes.map((size) => ({
    svg: seal({ mode: "favicon", size }),
    size,
    points: names.map((k) => POINTS[k].map((u) => Math.floor((u * size) / 64))),
  }));
  const res = rasterize(items);
  if (res.skip) {
    t.skip(`SKIPPED favicon raster check: ${res.skip}. Install Python Playwright + Chromium to run it.`);
    return;
  }
  sizes.forEach((size, i) => {
    const px = Object.fromEntries(names.map((k, j) => [k, res.items[i][j]]));
    for (const [k, v] of Object.entries(px)) assert.equal(v[3], 255, `${size}px ${k} is opaque`);
    // the four ring quarters keep their candy
    for (const [k, want] of Object.entries(EXPECT)) {
      assert.equal(nearest(px[k]), want, `${size}px ring ${k}: got rgb(${px[k].slice(0, 3)})`);
      assert.ok(dist(px[k], rgb(want)) < 60, `${size}px ring ${k} is close to ${want}`);
    }
    // the head and shoulders are dark; the disc around the head is light
    assert.ok(lum(px.head) < 0.2, `${size}px head is dark (${lum(px.head).toFixed(2)})`);
    assert.ok(lum(px.shoulders) < 0.2, `${size}px shoulders are dark (${lum(px.shoulders).toFixed(2)})`);
    assert.ok(lum(px.disc) > 0.6, `${size}px disc is light (${lum(px.disc).toFixed(2)})`);
    assert.ok(lum(px.disc) - lum(px.head) > 0.5, `${size}px head stands out from the disc`);
    // the head is distinguishable from every ring colour
    for (const k of Object.keys(EXPECT)) assert.ok(dist(px.head, px[k]) > 120, `${size}px head vs ring ${k}`);
    // at 32 px the head and the shoulders are two shapes (a light row between them)
    if (size === 32) assert.ok(lum(px.gap) > 0.45, `32px gap between head and shoulders (${lum(px.gap).toFixed(2)})`);
  });
});
