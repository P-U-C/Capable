#!/usr/bin/env node
// A5 — build the PWA into app/dist/.
//
//   node build.mjs [--app <app.json>] [--out <dir>]
//
// --app defaults to ../content/build/app.json when it exists, else the
// contract fixture. The App is validated with contract/validate-app.mjs and
// any error fails the build. Output:
//   index.html                 shell with the App inlined (as JSON, '<' escaped) and a strict CSP
//   app.<hash>.js / .css       the bundle and styles
//   app.json                   the same App, fetched network-first for updates
//   manifest.webmanifest, icon-*.png, apple-touch-icon.png, favicon-32.png
//   sw.js                      caches the shell and app.json, never video

import { build as esbuild, transform } from "esbuild";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateApp } from "../contract/validate-app.mjs";
import { iconFiles } from "./lib/icons.mjs";
import { serviceWorker } from "./lib/sw.mjs";

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(APP_DIR, "..");

export const FONTS_CSS =
  "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@125,900&family=Inter:wght@500;600;700;800&family=Pixelify+Sans:wght@600&family=Playfair+Display:ital,wght@1,700&family=Space+Mono:wght@400;700&display=swap";
export const THEME = "#f7f4ea";
export const BUDGET = 400 * 1024;

export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdnjs.cloudflare.com",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https:",
  "worker-src 'self' blob:",
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

// contract/validate-app.mjs ends with a Node CLI block; the browser never needs it.
const stripValidatorCli = {
  name: "strip-validator-cli",
  setup(b) {
    b.onLoad({ filter: /contract[\\/]validate-app\.mjs$/ }, (args) => {
      const src = readFileSync(args.path, "utf8");
      const cut = src.indexOf("\n// CLI:");
      return { contents: cut > 0 ? src.slice(0, cut) + "\n" : src, loader: "js" };
    });
  },
};

async function bundle() {
  const r = await esbuild({
    entryPoints: [join(APP_DIR, "src/main.mjs")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: ["es2020", "safari15", "chrome100"],
    minify: true,
    legalComments: "none",
    charset: "utf8",
    plugins: [stripValidatorCli],
    logLevel: "silent",
  });
  return r.outputFiles[0].text;
}

async function styles() {
  const css = ["tokens.css", "app.css"].map((f) => readFileSync(join(APP_DIR, "src", f), "utf8")).join("\n");
  const r = await transform(css, { loader: "css", minify: true, target: ["safari15", "chrome100", "firefox100"] });
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

export function page({ app, js, css }) {
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS_CSS.replace(/&/g, "&amp;")}">
<link rel="stylesheet" href="${css}">
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

/** Build everything into outDir. Returns { files: {name: bytes}, total }. */
export async function buildApp({ appPath = defaultAppPath(), outDir = join(APP_DIR, "dist") } = {}) {
  const app = loadApp(appPath);
  const [jsText, cssText] = await Promise.all([bundle(), styles()]);
  const jsName = `app.${hash(jsText)}.js`;
  const cssName = `app.${hash(cssText)}.css`;
  const files = new Map();
  files.set(jsName, Buffer.from(jsText));
  files.set(cssName, Buffer.from(cssText));
  files.set("index.html", Buffer.from(page({ app, js: jsName, css: cssName })));
  files.set("app.json", Buffer.from(JSON.stringify(app)));
  files.set("manifest.webmanifest", Buffer.from(JSON.stringify(manifest(app), null, 2)));
  for (const [name, png] of iconFiles()) files.set(name, png);
  const shell = ["./", ...[...files.keys()].map((f) => `./${f}`)];
  const version = hash(Buffer.concat([...files.values()]));
  files.set("sw.js", Buffer.from(serviceWorker({ version, shell })));

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const [name, buf] of files) writeFileSync(join(outDir, name), buf);
  const total = [...files.values()].reduce((n, b) => n + b.length, 0);
  if (total >= BUDGET) throw new Error(`dist is ${(total / 1024).toFixed(1)} KB, over the ${BUDGET / 1024} KB budget`);
  return { files: Object.fromEntries([...files].map(([k, v]) => [k, v.length])), total, version, js: jsName, css: cssName };
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
    console.log(`built ${Object.keys(r.files).length} files, ${(r.total / 1024).toFixed(1)} KB (budget ${BUDGET / 1024} KB) from ${appPath}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
