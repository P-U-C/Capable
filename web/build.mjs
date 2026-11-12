#!/usr/bin/env node
// W4 — build Primer into single self-contained HTML files.
//
//   node build.mjs                      both outputs
//   node build.mjs --media=link         artifact only  → dist/index.html
//   node build.mjs --media=inline       hosted only    → dist/hosted/index.html (+ manifest)
//   --book <path>   Book JSON (default: content/build/book.json if present, else the contract fixture)
//   --out <dir>     output directory (default: web/dist)
//   BASE_URL=https://… (hosted only) the public URL for the Mini App embed and manifest
//
// The Book is validated with contract/validate.mjs; any error fails the build.

import { build as esbuild, transform } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBook } from "../contract/validate.mjs";

const WEB = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(WEB, "..");
export const FONTS_CSS =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Newsreader:ital,opsz,wght@0,6..72,200..800;1,6..72,200..800&display=swap";
const DESCRIPTION = "An unofficial atlas of the ideas behind Farcaster's prize threads, readable at five depths.";

function args(argv) {
  const out = { media: null, book: null, out: join(WEB, "dist") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--media=")) out.media = a.slice(8);
    else if (a === "--media") out.media = argv[++i];
    else if (a.startsWith("--book=")) out.book = a.slice(7);
    else if (a === "--book") out.book = argv[++i];
    else if (a.startsWith("--out=")) out.out = a.slice(6);
    else if (a === "--out") out.out = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  if (out.media && !["link", "inline"].includes(out.media)) throw new Error("--media must be link or inline");
  return out;
}

export function defaultBookPath() {
  const built = join(ROOT, "content/build/book.json");
  return existsSync(built) ? built : join(ROOT, "contract/fixtures/book.sample.json");
}

export function loadBook(path) {
  const book = JSON.parse(readFileSync(path, "utf8"));
  const errors = validateBook(book);
  if (errors.length) {
    const e = new Error(`book failed validation (${errors.length}):\n  ${errors.slice(0, 30).join("\n  ")}`);
    e.errors = errors;
    throw e;
  }
  return book;
}

/** JSON safe to place inside <script type="application/json">. */
export function inlineJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

const stripValidatorCli = {
  name: "strip-validator-cli",
  setup(b) {
    b.onLoad({ filter: /contract[\\/]validate\.mjs$/ }, (args) => {
      const src = readFileSync(args.path, "utf8");
      const cut = src.indexOf("\n// CLI:");
      return { contents: cut > 0 ? src.slice(0, cut) + "\n" : src, loader: "js" };
    });
  },
};

async function bundle(media) {
  const entry = join(WEB, "src", media === "inline" ? "main-inline.mjs" : "main-link.mjs");
  const r = await esbuild({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: ["es2022", "safari15"],
    minify: true,
    legalComments: "none",
    charset: "utf8",
    // contract/validate.mjs ends with a Node CLI block; the browser never needs it.
    plugins: [stripValidatorCli],
    define: { "process.argv": "[]" },
    logLevel: "silent",
  });
  const js = r.outputFiles[0].text;
  if (/<\/script|<!--/i.test(js)) throw new Error("bundled script contains a sequence that would break inline embedding");
  return js;
}

async function styles() {
  const css = readFileSync(join(WEB, "src/styles.css"), "utf8");
  const r = await transform(css, { loader: "css", minify: true, target: ["safari15", "chrome100", "firefox100"] });
  if (/<\/style/i.test(r.code)) throw new Error("css contains </style");
  return r.code;
}

const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function miniappEmbed(baseUrl) {
  return JSON.stringify({
    version: "1",
    imageUrl: `${baseUrl}/og.png`,
    button: { title: "Read Primer", action: { type: "launch_miniapp", name: "Primer", url: baseUrl, splashImageUrl: `${baseUrl}/splash.png`, splashBackgroundColor: "#F3EFE6" } },
  });
}

export function manifest(baseUrl) {
  return {
    accountAssociation: {
      header: "REPLACE_WITH_SIGNED_HEADER",
      payload: "REPLACE_WITH_SIGNED_PAYLOAD",
      signature: "REPLACE_WITH_SIGNATURE",
    },
    miniapp: {
      version: "1",
      name: "Primer",
      homeUrl: baseUrl,
      iconUrl: `${baseUrl}/icon.png`,
      imageUrl: `${baseUrl}/og.png`,
      buttonTitle: "Read Primer",
      splashImageUrl: `${baseUrl}/splash.png`,
      splashBackgroundColor: "#F3EFE6",
      subtitle: "An atlas of prize ideas",
      description: "An unofficial reading client that turns Farcaster prize threads into an atlas of ideas, readable at five depths.",
      primaryCategory: "education",
      tags: ["reading", "ideas", "prizes", "books"],
      tagline: "Read the prizes as a book",
      ogTitle: "Primer",
      ogDescription: "An unofficial atlas of the ideas behind Farcaster prize threads.",
      ogImageUrl: `${baseUrl}/og.png`,
    },
  };
}

function page({ media, css, js, book, baseUrl, csp }) {
  const head = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`,
    `<title>Primer</title>`,
    `<meta name="description" content="${escAttr(DESCRIPTION)}">`,
    `<meta name="color-scheme" content="light dark">`,
    `<meta name="theme-color" content="#F3EFE6" media="(prefers-color-scheme: light)">`,
    `<meta name="theme-color" content="#14130F" media="(prefers-color-scheme: dark)">`,
    `<meta name="referrer" content="no-referrer">`,
  ];
  if (csp) head.push(`<meta http-equiv="Content-Security-Policy" content="${escAttr(csp)}">`);
  if (media === "inline") {
    head.push(
      `<meta property="og:title" content="Primer">`,
      `<meta property="og:description" content="${escAttr(DESCRIPTION)}">`,
      `<meta property="og:image" content="${escAttr(`${baseUrl}/og.png`)}">`,
      `<meta name="fc:miniapp" content='${miniappEmbed(baseUrl).replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;")}'>`,
    );
  }
  head.push(
    `<link rel="preconnect" href="https://fonts.googleapis.com">`,
    `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`,
    `<link rel="stylesheet" href="${escAttr(FONTS_CSS)}">`,
    `<style>${css}</style>`,
  );
  return `<!DOCTYPE html>
<html lang="en">
<head>
${head.join("\n")}
</head>
<body>
<div id="app"><noscript><p>Primer needs JavaScript to lay out its pages.</p></noscript></div>
<div id="pop" class="pop" role="dialog" aria-label="Voice" tabindex="-1" hidden></div>
<script type="application/json" id="book">${inlineJson(book)}</script>
<script type="module">${js}</script>
</body>
</html>
`;
}

async function sha256(text) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(text, "utf8").digest("base64");
}

/** Build one or both outputs. Returns the paths written. */
export async function buildAll({ media = null, bookPath = null, outDir = join(WEB, "dist"), baseUrl = process.env.BASE_URL } = {}) {
  const book = loadBook(bookPath || defaultBookPath());
  const css = await styles();
  const written = [];
  if (!media || media === "link") {
    const js = await bundle("link");
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, "index.html");
    writeFileSync(file, page({ media: "link", css, js, book }));
    written.push(file);
  }
  if (!media || media === "inline") {
    const base = (baseUrl || "https://primer.example").replace(/\/+$/, "");
    if (!/^https:\/\/[^\s"'<>]+$/.test(base)) throw new Error("BASE_URL must be an https URL");
    const js = await bundle("inline");
    const csp = [
      "default-src 'none'",
      `script-src 'sha256-${await sha256(js)}' https://cdnjs.cloudflare.com`,
      `style-src 'sha256-${await sha256(css)}' https://fonts.googleapis.com`,
      "font-src https://fonts.gstatic.com",
      "img-src 'self' data:",
      "media-src https: blob:",
      "connect-src https:",
      "worker-src blob:",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; ");
    const dir = join(outDir, "hosted");
    mkdirSync(join(dir, ".well-known"), { recursive: true });
    const file = join(dir, "index.html");
    writeFileSync(file, page({ media: "inline", css, js, book, baseUrl: base, csp }));
    writeFileSync(join(dir, ".well-known", "farcaster.json"), JSON.stringify(manifest(base), null, 2) + "\n");
    for (const img of ["og.png", "icon.png", "splash.png"]) {
      const src = join(WEB, "static", img);
      if (existsSync(src)) copyFileSync(src, join(dir, img));
    }
    written.push(file, join(dir, ".well-known", "farcaster.json"));
    if (!baseUrl) console.warn("build: BASE_URL not set; the hosted build uses https://primer.example as a placeholder");
  }
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const a = args(process.argv.slice(2));
    const files = await buildAll({ media: a.media, bookPath: a.book, outDir: resolve(a.out) });
    for (const f of files) console.log(`wrote ${f.replace(ROOT + "/", "")}`);
  } catch (err) {
    console.error(`build failed: ${err.message}`);
    process.exit(1);
  }
}
