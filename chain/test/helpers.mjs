// Shared test fixtures for chain/test (not a test file itself). Local anvil only.
import assert from "node:assert/strict";
import { ContractFunctionRevertedError, createPublicClient, createTestClient, createWalletClient, encodeFunctionData, http, parseEventLogs } from "viem";
import { foundry } from "viem/chains";
import { loadArtifact } from "../scripts/lib/build.mjs";
import { ANVIL_ACCOUNTS, startAnvil } from "../scripts/lib/foundry.mjs";

export const [OWNER, ALICE, BOB, CAROL, MALLORY] = ANVIL_ACCOUNTS;
export const artifact = loadArtifact();
export const abi = artifact.abi;
export const ZERO = "0x0000000000000000000000000000000000000000";

/** A fresh anvil plus viem clients. Call stop() in test.after. */
export async function localChain() {
  const anvil = await startAnvil();
  const transport = http(anvil.url);
  const chain = { ...foundry, rpcUrls: { default: { http: [anvil.url] } } };
  return {
    url: anvil.url,
    pub: createPublicClient({ chain, transport }),
    wallet: createWalletClient({ chain, transport }),
    test: createTestClient({ chain, transport, mode: "anvil" }),
    stop: anvil.stop,
  };
}

/** Deploy CapableStamps from `from` (an unlocked anvil account) and return a small driver. */
export async function deployStamps(c, from = OWNER) {
  const hash = await c.wallet.deployContract({ abi, bytecode: artifact.bytecode, account: from });
  const receipt = await c.pub.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  const address = receipt.contractAddress;
  const d = {
    address,
    receipt,
    read: (functionName, args = []) => c.pub.readContract({ address, abi, functionName, args }),
    /** Send a transaction; resolves the receipt with decoded events. Asserts success. */
    async write(account, functionName, args = []) {
      const h = await c.wallet.writeContract({ address, abi, functionName, args, account });
      const r = await c.pub.waitForTransactionReceipt({ hash: h });
      assert.equal(r.status, "success", `${functionName} by ${account}`);
      return { ...r, events: parseEventLogs({ abi, logs: r.logs }) };
    },
    /** Simulate (eth_call) and return the decoded custom error; fails if it does not revert. */
    async revert(account, functionName, args = []) {
      try {
        await c.pub.simulateContract({ address, abi, functionName, args, account });
      } catch (err) {
        const r = err.walk?.((e) => e instanceof ContractFunctionRevertedError);
        assert.ok(r, `${functionName}: expected a custom error, got ${err.shortMessage || err.message}`);
        return { name: r.data?.errorName, args: r.data?.args ?? [] };
      }
      assert.fail(`${functionName}(${args.join(", ")}) by ${account} did not revert`);
    },
    /** Mine a real transaction with a fixed gas limit (no estimation) and return its status. */
    async mined(account, functionName, args = []) {
      const data = encodeFunctionData({ abi, functionName, args });
      const h = await c.wallet.sendTransaction({ account, to: address, data, gas: 1_000_000n });
      return (await c.pub.waitForTransactionReceipt({ hash: h })).status;
    },
  };
  return d;
}

/** Decode a data:application/json;base64 tokenURI into its JSON text. */
export function decodeTokenURI(uri) {
  const prefix = "data:application/json;base64,";
  assert.ok(uri.startsWith(prefix), "tokenURI is a base64 JSON data URI");
  return Buffer.from(uri.slice(prefix.length), "base64").toString("utf8");
}

/** assert.equal for long strings that reports the first differing offset with context. */
export function assertSameString(actual, expected, label) {
  if (actual === expected) return;
  let i = 0;
  while (i < actual.length && i < expected.length && actual[i] === expected[i]) i++;
  const ctx = (s) => JSON.stringify(s.slice(Math.max(0, i - 40), i + 40));
  assert.fail(`${label}: first difference at offset ${i} (lengths ${actual.length} vs ${expected.length})\n  contract: ${ctx(actual)}\n  oracle:   ${ctx(expected)}`);
}

/** The slot of a CapableStamps state variable, from the compiler's storage layout. */
export function slotOf(label) {
  const s = artifact.storageLayout.storage.find((x) => x.label === label);
  assert.ok(s, `no storage variable ${label}`);
  return BigInt(s.slot);
}
