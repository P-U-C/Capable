// Build-time icons (v3, U18): the art lane's seal, pre-rendered in art/icons/
// (node art/bin/icons.mjs), copied into dist under content-hashed names so a
// changed icon is never served stale by a cache. The manifest, the page's
// <link> tags, the embed's splash image and the service worker's precache all
// take the hashed names from here.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ICON_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../art/icons");

/** Every icon the app ships: [role, source file in art/icons, px size or null, MIME type]. */
export const ICONS = [
  ["favicon-svg", "favicon.svg", null, "image/svg+xml"],
  ["favicon-16", "favicon-16.png", 16, "image/png"],
  ["favicon-32", "favicon-32.png", 32, "image/png"],
  ["apple-touch", "apple-touch-icon.png", 180, "image/png"],
  ["icon-192", "icon-192.png", 192, "image/png"],
  ["icon-512", "icon-512.png", 512, "image/png"],
  ["icon-maskable", "icon-maskable-512.png", 512, "image/png"],
];

const hashOf = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 10);

/** "icon-192.png" + bytes → "icon-192.<hash>.png" */
export const hashedName = (file, bytes) => file.replace(/\.(png|svg)$/, `.${hashOf(bytes)}.$1`);

/**
 * The icons as { role: { name, bytes, size, type } }. Throws when a file is
 * missing, so a build never ships without them.
 */
export function iconAssets(dir = ICON_DIR) {
  const out = {};
  for (const [role, file, size, type] of ICONS) {
    const bytes = readFileSync(join(dir, file));
    out[role] = { name: hashedName(file, bytes), bytes, size, type, source: file };
  }
  return out;
}
