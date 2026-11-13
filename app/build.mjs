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
//   manifest.webmanifest, icon-*.png, apple-touch-icon.png, favicon-32.png
//   sw.js                      caches the shell and hashed assets, never video

import { build as esbuild, transform } from "esbuild";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateApp, VIDEO_HOSTS } from "../contract/validate-app.mjs";
import { iconFiles } from "./lib/icons.mjs";
import { identityBuildPlugin } from "./src/identity/build-plugin.mjs";
import { serviceWorker } from "./lib/sw.mjs";

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(APP_DIR, "..");
const CONTRACT_DIR = join(ROOT, "contract");
const require = createRequire(import.meta.url);

export const THEME = "#f7f4ea";
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
 * Content-Security-Policy, delivered by meta tag. Everything is same-origin
 * (fonts and hls.js included) except video: streams play only from the
 * contract's VIDEO_HOSTS, and hls.js plays them through a blob: MediaSource.
 * img-src keeps data: for the grain texture in CSS.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  `media-src 'self' blob: ${VIDEO_ORIGINS}`,
  `connect-src 'self' ${VIDEO_ORIGINS}`,
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
    plugins: [identityBuildPlugin(), browserContract],
    logLevel: "silent",
  });
  return r.outputFiles.filter((f) => f.path.endsWith(".js")).map((f) => ({ name: basename(f.path), text: f.text }));
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

export function manifest(app) {
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
      { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

export function page({ app, js, css, preload = [] }) {
  const description = app.citizen.line.replace(/\*([^*]+)\*/g, "$1");
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
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
${preload.map((f) => `<link rel="preload" href="${escAttr(f)}" as="font" type="font/woff2" crossorigin>\n`).join("")}<link rel="stylesheet" href="${css}">
<script type="module" src="${js}"></script>
</head>
<body>
<div id="app"></div>
<noscript><p class="noscript">${escText(app.name)} needs JavaScript to run.</p></noscript>
<script type="application/json" id="app-data">${inlineJson(app)}</script>
</body>
</html>
`;
}

/** The first-paint bytes: the page (with the App inlined), the bundle and the styles. */
export const firstPaint = (files, { js, css }) => ["index.html", js, css].reduce((n, f) => n + (files.get(f)?.length || 0), 0);

/** Build everything into outDir. Returns sizes: { files: {name: bytes}, total, firstPaint, lazy, fonts }. */
export async function buildApp({ appPath = defaultAppPath(), outDir = join(APP_DIR, "dist") } = {}) {
  const app = loadApp(appPath);
  const fonts = fontAssets();
  const [scripts, cssText] = await Promise.all([bundle(), styles(fonts)]);
  const entry = scripts.find((f) => /^app\.[A-Za-z0-9]+\.js$/.test(f.name));
  if (!entry) throw new Error("the bundle has no app entry");
  const cssName = `app.${hash(cssText)}.css`;
  const files = new Map();
  for (const f of scripts) files.set(f.name, Buffer.from(f.text));
  files.set(cssName, Buffer.from(cssText));
  for (const f of fonts) files.set(f.name, f.bytes);
  files.set("index.html", Buffer.from(page({ app, js: entry.name, css: cssName, preload: fonts.filter((f) => f.preload).map((f) => f.name) })));
  files.set("app.json", Buffer.from(JSON.stringify(app)));
  files.set("manifest.webmanifest", Buffer.from(JSON.stringify(manifest(app), null, 2)));
  for (const [name, png] of iconFiles()) files.set(name, png);
  const lazy = scripts.filter((f) => f !== entry).map((f) => f.name);
  // precache: the page, app.json, manifest, icons, the bundle, styles and fonts; lazy chunks are cached when first used
  const shell = ["./", ...[...files.keys()].filter((f) => f !== "index.html" && !lazy.includes(f)).map((f) => `./${f}`)];
  const version = hash(Buffer.concat([...files.values()]));
  files.set("sw.js", Buffer.from(serviceWorker({ version, shell })));

  const sizes = {
    firstPaint: firstPaint(files, { js: entry.name, css: cssName }),
    lazy: lazy.reduce((n, f) => n + files.get(f).length, 0),
    fonts: fonts.reduce((n, f) => n + f.bytes.length, 0),
  };
  if (sizes.firstPaint >= BUDGET) throw new Error(`first paint is ${(sizes.firstPaint / 1024).toFixed(1)} KB, over the ${BUDGET / 1024} KB budget`);
  if (sizes.lazy >= LAZY_BUDGET) throw new Error(`lazy chunks are ${(sizes.lazy / 1024).toFixed(1)} KB, over the ${LAZY_BUDGET / 1024} KB budget`);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const [name, buf] of files) writeFileSync(join(outDir, name), buf);
  const total = [...files.values()].reduce((n, b) => n + b.length, 0);
  return { files: Object.fromEntries([...files].map(([k, v]) => [k, v.length])), total, ...sizes, version, js: entry.name, css: cssName, lazyChunks: lazy, fontFiles: fonts.map((f) => f.name) };
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
    const r = await buildApp({ appPath, outDir });
    const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
    console.log(`built ${Object.keys(r.files).length} files from ${appPath}: first paint ${kb(r.firstPaint)} (budget ${BUDGET / 1024} KB), lazy ${kb(r.lazy)} (${r.lazyChunks.join(", ")}), fonts ${kb(r.fonts)}, total ${kb(r.total)}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
