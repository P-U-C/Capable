#!/usr/bin/env node
// Write the app's icon set from the seal: node art/bin/icons.mjs [--out dir]
//
// Always writes SVGs (favicon.svg, logo.svg, lockup.svg, icon-*.svg). Then, if
// Python Playwright with Chromium is available, rasterizes the PNGs a web app
// manifest and iOS need (icon-192.png, icon-512.png, icon-maskable-512.png,
// apple-touch-icon.png at 180, favicon-32.png, favicon-16.png). Default out:
// art/icons/. The app lane copies these at build.
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { seal, iconSvg } from "../index.mjs";

const args = process.argv.slice(2);
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : fileURLToPath(new URL("../icons/", import.meta.url));
mkdirSync(out, { recursive: true });

const svgs = {
  "favicon.svg": seal({ mode: "favicon", size: 32 }),
  "logo.svg": seal({ mode: "logo", size: 240 }),
  "lockup.svg": seal({ mode: "lockup", size: 120 }),
  "icon-512.svg": iconSvg({ size: 512 }),
  "icon-maskable-512.svg": iconSvg({ size: 512, maskable: true }),
};
for (const [name, svg] of Object.entries(svgs)) writeFileSync(join(out, name), svg + "\n");

const pngs = [
  ["icon-192.png", iconSvg({ size: 192 }), 192],
  ["icon-512.png", iconSvg({ size: 512 }), 512],
  ["icon-maskable-512.png", iconSvg({ size: 512, maskable: true }), 512],
  ["apple-touch-icon.png", iconSvg({ size: 180 }), 180],
  ["favicon-32.png", seal({ mode: "favicon", size: 32 }), 32],
  ["favicon-16.png", seal({ mode: "favicon", size: 16 }), 16],
];
const r = spawnSync("python3", [fileURLToPath(new URL("./png.py", import.meta.url)), out], { input: JSON.stringify(pngs.map(([name, svg, size]) => ({ name, svg, size }))), encoding: "utf8" });
if (r.status === 0) console.log(r.stdout.trim());
else console.log(`SVGs written to ${out}; PNGs skipped (${(r.stdout || r.stderr || r.error?.message || "").trim().split("\n")[0]})`);
for (const name of Object.keys(svgs)) console.log(join(out, name));
