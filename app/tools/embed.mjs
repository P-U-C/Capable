#!/usr/bin/env node
// Dev tool: the HTML for the embed card a host client shows for a shared link
// (fc:miniapp imageUrl): 1200×800 (3:2), the citizen seal and wordmark, the
// four stamps and a row of portraits on paper, all drawn by the art grammar.
// tools/embed.py renders it to assets/embed.png, which is committed. Not used
// by the build or the tests.
//   node tools/embed.mjs > /tmp/embed.html

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { seal, portrait } from "../../art/index.mjs";
import { preview, stampTrait } from "../src/stamps/index.mjs";
import { keccak256, toHex } from "../src/stamps/keccak.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const meta = JSON.parse(readFileSync(join(ROOT, "content/app.meta.json"), "utf8"));
const font = (f) => pathToFileURL(require.resolve(f)).href;
const holder = (s) => "0x" + toHex(keccak256(new TextEncoder().encode(`capable:embed:${s}`))).slice(-40);

const stamps = meta.traits.map((t, i) => preview({ holder: holder(t.id), stampId: t.stampId, tokenId: [7, 21, 48, 112][i], trait: stampTrait(t) }));
const people = ["1000", "40595", "72271", "80190", "119785", "135623"].map((seed, i) => portrait({ seed: `fid:${seed}`, uid: `e${i}`, title: "" }));
const tilt = [-6, 4, -3, 7];

process.stdout.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
@font-face { font-family: "Archivo"; font-weight: 100 900; font-stretch: 62% 125%; src: url(${font("@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2")}) format("woff2"); }
@font-face { font-family: "Playfair Display"; font-weight: 700; font-style: italic; src: url(${font("@fontsource/playfair-display/files/playfair-display-latin-700-italic.woff2")}) format("woff2"); }
html, body { margin: 0; }
body { width: 1200px; height: 800px; background: #F7F4EA; position: relative; overflow: hidden; font-family: "Archivo", sans-serif; }
.grain { position: absolute; inset: 0; opacity: .5; }
.lockup { position: absolute; left: 50%; top: 34px; transform: translateX(-50%); }
.lockup svg { height: 170px; width: auto; display: block; }
.line { position: absolute; top: 214px; left: 0; right: 0; margin: 0; text-align: center; font: italic 700 38px/1 "Playfair Display", serif; color: #161616; letter-spacing: -.01em; }
.stamps { position: absolute; top: 290px; left: 0; right: 0; display: flex; justify-content: center; gap: 26px; }
.stamp { width: 236px; height: 236px; border: 4px solid #161616; box-shadow: 9px 9px 0 #161616; background: #F7F4EA; }
.stamp svg { width: 100%; height: 100%; display: block; }
.people { position: absolute; bottom: 30px; left: 0; right: 0; display: flex; justify-content: center; gap: 22px; }
.person { width: 132px; height: 132px; border: 4px solid #161616; border-radius: 26px; overflow: hidden; box-shadow: 7px 7px 0 #161616; background: #FFFDF6; }
.person svg { width: 100%; height: 100%; display: block; }
.dot { position: absolute; width: 14px; height: 14px; }
</style></head>
<body>
<div class="lockup">${seal({ mode: "lockup", size: 170 })}</div>
<p class="line">one idea at a time</p>
<div class="stamps">${stamps.map((s, i) => `<div class="stamp" style="transform: rotate(${tilt[i]}deg)">${s}</div>`).join("")}</div>
<div class="people">${people.map((p, i) => `<div class="person" style="transform: translateY(${[10, 0, 16, 4, 12, 0][i]}px) rotate(${[-4, 3, -2, 5, -5, 2][i]}deg)">${p}</div>`).join("")}</div>
<span class="dot" style="left: 64px; top: 70px; background: #18C8F0"></span>
<span class="dot" style="left: 96px; top: 118px; background: #FF1FC8; width: 10px; height: 10px"></span>
<span class="dot" style="left: 1100px; top: 84px; background: #5CF27E"></span>
<span class="dot" style="left: 1060px; top: 150px; background: #FFE11A; width: 10px; height: 10px"></span>
<span class="dot" style="left: 1130px; top: 200px; background: #161616; width: 8px; height: 8px"></span>
<span class="dot" style="left: 40px; top: 210px; background: #161616; width: 8px; height: 8px"></span>
</body></html>
`);
