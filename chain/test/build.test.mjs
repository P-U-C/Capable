// The build: pinned compiler and settings, size under EIP-170, a complete and
// reproducible standard-JSON input (what Basescan verifies), and the app's ABI
// slice (app/src/stamps/abi.mjs) matching the compiled contract.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHAIN_DIR, codeSize, compile, compileStandardJson, loadArtifact, loadInput } from "../scripts/lib/build.mjs";
import { toEventSelector } from "viem";
import { STAMPS_ABI } from "../../app/src/stamps/abi.mjs";
import { TOPICS } from "../../app/src/stamps/index.mjs";

const artifact = loadArtifact();

test("pinned toolchain: solc 0.8.30 (solcjs), optimizer on, evm cancun; OpenZeppelin 5.6.1; Foundry 1.7.1", () => {
  assert.equal(artifact.compiler.version, "0.8.30+commit.73712a01");
  assert.deepEqual(artifact.settings.optimizer, { enabled: true, runs: 200 });
  assert.equal(artifact.settings.evmVersion, "cancun");
  const pkg = JSON.parse(readFileSync(join(CHAIN_DIR, "package.json"), "utf8"));
  for (const [dep, v] of Object.entries(pkg.devDependencies)) assert.match(v, /^\d+\.\d+\.\d+$/, `${dep} is pinned exactly`);
  assert.equal(pkg.devDependencies.solc, "0.8.30");
  assert.equal(pkg.devDependencies["@openzeppelin/contracts"], "5.6.1");
  assert.equal(pkg.devDependencies["@foundry-rs/anvil"], "1.7.1");
  assert.equal(pkg.devDependencies["@foundry-rs/cast"], "1.7.1");
  const oz = JSON.parse(readFileSync(join(CHAIN_DIR, "node_modules/@openzeppelin/contracts/package.json"), "utf8"));
  assert.equal(oz.version, "5.6.1");
});

test("runtime bytecode is under the EIP-170 limit of 24,576 bytes (one contract, no linked library)", (t) => {
  const size = codeSize(artifact.deployedBytecode);
  t.diagnostic(`runtime ${size} bytes, initcode ${codeSize(artifact.bytecode)} bytes`);
  assert.ok(size < 24_576, `${size} bytes`);
  assert.doesNotMatch(artifact.bytecode, /__\$[0-9a-f]{34}\$__/, "no unlinked library placeholders");
});

test("the standard-JSON input is complete and reproduces the bytecode exactly (what Basescan will compile)", () => {
  const input = loadInput();
  assert.ok(input.sources["src/CapableStamps.sol"] && input.sources["src/BadgeArt.sol"]);
  assert.ok(Object.keys(input.sources).some((k) => k.startsWith("@openzeppelin/contracts/token/ERC721/")), "OpenZeppelin sources inlined");
  const again = compileStandardJson(input); // no import callback: everything must be inside the input
  assert.equal(`0x${again.evm.bytecode.object}`, artifact.bytecode);
  assert.equal(`0x${again.evm.deployedBytecode.object}`, artifact.deployedBytecode);
  // and compiling from sources again gives the same bytes
  assert.equal(compile().artifact.bytecode, artifact.bytecode);
});

test("app/src/stamps/abi.mjs is a faithful slice of the compiled ABI", () => {
  const shape = (f) => JSON.stringify({ name: f.name, stateMutability: f.stateMutability, inputs: f.inputs.map((i) => i.type), outputs: f.outputs.map((o) => o.type) });
  for (const f of STAMPS_ABI) {
    const match = artifact.abi.filter((x) => x.type === "function" && x.name === f.name);
    assert.equal(match.length, 1, `${f.name} exists once`);
    assert.equal(shape(f), shape(match[0]), f.name);
  }
  assert.deepEqual(STAMPS_ABI.map((f) => f.name).sort(), ["hasStamp", "mint", "stampOf", "tokenURI", "tokensOf", "traitOf"]);
});

test("the event topics receipt() reads (app/src/stamps/index.mjs TOPICS) are the compiled contract's, all arguments indexed", () => {
  for (const [name, topic] of Object.entries(TOPICS)) {
    const ev = artifact.abi.filter((x) => x.type === "event" && x.name === name);
    assert.equal(ev.length, 1, `${name} exists once`);
    assert.equal(toEventSelector(ev[0]), topic, name);
    assert.ok(ev[0].inputs.length === 3 && ev[0].inputs.every((i) => i.indexed), `${name}: three indexed arguments, so all of it is in the topics`);
  }
  assert.deepEqual(artifact.abi.find((x) => x.type === "event" && x.name === "Stamped").inputs.map((i) => i.type), ["address", "uint8", "uint256"]);
});
