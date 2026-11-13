// A5 — the PWA build: dist has index (with the App inlined safely and a strict
// CSP), manifest, icons, self-hosted fonts, hls.js as a lazy local chunk, a
// service worker that caches only the shell and hashed assets and never video,
// safe-area padding, no banned word in any script, and stays within budget.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { buildApp, inlineJson, defaultAppPath, browserValidator, BUDGET, LAZY_BUDGET, CSP, FONTS, SITE, IDENTITY_ORIGINS, staticClosure } from "../build.mjs";
import { ICONS, ICON_DIR } from "../lib/icons.mjs";
import { COPY } from "../src/copy.mjs";
import { BANNED, VIDEO_HOSTS } from "../../contract/validate-app.mjs";
import { fixture, FIXTURE_PATH, ROOT, APP_DIR, tags, attr, visibleText, decodePng } from "./helpers.mjs";

const out = mkdtempSync(join(tmpdir(), "capable-build-"));
const hostileOut = mkdtempSync(join(tmpdir(), "capable-build-h-"));
let result;
let index;
let manifest;

test.before(async () => {
  result = await buildApp({ appPath: FIXTURE_PATH, outDir: out });
  index = readFileSync(join(out, "index.html"), "utf8");
  manifest = JSON.parse(readFileSync(join(out, "manifest.webmanifest"), "utf8"));
});
test.after(() => {
  rmSync(out, { recursive: true, force: true });
  rmSync(hostileOut, { recursive: true, force: true });
});

const png = (file) => {
  const b = readFileSync(join(out, file));
  assert.deepEqual([...b.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${file} is a PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

const js = () => readdirSync(out).filter((f) => f.endsWith(".js") && f !== "sw.js");

test("dist has the shell, the App, a manifest, icons, fonts, the lazy hls.js chunk and a service worker", () => {
  const files = readdirSync(out);
  for (const f of ["index.html", "app.json", "manifest.webmanifest", "sw.js", "embed.png"]) assert.ok(files.includes(f), f);
  for (const [role] of ICONS) assert.ok(files.includes(result.icons[role]), `${role}: ${result.icons[role]}`);
  assert.ok(files.some((f) => /^app\.[A-Z0-9]{8}\.js$/.test(f)), "the first-paint bundle");
  assert.ok(files.some((f) => /^hls\.[A-Z0-9]{8}\.js$/.test(f)), "hls.js, a separate chunk");
  assert.ok(!files.some((f) => f.endsWith(".css")), "no stylesheet file: the styles are inlined (review T7)");
  assert.equal(files.filter((f) => /^[a-z0-9-]+\.[0-9a-f]{10}\.woff2$/.test(f)).length, FONTS.length);
  const scripts = files.filter((f) => f.endsWith(".js") && f !== "sw.js");
  assert.deepEqual(scripts.sort(), [result.js, ...result.modules, ...result.lazyChunks].sort(), "every script is the entry, a static chunk of it, or a lazy chunk");
  assert.equal(files.length, 5 + ICONS.length + FONTS.length + scripts.length, "nothing unexpected (no video, no source maps, no stylesheet file)");
  assert.ok(!files.some((f) => f.endsWith(".map")));
});

test("icons are the art lane's seal (art/icons), copied under hashed names (U18)", () => {
  for (const [role, src, size] of ICONS) {
    const name = result.icons[role];
    assert.match(name, new RegExp(`^${src.replace(/\.(png|svg)$/, "").replace(/[-]/g, "\\-")}\\.[0-9a-f]{10}\\.(png|svg)$`), role);
    assert.deepEqual(readFileSync(join(out, name)), readFileSync(join(ICON_DIR, src)), `${name} is art/icons/${src}`);
    if (size) assert.deepEqual(png(name), { w: size, h: size }, name);
  }
  const svg = readFileSync(join(out, result.icons["favicon-svg"]), "utf8");
  assert.match(svg, /^<svg[\s>]/);
  assert.doesNotMatch(svg, /<script|href=|on[a-z]+=/i);
  const links = tags(index, "link").filter((t) => /icon/.test(attr(t, "rel")));
  assert.deepEqual(
    links.map((t) => [attr(t, "rel"), attr(t, "type"), attr(t, "sizes"), attr(t, "href")]),
    [
      ["icon", "image/svg+xml", null, result.icons["favicon-svg"]],
      ["icon", "image/png", "32x32", result.icons["favicon-32"]],
      ["icon", "image/png", "16x16", result.icons["favicon-16"]],
      ["apple-touch-icon", null, null, result.icons["apple-touch"]],
    ],
  );
});

test("size budgets: first paint (page, bundle and its static chunks, styles) under 400 KB; lazy chunks under 900 KB", () => {
  const size = (f) => statSync(join(out, f)).size;
  const first = size("index.html") + size(result.js) + result.modules.reduce((n, f) => n + size(f), 0);
  assert.equal(result.firstPaint, first);
  assert.ok(first < BUDGET, `${(first / 1024).toFixed(1)} KB`);
  const lazy = result.lazyChunks.reduce((n, f) => n + size(f), 0);
  assert.equal(result.lazy, lazy);
  assert.ok(lazy < LAZY_BUDGET, `${(lazy / 1024).toFixed(1)} KB`);
  assert.equal(result.groups.total.bytes, lazy, "every lazy file counted once");
  for (const g of ["hls", "identity", "stamps"]) assert.ok(result.groups[g].bytes > 0, g);
  assert.equal(readdirSync(out).reduce((n, f) => n + size(f), 0), result.total);
  // the page preloads exactly the static chunks, so they arrive with the entry
  assert.deepEqual(
    tags(index, "link").filter((t) => attr(t, "rel") === "modulepreload").map((t) => attr(t, "href")),
    result.modules,
  );
  assert.deepEqual([...staticClosure(result.meta, result.js)].sort(), [result.js, ...result.modules].sort());
});

test("sign-in, wallet and chain code stay lazy: nothing of the SDK, the sign-in client or viem in first paint (P3)", () => {
  const firstInputs = [result.js, ...result.modules].flatMap((f) => result.meta[f].inputs);
  const heavy = firstInputs.filter((i) => /node_modules\/(@farcaster|viem|ox|zod|abitype|@noble|@scure|comlink|neverthrow|hls\.js)\//.test(i));
  assert.deepEqual(heavy, [], "no library code at first paint");
  for (const f of ["identity/flows.mjs", "identity/lazy-miniapp.mjs", "identity/lazy-auth.mjs", "stamps/codec.mjs", "src/hls.mjs"]) assert.ok(!firstInputs.some((i) => i.endsWith(f)), `${f} is not in first paint`);
  for (const f of ["identity/index.mjs", "stamps/index.mjs", "art/index.mjs"]) assert.ok(firstInputs.some((i) => i.endsWith(f)), `${f} (the light surface) is`);
  // each lazy path is its own import(): the flows, the SDK, the sign-in client, the codec and hls.js
  const lazyInputs = result.lazyChunks.flatMap((f) => result.meta[f].inputs);
  for (const f of ["identity/flows.mjs", "identity/lazy-miniapp.mjs", "identity/lazy-auth.mjs", "stamps/codec.mjs", "src/hls.mjs"]) assert.ok(lazyInputs.some((i) => i.endsWith(f)), `${f} is lazy`);
  assert.ok(!lazyInputs.some((i) => /ox\/_esm\/tempo\/(index|AccountConfig|KeyAuthorization)\.js$/.test(i)), "viem's unused Tempo error tables are stubbed out");
});

test("hls.js is a lazy same-origin chunk: not on the page, imported by the bundle on demand (review S6)", () => {
  const hls = result.lazyChunks.find((f) => /^hls\./.test(f));
  assert.doesNotMatch(index, new RegExp(hls.replace(/\./g, "\\.")), "the page does not load it");
  const main = readFileSync(join(out, result.js), "utf8");
  assert.ok(main.includes(`import("./${hls}")`), "the bundle imports it lazily");
  const chunk = readFileSync(join(out, hls), "utf8");
  assert.match(chunk, /isSupported/);
  for (const f of readdirSync(out).filter((x) => /\.(js|html|css)$/.test(x))) assert.doesNotMatch(readFileSync(join(out, f), "utf8"), /cdnjs|googleapis|gstatic/, f);
});

test("fonts are self-hosted: the package files, hashed, latin only, font-display swap, two preloaded (review S5)", () => {
  const require = createRequire(import.meta.url);
  const css = result.css;
  const faces = (css.match(/@font-face\{[^}]*\}/g) || []).filter((x) => x.includes("url(")); // the rest are the local fallbacks
  assert.equal(faces.length, FONTS.length);
  for (const f of FONTS) {
    const name = readdirSync(out).find((x) => x.startsWith(`${f.id}.`) && x.endsWith(".woff2"));
    assert.ok(name, f.id);
    assert.deepEqual(readFileSync(join(out, name)), readFileSync(require.resolve(f.file)), `${name} is the package's file`);
    const face = faces.find((x) => x.includes(`url(${name})`));
    assert.ok(face, `an @font-face for ${name}`);
    assert.ok(face.includes(`font-family:${f.family};`) || face.includes(`font-family:"${f.family}";`), `${f.family}: ${face}`); // the minifier may unquote it
    assert.match(face, /font-display:swap/);
    assert.match(face, /unicode-range:U\+0000-00FF/);
    assert.match(f.file, /-latin-/);
  }
  const archivo = faces.find((x) => /Archivo/.test(x));
  assert.match(archivo, /font-stretch:62% 125%/, "the width axis, for font-stretch: 125%");
  assert.match(FONTS.find((f) => f.id === "archivo").file, /archivo-latin-wdth-normal\.woff2$/);
  const preloads = tags(index, "link").filter((t) => attr(t, "rel") === "preload");
  assert.equal(preloads.length, 2);
  for (const t of preloads) {
    assert.equal(attr(t, "as"), "font");
    assert.equal(attr(t, "type"), "font/woff2");
    assert.match(t, /\scrossorigin>/);
    assert.ok(existsSync(join(out, attr(t, "href"))));
  }
  assert.deepEqual(
    preloads.map((t) => attr(t, "href").split(".")[0]),
    FONTS.filter((f) => f.preload).map((f) => f.id),
  );
});

test("manifest: named from app.name, standalone, themed, with any and maskable icons", () => {
  const app = fixture();
  assert.equal(manifest.name, app.name);
  assert.equal(manifest.short_name, app.name);
  assert.equal(manifest.description, app.citizen.line);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.theme_color, "#f7f4ea");
  assert.equal(manifest.background_color, "#f7f4ea");
  const sizes = manifest.icons.map((i) => `${i.sizes}:${i.purpose}`);
  assert.deepEqual(sizes, ["192x192:any", "512x512:any", "512x512:maskable"]);
  assert.deepEqual(
    manifest.icons.map((i) => i.src),
    [result.icons["icon-192"], result.icons["icon-512"], result.icons["icon-maskable"]],
    "the hashed copies of the art lane's icons",
  );
  for (const i of manifest.icons) {
    const { w, h } = png(i.src);
    assert.equal(`${w}x${h}`, i.sizes);
  }
  assert.deepEqual(png(result.icons["apple-touch"]), { w: 180, h: 180 });
  assert.match(index, /<link rel="manifest" href="manifest.webmanifest">/);
  assert.ok(index.includes(`<link rel="apple-touch-icon" href="${result.icons["apple-touch"]}">`));
  assert.match(index, /<meta name="theme-color" content="#f7f4ea">/);
  assert.match(index, /<title>capable<\/title>/);
});

test("the maskable icon keeps its mark inside the safe zone", () => {
  // the shipped PNG, decoded: everything outside the central 80% circle is the paper ground
  const { width, height, px, channels } = decodePng(readFileSync(join(out, result.icons["icon-maskable"])));
  assert.equal(width, 512);
  const at = (x, y) => [...px.subarray((y * width + x) * channels, (y * width + x) * channels + 3)];
  const bg = at(0, 0);
  assert.deepEqual(bg, [0xf7, 0xf4, 0xea], "a solid paper ground");
  let marked = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const c = at(x, y);
      const isBg = Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]) <= 6;
      if (isBg) continue;
      marked++;
      assert.ok(Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2) <= width * 0.4 + 1, `mark at ${x},${y} is outside the safe circle`);
    }
  assert.ok(marked > width * height * 0.2, "the seal is there");
});

test("index: phone viewport with safe areas, strict CSP, no inline code", () => {
  assert.match(index, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/);
  const css = result.css;
  for (const side of ["top", "bottom", "left", "right"]) assert.match(css, new RegExp(`env\\(safe-area-inset-${side}\\)`));
  const meta = tags(index, "meta").find((t) => attr(t, "http-equiv") === "Content-Security-Policy");
  const csp = attr(meta, "content").replace(/&#39;/g, "'");
  assert.equal(csp, result.csp);
  assert.equal(CSP.replace("style-src 'self'", `style-src 'self' ${result.styleHash}`), result.csp, "the base policy plus exactly one stylesheet hash");
  const dir = Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  const hosts = VIDEO_HOSTS.map((h) => `https://${h}`);
  // everything is the app's own origin except video, which plays only from the contract's hosts (review S22)
  assert.deepEqual(dir["default-src"], ["'self'"]);
  assert.deepEqual(dir["script-src"], ["'self'"], "no CDN for scripts (review S6)");
  assert.deepEqual(dir["style-src"], ["'self'", result.styleHash], "the inline stylesheet, pinned by its sha256 (review T7)");
  const inline = index.match(/<style>([\s\S]*?)<\/style>/);
  assert.equal(inline[1], result.css);
  assert.equal(result.styleHash, `'sha256-${createHash("sha256").update(inline[1], "utf8").digest("base64")}'`, "the hash is of the exact inlined text");
  assert.equal(index.match(/<style[\s>]/g).length, 1, "one inline stylesheet");
  assert.deepEqual(dir["font-src"], ["'self'"], "fonts are self-hosted (review S5)");
  assert.deepEqual(dir["img-src"], ["'self'", "data:", "https:"], "data: for the CSS grain; https: for profile pictures (v3), nothing else");
  assert.deepEqual(dir["media-src"], ["'self'", "blob:", ...hosts], "hls.js plays through a blob: MediaSource");
  assert.deepEqual(dir["connect-src"], ["'self'", ...hosts, "https://relay.farcaster.xyz", "https://mainnet.optimism.io", "https://mainnet.base.org"], "video, plus exactly the sign-in relay, the Optimism verifier and the Base RPC (P3)");
  assert.deepEqual(IDENTITY_ORIGINS, ["https://relay.farcaster.xyz", "https://mainnet.optimism.io", "https://mainnet.base.org"]);
  assert.deepEqual(dir["worker-src"], ["'self'"], "the service worker; hls.js runs without a worker");
  assert.deepEqual(dir["object-src"], ["'none'"]);
  assert.deepEqual(dir["frame-src"], ["'none'"]);
  assert.deepEqual(dir["base-uri"], ["'none'"]);
  assert.deepEqual(dir["form-action"], ["'none'"]);
  assert.deepEqual(Object.keys(dir), ["default-src", "script-src", "style-src", "font-src", "img-src", "media-src", "connect-src", "worker-src", "manifest-src", "object-src", "frame-src", "base-uri", "form-action"], "no other directive");
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/, "no wildcards");
  for (const [k, v] of Object.entries(dir)) if (k !== "img-src") assert.ok(!v.includes("https:"), `bare https: only in img-src, not ${k}`);
  const scripts = tags(index, "script");
  assert.equal(scripts.length, 2);
  assert.equal(attr(scripts[0], "type"), "module");
  assert.equal(attr(scripts[0], "src"), result.js);
  assert.equal(attr(scripts[1], "type"), "application/json", "the only inline script is data");
  const shell = index.replace(/<script type="application\/json" id="app-data">[\s\S]*?<\/script>/, "");
  for (const t of shell.match(/<[a-zA-Z][^>]*>/g)) assert.doesNotMatch(t.replace(/"[^"]*"/g, '""'), /\son[a-z]+=|\sstyle=/i, t);
  const links = tags(index, "link").filter((t) => attr(t, "rel") === "stylesheet").map((t) => attr(t, "href"));
  assert.deepEqual(links, [], "no external stylesheet to wait for");
  assert.match(readFileSync(join(APP_DIR, "build.mjs"), "utf8"), /target: \[[^\]]*"safari16"/, "the build targets Safari 16, which container units need (review S21)");
});

test("the App is inlined as JSON identical to dist/app.json, with '<' escaped", async () => {
  const inline = index.match(/<script type="application\/json" id="app-data">([\s\S]*?)<\/script>/)[1];
  assert.doesNotMatch(inline, /</);
  assert.deepEqual(JSON.parse(inline), JSON.parse(readFileSync(join(out, "app.json"), "utf8")));
  assert.deepEqual(JSON.parse(inline), fixture());
  // the contract allows markup-like display names (it rejects only control and format characters): they must still be inert
  const app = fixture();
  app.creators["5254"].displayName = "</script><script>alert(1)</script>";
  const p = join(hostileOut, "app.json");
  writeFileSync(p, JSON.stringify(app));
  await buildApp({ appPath: p, outDir: join(hostileOut, "dist") });
  const h = readFileSync(join(hostileOut, "dist/index.html"), "utf8");
  assert.equal(tags(h, "script").length, 2, "no script was smuggled in");
  const back = JSON.parse(h.match(/<script type="application\/json" id="app-data">([\s\S]*?)<\/script>/)[1]);
  assert.equal(back.creators["5254"].displayName, app.creators["5254"].displayName);
  assert.equal(inlineJson("<  "), '"\\u003c\\u2028\\u2029"');
});

test("an App that fails the contract fails the build", async () => {
  const app = fixture();
  app.lessons[0].promise = "Win the prize before the deadline.";
  const p = join(hostileOut, "bad.json");
  writeFileSync(p, JSON.stringify(app));
  await assert.rejects(buildApp({ appPath: p, outDir: join(hostileOut, "bad") }), /failed validation/);
  assert.equal(existsSync(join(hostileOut, "bad/index.html")), false);
});

test("the default input is the compiled App when present, else the fixture", () => {
  const built = join(ROOT, "content/build/app.json");
  assert.equal(defaultAppPath(), existsSync(built) ? built : FIXTURE_PATH);
});

test("nothing in the shell or manifest uses a BANNED word", () => {
  const shell = index.replace(/<script type="application\/json" id="app-data">[\s\S]*?<\/script>/, "");
  assert.doesNotMatch(visibleText(shell), BANNED);
  for (const t of tags(shell, "meta")) if (attr(t, "http-equiv") !== "Content-Security-Policy") assert.doesNotMatch(attr(t, "content") || "", BANNED, t);
  assert.doesNotMatch(`${manifest.name} ${manifest.short_name} ${manifest.description}`, BANNED);
  const main = readFileSync(join(out, result.js), "utf8");
  assert.doesNotMatch(main, /node:fs|readFileSync/, "the validator's CLI is stripped from the bundle");
});

/**
 * The only strings our own first-paint code may carry that name the sign-in
 * provider (docs/SPEC-V3.md "Independence, amended"): the six identity copy
 * keys (test/safety.test.mjs allow-lists exactly them) and the identity
 * module's two endpoint URLs.
 */
const IDENTITY_STRINGS = [COPY.signIn, COPY.signInTitle, COPY.signInScan, COPY.signInOpenHere, COPY.shareLabel, "https://relay.farcaster.xyz", "https://farcaster.xyz/~/compose"];
const IDENTITY_TEMPLATE = /`@\$\{\w+\} on Farcaster`/g; // COPY.handleLine, minified
const LIBRARY = /node_modules\//;

test("no script in dist ships the banned-word list or any banned word outside the identity allow-list (review C12, P3)", () => {
  const scripts = readdirSync(out).filter((f) => f.endsWith(".js"));
  assert.ok(scripts.length >= 3, "app, hls, sw");
  const listFragments = [/honou\?rable/, /network\\s\+schools/, /competing\\s\+entr/, /placed\\s\+\(\?:first/];
  for (const f of scripts) {
    const text = readFileSync(join(out, f), "utf8");
    for (const frag of listFragments) assert.doesNotMatch(text, frag, `${f} carries the banned-word list`);
    const inputs = result.meta[f]?.inputs ?? [];
    const ours = inputs.filter((i) => !LIBRARY.test(i) && !/identity\/lazy-(miniapp|auth)\.mjs$/.test(i));
    // a chunk of only third-party code (the host SDK, the sign-in client, viem, hls.js) is library text, never shown
    if (f !== "sw.js" && ours.length === 0) continue;
    let rest = text.replace(IDENTITY_TEMPLATE, "");
    for (const str of IDENTITY_STRINGS) rest = rest.split(JSON.stringify(str).slice(1, -1)).join("");
    const hits = [...rest.matchAll(new RegExp(BANNED.source, "gi"))].map((m) => m[0]);
    assert.deepEqual(hits, [], `${f} names: ${[...new Set(hits)].join(", ")}`);
    for (const w of ["warpcast", "bounty", "balaji", "network state", "contest", "prize"]) assert.ok(!rest.toLowerCase().includes(w), `${f} contains "${w}"`);
  }
  // and the allow-listed strings really are there: the identity UI is wired
  const main = readFileSync(join(out, result.js), "utf8");
  for (const str of [COPY.signIn, COPY.shareLabel]) assert.ok(main.includes(str), str);
});

test("the embed tags make a shared link open as a Mini App: fc:miniapp and fc:frame, absolute https URLs, a 3:2 PNG (P3)", () => {
  const meta = (name) => JSON.parse(attr(tags(index, "meta").find((t) => attr(t, "name") === name), "content").replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  const mini = meta("fc:miniapp");
  const frame = meta("fc:frame");
  for (const [m, type] of [
    [mini, "launch_miniapp"],
    [frame, "launch_frame"],
  ]) {
    assert.deepEqual(Object.keys(m), ["version", "imageUrl", "button"]);
    assert.equal(m.version, "1");
    assert.equal(m.imageUrl, `${SITE}embed.png`);
    assert.ok(m.imageUrl.length <= 1024);
    assert.equal(m.button.title, "Open capable");
    assert.ok(m.button.title.length <= 32);
    assert.doesNotMatch(m.button.title, BANNED);
    assert.deepEqual(m.button.action, { type, name: "capable", url: SITE, splashImageUrl: `${SITE}${result.icons["icon-192"]}`, splashBackgroundColor: "#F7F4EA" });
  }
  assert.equal(SITE, "https://p-u-c.github.io/Capable/");
  for (const u of [mini.imageUrl, mini.button.action.url, mini.button.action.splashImageUrl]) {
    const url = new URL(u);
    assert.equal(url.protocol, "https:");
    assert.doesNotMatch(url.hostname, /^(localhost|\d+\.\d+\.\d+\.\d+)$/);
  }
  const card = readFileSync(join(out, "embed.png"));
  assert.deepEqual(readFileSync(join(APP_DIR, "assets/embed.png")), card, "the committed card");
  const { w, h } = png("embed.png");
  assert.equal(w * 2, h * 3, `3:2, not ${w}x${h}`);
  assert.ok(w >= 600, "large enough for a feed");
  assert.ok(card.length <= 1024 * 1024, `${card.length} bytes`);
  assert.equal(attr(tags(index, "meta").find((t) => attr(t, "property") === "og:image"), "content"), `${SITE}embed.png`);
});

test("--site sets the embed's absolute URLs, and must be https", async () => {
  const dir = mkdtempSync(join(tmpdir(), "capable-site-"));
  try {
    await buildApp({ appPath: FIXTURE_PATH, outDir: join(dir, "a"), site: "https://example.org/x/" });
    const page = readFileSync(join(dir, "a/index.html"), "utf8");
    assert.match(page, /&quot;imageUrl&quot;:&quot;https:\/\/example\.org\/x\/embed\.png&quot;/);
    await assert.rejects(buildApp({ appPath: FIXTURE_PATH, outDir: join(dir, "b"), site: "http://example.org/" }), /https/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the browser's validator: no banned-word checks, hosts from the page's CSP, still fails closed", async () => {
  const src = readFileSync(join(ROOT, "contract/validate-app.mjs"), "utf8");
  const browser = browserValidator(src);
  assert.doesNotMatch(browser, /BANNED(?:_URL)?\.test\(|\/\/ CLI:/);
  assert.doesNotMatch(browser, /farcaster|warpcast/i);
  // run it, as the bundle would, against a page whose CSP the build wrote
  const dir = mkdtempSync(join(tmpdir(), "capable-bv-"));
  try {
    writeFileSync(join(dir, "banned.mjs"), readFileSync(join(ROOT, "contract/banned.stub.mjs"), "utf8"));
    writeFileSync(join(dir, "validate-app.mjs"), browser);
    const page = { querySelector: (sel) => (/Content-Security-Policy/.test(sel) ? { getAttribute: () => CSP } : null) };
    const prev = globalThis.document;
    globalThis.document = page;
    let v;
    try {
      v = await import(join(dir, "validate-app.mjs"));
    } finally {
      globalThis.document = prev;
    }
    assert.deepEqual([...v.VIDEO_HOSTS], [...VIDEO_HOSTS], "the hosts come back from the CSP");
    assert.deepEqual(v.validateApp(fixture()), [], "a valid App passes");
    const offList = fixture();
    const w = offList.lessons.flatMap((l) => l.work).find((x) => x.video?.hls);
    w.video = { hls: "https://evil.example/a.m3u8" };
    assert.ok(v.validateApp(offList).some((e) => /inline video only from/.test(e)), "an off-list stream is still refused");
    const broken = fixture();
    broken.lessons[0].cards = [];
    assert.ok(v.validateApp(broken).length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.throws(() => browserValidator(src.replace(/export const VIDEO_HOSTS = [^\n]*/, "export const VIDEO_HOSTS = Object.freeze([\n]);")), /VIDEO_HOSTS/, "a changed contract fails the build loudly");
});

/** Run dist/sw.js against fake caches and fetch, served from `base`. */
async function serviceWorker({ base = "https://app.example/capable/", reply } = {}) {
  const code = readFileSync(join(out, "sw.js"), "utf8");
  const handlers = {};
  const stores = new Map();
  const key = (r) => new URL(typeof r === "string" ? r : r.url, base).href;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return {
        addAll: async (reqs) => {
          for (const r of reqs) {
            const res = await fetchFn(r);
            if (!res.ok) throw new TypeError("addAll: bad response");
            m.set(key(r), res);
          }
        },
        put: async (r, res) => m.set(key(r), res),
        match: async (r) => m.get(key(r))?.clone(),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (n) => stores.delete(n),
  };
  const net = { online: true, calls: [], modes: {} };
  const type = (u) => (/\/(index\.html)?$/.test(u) ? "text/html" : u.endsWith(".json") ? "application/json" : u.endsWith(".webmanifest") ? "application/manifest+json" : "application/octet-stream");
  async function fetchFn(r) {
    const u = key(r);
    net.calls.push(u);
    net.modes[u] = r.cache;
    if (!net.online) throw new TypeError("offline");
    const custom = reply?.(u);
    if (custom) return custom;
    return new Response(`network ${u}`, { headers: { "content-type": type(u) } });
  }
  const self = { addEventListener: (t, f) => (handlers[t] = f), location: new URL("sw.js", base), skipWaiting: async () => {}, clients: { claim: async () => {} } };
  new Function("self", "caches", "fetch", "Request", code)(self, caches, fetchFn, Request);
  const wait = async (t) => {
    let p;
    handlers[t]({ waitUntil: (x) => (p = x) });
    await p;
  };
  const request = (path, { mode = "cors", headers = {}, destination = "", method = "GET" } = {}) => ({ url: new URL(path, base).href, method, mode, destination, headers: new Headers(headers) });
  const dispatch = async (path, init) => {
    let res = null;
    handlers.fetch({ request: request(path, init), respondWith: (r) => (res = r) });
    return res ? (await res).text() : null;
  };
  const cached = () => [...[...stores.values()].flatMap((m) => [...m.keys()])].map((u) => u.replace(base, ""));
  return { stores, net, wait, dispatch, cached, base };
}

test("service worker: precaches the shell, app.json and fonts (not lazy chunks), then serves them offline", async () => {
  const sw = await serviceWorker();
  await sw.wait("install");
  const [name] = sw.stores.keys();
  assert.match(name, /^capable:\/capable\/:[0-9a-f]{10}$/, "the cache is named for its scope (review S23)");
  const cached = sw.cached();
  for (const f of ["", "app.json", "manifest.webmanifest", ...Object.values(result.icons), result.js, ...result.modules]) assert.ok(cached.includes(f), `precached ${f || "./"}`);
  assert.ok(!cached.includes("embed.png"), "the embed card is for hosts, not precached");
  for (const f of result.fontFiles) assert.ok(cached.includes(f), `precached ${f}`);
  assert.ok(!cached.includes("index.html"), "the page is stored once, as ./");
  for (const f of result.lazyChunks) assert.ok(!cached.includes(f), `${f} is cached on first use, not at install`);
  assert.equal(sw.net.modes[`${sw.base}app.json`], "reload", "unhashed files are fetched past the HTTP cache");
  assert.equal(sw.net.modes[`${sw.base}${result.js}`], "default", "hashed files may come from it");
  sw.net.online = false;
  assert.match(await sw.dispatch("./", { mode: "navigate" }), /network .*\/capable\/$/);
  assert.match(await sw.dispatch("./index.html", { mode: "navigate" }), /network .*\/capable\/$/);
  assert.match(await sw.dispatch("./app.json"), /app\.json/);
  assert.match(await sw.dispatch(`./${result.js}`), /network/);
});

test("service worker: lazy chunks are cached on first use", async () => {
  const sw = await serviceWorker();
  await sw.wait("install");
  const hls = result.lazyChunks.find((f) => /^hls\./.test(f));
  assert.match(await sw.dispatch(`./${hls}`), /network/);
  assert.ok(sw.cached().includes(hls));
  sw.net.online = false;
  assert.match(await sw.dispatch(`./${hls}`), /network/, "offline, from the cache");
});

test("service worker: app.json and the page are network-first, so updates arrive", async () => {
  const sw = await serviceWorker();
  await sw.wait("install");
  sw.net.calls.length = 0;
  assert.match(await sw.dispatch("./app.json"), /^network/);
  assert.ok(sw.net.calls.some((u) => u.endsWith("/app.json")));
  assert.match(await sw.dispatch("./?from=home", { mode: "navigate" }), /^network/);
});

test("service worker: visiting another URL in scope never replaces the offline page (review S13)", async () => {
  const sw = await serviceWorker();
  await sw.wait("install");
  assert.equal(await sw.dispatch("./manifest.webmanifest", { mode: "navigate" }), null, "left to the network");
  assert.equal(await sw.dispatch("./sw.js", { mode: "navigate" }), null);
  assert.equal(await sw.dispatch("./nope/", { mode: "navigate" }), null);
  sw.net.online = false;
  const page = await sw.dispatch("./", { mode: "navigate" });
  assert.match(page, /network https:\/\/app\.example\/capable\/$/, "still the page");
  assert.doesNotMatch(page, /webmanifest/);
});

test("service worker: an error or the wrong kind of response is never stored (M38)", async () => {
  let mode = "ok";
  const reply = (u) =>
    mode === "500" ? new Response("server error", { status: 500, headers: { "content-type": "text/html" } }) : mode === "text" && /\/(app\.json)?$/.test(u) ? new Response("not json or html", { headers: { "content-type": "text/plain" } }) : null;
  const sw = await serviceWorker({ reply });
  await sw.wait("install");
  mode = "500";
  assert.equal(await sw.dispatch("./", { mode: "navigate" }), "server error", "passed through");
  assert.equal(await sw.dispatch("./app.json"), "server error");
  mode = "text";
  await sw.dispatch("./", { mode: "navigate" });
  await sw.dispatch("./app.json");
  const hls = result.lazyChunks.find((f) => /^hls\./.test(f));
  mode = "500";
  await sw.dispatch(`./${hls}`);
  assert.ok(!sw.cached().includes(hls), "a failed chunk is not cached");
  sw.net.online = false;
  assert.match(await sw.dispatch("./", { mode: "navigate" }), /^network .*\/capable\/$/, "the good page is still there");
  assert.match(await sw.dispatch("./app.json"), /^network .*app\.json$/);
});

test("service worker: never touches video, other origins or other apps' paths", async () => {
  const sw = await serviceWorker();
  await sw.wait("install");
  assert.equal(await sw.dispatch("./clip.m3u8"), null);
  assert.equal(await sw.dispatch("./seg0.ts"), null);
  assert.equal(await sw.dispatch("./film.mp4"), null);
  assert.equal(await sw.dispatch("./whatever", { headers: { range: "bytes=0-" } }), null);
  assert.equal(await sw.dispatch("./x", { destination: "video" }), null);
  assert.equal(await sw.dispatch("https://stream.example/v1/video/a.m3u8"), null);
  assert.equal(await sw.dispatch("https://x.example/capable/app.json"), null, "another origin's app.json (M08)");
  assert.equal(await sw.dispatch(`https://x.example/capable/${result.js}`), null);
  assert.equal(await sw.dispatch("https://app.example/other/app.json"), null, "the same origin outside this scope");
  assert.equal(await sw.dispatch("./app.json", { method: "POST" }), null);
  const names = sw.cached();
  assert.ok(names.every((u) => !/\.(m3u8|ts|mp4)$/.test(u)));
});

test("service worker: activation clears this scope's old versions and old-style caches, never another scope's", async () => {
  const sw = await serviceWorker();
  sw.stores.set("capable:/capable/:0000000000", new Map());
  sw.stores.set("capable:/staging/:0000000000", new Map());
  sw.stores.set("capable-0123456789", new Map());
  sw.stores.set("someone-else", new Map());
  await sw.wait("install");
  await sw.wait("activate");
  const names = [...sw.stores.keys()];
  assert.ok(!names.includes("capable:/capable/:0000000000"));
  assert.ok(!names.includes("capable-0123456789"), "the old unscoped name of this app");
  assert.ok(names.includes("capable:/staging/:0000000000"), "a second deployment on the origin keeps its cache");
  assert.ok(names.includes("someone-else"));
  assert.equal(names.filter((n) => n.startsWith("capable:/capable/:")).length, 1);
});
