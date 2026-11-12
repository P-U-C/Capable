// A5 — the PWA build: dist has index (with the App inlined safely and a strict
// CSP), manifest, icons, a service worker that caches the shell and app.json
// but never video, safe-area padding, and stays under the size budget.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp, inlineJson, defaultAppPath, BUDGET, CSP } from "../build.mjs";
import { BANNED } from "../../contract/validate-app.mjs";
import { fixture, FIXTURE_PATH, ROOT, tags, attr, visibleText } from "./helpers.mjs";

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

test("dist has the shell, the App, a manifest, icons and a service worker", () => {
  const files = readdirSync(out);
  for (const f of ["index.html", "app.json", "manifest.webmanifest", "sw.js", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "favicon-32.png"]) assert.ok(files.includes(f), f);
  assert.ok(files.some((f) => /^app\.[0-9a-f]{10}\.js$/.test(f)));
  assert.ok(files.some((f) => /^app\.[0-9a-f]{10}\.css$/.test(f)));
  assert.equal(files.length, 11, "nothing unexpected (no video, no source maps)");
});

test("size budget: dist is under 400 KB before fonts and video", () => {
  const total = readdirSync(out).reduce((n, f) => n + statSync(join(out, f)).size, 0);
  assert.ok(total < BUDGET, `${(total / 1024).toFixed(1)} KB`);
  assert.equal(total, result.total);
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
  for (const i of manifest.icons) {
    const { w, h } = png(i.src);
    assert.equal(`${w}x${h}`, i.sizes);
  }
  assert.deepEqual(png("apple-touch-icon.png"), { w: 180, h: 180 });
  assert.match(index, /<link rel="manifest" href="manifest.webmanifest">/);
  assert.match(index, /<link rel="apple-touch-icon" href="apple-touch-icon.png">/);
  assert.match(index, /<meta name="theme-color" content="#f7f4ea">/);
  assert.match(index, /<title>capable<\/title>/);
});

test("the maskable icon keeps its mark inside the safe zone", async () => {
  const { renderIcon } = await import("../lib/icons.mjs");
  const size = 128;
  const px = renderIcon(size, { maskable: true });
  const bg = [px[0], px[1], px[2]];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const isBg = px[i] === bg[0] && px[i + 1] === bg[1] && px[i + 2] === bg[2];
      if (!isBg) assert.ok(Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) <= size * 0.4 + 1, `mark at ${x},${y} is outside the safe circle`);
    }
});

test("index: phone viewport with safe areas, strict CSP, no inline code", () => {
  assert.match(index, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/);
  const css = readFileSync(join(out, readdirSync(out).find((f) => f.endsWith(".css"))), "utf8");
  for (const side of ["top", "bottom", "left", "right"]) assert.match(css, new RegExp(`env\\(safe-area-inset-${side}\\)`));
  const meta = tags(index, "meta").find((t) => attr(t, "http-equiv") === "Content-Security-Policy");
  const csp = attr(meta, "content").replace(/&#39;/g, "'");
  assert.equal(csp, CSP);
  const dir = Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.deepEqual(dir["script-src"], ["'self'", "https://cdnjs.cloudflare.com"]);
  assert.deepEqual(dir["style-src"], ["'self'", "https://fonts.googleapis.com"]);
  assert.deepEqual(dir["font-src"], ["https://fonts.gstatic.com"]);
  assert.ok(dir["media-src"].includes("https:") && dir["media-src"].includes("blob:"), "video hosts vary; hls.js plays from blob:");
  assert.ok(dir["connect-src"].includes("https:"), "hls.js fetches playlists from any https host");
  assert.ok(dir["worker-src"].includes("blob:"), "hls.js runs a worker from a blob");
  assert.deepEqual(dir["object-src"], ["'none'"]);
  assert.deepEqual(dir["base-uri"], ["'none'"]);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/);
  const scripts = tags(index, "script");
  assert.equal(scripts.length, 2);
  assert.equal(attr(scripts[0], "type"), "module");
  assert.match(attr(scripts[0], "src"), /^app\.[0-9a-f]{10}\.js$/);
  assert.equal(attr(scripts[1], "type"), "application/json", "the only inline script is data");
  const shell = index.replace(/<script type="application\/json" id="app-data">[\s\S]*?<\/script>/, "");
  for (const t of shell.match(/<[a-zA-Z][^>]*>/g)) assert.doesNotMatch(t.replace(/"[^"]*"/g, '""'), /\son[a-z]+=|\sstyle=/i, t);
  const links = tags(index, "link").filter((t) => attr(t, "rel") === "stylesheet").map((t) => attr(t, "href"));
  assert.equal(links.length, 2);
  assert.match(links[0], /^https:\/\/fonts\.googleapis\.com\/css2\?.*display=swap$/);
  assert.match(links[1], /^app\.[0-9a-f]{10}\.css$/);
  for (const fam of ["Archivo", "Pixelify", "Playfair", "Space\\+Mono", "Inter"]) assert.match(links[0], new RegExp(fam));
});

test("the App is inlined as JSON identical to dist/app.json, with '<' escaped", async () => {
  const inline = index.match(/<script type="application\/json" id="app-data">([\s\S]*?)<\/script>/)[1];
  assert.doesNotMatch(inline, /</);
  assert.deepEqual(JSON.parse(inline), JSON.parse(readFileSync(join(out, "app.json"), "utf8")));
  assert.deepEqual(JSON.parse(inline), fixture());
  // a creator's display name is not validated by the contract: it must still be inert
  const app = fixture();
  app.creators["5254"].displayName = "</script><script>alert(1)</script> ";
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
  for (const t of tags(shell, "meta")) assert.doesNotMatch(attr(t, "content") || "", BANNED, t);
  assert.doesNotMatch(`${manifest.name} ${manifest.short_name} ${manifest.description}`, BANNED);
  const js = readFileSync(join(out, readdirSync(out).find((f) => f.endsWith(".js"))), "utf8");
  assert.doesNotMatch(js, /node:fs|readFileSync/, "the validator's CLI is stripped from the bundle");
});

/** Run dist/sw.js against fake caches and fetch. */
async function serviceWorker() {
  const BASE = "https://app.example/capable/";
  const code = readFileSync(join(out, "sw.js"), "utf8");
  const handlers = {};
  const stores = new Map();
  const key = (r) => new URL(typeof r === "string" ? r : r.url, BASE).href;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return {
        addAll: async (urls) => urls.forEach((u) => m.set(key(u), new Response(`cached ${u}`))),
        put: async (r, res) => m.set(key(r), res),
        match: async (r) => m.get(key(r))?.clone(),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (n) => stores.delete(n),
    match: async (r) => {
      for (const m of stores.values()) if (m.has(key(r))) return m.get(key(r)).clone();
    },
  };
  const net = { online: true, calls: [] };
  const fetchFn = async (r) => {
    net.calls.push(key(r));
    if (!net.online) throw new TypeError("offline");
    return new Response(`network ${key(r)}`);
  };
  const self = { addEventListener: (t, f) => (handlers[t] = f), location: new URL("sw.js", BASE), skipWaiting: async () => {}, clients: { claim: async () => {} } };
  new Function("self", "caches", "fetch", code)(self, caches, fetchFn);
  const wait = async (type) => {
    let p;
    handlers[type]({ waitUntil: (x) => (p = x) });
    await p;
  };
  const request = (path, { mode = "cors", headers = {}, destination = "", method = "GET" } = {}) => ({ url: new URL(path, BASE).href, method, mode, destination, headers: new Headers(headers) });
  const dispatch = async (path, init) => {
    let res = null;
    handlers.fetch({ request: request(path, init), respondWith: (r) => (res = r) });
    return res ? (await res).text() : null;
  };
  return { stores, net, wait, dispatch };
}

test("service worker: precaches the shell and app.json, then serves them offline", async () => {
  const sw = await serviceWorker();
  await sw.wait("install");
  const [name] = sw.stores.keys();
  assert.match(name, /^capable-[0-9a-f]{10}$/);
  const cached = [...sw.stores.get(name).keys()].map((u) => u.replace("https://app.example/capable/", ""));
  for (const f of ["", "index.html", "app.json", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"]) assert.ok(cached.includes(f), `precached ${f || "./"}`);
  assert.ok(cached.some((f) => /^app\.[0-9a-f]{10}\.js$/.test(f)));
  sw.net.online = false;
  assert.match(await sw.dispatch("./", { mode: "navigate" }), /cached \.\/index\.html/);
  assert.match(await sw.dispatch("./app.json"), /cached \.\/app\.json/);
  const js = cached.find((f) => f.endsWith(".js"));
  assert.match(await sw.dispatch(`./${js}`), /cached/);
});

test("service worker: app.json and pages are network-first, so updates arrive", async () => {
  const sw = await serviceWorker();
  await sw.wait("install");
  assert.match(await sw.dispatch("./app.json"), /^network/);
  assert.ok(sw.net.calls.some((u) => u.endsWith("/app.json")));
  sw.net.online = false;
  assert.match(await sw.dispatch("./app.json"), /^network/, "the fresh copy was cached for next time");
  sw.net.online = true;
  assert.match(await sw.dispatch("./#/l/own-your-exit", { mode: "navigate" }), /^network/);
});

test("service worker: never touches video or other origins", async () => {
  const sw = await serviceWorker();
  await sw.wait("install");
  assert.equal(await sw.dispatch("./clip.m3u8"), null);
  assert.equal(await sw.dispatch("./seg0.ts"), null);
  assert.equal(await sw.dispatch("./film.mp4"), null);
  assert.equal(await sw.dispatch("./whatever", { headers: { range: "bytes=0-" } }), null);
  assert.equal(await sw.dispatch("./x", { destination: "video" }), null);
  assert.equal(await sw.dispatch("https://stream.example/v1/video/a.m3u8"), null);
  assert.equal(await sw.dispatch("https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.20/hls.min.js"), null);
  assert.equal(await sw.dispatch("https://fonts.gstatic.com/x.woff2"), null);
  assert.equal(await sw.dispatch("./app.json", { method: "POST" }), null);
  const names = [...sw.stores.values()].flatMap((m) => [...m.keys()]);
  assert.ok(names.every((u) => !/\.(m3u8|ts|mp4)$/.test(u)));
});

test("service worker: activation clears old versions only", async () => {
  const sw = await serviceWorker();
  sw.stores.set("capable-0000000000", new Map());
  sw.stores.set("someone-else", new Map());
  await sw.wait("install");
  await sw.wait("activate");
  const names = [...sw.stores.keys()];
  assert.ok(!names.includes("capable-0000000000"));
  assert.ok(names.includes("someone-else"));
  assert.equal(names.filter((n) => n.startsWith("capable-")).length, 1);
});
