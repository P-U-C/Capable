// Deploy CapableStamps with the owner's own signer, check it, record it, verify it.
//
// The signer is always Foundry's `cast`, driven by the owner at their own terminal:
// a Ledger or Trezor, a browser wallet, an interactive key prompt, or a Foundry
// encrypted keystore. This code never sees a key: it passes cast a flag, scrubs
// key-bearing environment variables, and reads back only the receipt.
// `--unlocked` (an anvil test account) is accepted on a localhost chain only.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, formatEther, formatGwei, getAddress, http, keccak256, parseAbi } from "viem";
import { CHAIN_DIR, ROOT, codeSize } from "./build.mjs";
import { tool } from "./foundry.mjs";

export const NETWORKS = {
  8453: { name: "Base", explorer: "https://basescan.org", rpc: "https://mainnet.base.org", local: false },
  84532: { name: "Base Sepolia", explorer: "https://sepolia.basescan.org", rpc: "https://sepolia.base.org", local: false },
  31337: { name: "local anvil", explorer: null, rpc: null, local: true },
};

/** Signer flags this script passes to cast. Anything else (a raw key, a mnemonic, a key file) is refused. */
const SIGNERS = {
  "--ledger": { kind: "ledger", label: "Ledger" },
  "--trezor": { kind: "trezor", label: "Trezor" },
  "--browser": { kind: "browser", label: "browser wallet" },
  "--interactive": { kind: "interactive", label: "interactive key prompt (typed into cast, never stored)" },
  "--account": { kind: "account", label: "Foundry encrypted keystore (password prompt)", value: true },
  "--unlocked": { kind: "unlocked", label: "unlocked anvil test account (local chain only)" },
};
const PASSTHROUGH = { "--mnemonic-derivation-path": ["ledger", "trezor"], "--mnemonic-index": ["ledger", "trezor"], "--browser-port": ["browser"] };
const REFUSED = new Set(["--private-key", "--private-keys", "--mnemonic", "--mnemonics", "--mnemonic-passphrase", "--keystore", "--password", "--password-file", "--aws", "--gcp", "--turnkey"]);
/** Environment variables cast would read a key, keystore or password from. Removed before cast runs. */
export const SCRUBBED_ENV = ["ETH_PRIVATE_KEY", "PRIVATE_KEY", "ETH_MNEMONIC", "MNEMONIC", "ETH_KEYSTORE", "ETH_KEYSTORE_ACCOUNT", "ETH_PASSWORD", "ETH_FROM"];

export class DeployError extends Error {}

/** Parse `npm run deploy -- …` arguments. Throws DeployError on anything unsafe or unclear. */
export function parseArgs(argv) {
  const o = { rpcUrl: null, chainId: null, signer: null, passthrough: [], verify: false, apiKey: null, yes: false, out: join(CHAIN_DIR, "deployments") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new DeployError(`${a} needs a value`);
      return v;
    };
    if (REFUSED.has(a.split("=")[0]) || a === "-i") {
      if (a === "-i") throw new DeployError("use --interactive (spelled out)");
      throw new DeployError(`${a} is refused: never put a key, mnemonic or key file on the command line or in a file. Use --ledger, --trezor, --browser, --interactive or --account <name>.`);
    } else if (a === "--rpc-url") o.rpcUrl = next();
    else if (a === "--chain-id") o.chainId = Number(next());
    else if (a === "--verify") o.verify = true;
    else if (a === "--etherscan-api-key") o.apiKey = next();
    else if (a === "--yes") o.yes = true;
    else if (a === "--out") o.out = next();
    else if (a === "--no-record") o.out = null;
    else if (a === "--from") {
      if (o.signer?.kind !== "unlocked") throw new DeployError("--from goes with --unlocked (local chain only); hardware and browser wallets choose the account themselves");
      o.signer.from = getAddressOr(next());
    } else if (SIGNERS[a]) {
      if (o.signer) throw new DeployError(`choose one signer (got ${o.signer.flag} and ${a})`);
      o.signer = { ...SIGNERS[a], flag: a };
      if (SIGNERS[a].value) o.signer.account = next();
    } else if (PASSTHROUGH[a]) {
      o.passthrough.push([a, next()]);
    } else throw new DeployError(`unknown argument ${a}`);
  }
  if (!o.rpcUrl) throw new DeployError("--rpc-url is required (Base: https://mainnet.base.org, Base Sepolia: https://sepolia.base.org)");
  if (!o.signer) throw new DeployError("choose a signer: --ledger, --trezor, --browser, --interactive or --account <name>");
  if (o.signer.kind === "unlocked" && !o.signer.from) throw new DeployError("--unlocked needs --from <anvil account>");
  for (const [flag] of o.passthrough) {
    if (!PASSTHROUGH[flag].includes(o.signer.kind)) throw new DeployError(`${flag} only goes with ${PASSTHROUGH[flag].map((k) => `--${k}`).join(" or ")}`);
  }
  if (o.chainId !== null && !NETWORKS[o.chainId]) throw new DeployError(`--chain-id ${o.chainId} is not one of ${Object.keys(NETWORKS).join(", ")}`);
  return o;
}

function getAddressOr(v) {
  try {
    return getAddress(v);
  } catch {
    throw new DeployError(`not an address: ${v}`);
  }
}

const isLocalUrl = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
};

/** cast's arguments for the chosen signer. Exported for tests. */
export function signerArgs(signer, passthrough = []) {
  const args = { ledger: ["--ledger"], trezor: ["--trezor"], browser: ["--browser"], interactive: ["--interactive"], account: ["--account", signer.account], unlocked: ["--unlocked", "--from", signer.from] }[signer.kind];
  if (!args) throw new DeployError(`unknown signer ${signer.kind}`);
  return [...args, ...passthrough.flat()];
}

export function scrubbedEnv(env = process.env) {
  const out = { ...env };
  for (const k of SCRUBBED_ENV) delete out[k];
  return out;
}

/** Which network the RPC serves, and whether this signer may use it. */
export async function preflight({ rpcUrl, chainId: expected, signer }) {
  const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 1, timeout: 20_000 }) });
  let chainId;
  try {
    chainId = await client.getChainId();
  } catch (err) {
    throw new DeployError(`cannot reach ${rpcUrl}: ${err.shortMessage || err.message}`);
  }
  const network = NETWORKS[chainId];
  if (!network) throw new DeployError(`RPC is chain ${chainId}; this script deploys to ${Object.entries(NETWORKS).map(([id, n]) => `${n.name} (${id})`).join(", ")}`);
  if (expected !== null && expected !== undefined && expected !== chainId) throw new DeployError(`--chain-id ${expected} but the RPC is chain ${chainId} (${network.name})`);
  const local = isLocalUrl(rpcUrl);
  if (network.local !== local) throw new DeployError(network.local ? `chain ${chainId} is only accepted on a localhost RPC` : `${network.name} must be reached over https, not ${rpcUrl}`);
  if (signer.kind === "unlocked" && !local) throw new DeployError("--unlocked is for a local anvil only; on Base use --ledger, --trezor, --browser, --interactive or --account");
  return { client, chainId, network };
}

const ESTIMATE_FROM = "0x000000000000000000000000000000000000dEaD";
const ORACLE = "0x420000000000000000000000000000000000000F"; // OP Stack GasPriceOracle predeploy (Base)
const ORACLE_ABI = parseAbi(["function getL1FeeUpperBound(uint256 unsignedTxSize) view returns (uint256)"]);

/** What deploying will cost: L2 execution (estimateGas × gasPrice) plus, on Base, the L1 data fee upper bound. */
export async function estimate({ client, bytecode }) {
  let gas, gasPrice;
  try {
    // The constructor makes msg.sender the owner, and refuses address(0): estimate from a placeholder sender.
    [gas, gasPrice] = await Promise.all([client.estimateGas({ account: ESTIMATE_FROM, data: bytecode }), client.getGasPrice()]);
  } catch (err) {
    throw new DeployError(`cannot estimate the deploy: ${err.shortMessage || String(err.message).split("\n")[0]}`);
  }
  let l1Fee = null;
  try {
    l1Fee = await client.readContract({ address: ORACLE, abi: ORACLE_ABI, functionName: "getL1FeeUpperBound", args: [BigInt(codeSize(bytecode) + 120)] });
  } catch {
    l1Fee = null; // not an OP Stack chain (a local anvil), or the oracle is unavailable
  }
  const l2Fee = gas * gasPrice;
  return { gas, gasPrice, l2Fee, l1Fee, total: l2Fee + (l1Fee ?? 0n) };
}

export const describeEstimate = (e) =>
  `gas ${e.gas} × ${formatGwei(e.gasPrice)} gwei = ${formatEther(e.l2Fee)} ETH` +
  (e.l1Fee === null ? " (no L1 data fee on this chain)" : ` + L1 data fee ≤ ${formatEther(e.l1Fee)} ETH ≈ ${formatEther(e.total)} ETH total`);

/**
 * Send one transaction with cast and the owner's signer. stdin and stderr stay attached
 * to the owner's terminal (hardware-wallet confirmation, browser link, prompts); stdout
 * carries the receipt as JSON. `tx` is cast's tail: ["--create", bytecode] or [to, sig, ...args].
 */
export function castSend({ rpcUrl, chainId, signer, passthrough = [], tx, spawnImpl = spawn }) {
  const args = ["send", "--rpc-url", rpcUrl, "--chain", String(chainId), ...signerArgs(signer, passthrough), "--json", ...tx];
  return new Promise((resolve, reject) => {
    const child = spawnImpl(tool("cast"), args, { stdio: ["inherit", "pipe", "inherit"], env: scrubbedEnv() });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new DeployError(`cast exited with ${code}: check your wallet and the explorer before retrying`));
      const receipt = parseReceipt(out);
      if (!receipt) return reject(new DeployError(`cast did not print a receipt:\n${out.slice(0, 2000)}`));
      resolve(receipt);
    });
  });
}

export const castDeploy = ({ bytecode, ...rest }) => castSend({ ...rest, tx: ["--create", bytecode] });

export function parseReceipt(stdout) {
  for (const line of stdout.trim().split("\n").reverse()) {
    try {
      const j = JSON.parse(line);
      if (j && typeof j === "object" && "transactionHash" in j && "status" in j) return j;
    } catch {
      /* not JSON */
    }
  }
  return null;
}

/** The founding traits the app expects (content/app.meta.json), as the contract stores them. */
export function expectedTraits() {
  const meta = JSON.parse(readFileSync(join(ROOT, "content/app.meta.json"), "utf8"));
  return meta.traits
    .filter((t) => Number.isInteger(t.stampId))
    .sort((a, b) => a.stampId - b.stampId)
    .map((t) => ({ stampId: t.stampId, name: t.name.toUpperCase(), color: t.color, emblem: t.emblem }));
}

/** After deploy: the code on chain is exactly the artifact, the owner is the deployer, the traits match the app. */
export async function checkDeployment({ client, address, artifact, owner }) {
  const problems = [];
  const code = await client.getCode({ address });
  if (code?.toLowerCase() !== artifact.deployedBytecode.toLowerCase()) problems.push("runtime code differs from chain/build/CapableStamps.json");
  const read = (functionName, args = []) => client.readContract({ address, abi: artifact.abi, functionName, args });
  const actualOwner = await read("owner");
  if (getAddress(actualOwner) !== getAddress(owner)) problems.push(`owner() is ${actualOwner}, expected ${owner}`);
  const count = Number(await read("traitCount"));
  const want = expectedTraits();
  if (count !== want.length) problems.push(`traitCount() is ${count}, app.meta.json has ${want.length}`);
  for (const t of want) {
    const [name, color, emblem, open] = await read("traitOf", [t.stampId]);
    if (name !== t.name || color !== t.color || emblem !== t.emblem || open !== true) problems.push(`trait ${t.stampId} is ${name} ${color} ${emblem} open=${open}, app expects ${t.name} ${t.color} ${t.emblem} open`);
  }
  return problems;
}

/** The whole flow, minus the confirmation prompt (the CLI asks; tests pass yes). */
export async function deploy(opts, { artifact, input, log = console.log, confirm = async () => true, fetchImpl = globalThis.fetch, sleep } = {}) {
  const { client, chainId, network } = await preflight(opts);
  const size = codeSize(artifact.deployedBytecode);
  log(`network     ${network.name} (chain ${chainId}) via ${opts.rpcUrl}`);
  log(`contract    ${artifact.sourceName}:${artifact.contractName}, solc ${artifact.compiler.version}, runtime ${size} bytes, code hash ${keccak256(artifact.deployedBytecode)}`);
  log(`signer      ${opts.signer.label}${opts.signer.from ? ` ${opts.signer.from}` : ""}`);
  const est = await estimate({ client, bytecode: artifact.bytecode });
  log(`estimate    ${describeEstimate(est)}`);
  if (!(await confirm(`Deploy CapableStamps to ${network.name} (chain ${chainId}) from your wallet?`))) throw new DeployError("cancelled; nothing was sent");

  const receipt = await castDeploy({ rpcUrl: opts.rpcUrl, chainId, bytecode: artifact.bytecode, signer: opts.signer, passthrough: opts.passthrough });
  if (receipt.status !== "0x1" || !receipt.contractAddress) throw new DeployError(`deploy transaction ${receipt.transactionHash} failed (status ${receipt.status})`);
  const address = getAddress(receipt.contractAddress);
  const deployer = getAddress(receipt.from);
  log(`deployed    ${address} in tx ${receipt.transactionHash} (gas ${BigInt(receipt.gasUsed)}) by ${deployer}`);

  const problems = await checkDeployment({ client, address, artifact, owner: deployer });
  if (problems.length) throw new DeployError(`deployed at ${address}, but the checks failed:\n  ${problems.join("\n  ")}`);
  log("checked     code = artifact, owner = deployer, 4 founding traits open and equal to content/app.meta.json");

  const record = {
    chainId,
    network: network.name,
    address,
    transactionHash: receipt.transactionHash,
    blockNumber: Number(BigInt(receipt.blockNumber)),
    deployer,
    gasUsed: Number(BigInt(receipt.gasUsed)),
    compiler: artifact.compiler.version,
    settings: { optimizer: artifact.settings.optimizer, evmVersion: artifact.settings.evmVersion },
    runtimeBytes: size,
    codeHash: keccak256(artifact.deployedBytecode),
  };
  if (opts.out) {
    mkdirSync(opts.out, { recursive: true });
    const file = join(opts.out, `${chainId}-${address.toLowerCase()}.json`);
    writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
    log(`recorded    ${file}`);
  }

  if (opts.verify && !network.local) {
    if (!opts.apiKey) log("verify      skipped: no API key (pass --etherscan-api-key or set ETHERSCAN_API_KEY). See docs/DEPLOY-STAMPS.md to verify later.");
    else {
      const v = await verifySource({ chainId, address, input, artifact, apiKey: opts.apiKey, fetchImpl, log, sleep });
      log(`verify      ${v.ok ? "verified" : `not verified: ${v.message}`}`);
      record.verified = v.ok;
    }
  }
  if (network.explorer) log(`explorer    ${network.explorer}/address/${address}`);
  log("");
  if (network.local) log(`(local rehearsal: ${address} exists only on this anvil; it never goes in content/app.meta.json)`);
  else log(`Now set content/app.meta.json → "stamps": { "chainId": ${chainId}, "address": "${address}" }`);
  return { ...record, receipt };
}

// ─────────────────────────── source verification (Basescan via the Etherscan v2 API) ───────────────────────────

export const ETHERSCAN_API = "https://api.etherscan.io/v2/api";

/** The form fields for verifysourcecode. Exported so tests can check exactly what would be sent. */
export function verifyForm({ address, input, artifact, apiKey }) {
  return new URLSearchParams({
    apikey: apiKey,
    module: "contract",
    action: "verifysourcecode",
    contractaddress: address,
    sourceCode: JSON.stringify(input),
    codeformat: "solidity-standard-json-input",
    contractname: `${artifact.sourceName}:${artifact.contractName}`,
    compilerversion: `v${artifact.compiler.version}`,
    constructorArguements: "", // (sic) the API's spelling; the constructor takes no arguments
  });
}

/**
 * Submit the exact standard-JSON input that produced the deployed code, then poll.
 * Resolves { ok, message }; never throws for an API refusal (the deploy already succeeded).
 */
export async function verifySource({ chainId, address, input, artifact, apiKey, fetchImpl = globalThis.fetch, log = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), attempts = 6, polls = 30 }) {
  const url = `${ETHERSCAN_API}?chainid=${chainId}`;
  let guid = null;
  for (let i = 0; i < attempts && !guid; i++) {
    const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: verifyForm({ address, input, artifact, apiKey }).toString() });
    const j = await res.json().catch(() => ({}));
    if (j.status === "1" && typeof j.result === "string") guid = j.result;
    else if (/already verified/i.test(String(j.result))) return { ok: true, message: "already verified" };
    else if (/unable to locate contractcode|not yet indexed|does not have bytecode/i.test(String(j.result))) {
      log(`verify      explorer has not indexed ${address} yet; retrying in 10 s`);
      await sleep(10_000);
    } else return { ok: false, message: String(j.result ?? j.message ?? `HTTP ${res.status}`) };
  }
  if (!guid) return { ok: false, message: "the explorer never indexed the contract; run `npm run verify` later" };
  for (let i = 0; i < polls; i++) {
    await sleep(5_000);
    const q = new URLSearchParams({ chainid: String(chainId), module: "contract", action: "checkverifystatus", guid, apikey: apiKey });
    const res = await fetchImpl(`${ETHERSCAN_API}?${q}`);
    const j = await res.json().catch(() => ({}));
    const r = String(j.result ?? "");
    if (/pass - verified|already verified/i.test(r)) return { ok: true, message: r };
    if (/pending|queue/i.test(r)) continue;
    return { ok: false, message: r || `HTTP ${res.status}` };
  }
  return { ok: false, message: "still pending after polling; check the explorer" };
}
