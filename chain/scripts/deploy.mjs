#!/usr/bin/env node
// The owner's deploy. Run from chain/ (see docs/DEPLOY-STAMPS.md):
//
//   npm run deploy -- --rpc-url https://sepolia.base.org --ledger            # dry run on Base Sepolia
//   npm run deploy -- --rpc-url https://mainnet.base.org --ledger --verify   # Base mainnet
//
// Signers (choose one): --ledger | --trezor | --browser | --interactive | --account <keystore name>
//   with --ledger/--trezor: optional --mnemonic-index <n> or --mnemonic-derivation-path <path>
//   with --browser:         optional --browser-port <port>
// Other options: --chain-id <8453|84532> (refuse if the RPC differs), --verify,
//   --etherscan-api-key <key> (or ETHERSCAN_API_KEY), --yes (skip the confirmation), --no-record
//
// It compiles (npm run deploy builds first), shows the network and the cost, asks,
// sends ONE creation transaction through cast with your wallet, checks the result,
// writes chain/deployments/<chainId>-<address>.json, optionally verifies the source
// on Basescan, and prints the line to paste into content/app.meta.json.
// It never reads, stores or asks for a private key or seed phrase.
import { createInterface } from "node:readline/promises";
import { loadArtifact, loadInput } from "./lib/build.mjs";
import { DeployError, deploy, parseArgs } from "./lib/deploy.mjs";

async function confirm(question) {
  if (!process.stdin.isTTY) {
    console.error("not a terminal: pass --yes to deploy without the confirmation prompt");
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

try {
  const opts = parseArgs(process.argv.slice(2));
  opts.apiKey ??= process.env.ETHERSCAN_API_KEY || null;
  await deploy(opts, { artifact: loadArtifact(), input: loadInput(), confirm: opts.yes ? async () => true : confirm });
} catch (err) {
  console.error(err instanceof DeployError ? `deploy: ${err.message}` : err);
  process.exit(1);
}
