// S5: the app's StampsAPI (app/src/stamps/index.mjs) against the real contract on a local
// anvil that answers as Base (chain 8453). Review V1: check() reads the trait's `open` flag and
// hasStamp; mint() refuses a closed trait and a held stamp before anything is sent; receipt()
// tells a mint from a revert and reads the tokenId from this contract's own log. V11: the send
// is pinned to the chain, so a wallet that changed network after the switch cannot mint
// elsewhere. Local chains only; the wallet below is a stand-in that forwards to anvil.
import test from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionResult, encodeFunctionData, encodeFunctionResult, getAddress } from "viem";
import { STAMPS_ABI } from "../../app/src/stamps/abi.mjs";
import { createStamps } from "../../app/src/stamps/index.mjs";
import { startAnvil } from "../scripts/lib/foundry.mjs";
import { ALICE, BOB, CAROL, MALLORY, MINTERS_SOL, OWNER, abi, compileTestContracts, deployStamps, deployTestContract, localChain, rawRpc } from "./helpers.mjs";

// The app's codec.mjs, over app/node_modules/viem. The gate runs chain tests before it installs app/, so
// the same functions are built here from chain/'s viem (the same pinned version), strict decode included.
const codec = {
  encode: (functionName, args) => encodeFunctionData({ abi: STAMPS_ABI, functionName, args }),
  decode(functionName, data) {
    const value = decodeFunctionResult({ abi: STAMPS_ABI, functionName, data });
    assert.equal(encodeFunctionResult({ abi: STAMPS_ABI, functionName, result: value }), data.toLowerCase(), "the contract's answers are canonical ABI");
    return value;
  },
};

let c;
test.before(async () => {
  c = await localChain({ chainId: 8453 });
});
test.after(() => c?.stop());

const appFor = (address) => ({ stamps: { chainId: 8453, address } });
const stampsOn = (url) => createStamps({ rpcUrl: url, loadCodec: async () => codec });

/**
 * An EIP-1193 wallet for `account` that sends through `sendUrl` (default: the Base anvil). Like a wallet whose
 * person presses "proceed anyway" after a failed simulation, it sends with a fixed gas limit instead of refusing.
 */
function anvilWallet(account, { sendUrl = c.url, chainId = "0x2105" } = {}) {
  const calls = [];
  return {
    calls,
    methods: () => calls.map((x) => x.method),
    async request({ method, params }) {
      calls.push({ method, params });
      if (method === "eth_chainId") return chainId;
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
      if (method === "eth_sendTransaction") {
        const r = await rawRpc(sendUrl, "eth_sendTransaction", [{ ...params[0], gas: "0x493e0" }]);
        if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
        return r.result;
      }
      throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
    },
  };
}

test("check → mint → receipt on chain: open and unheld, one pinned send, success with the minted tokenId; then held, and mint() refuses before sending", async () => {
  const s = await deployStamps(c);
  const app = appFor(s.address);
  const stamps = stampsOn(c.url);
  assert.deepEqual(await stamps.check({ app, holder: ALICE, stampId: 0 }), { open: true, held: false });

  const w = anvilWallet(ALICE);
  const sent = await stamps.mint({ provider: w, stampId: 0, app });
  assert.equal(sent.from, ALICE);
  assert.equal(sent.explorerUrl, `https://basescan.org/tx/${sent.txHash}`);
  assert.deepEqual(w.methods(), ["eth_chainId", "eth_requestAccounts", "eth_sendTransaction"]);
  const tx = w.calls[2].params[0];
  assert.deepEqual(Object.keys(tx).sort(), ["chainId", "data", "from", "to"]);
  assert.equal(tx.chainId, "0x2105");
  assert.equal(tx.to, s.address.toLowerCase());

  assert.deepEqual(await stamps.receipt({ app, txHash: sent.txHash }), { status: "success", tokenId: 1 });
  assert.deepEqual(await stamps.receipt({ app, txHash: sent.txHash, holder: sent.from }), { status: "success", tokenId: 1 });
  assert.deepEqual(await stamps.check({ app, holder: ALICE, stampId: 0 }), { open: true, held: true });
  assert.deepEqual(await stamps.owned(ALICE, { app }), { stamps: [{ tokenId: 1, stampId: 0 }] });

  // a second mint of the same stamp: refused with "held", no transaction (it would revert AlreadyHeld)
  const again = anvilWallet(ALICE);
  await assert.rejects(stamps.mint({ provider: again, stampId: 0, app }), (e) => e.code === "held");
  assert.deepEqual(again.methods(), ["eth_chainId", "eth_requestAccounts"]);
  assert.equal(await s.read("balanceOf", [ALICE]), 1n);
});

test("a closed trait (the owner's lever against bots): check() says closed, mint() refuses before sending; the old unguarded send is mined, reverts, and receipt() says so", async () => {
  const s = await deployStamps(c);
  const app = appFor(s.address);
  const stamps = stampsOn(c.url);
  await s.write(OWNER, "setOpen", [1, false]);
  assert.deepEqual(await stamps.check({ app, holder: BOB, stampId: 1 }), { open: false, held: false });

  const w = anvilWallet(BOB);
  const before = await c.pub.getBlockNumber();
  await assert.rejects(stamps.mint({ provider: w, stampId: 1, app }), (e) => e.code === "closed" && /not open/.test(e.message));
  assert.ok(!w.methods().includes("eth_sendTransaction"), "nothing sent");
  assert.equal(await c.pub.getBlockNumber(), before, "nothing mined");
  assert.deepEqual(await s.revert(BOB, "mint", [1]), { name: "TraitClosed", args: [1] }, "and it would have reverted");

  // What the app did before V1: send anyway. The wallet lets the person proceed; the tx is mined and reverts.
  const r = await rawRpc(c.url, "eth_sendTransaction", [{ from: BOB, to: s.address, data: encodeFunctionData({ abi, functionName: "mint", args: [1] }), gas: "0x493e0" }]);
  assert.deepEqual(await stamps.receipt({ app, txHash: r.result }), { status: "reverted" });
  assert.equal(await s.read("hasStamp", [BOB, 1]), false);

  // a held AND closed stamp says "held" (the more useful thing to tell the person)
  await s.write(CAROL, "mint", [2]);
  await s.write(OWNER, "setOpen", [2, false]);
  assert.deepEqual(await stamps.check({ app, holder: CAROL, stampId: 2 }), { open: false, held: true });
  await assert.rejects(stamps.mint({ provider: anvilWallet(CAROL), stampId: 2, app }), (e) => e.code === "held");

  // reopened: the same reader mints
  await s.write(OWNER, "setOpen", [1, true]);
  const ok = await stamps.mint({ provider: anvilWallet(BOB), stampId: 1, app });
  assert.equal((await stamps.receipt({ app, txHash: ok.txHash })).status, "success");
});

test("receipt(): pending until mined, then success; an unknown hash stays pending", async () => {
  const s = await deployStamps(c);
  const app = appFor(s.address);
  const stamps = stampsOn(c.url);
  await c.test.setAutomine(false);
  try {
    const sent = await stamps.mint({ provider: anvilWallet(MALLORY), stampId: 3, app });
    assert.deepEqual(await stamps.receipt({ app, txHash: sent.txHash }), { status: "pending" });
    await c.test.mine({ blocks: 1 });
    const done = await stamps.receipt({ app, txHash: sent.txHash });
    assert.equal(done.status, "success");
    assert.deepEqual(await s.read("tokensOf", [MALLORY]), [BigInt(done.tokenId)]);
  } finally {
    await c.test.setAutomine(true);
  }
  assert.deepEqual(await stamps.receipt({ app, txHash: `0x${"12".repeat(32)}` }), { status: "pending" });
});

test("receipt(): a mint through another contract (as a smart-contract wallet's bundle is) is found with the holder, never credited to the sender", async () => {
  const s = await deployStamps(c);
  const app = appFor(s.address);
  const stamps = stampsOn(c.url);
  const { PlainMinter } = compileTestContracts(MINTERS_SOL);
  const minter = await deployTestContract(c, PlainMinter, MALLORY);
  const hash = await c.wallet.writeContract({ address: minter, abi: PlainMinter.abi, functionName: "mint", args: [s.address, 0], account: MALLORY });
  await c.pub.waitForTransactionReceipt({ hash });
  // the tx is from MALLORY, but the stamp is the contract's: without the holder nothing is credited to MALLORY
  const blind = await stamps.receipt({ app, txHash: hash });
  assert.equal(blind.status, "reverted");
  assert.match(blind.error, /minted no stamp for this account/);
  assert.deepEqual(await stamps.receipt({ app, txHash: hash, holder: minter }), { status: "success", tokenId: 1 });
  assert.equal(getAddress(await s.read("ownerOf", [1n])), minter);
  // the same tx read against another stamps contract: none of its logs count
  const other = await deployStamps(c);
  assert.equal((await stamps.receipt({ app: appFor(other.address), txHash: hash, holder: minter })).status, "reverted");
});

test("V11: the wallet's network changes after the switch; the send carries chainId 0x2105, so the other chain's node refuses it and nothing is minted anywhere", async () => {
  const s = await deployStamps(c);
  const app = appFor(s.address);
  const stamps = stampsOn(c.url);
  const elsewhere = await startAnvil({ chainId: 1 });
  try {
    const blockNumber = async (url) => (await rawRpc(url, "eth_blockNumber")).result;
    const [baseBefore, otherBefore] = [await blockNumber(c.url), await blockNumber(elsewhere.url)];
    // eth_chainId still said Base when asked; by the send the wallet points at chain 1
    const w = anvilWallet(ALICE, { sendUrl: elsewhere.url });
    await assert.rejects(stamps.mint({ provider: w, stampId: 0, app }), (e) => e.code === "wallet" && /chain ID/i.test(e.message));
    assert.equal(w.methods().filter((m) => m === "eth_sendTransaction").length, 1, "one attempt, never retried");
    assert.equal(w.calls.at(-1).params[0].chainId, "0x2105");
    assert.equal(await blockNumber(c.url), baseBefore);
    assert.equal(await blockNumber(elsewhere.url), otherBefore);
    assert.equal(await s.read("hasStamp", [ALICE, 0]), false);
  } finally {
    await elsewhere.stop();
  }
});
