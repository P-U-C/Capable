#!/usr/bin/env node
// The owner's trait registry tool (docs/DEPLOY-STAMPS.md, "Adding a trait").
//
//   npm run trait -- list  --rpc-url https://mainnet.base.org [--address 0x…]
//   npm run trait -- add   "NEW IDEA" "#A0A0FF" 9 --rpc-url https://mainnet.base.org --ledger
//   npm run trait -- open  4 --rpc-url https://mainnet.base.org --ledger
//   npm run trait -- close 4 --rpc-url https://mainnet.base.org --ledger
//
// --address defaults to stamps.address in content/app.meta.json. A new trait starts
// closed. Names and colours are checked here with the same rules as the contract
// (and contract/badge-art.mjs) before anything is sent. The signer flags are the
// deploy script's: --ledger | --trezor | --browser | --interactive | --account <name>.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { getAddress, parseEventLogs } from "viem";
import { ROOT, loadArtifact } from "./lib/build.mjs";
import { DeployError, castSend, parseArgs, preflight } from "./lib/deploy.mjs";

const NAME = /^[A-Z][A-Z ]{0,11}$/;
const HEX = /^#[0-9A-F]{6}$/;

/** Split `trait` arguments into the command, its operands, --address, and the deploy-style options. */
export function parseTraitArgs(argv) {
  const [command, ...rest] = argv;
  const operands = [];
  const options = [];
  let address = null;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--address") address = rest[++i];
    else if (rest[i].startsWith("--")) {
      options.push(rest[i]);
      if (rest[i + 1] !== undefined && !rest[i + 1].startsWith("--") && !["--ledger", "--trezor", "--browser", "--interactive", "--unlocked", "--yes"].includes(rest[i])) options.push(rest[++i]);
    } else operands.push(rest[i]);
  }
  if (!["list", "add", "open", "close"].includes(command)) throw new DeployError("usage: trait list | add <NAME> <#RRGGBB> <emblem> | open <stampId> | close <stampId>");
  if (!address) {
    const meta = JSON.parse(readFileSync(join(ROOT, "content/app.meta.json"), "utf8"));
    address = meta.stamps?.address ?? null;
  }
  if (!address) throw new DeployError("no contract address: pass --address 0x… (or set stamps.address in content/app.meta.json)");
  try {
    address = getAddress(address);
  } catch {
    throw new DeployError(`not an address: ${address}`);
  }
  let call = null;
  if (command === "add") {
    const [name, color, emblem] = operands;
    if (!NAME.test(name ?? "")) throw new DeployError(`name must be 1–12 of A–Z and space, starting with a letter (got ${JSON.stringify(name)})`);
    if (!HEX.test(color ?? "")) throw new DeployError(`color must be #RRGGBB in capitals (got ${JSON.stringify(color)})`);
    const e = Number(emblem);
    if (!Number.isInteger(e) || e < 0 || e > 255) throw new DeployError("emblem must be 0–255 (0 key, 1 speech, 2 arrow, 3 house, other = a pixel)");
    call = { sig: "addTrait(string,string,uint8)", args: [name, color, String(e)], describe: `add trait ${name} ${color} emblem ${e} (closed until you open it)` };
  } else if (command === "open" || command === "close") {
    const id = Number(operands[0]);
    if (!Number.isInteger(id) || id < 0 || id > 255) throw new DeployError("stampId must be 0–255");
    call = { sig: "setOpen(uint8,bool)", args: [String(id), String(command === "open")], describe: `${command} trait ${id}`, stampId: id };
  }
  const opts = command === "list" ? { rpcUrl: options.includes("--rpc-url") ? options[options.indexOf("--rpc-url") + 1] : null } : parseArgs(options);
  if (!opts.rpcUrl) throw new DeployError("--rpc-url is required");
  return { command, address, call, opts };
}

export async function listTraits({ client, address, abi }) {
  const count = Number(await client.readContract({ address, abi, functionName: "traitCount" }));
  const out = [];
  for (let i = 0; i < count; i++) {
    const [name, color, emblem, open] = await client.readContract({ address, abi, functionName: "traitOf", args: [i] });
    out.push({ stampId: i, name, color, emblem, open });
  }
  return out;
}

export async function trait(argv, { log = console.log, confirm = async () => true } = {}) {
  const { command, address, call, opts } = parseTraitArgs(argv);
  const { abi } = loadArtifact();
  const signer = opts.signer ?? { kind: "read-only" };
  const { client, chainId, network } = await preflight({ rpcUrl: opts.rpcUrl, chainId: opts.chainId ?? null, signer });
  if (!(await client.getCode({ address }))) throw new DeployError(`no contract at ${address} on ${network.name}`);
  const before = await listTraits({ client, address, abi });
  if (command === "list") {
    for (const t of before) log(`${String(t.stampId).padStart(3)}  ${t.name.padEnd(12)}  ${t.color}  emblem ${String(t.emblem).padStart(3)}  ${t.open ? "open" : "closed"}`);
    return before;
  }
  if (call.stampId !== undefined && call.stampId >= before.length) throw new DeployError(`trait ${call.stampId} does not exist (there are ${before.length})`);
  log(`${network.name} (chain ${chainId}), CapableStamps at ${address}: ${call.describe}`);
  if (!(await confirm(`Send this from your wallet (it must be the contract owner)?`))) throw new DeployError("cancelled; nothing was sent");
  const receipt = await castSend({ rpcUrl: opts.rpcUrl, chainId, signer: opts.signer, passthrough: opts.passthrough, tx: [address, call.sig, ...call.args] });
  if (receipt.status !== "0x1") throw new DeployError(`transaction ${receipt.transactionHash} failed (only the owner can change traits)`);
  const events = parseEventLogs({ abi, logs: receipt.logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data })) });
  for (const e of events) log(`event       ${e.eventName} ${JSON.stringify(e.args)}`);
  const added = events.find((e) => e.eventName === "TraitAdded");
  if (added) log(`Added as stampId ${added.args.stampId}. Give that stampId, colour and emblem to the trait in content/app.meta.json, then: npm run trait -- open ${added.args.stampId} …`);
  return listTraits({ client, address, abi });
}

async function ask(question) {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const a = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(a.trim());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  try {
    await trait(argv, { confirm: argv.includes("--yes") ? async () => true : ask });
  } catch (err) {
    console.error(err instanceof DeployError ? `trait: ${err.message}` : err);
    process.exit(1);
  }
}
