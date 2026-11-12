#!/usr/bin/env node
// Verify an already deployed CapableStamps on Basescan (Etherscan v2 API), e.g. when
// the explorer was slow during `npm run deploy`:
//
//   npm run verify -- --chain-id 8453 --address 0x… [--etherscan-api-key <key>]
//
// Submits chain/build/CapableStamps.input.json: the exact standard-JSON input that
// produced the bytecode. The API key (from basescan.org or etherscan.io) is not a
// signing key; it can also come from ETHERSCAN_API_KEY. No wallet is involved.
import { getAddress } from "viem";
import { loadArtifact, loadInput } from "./lib/build.mjs";
import { NETWORKS, verifySource } from "./lib/deploy.mjs";

const argv = process.argv.slice(2);
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const chainId = Number(opt("--chain-id"));
const apiKey = opt("--etherscan-api-key") || process.env.ETHERSCAN_API_KEY;
let address;
try {
  address = getAddress(opt("--address") || "");
} catch {
  console.error("verify: --address 0x… is required");
  process.exit(1);
}
if (!NETWORKS[chainId] || NETWORKS[chainId].local) {
  console.error("verify: --chain-id must be 8453 (Base) or 84532 (Base Sepolia)");
  process.exit(1);
}
if (!apiKey) {
  console.error("verify: pass --etherscan-api-key <key> or set ETHERSCAN_API_KEY");
  process.exit(1);
}
const r = await verifySource({ chainId, address, input: loadInput(), artifact: loadArtifact(), apiKey, log: console.log });
console.log(r.ok ? `verified: ${NETWORKS[chainId].explorer}/address/${address}#code` : `not verified: ${r.message}`);
process.exit(r.ok ? 0 : 1);
