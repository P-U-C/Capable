// W4 — single-file builds: the artifact loads nothing but Google Fonts; the
// hosted build adds the Mini App embed, manifest and inline video.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAll, inlineJson } from "../build.mjs";
import { FIXTURE_PATH, fixture } from "./synthetic.mjs";

const BASE = "https://primer.test.example";
const out = mkdtempSync(join(tmpdir(), "primer-build-"));
let artifact;
let hosted;
let manifest;

test.before(async () => {
  await buildAll({ bookPath: FIXTURE_PATH, outDir: out, baseUrl: BASE });
  artifact = readFileSync(join(out, "index.html"), "utf8");
  hosted = readFileSync(join(out, "hosted", "index.html"), "utf8");
  manifest = JSON.parse(readFileSync(join(out, "hosted", ".well-known", "farcaster.json"), "utf8"));
});
test.after(() => rmSync(out, { recursive: true, force: true }));

const unescapeAttr = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => m[0]);
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`, "i"));
  return m ? unescapeAttr(m[1] ?? m[2]) : null;
};
const inlineScript = (html) => html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const inlineStyle = (html) => html.match(/<style>([\s\S]*?)<\/style>/)[1];

test("artifact: one self-contained HTML document", () => {
  assert.ok(artifact.startsWith("<!DOCTYPE html>\n<html lang=\"en\">"));
  assert.match(artifact, /<title>Primer<\/title>/);
  assert.match(artifact, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/);
  // viewport-fit=cover only together with safe-area padding
  assert.match(inlineStyle(artifact), /env\(safe-area-inset-bottom\)/);
  assert.match(inlineStyle(artifact), /env\(safe-area-inset-left\)/);
  assert.equal(tags(artifact, "style").length, 1);
  assert.equal(tags(artifact, "script").length, 2);
  assert.ok(statSync(join(out, "index.html")).size < 3 * 1024 * 1024);
});

test("artifact: no script/style/img/media src outside the allowlist", () => {
  for (const t of tags(artifact, "script")) assert.equal(attr(t, "src"), null, t);
  for (const name of ["img", "video", "audio", "source", "track", "iframe", "embed", "object", "picture", "frame", "base", "form"]) assert.equal(tags(artifact, name).length, 0, name);
  const links = tags(artifact, "link");
  assert.ok(links.length >= 1);
  for (const l of links) {
    const href = attr(l, "href");
    const rel = attr(l, "rel");
    if (rel === "stylesheet") assert.match(href, /^https:\/\/fonts\.googleapis\.com\/css2\?/);
    else if (rel === "preconnect") assert.match(href, /^https:\/\/fonts\.(googleapis|gstatic)\.com$/);
    else assert.fail(`unexpected <link rel=${rel}>`);
  }
  // any src= anywhere outside the inline book data
  const shell = artifact.replace(/<script type="application\/json" id="book">[\s\S]*?<\/script>/, "");
  assert.doesNotMatch(shell.replace(inlineScript(artifact), ""), /\ssrc=/i);
  // the stylesheet pulls nothing remote
  const css = inlineStyle(artifact);
  assert.doesNotMatch(css, /@import/i);
  for (const u of css.matchAll(/url\(([^)]*)\)/gi)) assert.fail(`css url(${u[1]})`);
  // the script loads nothing, opens nothing, asks nothing
  const js = inlineScript(artifact);
  for (const bad of ["cdnjs", "fetch(", "XMLHttpRequest", "serviceWorker", "window.open", "alert(", "confirm(", "prompt(", "importScripts", "eval(", "new Function", ".download", "document.write", "WebSocket", "createElement(\"script\")"]) assert.ok(!js.includes(bad), bad);
  assert.ok(!/<\/script/i.test(js));
});

test("artifact: the Book is inlined as escaped JSON and parses back", () => {
  const m = artifact.match(/<script type="application\/json" id="book">([\s\S]*?)<\/script>/);
  assert.ok(m);
  assert.ok(!m[1].includes("<"));
  assert.deepEqual(JSON.parse(m[1]), fixture());
  assert.equal(inlineJson({ a: "</script><b>\u2028" }), '{"a":"\\u003c/script>\\u003cb>\\u2028"}');
});

test("artifact: mounts into #app with a popover host and a noscript note", () => {
  assert.match(artifact, /<div id="app">/);
  assert.match(artifact, /<div id="pop" class="pop" role="dialog"/);
  assert.match(artifact, /<noscript>/);
});

test("hosted: Mini App embed meta built from BASE_URL", () => {
  const meta = tags(hosted, "meta").find((t) => attr(t, "name") === "fc:miniapp");
  assert.ok(meta, "fc:miniapp meta");
  const embed = JSON.parse(attr(meta, "content"));
  assert.equal(embed.version, "1");
  assert.equal(embed.imageUrl, `${BASE}/og.png`);
  assert.equal(embed.button.title, "Read Primer");
  assert.equal(embed.button.action.type, "launch_miniapp");
  assert.equal(embed.button.action.name, "Primer");
  assert.equal(embed.button.action.url, BASE);
});

test("hosted: farcaster.json manifest template with accountAssociation placeholders", () => {
  assert.deepEqual(Object.keys(manifest.accountAssociation).sort(), ["header", "payload", "signature"]);
  for (const v of Object.values(manifest.accountAssociation)) assert.match(v, /^REPLACE_WITH_/);
  assert.equal(manifest.miniapp.version, "1");
  assert.equal(manifest.miniapp.homeUrl, BASE);
  assert.ok(manifest.miniapp.name.length <= 32);
  assert.ok(manifest.miniapp.subtitle.length <= 30);
  assert.ok(manifest.miniapp.description.length <= 170);
  assert.ok(manifest.miniapp.tags.length <= 5 && manifest.miniapp.tags.every((t) => /^[a-z0-9]{1,20}$/.test(t)));
});

test("hosted: plays HLS inline via cdnjs hls.js, under a CSP", () => {
  const js = inlineScript(hosted);
  assert.ok(js.includes("https://cdnjs.cloudflare.com/ajax/libs/hls.js/"));
  assert.ok(js.includes("application/vnd.apple.mpegurl"));
  const csp = tags(hosted, "meta").find((t) => attr(t, "http-equiv") === "Content-Security-Policy");
  assert.ok(csp);
  const policy = attr(csp, "content");
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /script-src 'sha256-[A-Za-z0-9+/=]+' https:\/\/cdnjs\.cloudflare\.com/);
  for (const t of tags(hosted, "script")) assert.equal(attr(t, "src"), null);
});

test("an invalid book fails the build", async () => {
  const bad = fixture();
  bad.chapters[1].connections = [{ to: "nowhere", kind: "echoes", why: "x" }];
  bad.submissions[0].url = "javascript:alert(1)";
  const p = join(out, "bad.json");
  writeFileSync(p, JSON.stringify(bad));
  await assert.rejects(() => buildAll({ bookPath: p, outDir: join(out, "bad") }), /failed validation/);
  assert.ok(!existsSync(join(out, "bad", "index.html")));
});

test("the build is deterministic for the same input", async () => {
  const again = join(out, "again");
  await buildAll({ bookPath: FIXTURE_PATH, outDir: again, baseUrl: BASE, media: "link" });
  assert.equal(readFileSync(join(again, "index.html"), "utf8"), artifact);
});
