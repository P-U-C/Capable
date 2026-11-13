# v3: citizens

Planner-owned. v2 made capable a set of swipeable lessons. v3 makes the reader
a citizen with an identity, a passport and stamps, and gives everything one
generated visual language. Contract: `contract/citizen.d.ts`,
`contract/badge-art.mjs`, `contract/app.d.ts` (Trait.color/emblem/stampId,
App.stamps).

## The idea

You read lessons. Each one you finish stamps your **passport** with a trait.
Sign in with Farcaster to put your name and face on the passport, and mint the
stamp as a **soulbound badge on Base** so anyone can verify it. Everything you
see (the logo, the favicon, each lesson's art, your portrait, your stamps) is
drawn by one **art grammar**, so it all belongs together and no two pieces are
the same.

Nothing is required. Signed out, with no wallet, the app works exactly as v2
and stamps live in this browser.

## Independence, amended

Lessons, cards, captions, home copy, art and stamp metadata still never name
the platform, the commissioners or the contests (`BANNED`). The one exception
is **identity UI**: the sign-in button and sheet ("Sign in with Farcaster"),
the share button's label, and the profile's handle line may name Farcaster,
because that is the account the person is choosing to use. The app's safety
test allow-lists exactly those copy keys and nothing else.

## Identity (identity lane: `app/src/identity/`)

- **Inside a Farcaster client** (Mini App): `@farcaster/miniapp-sdk`. Detect
  with `sdk.isInMiniApp()`, call `sdk.actions.ready()` after first paint, take
  `sdk.context.user` (fid, username, displayName, pfpUrl) as the identity,
  use `sdk.wallet.getEthereumProvider()` as the wallet and
  `sdk.actions.composeCast` to share. The page carries an `fc:miniapp` embed
  meta tag so a shared link opens as a Mini App. (A hosted manifest needs a
  custom domain: GitHub Pages project sites can't serve `/.well-known` at the
  root. Out of scope until the owner adds a domain.)
- **On the web**: Sign In With Farcaster with `@farcaster/auth-client`
  (relay `https://relay.farcaster.xyz`): create a channel, show the deep link
  as a QR code plus an "open on this phone" button, poll, then verify the
  signed message (domain = `location.host`, our nonce, signature valid for the
  fid's custody address or one of its registered auth addresses, via a public
  Optimism RPC) before storing anything.
  Five-minute timeout; cancel any time.
- Loaded lazily: none of this code is in the first paint bundle.
- Stored in `localStorage["capable.identity.v1"]`, validated on read. Sign
  out clears it. No analytics, no server, nothing else leaves the browser.
- Wallet for minting: the Mini App host wallet, else an injected wallet found
  through EIP-6963, else none (minting hidden).

## Passport (app lane, using identity + stamps + art)

- Route `#/passport`: the person's passport. Portrait (art `portrait`, seeded
  by fid when signed in, else a random local id kept in localStorage), name
  and @handle when signed in, the citizen line, each trait with its stamp
  (earned here / minted on chain / not yet), lessons done, and Share.
- Route `#/p/<address>`: anyone's public passport, read from chain: their
  minted stamps and a portrait seeded by the address. No name (the chain does
  not say who they are).
- The "you" chip on home opens the passport. The trait card at the end of a
  lesson shows the stamp being pressed, then "Mint this stamp" when a wallet
  and a deployed contract exist, else "Saved to your passport".

**Earned** means: a trait is earned when the reader has finished at least one
ready lesson that builds it. The header seal, the stamp, the passport and
home's "N/4 traits" all use this one definition.

## Stamps (stamps lane: `chain/`, `app/src/stamps/`)

- `CapableStamps` on Base (chain 8453): ERC-721 + ERC-5192 locked
  (soulbound). `mint(uint8 stampId)` is free (the minter pays gas), one per
  (holder, stampId), reverts if the trait is closed or already held. The
  holder may `burn` their own stamp (leaving is a right). Transfers and
  approvals revert.
- Trait registry: `addTrait(name, color, emblem)` and `setOpen(stampId,
  bool)`, owner only. The constructor registers the four founding traits in
  order (stampIds 0–3, matching `content/app.meta.json`). The owner cannot
  mint for others, move or burn anyone's stamp, or change art. No proxy, no
  upgrade path.
- `tokenURI` is fully on-chain: the Solidity port of
  `contract/badge-art.mjs`, byte-identical to the JS reference for every
  vector in `contract/fixtures/badge-vectors.json` and for 200 random seeds
  (docs/BADGE-ART.md). Seed = `keccak256(abi.encodePacked(holder, stampId,
  tokenId))`, stored at mint so the art never changes.
- Deploy: the owner deploys from their own wallet with one command
  (`docs/DEPLOY-STAMPS.md`), then sets `stamps.address` in
  `content/app.meta.json`. Until then `address` is null and stamps stay
  local. Agents never deploy, hold keys or send transactions; they test on a
  local chain only.

## Art grammar (art lane: `art/`)

One grammar, many unique pieces. Shared parts: paper `#F7F4EA`, ink
`#161616`, the four candies (cyan `#18C8F0`, magenta `#FF1FC8`, lime
`#5CF27E`, yellow `#FFE11A`); ink outlines and hard offset shadows; rounded
geometry; pixel confetti kept to the corners; the **citizen figure** (round
head, rounded shoulders); the **seal** (ring of the four candies around a
disc). Riso grain and halftone (SVG filters/patterns) are allowed in app art
but not in stamps.

- `seal`: the new logo. A round civic seal: the four-candy ring, a citizen at
  the centre, ink outline and offset shadow. `lockup` adds the "capable"
  wordmark. `favicon` simplifies to ring + head and shoulders and stays
  legible at 16 px. App icons (192, 512, maskable, apple-touch) are rendered
  from it at build.
- `lessonScene`: a unique scene per lesson id: a composition of civic motifs
  (doors, keys, roads, bridges, tables, houses, flags, crowds), a figure
  count and pose, and a background pattern, in two tones (trait colour + ink
  on paper) with riso grain. The four hand-drawn scenes stay for their
  lessons unless the planner prefers the generated ones; every new lesson
  gets a generated scene automatically.
- `portrait`: the passport photo: the citizen figure with seeded hair or
  headwear, collar, background block and confetti.
- `stamp`: `contract/badge-art.mjs`, unchanged.
- A gallery (`art/gallery.html`, built by `node art/bin/gallery.mjs`) shows
  every generator across many seeds for review.

## Budgets

- First paint bundle (index + css + js + inline app.json): ≤ 400 KB.
- Lazy chunks (identity, wallet, chain reads, video): ≤ 900 KB total, loaded
  only on use (the web sign-in path alone is ~360 KB: auth-client + viem).
- CSP grows only by: `connect-src https://relay.farcaster.xyz
  https://mainnet.optimism.io https://mainnet.base.org` and `img-src https:`
  (profile pictures).
