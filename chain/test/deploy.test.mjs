// S4: the owner's deploy script refuses anything unsafe, runs the real cast path on a
// local chain, checks and records the result, and builds the Basescan verification
// request correctly (mocked: tests never touch the network). The rehearsal runs end
// to end and reproduces the committed fixture.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadArtifact, loadInput } from "../scripts/lib/build.mjs";
import { DeployError, SCRUBBED_ENV, deploy, parseArgs, parseReceipt, preflight, scrubbedEnv, signerArgs, verifyForm, verifySource } from "../scripts/lib/deploy.mjs";
import { ANVIL_ACCOUNTS, startAnvil } from "../scripts/lib/foundry.mjs";
import { FIXTURE, rehearse } from "../scripts/rehearse.mjs";
import { parseTraitArgs, trait } from "../scripts/trait.mjs";

const artifact = loadArtifact();
const input = loadInput();
const tmp = mkdtempSync(join(tmpdir(), "capable-chain-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const refuses = (argv, pattern) => assert.throws(() => parseArgs(argv), (e) => e instanceof DeployError && pattern.test(e.message), argv.join(" "));

test("arguments: a private key, mnemonic, key file or password on the command line is refused", () => {
  const base = ["--rpc-url", "https://mainnet.base.org"];
  for (const flag of ["--private-key", "--mnemonic", "--keystore", "--password", "--password-file", "--mnemonics", "--mnemonic-passphrase"]) {
    refuses([...base, "--ledger", flag, "x"], /refused/);
    refuses([...base, `${flag}=x`, "--ledger"], /refused/);
  }
  refuses([...base, "-i"], /--interactive/);
  refuses(base, /choose a signer/);
  refuses(["--ledger"], /--rpc-url is required/);
  refuses([...base, "--ledger", "--browser"], /choose one signer/);
  refuses([...base, "--ledger", "--from", ANVIL_ACCOUNTS[0]], /--from goes with --unlocked/);
  refuses([...base, "--unlocked"], /needs --from/);
  refuses([...base, "--browser", "--mnemonic-index", "1"], /only goes with --ledger or --trezor/);
  refuses([...base, "--ledger", "--chain-id", "1"], /not one of/);
  refuses([...base, "--ledger", "--surprise"], /unknown argument/);
  refuses([...base, "--account"], /needs a value/);
});

test("arguments: each wallet maps to exactly one cast signer flag", () => {
  const base = ["--rpc-url", "https://mainnet.base.org"];
  const flags = (argv) => {
    const o = parseArgs([...base, ...argv]);
    return signerArgs(o.signer, o.passthrough);
  };
  assert.deepEqual(flags(["--ledger"]), ["--ledger"]);
  assert.deepEqual(flags(["--ledger", "--mnemonic-index", "2"]), ["--ledger", "--mnemonic-index", "2"]);
  assert.deepEqual(flags(["--trezor"]), ["--trezor"]);
  assert.deepEqual(flags(["--browser", "--browser-port", "9545"]), ["--browser", "--browser-port", "9545"]);
  assert.deepEqual(flags(["--interactive"]), ["--interactive"]);
  assert.deepEqual(flags(["--account", "capable-owner"]), ["--account", "capable-owner"]);
  assert.deepEqual(flags(["--unlocked", "--from", ANVIL_ACCOUNTS[0].toLowerCase()]), ["--unlocked", "--from", ANVIL_ACCOUNTS[0]]);
  const o = parseArgs([...base, "--ledger", "--chain-id", "8453", "--verify", "--etherscan-api-key", "k", "--yes", "--no-record"]);
  assert.equal(o.chainId, 8453);
  assert.equal(o.verify, true);
  assert.equal(o.apiKey, "k");
  assert.equal(o.yes, true);
  assert.equal(o.out, null);
});

test("cast never inherits a key, mnemonic, keystore or password from the environment", () => {
  const env = Object.fromEntries(SCRUBBED_ENV.map((k) => [k, "not-a-real-secret"]));
  const out = scrubbedEnv({ ...env, PATH: "/bin", ETHERSCAN_API_KEY: "kept" });
  for (const k of SCRUBBED_ENV) assert.ok(!(k in out), k);
  assert.equal(out.PATH, "/bin");
  assert.deepEqual(SCRUBBED_ENV.filter((k) => /KEY|MNEMONIC|PASSWORD|KEYSTORE/.test(k)).length >= 6, true);
});

test("preflight: Base only over https, the local chain only on localhost, --unlocked only locally, unknown chains refused", async () => {
  const ledger = parseArgs(["--rpc-url", "http://127.0.0.1:1", "--ledger"]).signer;
  const unlocked = { kind: "unlocked", from: ANVIL_ACCOUNTS[0] };
  const asBase = await startAnvil({ chainId: 8453 });
  const asMainnet = await startAnvil({ chainId: 1 });
  const local = await startAnvil();
  try {
    await assert.rejects(preflight({ rpcUrl: asBase.url, signer: ledger }), /Base must be reached over https/);
    await assert.rejects(preflight({ rpcUrl: asMainnet.url, signer: ledger }), /RPC is chain 1/);
    await assert.rejects(preflight({ rpcUrl: local.url, chainId: 8453, signer: unlocked }), /--chain-id 8453 but the RPC is chain 31337/);
    await assert.rejects(preflight({ rpcUrl: local.url.replace("127.0.0.1", "127.0.0.2"), signer: unlocked }), /only accepted on a localhost RPC|cannot reach/);
    const ok = await preflight({ rpcUrl: local.url, chainId: 31337, signer: unlocked });
    assert.equal(ok.chainId, 31337);
    await assert.rejects(preflight({ rpcUrl: "http://127.0.0.1:9", signer: ledger }), /cannot reach/);
  } finally {
    await Promise.all([asBase.stop(), asMainnet.stop(), local.stop()]);
  }
});

test("deploy: the owner's path (cast send --create) on a local chain; code, owner and traits checked; record written", async () => {
  const anvil = await startAnvil();
  const lines = [];
  let asked = null;
  try {
    const out = join(tmp, "deployments");
    const r = await deploy(
      { rpcUrl: anvil.url, chainId: null, signer: { kind: "unlocked", label: "anvil", from: ANVIL_ACCOUNTS[3] }, passthrough: [], verify: true, apiKey: "unused-on-local", out },
      { artifact, input, log: (l) => lines.push(l), confirm: async (q) => ((asked = q), true), fetchImpl: () => assert.fail("no network on a local chain") },
    );
    assert.match(asked, /Deploy CapableStamps to local anvil \(chain 31337\)/);
    assert.equal(r.deployer, ANVIL_ACCOUNTS[3]);
    const files = readdirSync(out);
    assert.deepEqual(files, [`31337-${r.address.toLowerCase()}.json`]);
    const rec = JSON.parse(readFileSync(join(out, files[0]), "utf8"));
    assert.equal(rec.address, r.address);
    assert.equal(rec.compiler, "0.8.30+commit.73712a01");
    assert.equal(rec.runtimeBytes, (artifact.deployedBytecode.length - 2) / 2);
    assert.ok(lines.some((l) => /^estimate +gas \d+/.test(l)));
    assert.ok(lines.some((l) => /^checked +code = artifact, owner = deployer/.test(l)));
    assert.ok(lines.some((l) => /never goes in content\/app\.meta\.json/.test(l)), "a local address is never offered for app.meta.json");
    // cancelled at the prompt: nothing is sent
    const before = await (await fetch(anvil.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) })).json();
    await assert.rejects(
      deploy({ rpcUrl: anvil.url, chainId: null, signer: { kind: "unlocked", label: "anvil", from: ANVIL_ACCOUNTS[3] }, passthrough: [], out: null }, { artifact, input, log: () => {}, confirm: async () => false }),
      /cancelled; nothing was sent/,
    );
    const after = await (await fetch(anvil.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) })).json();
    assert.equal(after.result, before.result);
  } finally {
    await anvil.stop();
  }
});

test("parseReceipt finds cast's JSON receipt among other output", () => {
  assert.equal(parseReceipt('Opening browser…\n{"status":"0x1","contractAddress":"0xabc","transactionHash":"0x1"}\n').contractAddress, "0xabc");
  assert.equal(parseReceipt("no receipt here"), null);
});

test("Basescan verification: the exact standard-JSON input, compiler and contract name; polls to verified", async () => {
  const form = verifyForm({ address: "0x5FbDB2315678afecb367f032d93F642f64180aa3", input, artifact, apiKey: "KEY" });
  assert.equal(form.get("module"), "contract");
  assert.equal(form.get("action"), "verifysourcecode");
  assert.equal(form.get("codeformat"), "solidity-standard-json-input");
  assert.equal(form.get("contractname"), "src/CapableStamps.sol:CapableStamps");
  assert.equal(form.get("compilerversion"), "v0.8.30+commit.73712a01");
  assert.equal(form.get("constructorArguements"), "");
  assert.deepEqual(JSON.parse(form.get("sourceCode")), input);

  const calls = [];
  const answers = [{ status: "0", result: "Unable to locate ContractCode at 0x5f…" }, { status: "1", result: "guid-1" }, { status: "0", result: "Pending in queue" }, { status: "1", result: "Pass - Verified" }];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body });
    return { status: 200, json: async () => answers.shift() };
  };
  const r = await verifySource({ chainId: 8453, address: "0x5FbDB2315678afecb367f032d93F642f64180aa3", input, artifact, apiKey: "KEY", fetchImpl, sleep: async () => {} });
  assert.deepEqual(r, { ok: true, message: "Pass - Verified" });
  assert.equal(calls[0].url, "https://api.etherscan.io/v2/api?chainid=8453");
  assert.equal(calls[0].method, "POST");
  assert.match(calls[2].url, /chainid=8453&module=contract&action=checkverifystatus&guid=guid-1&apikey=KEY/);

  const already = await verifySource({ chainId: 84532, address: "0x5FbDB2315678afecb367f032d93F642f64180aa3", input, artifact, apiKey: "KEY", fetchImpl: async () => ({ json: async () => ({ status: "0", result: "Contract source code already verified" }) }), sleep: async () => {} });
  assert.equal(already.ok, true);
  const refused = await verifySource({ chainId: 8453, address: "0x5FbDB2315678afecb367f032d93F642f64180aa3", input, artifact, apiKey: "BAD", fetchImpl: async () => ({ status: 200, json: async () => ({ status: "0", result: "Invalid API Key" }) }), sleep: async () => {} });
  assert.deepEqual(refused, { ok: false, message: "Invalid API Key" });
});

test("rehearsal: anvil → deploy (cast) → mint ×3 → tokenURI = badge-art.mjs → anvil stopped; reproduces chain/fixtures/rehearsal.json", async () => {
  const out = join(tmp, "rehearsal.json");
  const { gas } = await rehearse({ out, log: () => {} });
  assert.equal(readFileSync(out, "utf8"), readFileSync(FIXTURE, "utf8"), "fixture is current: run `npm run rehearse` in chain/ and commit it");
  assert.equal(gas.mint.length, 3);
  const f = JSON.parse(readFileSync(FIXTURE, "utf8"));
  assert.equal(f.stamps.length, 3);
  assert.deepEqual(f.calls.map((c) => c.functionName), ["tokensOf", "tokensOf", "tokensOf", "stampOf", "stampOf", "stampOf"]);
});

test("trait tool: the owner adds a trait (closed), opens and closes it; bad names never reach the chain; non-owners fail", async () => {
  const anvil = await startAnvil();
  const blockNumber = async () => (await (await fetch(anvil.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) })).json()).result;
  try {
    const { address } = await deploy({ rpcUrl: anvil.url, chainId: null, signer: { kind: "unlocked", label: "anvil", from: ANVIL_ACCOUNTS[0] }, passthrough: [], out: null }, { artifact, input, log: () => {} });
    const as = (who) => ["--address", address, "--rpc-url", anvil.url, "--unlocked", "--from", who];
    const owner = as(ANVIL_ACCOUNTS[0]);
    const lines = [];
    let traits = await trait(["add", "NEW IDEA", "#A0A0FF", "9", ...owner], { log: (l) => lines.push(l) });
    assert.deepEqual(traits.at(-1), { stampId: 4, name: "NEW IDEA", color: "#A0A0FF", emblem: 9, open: false });
    assert.ok(lines.some((l) => /Added as stampId 4/.test(l)));
    traits = await trait(["open", "4", ...owner], { log: () => {} });
    assert.equal(traits[4].open, true);
    traits = await trait(["close", "0", ...owner], { log: () => {} });
    assert.equal(traits[0].open, false);
    const listed = [];
    await trait(["list", "--address", address, "--rpc-url", anvil.url], { log: (l) => listed.push(l) });
    assert.equal(listed.length, 5);
    assert.match(listed[4], /NEW IDEA +#A0A0FF +emblem +9 +open/);

    const before = await blockNumber();
    for (const bad of [["add", "new idea", "#A0A0FF", "9"], ["add", "OK", "#a0a0ff", "9"], ["add", "OK", "#A0A0FF", "256"], ["open", "300"], ["fly"]]) {
      await assert.rejects(trait([...bad, ...owner], { log: () => {} }), DeployError, bad.join(" "));
    }
    await assert.rejects(trait(["open", "9", ...owner], { log: () => {} }), /does not exist/);
    await assert.rejects(trait(["add", "OK", "#000000", "1", ...owner, "--private-key", "x"], { log: () => {} }), /refused/);
    await assert.rejects(trait(["open", "4", ...owner], { log: () => {}, confirm: async () => false }), /cancelled/);
    assert.equal(await blockNumber(), before, "nothing was sent");
    await assert.rejects(trait(["add", "MALLORY", "#000000", "1", ...as(ANVIL_ACCOUNTS[4])], { log: () => {} }), /cast exited/);
    // with no --address the tools use stamps.address from content/app.meta.json: refuse when unset, use it once deployed
    const metaAddress = JSON.parse(readFileSync(new URL("../../content/app.meta.json", import.meta.url), "utf8")).stamps?.address ?? null;
    if (metaAddress === null) assert.throws(() => parseTraitArgs(["open", "1", "--rpc-url", anvil.url, "--ledger"]), /no contract address/);
    else assert.equal(parseTraitArgs(["open", "1", "--rpc-url", anvil.url, "--ledger"]).address.toLowerCase(), metaAddress.toLowerCase());
  } finally {
    await anvil.stop();
  }
});
