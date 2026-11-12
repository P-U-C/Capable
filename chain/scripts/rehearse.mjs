#!/usr/bin/env node
// Local rehearsal of the owner's deploy, for agents and reviewers. No real keys, no
// public network: a throwaway anvil on localhost and its well-known test accounts.
//
//   npm run rehearse                 # deploy + mint + read tokenURI, write fixtures/rehearsal.json
//   npm run rehearse -- --out <file> # write the fixture elsewhere (the chain test compares it)
//
// 1. starts anvil, 2. deploys through the same code path as `npm run deploy` (cast
// send --create; signer --unlocked instead of the owner's wallet), 3. mints three
// stamps with cast, 4. reads tokensOf / stampOf / seedOf / locked / tokenURI,
// 5. checks the decoded tokenURI against contract/badge-art.mjs, 6. writes the
// fixture app/test/stamps.test.mjs uses, 7. stops anvil.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, encodeFunctionData, encodePacked, getAddress, http, keccak256 } from "viem";
import { badgeMetadata, badgeSvg } from "../../contract/badge-art.mjs";
import { CHAIN_DIR, loadArtifact, loadInput } from "./lib/build.mjs";
import { deploy, expectedTraits, parseReceipt, scrubbedEnv } from "./lib/deploy.mjs";
import { ANVIL_ACCOUNTS, startAnvil, tool } from "./lib/foundry.mjs";

export const FIXTURE = join(CHAIN_DIR, "fixtures/rehearsal.json");

/** Who mints what in the rehearsal: [anvil account index, stampId]. */
const MINTS = [
  [1, 0],
  [1, 2],
  [2, 3],
];

function castUnlocked(url, from, to, sig, ...args) {
  const r = spawnSync(tool("cast"), ["send", "--rpc-url", url, "--unlocked", "--from", from, "--json", to, sig, ...args.map(String)], { encoding: "utf8", env: scrubbedEnv() });
  if (r.status !== 0) throw new Error(`cast send ${sig} failed:\n${r.stderr}`);
  return parseReceiptLoose(r.stdout);
}
const parseReceiptLoose = (stdout) => parseReceipt(stdout) ?? JSON.parse(stdout.trim().split("\n").pop());

export async function rehearse({ out = FIXTURE, log = console.log } = {}) {
  const artifact = loadArtifact();
  const anvil = await startAnvil();
  try {
    log(`anvil       ${anvil.url} (chain ${anvil.chainId})`);
    const dep = await deploy(
      { rpcUrl: anvil.url, chainId: anvil.chainId, signer: { kind: "unlocked", label: "unlocked anvil test account", from: ANVIL_ACCOUNTS[0] }, passthrough: [], verify: false, out: null },
      { artifact, input: loadInput(), log },
    );
    const address = dep.address;
    const client = createPublicClient({ transport: http(anvil.url) });
    const read = (functionName, args = []) => client.readContract({ address, abi: artifact.abi, functionName, args });
    const traits = new Map(expectedTraits().map((t) => [t.stampId, t]));

    const gas = { deploy: dep.gasUsed, mint: [], tokenURI: [] };
    const stamps = [];
    for (const [who, stampId] of MINTS) {
      const holder = ANVIL_ACCOUNTS[who];
      const receipt = castUnlocked(anvil.url, holder, address, "mint(uint8)", stampId);
      if (receipt.status !== "0x1") throw new Error(`mint(${stampId}) by ${holder} failed`);
      gas.mint.push(Number(BigInt(receipt.gasUsed)));
      const tokenId = stamps.length + 1;
      const seed = await read("seedOf", [BigInt(tokenId)]);
      const want = keccak256(encodePacked(["address", "uint8", "uint256"], [holder, stampId, BigInt(tokenId)]));
      if (seed !== want) throw new Error(`seedOf(${tokenId}) ${seed} ≠ keccak256(holder, stampId, tokenId) ${want}`);
      if ((await read("stampOf", [BigInt(tokenId)])) !== stampId) throw new Error(`stampOf(${tokenId}) ≠ ${stampId}`);
      if ((await read("locked", [BigInt(tokenId)])) !== true) throw new Error(`locked(${tokenId}) ≠ true`);
      const tokenURI = await read("tokenURI", [BigInt(tokenId)]);
      gas.tokenURI.push(Number(await client.estimateGas({ to: address, data: encodeFunctionData({ abi: artifact.abi, functionName: "tokenURI", args: [BigInt(tokenId)] }) })));

      const t = traits.get(stampId);
      const prefix = "data:application/json;base64,";
      if (!tokenURI.startsWith(prefix)) throw new Error("tokenURI is not a base64 JSON data URI");
      const json = Buffer.from(tokenURI.slice(prefix.length), "base64").toString("utf8");
      const svg = badgeSvg({ seed, name: t.name, color: t.color, emblem: t.emblem, serial: tokenId });
      const expected = badgeMetadata({ name: t.name, serial: tokenId, svgBase64: Buffer.from(svg).toString("base64") });
      if (json !== expected) throw new Error(`tokenURI(${tokenId}) metadata differs from badge-art.mjs`);
      const image = Buffer.from(JSON.parse(json).image.replace("data:image/svg+xml;base64,", ""), "base64").toString("utf8");
      if (image !== svg) throw new Error(`tokenURI(${tokenId}) image differs from badgeSvg()`);
      stamps.push({ holder, stampId, tokenId, seed, trait: { stampId, name: t.name, color: t.color, emblem: t.emblem, open: true }, mintData: encodeFunctionData({ abi: artifact.abi, functionName: "mint", args: [stampId] }), tokenURI, svg });
      log(`minted      #${tokenId} ${t.name} for ${holder}: gas ${gas.mint.at(-1)}, tokenURI = badge-art.mjs ✓ (eth_call gas ${gas.tokenURI.at(-1)})`);
    }

    // Raw eth_call answers for the app's read path (tokensOf, stampOf), replayed by app/test/stamps.test.mjs.
    const calls = [];
    const record = async (functionName, args) => {
      const data = encodeFunctionData({ abi: artifact.abi, functionName, args });
      const { data: result } = await client.call({ to: address, data });
      calls.push({ functionName, args: args.map(String), data, result });
    };
    for (const h of [...new Set(MINTS.map(([w]) => ANVIL_ACCOUNTS[w]))]) await record("tokensOf", [h]);
    await record("tokensOf", [ANVIL_ACCOUNTS[4]]); // holds nothing
    for (const s of stamps) await record("stampOf", [BigInt(s.tokenId)]);

    const fixture = {
      note: "Generated by `cd chain && npm run rehearse` on a local anvil (chain 31337, well-known test accounts). The chain test regenerates it and compares; app/test/stamps.test.mjs checks preview() against each svg, mint() against mintData, and owned() against the recorded eth_call answers.",
      chainId: anvil.chainId,
      contract: getAddress(address),
      stamps,
      calls,
    };
    writeFileSync(out, JSON.stringify(fixture, null, 1) + "\n");
    log(`gas         deploy ${gas.deploy}; mint ${gas.mint.join(", ")}; tokenURI (eth_call) ${gas.tokenURI.join(", ")}`);
    log(`fixture     ${out}`);
    log("REHEARSAL OK: deployed, minted, tokenURI equals contract/badge-art.mjs; anvil stopped.");
    return { fixture, gas };
  } finally {
    await anvil.stop();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  try {
    await rehearse({ out: argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : FIXTURE });
  } catch (err) {
    console.error(`REHEARSAL FAILED: ${err.stack || err.message}`);
    process.exit(1);
  }
}
