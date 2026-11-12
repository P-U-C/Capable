#!/usr/bin/env node
// Compile chain/src with the pinned solcjs (npm "solc", no native download) into
// chain/build/:
//   CapableStamps.json        abi, bytecode, deployedBytecode, compiler, settings
//   CapableStamps.input.json  the complete standard-JSON input (every source inlined),
//                             exactly what Basescan needs to verify the deployed code
// Deterministic: same sources + same solc → same bytes.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHAIN_DIR, compile } from "./lib/build.mjs";

const t0 = Date.now();
const { artifact, input } = compile();
const out = join(CHAIN_DIR, "build");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "CapableStamps.json"), JSON.stringify(artifact, null, 2) + "\n");
writeFileSync(join(out, "CapableStamps.input.json"), JSON.stringify(input) + "\n");
const size = (artifact.deployedBytecode.length - 2) / 2;
console.log(
  `compiled ${artifact.sourceName}:${artifact.contractName} with solc ${artifact.compiler.version}: ` +
    `runtime ${size} bytes (EIP-170 limit 24576), ${((Date.now() - t0) / 1000).toFixed(1)} s`,
);
