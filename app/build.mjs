#!/usr/bin/env node
// A5 — build the PWA into app/dist/.
//
//   node build.mjs [--app <app.json>] [--out <dir>]
//
// --app defaults to ../content/build/app.json when it exists, else the
// contract fixture. The App is validated with contract/validate-app.mjs and
// any error fails the build. Output:
//   index.html                 shell with the App inlined (as JSON, '<' escaped), a strict CSP, two font preloads
//   app.<hash>.js / .css       the first-paint bundle and styles
//   hls.<hash>.js              hls.js from npm, a lazy chunk imported on first HLS play (review S6)
//   <font>.<hash>.woff2        the self-hosted faces, latin only (review S5)
//   app.json                   the same App, fetched network-first for updates
//   manifest.webmanifest       icons from the art lane's seal, hashed: favicon.<h>.svg,
//                              favicon-16/32.<h>.png, apple-touch-icon.<h>.png,
//                              icon-192/512.<h>.png, icon-maskable-512.<h>.png
//   embed.png                  the 3:2 card a shared link shows in a host client (fc:miniapp)
//   sw.js                      caches the shell and hashed assets, never video

import { build as esbuild, transform } from "esbuild";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateApp, VIDEO_HOSTS } from "../contract/validate-app.mjs";
import { iconAssets } from "./lib/icons.mjs";
import { identityBuildPlugin } from "./src/identity/build-plugin.mjs";
import { serviceWorker } from "./lib/sw.mjs";

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(APP_DIR, "..");
const CONTRACT_DIR = join(ROOT, "contract");
const require = createRequire(import.meta.url);

export const THEME = "#f7f4ea";
/** Where the app is published: absolute URLs in the embed tags point here (override with --site). */
export const SITE = "https://p-u-c.github.io/Capable/";
/** The embed card, rendered from the art grammar by tools/embed.py and committed. */
export const EMBED_PNG = join(APP_DIR, "assets/embed.png");
/** What the first paint downloads: index.html (with the App inlined), the bundle and the styles (docs/SPEC-V3.md budgets). */
export const BUDGET = 400 * 1024;
/** Chunks loaded only on use, together: video (hls.js) now; identity, wallet and chain reads later (docs/SPEC-V3.md). */
export const LAZY_BUDGET = 900 * 1024;

/** fontsource's "latin" subset. */
const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";

/**
 * The faces the five type voices use (docs/DESIGN-APP.md), copied from the
 * @fontsource packages: latin only, the weights the CSS asks for. Archivo is
 * the variable file with the width axis, for font-stretch: 125%. The two
 * marked `preload` are on the first screen (the Shout headline and body text).
 */
export const FONTS = [
  { id: "archivo", family: "Archivo", weight: "100 900", stretch: "62% 125%", file: "@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2", preload: true },
  { id: "inter-500", family: "Inter", weight: "500", file: "@fontsource/inter/files/inter-latin-500-normal.woff2" },
  { id: "inter-600", family: "Inter", weight: "600", file: "@fontsource/inter/files/inter-latin-600-normal.woff2", preload: true },
  { id: "inter-700", family: "Inter", weight: "700", file: "@fontsource/inter/files/inter-latin-700-normal.woff2" },
  { id: "inter-800", family: "Inter", weight: "800", file: "@fontsource/inter/files/inter-latin-800-normal.woff2" },
  { id: "pixelify-600", family: "Pixelify Sans", weight: "600", file: "@fontsource/pixelify-sans/files/pixelify-sans-latin-600-normal.woff2" },
  { id: "playfair-700i", family: "Playfair Display", weight: "700", style: "italic", file: "@fontsource/playfair-display/files/playfair-display-latin-700-italic.woff2" },
  { id: "spacemono-400", family: "Space Mono", weight: "400", file: "@fontsource/space-mono/files/space-mono-latin-400-normal.woff2" },
  { id: "spacemono-700", family: "Space Mono", weight: "700", file: "@fontsource/space-mono/files/space-mono-latin-700-normal.woff2" },
];

const VIDEO_ORIGINS = VIDEO_HOSTS.map((h) => `https://${h}`).join(" ");

/**
 * v3 (docs/SPEC-V3.md "Budgets"): the only origins added for identity and
 * stamps. The sign-in relay, the Optimism RPC that verifies a sign-in, and
 * the Base RPC that reads stamps. Inside a host client the SDK talks over
 * postMessage, and wallets over their own channels, so nothing else is needed.
 */
export const IDENTITY_ORIGINS = ["https://relay.farcaster.xyz", "https://mainnet.optimism.io", "https://mainnet.base.org"];

/**
 * Content-Security-Policy, delivered by meta tag. Everything is same-origin
 * (fonts, hls.js and the identity and chain chunks included) except video:
 * streams play only from the contract's VIDEO_HOSTS, and hls.js plays them
 * through a blob: MediaSource. img-src keeps data: for the grain texture in
 * CSS and adds https: for profile pictures (v3), the one bare scheme. Fetches
 * go only to the video hosts and the three identity/chain origins.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data: https:",
  `media-src 'self' blob: ${VIDEO_ORIGINS}`,
  `connect-src 'self' ${VIDEO_ORIGINS} ${IDENTITY_ORIGINS.join(" ")}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export function defaultAppPath() {
  const built = join(ROOT, "content/build/app.json");
  return existsSync(built) ? built : join(ROOT, "contract/fixtures/app.sample.json");
}

export function loadApp(path) {
  const app = JSON.parse(readFileSync(path, "utf8"));
  const errors = validateApp(app);
  if (errors.length) {
    const e = new Error(`app failed validation (${errors.length}):\n  ${errors.slice(0, 30).join("\n  ")}`);
    e.errors = errors;
    throw e;
  }
  return app;
}

/** JSON safe inside <script type="application/json">: no '<', no line separators. */
export function inlineJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const hash = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 10);

/**
 * contract/validate-app.mjs as the browser runs it (review C12):
 *  - no Node CLI block;
 *  - no banned-word checks: the browser gets contract/banned.stub.mjs, which
 *    matches nothing, so those lines are dead there, and their messages name
 *    what the app never names. The build and compile still run the real list.
 *  - VIDEO_HOSTS read from the page's own CSP (src/csp.mjs), which this build
 *    writes from the real list, so the bundle does not spell the hosts out.
 * Throws if the contract file changed shape, so the build fails loudly rather
 * than ship the list.
 */
export function browserValidator(src) {
  const cut = src.indexOf("\n// CLI:");
  const body = cut > 0 ? src.slice(0, cut) + "\n" : src;
  const hosts = /^export const VIDEO_HOSTS = .*;$/m;
  if (!hosts.test(body)) throw new Error("contract/validate-app.mjs: VIDEO_HOSTS is not a one-line export any more; update browserValidator in app/build.mjs");
  const kept = body
    .split("\n")
    .filter((line) => !/\bBANNED(?:_URL)?\.test\(/.test(line))
    .join("\n")
    .replace(hosts, `import { cspHosts as __cspHosts } from ${JSON.stringify(join(APP_DIR, "src/csp.mjs"))};\nexport const VIDEO_HOSTS = Object.freeze(__cspHosts(globalThis.document, "media-src"));`);
  if (/\bBANNED(?:_URL)?\b(?!\s*[,}])/.test(kept.replace(/^(?:import|export) \{[^}]*\} from "\.\/banned\.mjs";$/gm, ""))) throw new Error("contract/validate-app.mjs: a banned-word check spans lines; update browserValidator in app/build.mjs");
  return kept;
}

const browserContract = {
  name: "browser-contract",
  setup(b) {
    // The real list stays in Node; the browser bundle gets the planner's stub.
    b.onResolve({ filter: /(?:^|[\\/])banned\.mjs$/ }, (args) => (resolve(args.resolveDir, args.path) === join(CONTRACT_DIR, "banned.mjs") ? { path: join(CONTRACT_DIR, "banned.stub.mjs") } : undefined));
    b.onLoad({ filter: /contract[\\/]validate-app\.mjs$/ }, (args) => ({ contents: browserValidator(readFileSync(args.path, "utf8")), loader: "js", resolveDir: CONTRACT_DIR }));
  },
};

/**
 * viem's Tempo-chain actions wrap their failures with an error resolver that
 * they import() only when such an action fails. esbuild makes every import()
 * it sees a chunk, so the resolver and its tables (about 170 KB of ox/tempo)
 * would ship although nothing here uses Tempo: sign-in verifies on Optimism
 * and stamps read and mint on Base. This swaps that one import for a stub
 * that hands the original error back unchanged.
 */
export const viemTempoStub = {
  name: "viem-tempo-stub",
  setup(b) {
    b.onResolve({ filter: /^\.\/resolveError\.js$/ }, (args) =>
      /[\\/]viem[\\/]_esm[\\/]tempo[\\/]internal[\\/]errors\.js$/.test(args.importer) ? { path: "tempo-resolve-error", namespace: "capable-stub" } : undefined,
    );
    b.onLoad({ filter: /.*/, namespace: "capable-stub" }, () => ({ contents: "export async function toExecutionError(error) { return error; }\n", loader: "js" }));
  },
};

/** The JS: the first-paint entry (app.<hash>.js) and lazy chunks such as hls.<hash>.js. */
async function bundle() {
  const r = await esbuild({
    entryPoints: { app: join(APP_DIR, "src/main.mjs") },
    bundle: true,
    splitting: true,
    write: false,
    outdir: join(APP_DIR, "dist"),
    entryNames: "[name].[hash]",
    chunkNames: "[name].[hash]",
    format: "esm",
    platform: "browser",
    target: ["es2020", "safari16", "chrome100", "firefox110"],
    minify: true,
    legalComments: "none",
    charset: "utf8",
    plugins: [identityBuildPlugin(), viemTempoStub, browserContract],
    metafile: true,
    logLevel: "silent",
  });
  const files = r.outputFiles.filter((f) => f.path.endsWith(".js")).map((f) => ({ name: basename(f.path), text: f.text }));
  const meta = Object.fromEntries(
    Object.entries(r.metafile.outputs)
      .filter(([k]) => k.endsWith(".js"))
      .map(([k, v]) => [basename(k), { bytes: v.bytes, entry: v.entryPoint || null, inputs: Object.keys(v.inputs), imports: v.imports.map((i) => ({ path: basename(i.path), kind: i.kind })) }]),
  );
  files.meta = meta;
  return files;
}

/** The fonts: hashed copies of the package files, and their @font-face rules (font-display: swap). */
export function fontAssets() {
  return FONTS.map((f) => {
    const bytes = readFileSync(require.resolve(f.file));
    return { ...f, name: `${f.id}.${hash(bytes)}.woff2`, bytes };
  });
}

export function fontFaces(fonts) {
  return fonts
    .map(
      (f) =>
        `@font-face{font-family:"${f.family}";font-style:${f.style || "normal"};font-weight:${f.weight};${f.stretch ? `font-stretch:${f.stretch};` : ""}font-display:swap;src:url(${f.name}) format("woff2");unicode-range:${LATIN}}`,
    )
    .join("\n");
}

async function styles(fonts) {
  const css = [fontFaces(fonts), ...["tokens.css", "app.css"].map((f) => readFileSync(join(APP_DIR, "src", f), "utf8"))].join("\n");
  const r = await transform(css, { loader: "css", minify: true, target: ["safari16", "chrome100", "firefox110"] });
  return r.code;
}

export function manifest(app, icons = iconAssets()) {
  return {
    name: app.name,
    short_name: app.name,
    description: app.citizen.line.replace(/\*([^*]+)\*/g, "$1"),
    id: "./",
    start_url: "./",
    scope: "./",
    display: "standalone",
    orientation: "portrait",
    background_color: THEME,
    theme_color: THEME,
    lang: "en",
    categories: ["education", "books"],
    icons: [
      { src: icons["icon-192"].name, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: icons["icon-512"].name, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: icons["icon-maskable"].name, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

/**
 * The embed a host client reads from a shared link, so the link opens the app
 * as a Mini App (docs/IDENTITY.md; @farcaster/miniapp-core embed schema):
 * version "1", an absolute https 3:2 image, a button whose action launches
 * the app at `site` with a splash. `type` is "launch_miniapp" for fc:miniapp
 * and "launch_frame" for the older fc:frame tag.
 */
export function embedCard(app, { site = SITE, splash, type = "launch_miniapp" } = {}) {
  const name = String(app.name).slice(0, 32);
  return {
    version: "1",
    imageUrl: new URL("embed.png", site).href,
    button: {
      title: `Open ${name}`.slice(0, 32),
      action: { type, name, url: site, splashImageUrl: new URL(splash, site).href, splashBackgroundColor: THEME.toUpperCase() },
    },
  };
}

export function page({ app, js, css, preload = [], modules = [], icons = iconAssets(), site = SITE }) {
  const description = app.citizen.line.replace(/\*([^*]+)\*/g, "$1");
  const embed = (type) => escAttr(JSON.stringify(embedCard(app, { site, splash: icons["icon-192"].name, type })));
  return `<!DOCTYPE html>
<html lang="en" data-view="home">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${escAttr(CSP)}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>${escText(app.name)}</title>
<meta name="description" content="${escAttr(description)}">
<meta name="theme-color" content="${THEME}">
<meta name="color-scheme" content="light">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="${escAttr(app.name)}">
<meta property="og:title" content="${escAttr(app.name)}">
<meta property="og:description" content="${escAttr(description)}">
<meta property="og:image" content="${escAttr(new URL("embed.png", site).href)}">
<meta name="fc:miniapp" content="${embed("launch_miniapp")}">
<meta name="fc:frame" content="${embed("launch_frame")}">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/svg+xml" href="${icons["favicon-svg"].name}">
<link rel="icon" type="image/png" sizes="32x32" href="${icons["favicon-32"].name}">
<link rel="icon" type="image/png" sizes="16x16" href="${icons["favicon-16"].name}">
<link rel="apple-touch-icon" href="${icons["apple-touch"].name}">
${preload.map((f) => `<link rel="preload" href="${escAttr(f)}" as="font" type="font/woff2" crossorigin>\n`).join("")}<link rel="stylesheet" href="${css}">
${modules.map((f) => `<link rel="modulepreload" href="${escAttr(f)}">\n`).join("")}<script type="module" src="${js}"></script>
</head>
<body>
<div id="app"></div>
<noscript><p class="noscript">${escText(app.name)} needs JavaScript to run.</p></noscript>
<script type="application/json" id="app-data">${inlineJson(app)}</script>
</body>
</html>
`;
}

/** The chunks a script pulls in with static imports (itself included): what loads before it runs. */
export function staticClosure(meta, start) {
  const seen = new Set();
  const walk = (f) => {
    if (seen.has(f) || !meta[f]) return;
    seen.add(f);
    for (const i of meta[f].imports) if (i.kind === "import-statement") walk(i.path);
  };
  walk(start);
  return seen;
}

/**
 * The lazy code by what loads it, each the closure of its import() targets
 * minus first paint (shared chunks appear in each group that loads them;
 * `total` counts every lazy file once):
 *   hls       video (hls.js)
 *   identity  sign-in: the flows, the Mini App SDK, the web sign-in client + viem
 *   stamps    chain reads and the mint (viem codec)
 */
export function lazyGroups(meta, first) {
  const owners = { hls: /src\/hls\.mjs$/, identity: /src\/identity\/(flows|lazy-miniapp|lazy-auth)\.mjs$/, stamps: /src\/stamps\/codec\.mjs$/ };
  const lazy = Object.keys(meta).filter((f) => !first.has(f));
  const size = (set) => [...set].reduce((n, f) => n + meta[f].bytes, 0);
  const groups = {};
  for (const [g, re] of Object.entries(owners)) {
    const set = new Set();
    for (const f of lazy) if (meta[f].inputs.some((i) => re.test(i))) for (const x of staticClosure(meta, f)) if (!first.has(x)) set.add(x);
    // the identity flows import() the SDK and the sign-in client: follow those too
    if (g === "identity") for (const f of [...set]) for (const i of meta[f].imports) if (i.kind === "dynamic-import") for (const x of staticClosure(meta, i.path)) if (!first.has(x)) set.add(x);
    groups[g] = { files: [...set].sort(), bytes: size(set) };
  }
  const covered = new Set(Object.values(groups).flatMap((x) => x.files));
  const other = new Set(lazy.filter((f) => !covered.has(f)));
  groups.other = { files: [...other].sort(), bytes: size(other) };
  groups.total = { files: lazy.sort(), bytes: size(new Set(lazy)) };
  return groups;
}

/** The first-paint bytes: the page (with the App inlined), the entry and its static chunks, and the styles. */
export const firstPaint = (files, { js, css, modules = [] }) => ["index.html", js, ...modules, css].reduce((n, f) => n + (files.get(f)?.length || 0), 0);

/** Build everything into outDir. Returns sizes: { files: {name: bytes}, total, firstPaint, lazy, fonts, groups }. */
export async function buildApp({ appPath = defaultAppPath(), outDir = join(APP_DIR, "dist"), site = SITE } = {}) {
  const app = loadApp(appPath);
  if (!/^https:\/\/[^/]+\/(?:.*\/)?$/.test(site)) throw new Error(`--site must be an absolute https URL ending in "/": ${site}`);
  const fonts = fontAssets();
  const icons = iconAssets();
  if (!existsSync(EMBED_PNG)) throw new Error(`missing ${EMBED_PNG}: run python3 -I tools/embed.py`);
  const [scripts, cssText] = await Promise.all([bundle(), styles(fonts)]);
  const entry = scripts.find((f) => /^app\.[A-Za-z0-9]+\.js$/.test(f.name));
  if (!entry) throw new Error("the bundle has no app entry");
  const first = staticClosure(scripts.meta, entry.name);
  const modules = [...first].filter((f) => f !== entry.name).sort();
  const cssName = `app.${hash(cssText)}.css`;
  const files = new Map();
  for (const f of scripts) files.set(f.name, Buffer.from(f.text));
  files.set(cssName, Buffer.from(cssText));
  for (const f of fonts) files.set(f.name, f.bytes);
  for (const ic of Object.values(icons)) files.set(ic.name, ic.bytes);
  files.set("embed.png", readFileSync(EMBED_PNG));
  files.set("index.html", Buffer.from(page({ app, js: entry.name, css: cssName, preload: fonts.filter((f) => f.preload).map((f) => f.name), modules, icons, site })));
  files.set("app.json", Buffer.from(JSON.stringify(app)));
  files.set("manifest.webmanifest", Buffer.from(JSON.stringify(manifest(app, icons), null, 2)));
  const lazy = scripts.filter((f) => !first.has(f.name)).map((f) => f.name);
  // precache: the page, app.json, manifest, icons, the bundle and its static chunks, styles and fonts.
  // Lazy chunks are cached when first used; the embed card is for hosts, never the app.
  const shell = ["./", ...[...files.keys()].filter((f) => f !== "index.html" && f !== "embed.png" && !lazy.includes(f)).map((f) => `./${f}`)];
  const version = hash(Buffer.concat([...files.values()]));
  files.set("sw.js", Buffer.from(serviceWorker({ version, shell })));

  const groups = lazyGroups(scripts.meta, first);
  const sizes = {
    firstPaint: firstPaint(files, { js: entry.name, css: cssName, modules }),
    lazy: lazy.reduce((n, f) => n + files.get(f).length, 0),
    fonts: fonts.reduce((n, f) => n + f.bytes.length, 0),
  };
  if (sizes.firstPaint >= BUDGET) throw new Error(`first paint is ${(sizes.firstPaint / 1024).toFixed(1)} KB, over the ${BUDGET / 1024} KB budget`);
  if (sizes.lazy >= LAZY_BUDGET) throw new Error(`lazy chunks are ${(sizes.lazy / 1024).toFixed(1)} KB, over the ${LAZY_BUDGET / 1024} KB budget`);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const [name, buf] of files) writeFileSync(join(outDir, name), buf);
  const total = [...files.values()].reduce((n, b) => n + b.length, 0);
  return {
    files: Object.fromEntries([...files].map(([k, v]) => [k, v.length])),
    total,
    ...sizes,
    groups,
    version,
    js: entry.name,
    modules,
    css: cssName,
    lazyChunks: lazy,
    fontFiles: fonts.map((f) => f.name),
    icons: Object.fromEntries(Object.entries(icons).map(([k, v]) => [k, v.name])),
    meta: scripts.meta,
  };
}

export function distSize(dir) {
  return readdirSync(dir).reduce((n, f) => n + statSync(join(dir, f)).size, 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const opt = (k) => {
    const i = argv.findIndex((a) => a === k || a.startsWith(`${k}=`));
    if (i < 0) return undefined;
    return argv[i].includes("=") ? argv[i].split("=").slice(1).join("=") : argv[i + 1];
  };
  try {
    const appPath = opt("--app") ? resolve(process.cwd(), opt("--app")) : defaultAppPath();
    const outDir = opt("--out") ? resolve(process.cwd(), opt("--out")) : join(APP_DIR, "dist");
    const site = opt("--site") || SITE;
    const r = await buildApp({ appPath, outDir, site });
    const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
    const g = r.groups;
    console.log(
      `built ${Object.keys(r.files).length} files from ${appPath}: first paint ${kb(r.firstPaint)} (budget ${BUDGET / 1024} KB), lazy ${kb(r.lazy)} in ${r.lazyChunks.length} files (budget ${LAZY_BUDGET / 1024} KB; on use: video ${kb(g.hls.bytes)}, sign-in ${kb(g.identity.bytes)}, stamps ${kb(g.stamps.bytes)}, other ${kb(g.other.bytes)}), fonts ${kb(r.fonts)}, total ${kb(r.total)}`,
    );
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
