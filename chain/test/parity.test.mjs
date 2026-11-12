// S2: the on-chain art is byte-identical to contract/badge-art.mjs (docs/BADGE-ART.md).
//   1. every vector in contract/fixtures/badge-vectors.json
//   2. 200 random inputs from a fixed seed, rendered by badgeSvg() and by the deployed
//      contract's render() on a local chain, compared as strings
//   3. inputs badgeSvg() refuses are refused by the contract too
// (tokenURI's JSON and image against badgeMetadata()/badgeSvg(): stamps.test.mjs.)
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { badgeSvg } from "../../contract/badge-art.mjs";
import { ROOT } from "../scripts/lib/build.mjs";
import { ALICE, assertSameString, deployStamps, localChain } from "./helpers.mjs";

const VECTORS = JSON.parse(readFileSync(`${ROOT}/contract/fixtures/badge-vectors.json`, "utf8")).vectors;
const RANDOM_COUNT = 200;
const PARITY_SEED = 0x5eed_ca9a; // fixed: the same 200 inputs on every run

let c;
let s;
test.before(async () => {
  c = await localChain();
  s = await deployStamps(c);
});
test.after(() => c?.stop());

const onChain = (i) => s.read("render", [i.seed, i.name, i.color, i.emblem, BigInt(i.serial)]);

/** mulberry32: a tiny deterministic PRNG. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 200 inputs that cover every branch: all name lengths (both font sizes), spaces, all emblems 0–4 plus pixels, edge serials. */
export function randomInputs(n = RANDOM_COUNT, seed = PARITY_SEED) {
  const r = prng(seed);
  const int = (k) => Math.floor(r() * k);
  const AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const HEX = "0123456789ABCDEF";
  const SERIALS = [0, 1, 9, 10, 99, 100, 999, 1000, 65535, 65536, 99_999_999, 100_000_000, 999_999_998, 999_999_999];
  const out = [];
  for (let k = 0; k < n; k++) {
    const len = 1 + (k % 12); // every length 1..12, repeatedly
    let name = AZ[int(26)];
    for (let j = 1; j < len; j++) name += r() < 0.2 ? " " : AZ[int(26)];
    const seedHex = "0x" + Array.from({ length: 32 }, () => int(256).toString(16).padStart(2, "0")).join("");
    out.push({
      seed: seedHex,
      name,
      color: "#" + Array.from({ length: 6 }, () => HEX[int(16)]).join(""),
      emblem: k % 3 === 0 ? int(256) : k % 5, // pixels and every drawn emblem
      serial: k % 4 === 0 ? SERIALS[int(SERIALS.length)] : int(1e9),
    });
  }
  return out;
}

async function inBatches(items, size, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += size) results.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return results;
}

test("oracle self-check: every fixture vector's svg is what badgeSvg() draws today, and its sha256", () => {
  assert.equal(VECTORS.length, 14);
  for (const v of VECTORS) {
    assert.equal(badgeSvg(v.input), v.svg, JSON.stringify(v.input));
    assert.equal(createHash("sha256").update(v.svg).digest("hex"), v.sha256);
  }
});

test("parity: every vector in contract/fixtures/badge-vectors.json is byte-identical on chain", async () => {
  const got = await inBatches(VECTORS, 7, (v) => onChain(v.input));
  VECTORS.forEach((v, i) => assertSameString(got[i], v.svg, `vector ${i} ${JSON.stringify(v.input)}`));
});

test(`parity: ${RANDOM_COUNT} random inputs (fixed seed) are byte-identical on chain`, async (t) => {
  const inputs = randomInputs();
  assert.equal(inputs.length, RANDOM_COUNT);
  // the generator really covers the branches
  assert.ok(inputs.some((i) => i.name.length <= 9) && inputs.some((i) => i.name.length > 9), "both font sizes");
  for (const e of [0, 1, 2, 3, 4]) assert.ok(inputs.some((i) => i.emblem === e), `emblem ${e}`);
  assert.ok(inputs.some((i) => i.emblem > 4), "pixel emblems above 4");
  assert.ok(inputs.some((i) => i.name.includes(" ")), "names with spaces");
  assert.ok(inputs.some((i) => i.serial === 999_999_999) && inputs.some((i) => i.serial === 0), "edge serials");
  assert.equal(new Set(inputs.map((i) => i.seed)).size, RANDOM_COUNT);

  const got = await inBatches(inputs, 25, onChain);
  let bytes = 0;
  inputs.forEach((input, i) => {
    assertSameString(got[i], badgeSvg(input), `random input ${i} ${JSON.stringify(input)}`);
    bytes += got[i].length;
  });
  t.diagnostic(`${RANDOM_COUNT} random inputs identical (${bytes} bytes compared)`);
});

test("parity of refusals: inputs badgeSvg() throws on, render() reverts on", async () => {
  const good = VECTORS[0].input;
  const cases = [
    [{ name: "" }, "InvalidName"],
    [{ name: "sovereign" }, "InvalidName"],
    [{ name: " A" }, "InvalidName"],
    [{ name: "ABCDEFGHIJKLM" }, "InvalidName"],
    [{ name: "A-B" }, "InvalidName"],
    [{ name: "A<B" }, "InvalidName"],
    [{ name: "É" }, "InvalidName"],
    [{ color: "#18c8f0" }, "InvalidColor"],
    [{ color: "18C8F0" }, "InvalidColor"],
    [{ color: "#18C8F" }, "InvalidColor"],
    [{ color: "#GGGGGG" }, "InvalidColor"],
    [{ color: "#18C8F0\"" }, "InvalidColor"],
    [{ serial: 1_000_000_000 }, "InvalidSerial"],
    [{ serial: 2 ** 53 }, "InvalidSerial"],
  ];
  for (const [patch, error] of cases) {
    const input = { ...good, ...patch };
    assert.throws(() => badgeSvg(input), undefined, JSON.stringify(patch));
    assert.deepEqual(await s.revert(ALICE, "render", [input.seed, input.name, input.color, input.emblem, BigInt(input.serial)]), { name: error, args: [] }, JSON.stringify(patch));
  }
});
