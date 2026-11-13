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
  So anyone can reroll their stamp's art (confetti, tilt) for about 115k gas a try, and
  each try spends a token id. That is fine as designed: using up all 999,999,999 ids
  would take about 1.15e14 gas (review V19, A3).
- **Fully on chain.** `tokenURI` returns `data:application/json;base64,…`. Its `image` is
  `data:image/svg+xml;base64,…` of `BadgeArt.svg()`, a Solidity port of
  `contract/badge-art.mjs`. The port is byte-identical to that file (see Parity below).
- **Art fixed at mint.** `seed = keccak256(abi.encodePacked(holder, uint8 stampId, uint256 tokenId))`
  is stored with the stamp. A trait's name, colour and emblem cannot change once added.
- **Honor system.** The contract cannot know whether someone read the lesson, and it does not
  pretend to. The app offers the mint only after the trait is earned in that browser.
  On chain, a stamp proves only that an address called `mint`: the mint is free and ungated,
  so bots farm it for about a cent a wallet (review V2). A stamp is self-claimed. Never publish
  holder counts as if they meant readers.
- **A small owner.** The owner (`Ownable2Step`) can only add traits and open or close them.
  The owner cannot mint for anyone, move or burn anyone's stamp, edit a trait, or change the art.
  There is no proxy and no upgrade path. Closing a trait stops new mints and leaves existing stamps alone.
  It is the owner's only lever against bot minting, so the app reads it: `check()` before it offers
  a mint and again before it sends (review V1).

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
npm test            # compile + 39 tests on throwaway anvils (~30 s)
npm run rehearse    # local deploy + 3 mints + tokenURI check + a closed trait and two reverts; rewrites fixtures/rehearsal.json
npm run build       # chain/build/CapableStamps.json (+ .input.json, the standard JSON for verification)
```

`npm run deploy`, `npm run verify` and `npm run trait` are the owner's tools (see DEPLOY-STAMPS.md).

## Tests

| File | Proves |
| --- | --- |
| `chain/test/stamps.test.mjs` | S1: constructor and traits equal app.meta.json; ERC-165; mint (ids, seeds, events, free); one per holder and trait; unknown and closed traits; `_mint`, never `_safeMint`: a contract with no ERC-721 receiver, and one whose receiver reverts, both mint (review V-M60); soulbound (calls and mined txs, every caller); burn (holder only, list upkeep, re-mint, the stamp's storage zeroed: V-M56); registry (owner only, closed by default, name and colour rules, 256 cap); Ownable2Step; the full list of state-changing functions; tokenURI against badgeMetadata/badgeSvg (incl. a 12-letter name and a pixel emblem); supply cap at 999,999,999; gas |
| `chain/test/app.test.mjs` | S5: the app's StampsAPI against the real contract on an anvil that answers as Base (8453): check → mint → receipt (success with the tokenId); a held stamp and a closed trait are refused before sending; the unguarded send of a closed trait is mined, reverts, and `receipt()` says so; pending until mined; a mint through another contract is found only with `holder`; V11: a wallet that changed network after the switch cannot mint (the pinned chainId is refused by the other chain's node) |
| `chain/test/parity.test.mjs` | S2: the oracle reproduces its 14 vectors; all 14 vectors byte-identical on chain; 200 random inputs from a fixed seed byte-identical (both font sizes, every emblem, spaces, edge serials); the inputs `badgeSvg()` refuses are the inputs `render()` reverts on. A failure prints the first differing offset with context |
| `chain/test/build.test.mjs` | Pinned versions; runtime under 24,576 bytes; the standard-JSON input is complete and reproduces the bytecode with no import callback; `app/src/stamps/abi.mjs` matches the compiled ABI; the event topics `receipt()` reads are the compiled `Stamped` and `Transfer` |
| `chain/test/deploy.test.mjs` | S4: refuses keys, mnemonics, key files, passwords and their env vars; signer flag mapping; network checks (Base only over https, `--unlocked` only on localhost); the real `cast send --create` path deploys, checks and records; cancel sends nothing; Basescan request and polling (mocked); the rehearsal reproduces the committed fixture byte for byte (fixed block timestamps, so its receipts and hashes too); the trait tool |
| `app/test/stamps.test.mjs` | S3: sync keccak = viem; seed = chain; config fails closed; `preview()` = the tokenURI SVG of real local-chain mints; `owned()` decodes real recorded eth_call answers, never throws, caps `tokensOf` at 256 before any fan-out (V-M16), refuses stampIds outside 0..255 even from a lax decoder (V-M18), repeats and oversized answers; the codec accepts only canonical ABI; `check()` on real recorded answers (an open and a closed trait) and every failure → no offer; `mint()` call order, re-check for the sending account, `closed`/`held` before any send, chainId pinned, chain switch, add (incl. nested 4902), 4001 → `rejected` at every step, never resends, wrong chain, offline; `receipt()` on the recorded receipts (three mints, two reverts), only this contract's logs, the holder, every bad answer → pending; viem only in a lazy chunk |

The parity test was checked by mutation. Shifting the tilt by one degree, changing the
font-size threshold from `<= 9` to `< 9`, or growing one confetti square when a seed byte
is 0xFF each fails both parity tests.

The review's surviving mutations in this lane are now killed: `_mint` → `_safeMint` (V-M60),
burn leaving the stamp record (V-M56), and removing the `tokensOf` cap or the stampId range
check in `owned()` (V-M16, V-M18). So is each new guard: the `closed`/`held` refusals, the
pinned chainId, the re-check's account, and every rule in `receipt()` and the strict codec.
One survivor stays by design: `_update`'s owner-to-owner guard (V-M51) has no external path
that reaches it.

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
import { config, owned, preview, check, mint, receipt, stampTrait } from "./stamps/index.mjs";

const cfg = config(app);            // { chainId: 8453, address } or null → stamps stay local
const svg = preview({ holder, stampId, tokenId, trait: stampTrait(appTrait) }); // sync, offline
const { stamps, error } = await owned(address, { app });        // [{ tokenId, stampId }] sorted; [] + reason on any failure
const { open, held, error } = await check({ app, holder, stampId }); // offer a mint only when open && !held && !error
const { txHash, explorerUrl, from } = await mint({ provider, stampId, app });
const { status, tokenId, error } = await receipt({ app, txHash, holder: from }); // poll: pending | success | reverted
```

- **`config(app)`** reads `app.stamps`. It returns null unless `chainId` is 8453 (or 84532 for
  the owner's Sepolia dry run) and `address` is a non-zero `0x` + 40 hex. `content/app.meta.json`
  ships the live contract, `0xdDe6A74CDBACF6A3b9909F2CfCF10d634A29C692` on Base.
- **`owned(address)`** reads `tokensOf` and then `stampOf` with `eth_call` on
  `https://mainnet.base.org`. Without `{ app }` it uses the last `config(app)` result. It never
  fetches `tokenURI`: `preview()` reproduces each stamp's SVG exactly from (holder, stampId,
  tokenId) and the trait. It distrusts the RPC: a `tokensOf` answer over 256 ids (one per trait,
  at most 256 traits), an id outside 1..999,999,999, a repeated id, a stampId outside 0..255 or a
  repeated stampId is refused before anything is shown, and the length is checked before any
  `stampOf` call, so a hostile RPC cannot make it fan out. A holder has at most one token per
  trait, so the real fan-out is 1 + the number of traits (5 today).
- **`check({ app, holder, stampId })`** reads `traitOf(stampId).open` and `hasStamp(holder, stampId)`
  together. Any failure gives `{ open: false, held: false, error }`, and the caller then offers no
  mint. The card calls it with the wallet's `eth_accounts` address (or with no holder known, it
  can only say whether the trait is open).
- **`mint()`** calls `eth_chainId`, then `wallet_switchEthereumChain(0x2105)` if needed. On
  4902 it calls `wallet_addEthereumChain` with Base's parameters (and switches once more if
  the wallet did not). Then it calls `eth_requestAccounts` and re-runs the check for **that**
  account: a definite `held` or `closed` answer throws before anything is sent. Then it sends
  **one** `eth_sendTransaction` `{ from, to, data: mint(stampId), chainId: "0x2105" }`. The
  chainId pins the send to Base: a wallet that changed network after the switch refuses it
  (V11). It resolves `{ txHash, explorerUrl, from }`. It never retries. A second call for the
  same stamp while the first is open returns the same promise.
  - If the re-check **cannot be read** (rate limit, a node that is behind, a moment offline),
    the send goes ahead. The card only offers a mint after a `check()` that answered, the
    wallet simulates the call and warns, and `receipt()` reports a revert, so the worst case
    is a reverted mint the person chose to send. Blocking instead would leave a reader whose
    public RPC is flaky unable to mint at all.
  - The wallet call sequence is unchanged: `eth_chainId`, [`wallet_switchEthereumChain`,
    `eth_chainId`], `eth_requestAccounts`, `eth_sendTransaction`. The re-check reads the public
    RPC, not the wallet. There is no extra `eth_chainId` right before the send; the pinned
    chainId does that job in the wallet.
- **`receipt({ app, txHash, holder? })`** reads `eth_getTransactionReceipt`. It never throws.
  - `pending`: not mined yet (no `error`), or the read failed or looked wrong (with `error`).
    Poll again.
  - `success` with `tokenId`: mined with status 1, **and** this contract's own `Stamped` log
    (else its `Transfer` from 0x0) names the holder. Logs from any other address, removed logs,
    out-of-range ids and dirty topics are ignored. A receipt for another hash is refused.
  - `reverted`: mined with status 0. Also: mined, but it minted no stamp to the holder (`error`
    says so).
  - `holder` is optional and goes beyond `contract/citizen.d.ts`. Pass mint()'s `from`. Without
    it the tx sender is the holder, which is right for every ordinary wallet. A smart-contract
    wallet's mint is sent by a bundler, so without `holder` it reads as `reverted`; with it, as
    `success`.
  - It decodes the two event logs by hand and does not load viem.
- **Polling (for the app).** Base makes a block every 2 s. Poll `receipt()` about 2 s after the
  send, then back off (2, 3, 5, 8 s, capped at 10 s). Stop after about 5 minutes and keep the tx
  link. `pending` with an `error` counts toward the 5 minutes and is not a failure. On `success`,
  record the mint with its `tokenId` and redraw the stamp for (from, stampId, tokenId) (V12).
  On `reverted`, clear the record and offer the mint again only after a fresh `check()`.
- **Error codes** (`err.code`). Only `wallet` can follow a send; after every other code nothing was sent.

  | Code | Meaning |
  | --- | --- |
  | `rejected` | 4001: the person said no |
  | `not-configured` | No contract address is configured |
  | `no-wallet` | No wallet was passed |
  | `bad-stamp` | `stampId` is invalid |
  | `wrong-chain` | The wallet will not switch to Base |
  | `no-account` | The wallet shared no account |
  | `held` | The sending account already holds this stamp (minting would revert `AlreadyHeld`). Say so; do not offer the mint |
  | `closed` | The trait is closed on chain (minting would revert `TraitClosed`). Say so; do not offer the mint |
  | `wallet` | Any other wallet failure. The transaction may have been sent; tell the person to check their wallet |
  | `offline` | The lazy code failed to load. This happens before any wallet prompt |

- **Lazy loading.** viem is imported only by `codec.mjs`, which `index.mjs` loads with
  `import("./codec.mjs")` on the first `owned()`, `check()` or `mint()`. `receipt()` never
  needs it. The codec accepts only the canonical ABI encoding of what it decoded: no dirty
  bits in a `uint8` or `bool`, no trailing bytes, no odd offsets. The contract never answers
  any other way. Bundled with esbuild code splitting, the stamps entry is 13.5 KB (5.3 KB
  gzipped, including the art oracle and keccak), and viem lands in lazy chunks of about 137 KB.
  `app/build.mjs` bundles with `splitting: true`.
- **CSP.** Reads go to `https://mainnet.base.org` (already in SPEC-V3's `connect-src` list).
  A Sepolia dry run of the app would also need `https://sepolia.base.org`.

## Notes for the planner

- `receipt()` takes an optional `holder` (mint()'s `from`), which `contract/citizen.d.ts` does not
  list. Without it a smart-contract wallet's mint reads as `reverted`; the card's next `check()`
  then shows it as held, so nothing breaks, but the app should pass it. Consider adding
  `holder?: string` to `receipt()` in the contract.
- `mint()` lets the send go ahead when the re-check cannot be read (see `mint()` above). If you
  want it to fail closed instead, it is one line in `send()`: throw `offline` when `c.error` is
  set. The app lane's trait-card tests would then need a mocked `fetch`, because several of
  them build `createStamps()` with the real one.
- `StampTrait.name` is the printed capitals (`"SOVEREIGN"`), but `Trait.name` is `"Sovereign"`.
  `preview()` capitalises for you, and `stampTrait()` does the mapping. `stampTrait()` sets
  `open: true` for drawing only; `check()` is the chain's answer.
- `contract/badge-art.mjs` ports cleanly. It uses integers only, every division is on
  non-negative values (so `Math.floor` is Solidity's `/`), there is no locale, and names are
  ASCII, so `name.length` is the byte length. No change is needed.
