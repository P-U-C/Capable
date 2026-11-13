# Deploying CapableStamps (the owner's runbook)

You deploy from your own wallet. Nothing here asks for, reads or stores a private key or a
seed phrase. The script passes a signer flag to Foundry's `cast` (from the pinned npm
package), and your Ledger, Trezor, browser wallet or Foundry keystore does the signing.
It refuses `--private-key`, `--mnemonic`, key files and password files, and it strips
key-bearing environment variables before running `cast`.

Design and tests: [STAMPS.md](STAMPS.md).

## 0. What you need

- Node 22 and this repository.
- A wallet you control:
  - **Recommended:** a Ledger (with the Ethereum app open) or a Trezor.
  - Or a browser wallet: `--browser` opens a local page that asks your wallet extension to sign.
  - Or `--interactive`, where `cast` prompts for a key. You type it into cast; it is not echoed or stored.
  - Or `--account <name>`, a Foundry encrypted keystore with a password prompt.
- That wallet becomes the contract **owner**. It needs a little ETH **on Base**:
  - A deploy is about 3.6 M gas. At Base's usual fractions of a gwei that is a few cents,
    plus an L1 data fee for about 16.5 KB.
  - The script prints a live estimate, including the L1 fee from Base's gas oracle, before you
    confirm. 0.002 ETH is a comfortable buffer.
  - For the dry run, get Base Sepolia ETH from a Base Sepolia faucet.
- Optional, to publish the source on Basescan: an Etherscan API key. Etherscan's v2 API uses
  one key for Base and Base Sepolia. This key cannot sign or spend anything.

**Ledger:** deploying a contract sends raw data. If the device refuses, enable *Blind signing*
in the Ethereum app's settings, then turn it off again after the deploy.

## 1. Install and rehearse locally (no wallet, no network)

```bash
cd chain
npm ci            # pins solc 0.8.30, OpenZeppelin 5.6.1, Foundry cast/anvil 1.7.1, viem
npm test          # 39 tests, including byte-for-byte art parity, on a throwaway local chain
npm run rehearse  # deploys with the same code path as below, mints 3 stamps, checks tokenURI
```

`npm run rehearse` ends with `REHEARSAL OK … anvil stopped.`

## 2. Dry run on Base Sepolia (chain 84532)

```bash
npm run deploy -- --rpc-url https://sepolia.base.org --chain-id 84532 --ledger --verify --etherscan-api-key <key>
```

For other wallets, replace `--ledger` with `--browser`, `--trezor`, `--interactive` or
`--account <name>`. For a Ledger account other than the first, add `--mnemonic-index <n>`.

What happens:

1. It compiles and prints the network, the contract, its code hash, your signer and the cost estimate.
2. It asks `Deploy CapableStamps to Base Sepolia (chain 84532) from your wallet? [y/N]`.
3. `cast` asks your wallet to sign **one** creation transaction. Confirm it on the device or in the browser.
4. It checks the result:
   - the code on chain equals the build;
   - `owner()` is your address;
   - the 4 founding traits are open and match `content/app.meta.json`.
5. It writes `chain/deployments/84532-<address>.json`.
6. It submits the exact compiler input to Basescan and waits for "verified".
7. It prints the explorer link.

To try a mint, open the contract on `sepolia.basescan.org`, go to *Contract → Write Contract*,
connect the wallet and call `mint(0)`. Then read `tokenURI(1)` on *Read Contract* and paste it
into a browser's address bar to see the stamp.

## 3. Deploy to Base mainnet (chain 8453)

```bash
npm run deploy -- --rpc-url https://mainnet.base.org --chain-id 8453 --ledger --verify --etherscan-api-key <key>
```

You can also set `ETHERSCAN_API_KEY` instead of passing the flag. The steps are the same as
the dry run. **Send once.** If `cast` exits with an error after you confirmed, look up your
address on basescan.org before running the command again, because the first transaction may
have gone through.

## 4. Verify later, if the explorer was slow

```bash
npm run verify -- --chain-id 8453 --address 0x… --etherscan-api-key <key>
```

**Manual fallback** on basescan.org: *Contract → Verify and Publish*, then:

- Compiler type: **Solidity (Standard-Json-Input)**
- Compiler: **v0.8.30+commit.73712a01**
- File: `chain/build/CapableStamps.input.json` (written by `npm run build`)
- Contract name: `src/CapableStamps.sol:CapableStamps`
- Constructor arguments: none

## 5. Turn stamps on in the app

The script ends with the line to use. Edit `content/app.meta.json`:

```json
"stamps": { "chainId": 8453, "address": "0xYourContractAddress" }
```

Commit that together with `chain/deployments/8453-<address>.json`. Until `address` is set,
the app keeps stamps in the browser and never offers a mint.

For a quick check, mint your own first stamp in the app. It should show up on basescan.org
under your address.

## 6. Adding a trait for a new lesson

A new trait **starts closed**. The order is: register it on chain, put it in the app, then
open it when the lesson ships.

```bash
npm run trait -- list --rpc-url https://mainnet.base.org                       # address from app.meta.json
npm run trait -- add "NEW IDEA" "#A0A0FF" 9 --rpc-url https://mainnet.base.org --ledger
# → "Added as stampId 4"
```

Rules for a trait:

- **name:** 1–12 capital letters A–Z and spaces, starting with a letter. It is printed on the stamp exactly as given.
- **colour:** `#RRGGBB` in capitals.
- **emblem:** 0 key, 1 speech, 2 arrow, 3 house; any other value up to 255 draws a pixel.

The tool checks these rules before anything is sent. **A trait cannot be edited once added**,
so check it twice.

Then:

1. In `content/app.meta.json`, give the trait `"stampId": 4` with the same `color` and `emblem`.
   Its `name` is the same word; the app prints it in capitals.
2. Ship the lesson, then open the trait:

   ```bash
   npm run trait -- open 4 --rpc-url https://mainnet.base.org --ledger
   ```

To pause new mints of a trait, run `npm run trait -- close <stampId> …`. Stamps already
minted are never affected. Closing is the only lever against bot minting. The app reads the
trait's `open` flag before it offers a mint and again before it sends (`check()`, see
STAMPS.md), so readers see no mint for a closed trait instead of a transaction that reverts.
Close a trait only once the app build that calls `check()` is live; an older build still
offers the mint. To try any of this first, point it at Sepolia with
`--rpc-url https://sepolia.base.org --address 0x…`.

## 7. Ownership

The owner can only add, open and close traits. To hand the contract to another wallet, for
example a multisig, use Basescan's *Write Contract* tab:

1. Call `transferOwnership(newOwner)` from the current owner.
2. Call `acceptOwnership()` from the new owner. Until that call, nothing changes.

**Never renounce while any trait is open.** `renounceOwnership()` is a single step and freezes
every trait's open or closed state forever, and the trait list with it. Minting and burning
keep working, but the owner's only lever against bot minting (closing a trait) is gone for good.

The owner today is the deployer key. Move ownership to a hardware wallet or a Safe with the two
steps above, and keep that key off any machine an agent runs on.

## What the owner can never do

The owner can never:

- mint for someone else;
- move or burn anyone's stamp;
- edit a trait's name, colour or emblem;
- change the art;
- upgrade the contract.

None of these exist in the contract, and `chain/test/stamps.test.mjs` checks the complete
list of state-changing functions.
