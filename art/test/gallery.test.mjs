// R2: the gallery is built by `node art/bin/gallery.mjs`, shows every
// generator over many seeds and the logo at 16/32/180/512 px, and the
// committed art/gallery.html is the current build.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGallery } from "../lib/gallery.mjs";

const count = (s, re) => (s.match(re) || []).length;

test("the gallery shows every generator across many seeds", () => {
  const html = buildGallery();
  for (const id of ["tokens", "logo", "favicon", "icons", "scenes", "portraits", "stamps"]) assert.match(html, new RegExp(`<section id="${id}">`), id);
  for (const s of [16, 32, 180, 512]) {
    assert.match(html, new RegExp(`viewBox="0 0 240 240" width="${s}" height="${s}"`), `logo at ${s}px`);
    assert.match(html, new RegExp(`viewBox="0 0 64 64" width="${s}" height="${s}"`), `favicon at ${s}px`);
  }
  assert.ok(count(html, /viewBox="0 0 320 240"/g) >= 24, "24+ lesson scenes");
  for (const id of ["own-your-exit", "friend-speech", "vote-with-your-feet", "what-lasts"]) assert.match(html, new RegExp(`${id} · \\w+`), id);
  assert.ok(count(html, /viewBox="0 0 160 160"/g) >= 24, "24+ portraits");
  assert.equal(count(html, /viewBox="0 0 400 400"/g), 8, "8 stamps");
  assert.doesNotMatch(html, /<script|<link|https?:\/\/(?!www\.w3\.org\/2000\/svg)/, "self-contained");
});

test("node art/bin/gallery.mjs writes the same bytes as the committed art/gallery.html", () => {
  const dir = mkdtempSync(join(tmpdir(), "art-gallery-"));
  try {
    const out = join(dir, "gallery.html");
    const r = spawnSync(process.execPath, [fileURLToPath(new URL("../bin/gallery.mjs", import.meta.url)), "--out", out], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const built = readFileSync(out, "utf8");
    assert.equal(built, buildGallery());
    const committed = readFileSync(new URL("../gallery.html", import.meta.url), "utf8");
    assert.ok(committed === built, "art/gallery.html is stale: run node art/bin/gallery.mjs");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("art/icons: the committed SVGs are current and the PNG set exists (node art/bin/icons.mjs)", async () => {
  const { seal, iconSvg } = await import("../index.mjs");
  const { existsSync } = await import("node:fs");
  const want = {
    "favicon.svg": seal({ mode: "favicon", size: 32 }),
    "logo.svg": seal({ mode: "logo", size: 240 }),
    "lockup.svg": seal({ mode: "lockup", size: 120 }),
    "icon-512.svg": iconSvg({ size: 512 }),
    "icon-maskable-512.svg": iconSvg({ size: 512, maskable: true }),
  };
  for (const [name, svg] of Object.entries(want)) {
    assert.equal(readFileSync(new URL(`../icons/${name}`, import.meta.url), "utf8"), svg + "\n", `art/icons/${name} is stale: run node art/bin/icons.mjs`);
  }
  for (const name of ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "favicon-32.png", "favicon-16.png"]) {
    const url = new URL(`../icons/${name}`, import.meta.url);
    assert.ok(existsSync(url), name);
    assert.deepEqual([...readFileSync(url).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${name} is a PNG`);
  }
});
