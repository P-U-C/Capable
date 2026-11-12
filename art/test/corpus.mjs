// A fixed set of generator calls, shared by the determinism tests (in-process
// and in a child process) and the grammar tests. Each entry: [name, extra
// allowed colour or null, () => svg].
import { readFileSync } from "node:fs";
import { seal, iconSvg, lessonScene, portrait, stamp } from "../index.mjs";
import { CANDIES } from "../palette.mjs";

const vectors = JSON.parse(readFileSync(new URL("../../contract/fixtures/badge-vectors.json", import.meta.url), "utf8")).vectors;

export const REAL = [
  ["own-your-exit", "#18C8F0"],
  ["friend-speech", "#FF1FC8"],
  ["vote-with-your-feet", "#5CF27E"],
  ["what-lasts", "#FFE11A"],
];

export function corpus() {
  const out = [];
  for (const s of [16, 32, 48, 96, 180, 512]) {
    out.push([`seal logo ${s}`, null, () => seal({ mode: "logo", size: s })]);
    out.push([`seal favicon ${s}`, null, () => seal({ mode: "favicon", size: s })]);
    out.push([`seal lockup ${s}`, null, () => seal({ mode: "lockup", size: s })]);
  }
  out.push(["seal default", null, () => seal()]);
  const traits = ["sovereign", "civil", "mobile", "enduring"];
  for (let k = 0; k <= 4; k++) out.push([`seal filled ${k}`, null, () => seal({ mode: k % 2 ? "lockup" : "logo", size: 120, filled: traits.slice(0, k) })]);
  for (const s of [48, 180, 192, 512]) {
    out.push([`icon ${s}`, null, () => iconSvg({ size: s })]);
    out.push([`icon maskable ${s}`, null, () => iconSvg({ size: s, maskable: true })]);
  }
  for (const [id, c] of REAL) out.push([`scene ${id}`, c, () => lessonScene({ lessonId: id, color: c, title: id })]);
  for (let i = 0; i < 40; i++) {
    const c = i % 5 === 4 ? "#B48CFF" : CANDIES[i % 4];
    out.push([`scene sample-${i}`, c, () => lessonScene({ lessonId: `sample-${i}`, color: c })]);
  }
  out.push(["scene uid", CANDIES[0], () => lessonScene({ lessonId: "own-your-exit", color: CANDIES[0], uid: "tile" })]);
  out.push(["scene no grain", CANDIES[1], () => lessonScene({ lessonId: "friend-speech", color: CANDIES[1], grain: false })]);
  out.push(["scene lowercase colour", CANDIES[2], () => lessonScene({ lessonId: "lowercase", color: CANDIES[2].toLowerCase() })]);
  for (let i = 0; i < 40; i++) out.push([`portrait ${i}`, null, () => portrait({ seed: String(10000 + i * 7) })]);
  for (let i = 0; i < 4; i++) out.push([`portrait colour ${i}`, CANDIES[i], () => portrait({ seed: `0x${"ab".repeat(20)}${i}`, color: CANDIES[i] })]);
  out.push(["portrait numeric seed", null, () => portrait({ seed: 4242 })]);
  for (const [k, v] of vectors.entries()) out.push([`stamp vector ${k}`, v.input.color, () => stamp(v.input)]);
  return out;
}
