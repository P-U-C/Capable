# Stamps: soulbound badges on Base

Stamps lane. Covers `chain/` (the `CapableStamps` contract, its tests and scripts) and
`app/src/stamps/` (the app's `StampsAPI`). The deploy runbook for the owner is
[DEPLOY-STAMPS.md](DEPLOY-STAMPS.md). The spec is [SPEC-V3.md](SPEC-V3.md) "Stamps",
and the art rule is [BADGE-ART.md](BADGE-ART.md).

## Design

Finishing a lesson earns its trait in the reader's browser. If a wallet is available
and the contract is deployed, the reader may also mint that trait as a stamp on Base:

- **Free.** `mint(uint8 stampId)` costs nothing beyond gas, which the minter pays. It is not payable.
- **One per holder and trait.** A second mint reverts `AlreadyHeld`.
- **Soulbound (ERC-5192).** `locked(id)` is always true, and `Locked` is emitted at mint.
  `transferFrom`, both `safeTransferFrom`s, `approve` and `setApprovalForAll` always revert `Soulbound`.
- **Leaving is a right.** The holder can `burn` their own stamp. That clears the one-per
  slot, so they can mint the trait again later, with a new token id and a new seed.
- **Fully on chain.** `tokenURI` returns `data:application/json;base64,…`. Its `image` is
  `data:image/svg+xml;base64,…` of `BadgeArt.svg()`, a Solidity port of
  `contract/badge-art.mjs`. The port is byte-identical to that file (see Parity below).
- **Art fixed at mint.** `seed = keccak256(abi.encodePacked(holder, uint8 stampId, uint256 tokenId))`
  is stored with the stamp. A trait's name, colour and emblem cannot change once added.
- **Honor system.** The contract cannot know whether someone read the lesson, and it does not
  pretend to. The app offers the mint only after the trait is earned in that browser.
- **A small owner.** The owner (`Ownable2Step`) can only add traits and open or close them.
  The owner cannot mint for anyone, move or burn anyone's stamp, edit a trait, or change the art.
  There is no proxy and no upgrade path. Closing a trait stops new mints and leaves existing stamps alone.

## Contract

`chain/src/CapableStamps.sol` (ERC-721 "capable stamps" / "STAMP", OpenZeppelin 5.6.1) and
`chain/src/BadgeArt.sol` (an internal library, compiled into the same contract).

| Function | Who | Does |
| --- | --- | --- |
| `mint(uint8 stampId) → tokenId` | anyone | Mints to `msg.sender`. Reverts `UnknownTrait`, `TraitClosed`, `AlreadyHeld`, `SupplyExhausted`. Emits `Transfer`, `Locked`, `Stamped(holder, stampId, tokenId)` |
| `burn(uint256 tokenId)` | the holder | Reverts `NotHolder` for anyone else (including the owner) and for missing tokens |
| `addTrait(string name, string color, uint8 emblem) → stampId` | owner | Validates like badge-art.mjs: name `^[A-Z][A-Z ]{0,11}$`, color `^#[0-9A-F]{6}$`. **Starts closed.** Max 256 traits. Emits `TraitAdded` |
| `setOpen(uint8 stampId, bool open)` | owner | Emits `TraitOpenSet` |
| `traitCount()`, `traitOf(stampId) → (name, color, emblem, open)` | view | |
| `stampOf(tokenId) → uint8`, `seedOf(tokenId) → bytes32` | view | Revert `ERC721NonexistentToken` for burned or missing tokens |
| `hasStamp(holder, stampId) → bool`, `tokensOf(holder) → uint256[]` | view | `tokensOf` order is not meaningful: a burn moves the last id into the gap |
| `tokenURI(tokenId)`, `locked(tokenId)` | view | ERC-721 metadata; ERC-5192 |
| `render(seed, name, color, emblem, serial) → svg` | pure | The art for any input. Reverts `InvalidName`, `InvalidColor` or `InvalidSerial` exactly where `badgeSvg()` throws |
| `supportsInterface` | view | ERC-165, ERC-721, ERC-721 metadata, ERC-5192 (`0xb45a3c0e`) |
| `transferOwnership`, `acceptOwnership`, `renounceOwnership`, `owner`, `pendingOwner` | Ownable2Step | |

The constructor makes the deployer the owner and registers the founding traits as
stampIds 0 to 3, all open. They match `content/app.meta.json`:
SOVEREIGN `#18C8F0` emblem 0, CIVIL `#FF1FC8` 1, MOBILE `#5CF27E` 2, ENDURING `#FFE11A` 3.

Token ids are sequential from 1 and capped at `MAX_TOKEN_ID = 999,999,999`, because the
art prints serials below 10^9. That keeps every token inside the oracle's domain.

### Invariants (each has a test)

- Only mint (from 0) and burn (to 0) change an owner: the transfer functions are overridden
  `pure` reverts, and `_update` refuses any owner-to-owner move as defence in depth.
- `_held[holder][stampId]` is non-zero exactly while the holder owns a stamp of that trait.
  `tokensOf(holder)` holds exactly the holder's live tokens.
- `seedOf(id)` equals `keccak256(abi.encodePacked(ownerOf(id), stampOf(id), id))` for every live token.
- `tokenURI(id)` decodes to `badgeMetadata({ name, serial: id, svgBase64 })`, with
  `svgBase64 = base64(badgeSvg({ seed, name, color, emblem, serial: id }))`.
- The only state-changing functions are `mint`, `burn`, `addTrait`, `setOpen` and the
  three ownership functions. OpenZeppelin's 3-argument `safeTransferFrom` is not virtual;
  it calls the 4-argument override, which reverts. Nothing is payable.

## Toolchain (`chain/`, its own npm package; every version pinned)

- **solc 0.8.30**, via the `solc` npm package (solcjs). No native download is needed.
  Optimizer on (200 runs), `evmVersion: cancun`. Base has supported Cancun since Ecotone.
- **OpenZeppelin Contracts 5.6.1**: ERC721, Ownable2Step, Base64, Strings.
- **Foundry 1.7.1** `anvil` and `cast`, from npm (`@foundry-rs/anvil`, `@foundry-rs/cast`).
  `npm ci` installs the binary for the platform, so foundryup is not needed. `anvil` is the
  local chain for tests and the rehearsal. `cast` sends the owner's transactions with their
  own signer: Ledger, Trezor, browser wallet, interactive prompt, or Foundry keystore.
- **viem 2.57.19** for the tests and scripts, the same version the app uses.

```bash
cd chain
npm ci
npm test            # compile + 31 tests on throwaway anvils (~20 s)
npm run rehearse    # local deploy + 3 mints + tokenURI check; rewrites fixtures/rehearsal.json
npm run build       # chain/build/CapableStamps.json (+ .input.json, the standard JSON for verification)
```

`npm run deploy`, `npm run verify` and `npm run trait` are the owner's tools (see DEPLOY-STAMPS.md).

## Tests

| File | Proves |
| --- | --- |
| `chain/test/stamps.test.mjs` | S1: constructor and traits equal app.meta.json; ERC-165; mint (ids, seeds, events, free); one per holder and trait; unknown and closed traits; soulbound (calls and mined txs, every caller); burn (holder only, list upkeep, re-mint); registry (owner only, closed by default, name and colour rules, 256 cap); Ownable2Step; the full list of state-changing functions; tokenURI against badgeMetadata/badgeSvg (incl. a 12-letter name and a pixel emblem); supply cap at 999,999,999; gas |
| `chain/test/parity.test.mjs` | S2: the oracle reproduces its 14 vectors; all 14 vectors byte-identical on chain; 200 random inputs from a fixed seed byte-identical (both font sizes, every emblem, spaces, edge serials); the inputs `badgeSvg()` refuses are the inputs `render()` reverts on. A failure prints the first differing offset with context |
| `chain/test/build.test.mjs` | Pinned versions; runtime under 24,576 bytes; the standard-JSON input is complete and reproduces the bytecode with no import callback; `app/src/stamps/abi.mjs` matches the compiled ABI |
| `chain/test/deploy.test.mjs` | S4: refuses keys, mnemonics, key files, passwords and their env vars; signer flag mapping; network checks (Base only over https, `--unlocked` only on localhost); the real `cast send --create` path deploys, checks and records; cancel sends nothing; Basescan request and polling (mocked); the rehearsal reproduces the committed fixture; the trait tool |
| `app/test/stamps.test.mjs` | S3: sync keccak = viem; seed = chain; config fails closed; `preview()` = the tokenURI SVG of real local-chain mints; `owned()` decodes real recorded eth_call answers and never throws; `mint()` call order, chain switch, add (incl. nested 4902), 4001 → `rejected` at every step, never resends, wrong chain, offline; viem only in a lazy chunk |

The parity test was checked by mutation. Shifting the tilt by one degree, changing the
font-size threshold from `<= 9` to `< 9`, or growing one confetti square when a seed byte
is 0xFF each fails both parity tests.

## Size and gas

Measured on anvil (cancun). Base's L2 gas price changes; the deploy script prints a live estimate.

| | |
| --- | --- |
| Runtime bytecode | **14,407 bytes** (limit 24,576), one contract, no linked library |
| Init code | 16,468 bytes |
| Deploy | **3,603,524 gas** |
| `mint`: first ever / a holder's first stamp / a holder's next stamp | **190,150 / 173,050 / 158,762 gas** |
| `burn` | 56,556 gas |
| `tokenURI` (eth_call, free) | ≈ 525,000–542,000 gas, well under public RPC call caps |

At an L2 gas price of 0.01 gwei, a mint is about 0.0000019 ETH plus a small L1 data fee.

## How the app uses it (`app/src/stamps/index.mjs`)

```js
import { config, owned, preview, mint, stampTrait } from "./stamps/index.mjs";

const cfg = config(app);            // { chainId: 8453, address } or null → stamps stay local
const svg = preview({ holder, stampId, tokenId, trait: stampTrait(appTrait) }); // sync, offline
const { stamps, error } = await owned(address);       // [{ tokenId, stampId }] sorted; [] + reason on any failure
const { txHash, explorerUrl } = await mint({ provider, stampId, app });
```

- **`config(app)`** reads `app.stamps`. It returns null unless `chainId` is 8453 (or 84532 for
  the owner's Sepolia dry run) and `address` is a non-zero `0x` + 40 hex. Today's
  `content/app.meta.json` has `address: null`, so it returns null.
- **`owned(address)`** reads `tokensOf` and then `stampOf` with `eth_call` on
  `https://mainnet.base.org`. It does not take an `app`, so it uses the last `config(app)`
  result. You can also pass `owned(address, { app })`. It never fetches `tokenURI`:
  `preview()` reproduces each stamp's SVG exactly from (holder, stampId, tokenId) and the trait.
- **`preview()`** is synchronous: `badgeSvg()` from `contract/badge-art.mjs`, with the seed
  computed by a small dependency-free keccak-256 (`keccak.mjs`, tested against viem). It
  accepts the app's `"Sovereign"` and prints it in capitals, as the contract does.
  `stampTrait(trait)` maps an app `Trait` to a `StampTrait`.
- **`mint()`** calls `eth_chainId`, then `wallet_switchEthereumChain(0x2105)` if needed. On
  4902 it calls `wallet_addEthereumChain` with Base's parameters (and switches once more if
  the wallet did not). Then it calls `eth_requestAccounts` and **one** `eth_sendTransaction`
  `{ from, to, data: mint(stampId) }`, and returns `https://basescan.org/tx/<hash>`. It never
  retries. A second call for the same stamp while the first is open returns the same promise.
- **Error codes** (`err.code`):

  | Code | Meaning |
  | --- | --- |
  | `rejected` | 4001: the person said no |
  | `not-configured` | No contract address is configured |
  | `no-wallet` | No wallet was passed |
  | `bad-stamp` | `stampId` is invalid |
  | `wrong-chain` | The wallet will not switch to Base |
  | `no-account` | The wallet shared no account |
  | `wallet` | Any other wallet failure. The transaction may have been sent; tell the person to check their wallet |
  | `offline` | The lazy code failed to load. This happens before any wallet prompt |

- **Lazy loading.** viem is imported only by `codec.mjs`, which `index.mjs` loads with
  `import("./codec.mjs")` on the first `owned()` or `mint()`. Bundled with esbuild code
  splitting, the stamps entry is 10.3 KB (4.3 KB gzipped, including the art oracle and
  keccak). viem lands in lazy chunks of about 137 KB. **For the app lane:** `app/build.mjs`
  bundles without `splitting`. With splitting off, esbuild inlines dynamic imports, so to
  keep viem out of first paint, either enable `splitting: true` (ESM, `outdir`) or load the
  stamps module itself lazily.
- **CSP.** Reads go to `https://mainnet.base.org` (already in SPEC-V3's `connect-src` list).
  A Sepolia dry run of the app would also need `https://sepolia.base.org`.

## Notes for the planner

- `StampsAPI.owned(address)` has no way to learn the contract address. The module uses the
  last `config(app)`, and also accepts `owned(address, { app })`. Consider writing
  `owned(address, app?)` into `contract/citizen.d.ts`.
- `StampTrait.name` is the printed capitals (`"SOVEREIGN"`), but `Trait.name` is `"Sovereign"`.
  `preview()` capitalises for you, and `stampTrait()` does the mapping.
- `contract/badge-art.mjs` ports cleanly. It uses integers only, every division is on
  non-negative values (so `Math.floor` is Solidity's `/`), there is no locale, and names are
  ASCII, so `name.length` is the byte length. No change is needed.
