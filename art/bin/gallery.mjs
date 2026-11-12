#!/usr/bin/env node
// Build the review gallery: node art/bin/gallery.mjs [--out path]
// Writes art/gallery.html by default. Deterministic: rerunning changes nothing.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildGallery } from "../lib/gallery.mjs";

const args = process.argv.slice(2);
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : fileURLToPath(new URL("../gallery.html", import.meta.url));
const html = buildGallery();
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
