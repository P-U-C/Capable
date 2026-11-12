# Identity

The identity lane's module: `app/src/identity/`. It implements `IdentityAPI`
from `contract/citizen.d.ts` (docs/SPEC-V3.md, "Identity"). Readiness rows
I1–I3 (docs/READINESS-V3.md).

Signing in is optional. Signed out, the app works exactly as v2.

## Files

| File | Loaded | What it does |
| --- | --- | --- |
| `index.mjs` | first paint | The public API. Stored identity (`current`, `onChange`, `signOut`), the QR encoder, and the answers that must not wait for a download. Everything else goes through `import("./flows.mjs")`. |
| `store.mjs` | first paint | `localStorage["capable.identity.v1"]`: validation on every read, writes, subscribers, other tabs. Imports nothing. |
| `qr.mjs` | first paint (tree-shaken if unused) | A dependency-free QR encoder: byte mode, level M, versions 1–40, returns an SVG string. |
| `core.mjs` | first paint | Constants, `IdentityError`, test-injectable state, Mini App fast check, compose URL, nonce. |
| `flows.mjs` | lazy | Mini App detection and context, web Sign In With Farcaster with verification, host compose, wallet discovery. |
| `lazy-miniapp.mjs` | lazy | `export { sdk } from "@farcaster/miniapp-sdk"`. Its own chunk. |
| `lazy-auth.mjs` | lazy | `export { createAppClient, viemConnector } from "@farcaster/auth-client"` (and the viem it brings). Its own chunk. |
| `build-plugin.mjs` | build only | The esbuild plugin the app's build must use (see Bundling). |

## API

```js
import { identity } from "./identity/index.mjs"; // or the named exports below
```

Everything in `IdentityAPI`:

- `isMiniApp(): Promise<boolean>`. A top-level page (not framed and not a React Native WebView) answers `false` at once and never downloads the SDK. In a frame, the SDK's own `sdk.isInMiniApp()` decides. Always resolves within 1.5 s, and resolves `false` on any error. A `true` is remembered for the session.
- `ready(): Promise<void>`. Inside a host, calls `sdk.actions.ready()` (which hides the host's splash), bounded at 3 s. Outside a host it does nothing. It never throws. Call it after first paint.
- `current(): Identity | null`. Synchronous. Returns a frozen copy, validated on every read (see Storage).
- `signIn({ onUrl?, signal? }): Promise<Identity>`. See Flows. Rejects with `IdentityError`.
- `signOut(): void`. Removes the key and tells subscribers (`null`). Nothing else is touched.
- `onChange(fn): () => void`. Called with the new identity, or `null`, after sign-in, sign-out, or a change in another tab (the `storage` event). A subscriber that throws does not stop the others.
- `share(text, url): Promise<void>`. See Flows. Never posts by itself.
- `wallet(): Promise<EIP1193Provider | null>`. Inside a host: the host wallet. Otherwise the first wallet to answer an EIP-6963 request (wait up to 300 ms), else `window.ethereum`, else `null`.

Extras:

- `qrSvg(text, { px? })`, `qrDataUrl(text)` and `qrMatrix(text)`: the QR code.
- `composeUrl(text, url)`: the web compose link, if the app wants a real `<a>` instead of `share()`.
- `IdentityError` (`.code`), `ERROR_CODES`, `STORAGE_KEY`, `TIMING`, `RELAY_URL`, `OPTIMISM_RPC`, `COMPOSE_URL`.
- `sanitizeIdentity(raw)`: the validator, for anything else that wants it.
- Test-only hooks: `_setLoaders({ miniapp, authClient })`, `_setTiming({...})` and `_reset()`.

## Flows

### Inside a host client (Mini App)

1. **Detect.** `isMiniApp()` (see API).
2. **Ready.** The app calls `ready()` after first paint.
3. **Sign in.** `signIn()` reads `await sdk.context` and takes `context.user` (`fid`, `username`, `displayName`, `pfpUrl`) as the identity, with `source: "miniapp"`. There is no prompt (`sdk.actions.signIn` is never called) and no network request. The user is validated like everything else: an invalid `fid` gives `verify-failed`, and a bad optional field is dropped. This is the host's word, not a signature. It is display data the person's own client hands over, and it is used only for display.
4. **Share.** `sdk.actions.composeCast({ text, embeds: [url] })` opens the host's compose sheet. The person posts, or doesn't. A link that isn't https is left out.
5. **Wallet.** `sdk.wallet.getEthereumProvider()`. If the host has no wallet, the web discovery below runs instead.

### On the web: Sign In With Farcaster

1. `createAppClient({ relay: "https://relay.farcaster.xyz", ethereum: viemConnector({ rpcUrl: "https://mainnet.optimism.io" }) })`.
2. `createChannel({ siweUri: location.origin + location.pathname, domain: location.host, nonce })`. The nonce is 24 alphanumeric characters from `crypto.getRandomValues`, without modulo bias. If the relay echoes a different nonce, the result is `verify-failed`.
3. `onUrl(url)` gets the channel's https deep link. The app shows it as a QR code (`qrSvg(url)`) and as an "open on this phone" link to the same URL. A link that isn't https gives `network`.
4. Poll `status({ channelToken })` every 1.5 s until `state === "completed"`. Two failed polls in a row are tolerated; a third gives `network`. A 4xx from the relay (channel closed, expired or unknown) gives `rejected`. `signal` and the 5-minute deadline apply throughout.
5. `verifySignInMessage({ nonce, domain, message, signature })`, with the same nonce and domain, bounded at 30 s. The library parses the SIWE message, checks the statement, chain 10, the single `farcaster://fid/N` resource, the nonce and the domain, checks the signature (EOA recovery, or ERC-1271/6492 via Optimism), and then checks on Optimism that the signer owns the fid (IdRegistry `idOf`) or is a registered auth address for it (KeyRegistry). The module then checks again itself: the signed nonce and domain must equal ours, the fid must be a positive integer, and the relay's `fid` must equal the signed one.
6. Only then is anything stored: `{ fid, username, displayName, pfpUrl, custody, verifications, source: "siwf", signedInAt }`. `custody` is the address that signed, and is set only when that was the custody key; if an auth address signed, it is left out. `username`, `displayName`, `pfpUrl` and `verifications` come from the relay. They are unverified display data and pass the same validators as everything else. Non-EVM verifications are dropped.

`p-u-c.github.io` is shared by every project site of that GitHub account, so the domain alone does not tell this app apart. The fresh nonce binds the signature to this request. The identity is display data in the person's own browser: no server trusts it.

### Share and wallet on the web

- `share(text, url)` opens `https://farcaster.xyz/~/compose?text=…&embeds[]=…` (each value `encodeURIComponent`-ed) with `window.open(…, "_blank", "noopener,noreferrer")`. On a top-level page this happens synchronously, before any `await`, so the tap still counts as a user gesture and popup blockers allow it.
- `wallet()`: dispatches `eip6963:requestProvider` and takes the first `eip6963:announceProvider` with a usable `request()` (waits up to 300 ms), else `window.ethereum`, else `null`.

## Failure codes

`signIn()` rejects only with `IdentityError`, and `err.code` is one of these. Nothing is stored and `onChange` does not fire. An identity that was already stored is left exactly as it was.

| Code | When |
| --- | --- |
| `timeout` | No approval within 5 minutes, including a relay that stops answering. |
| `cancelled` | `signal` aborted (before or at any step), or `onUrl` threw. |
| `rejected` | The request came back without a message or signature, the relay closed the channel (4xx), or the page has no web origin. |
| `verify-failed` | Wrong nonce or domain, a signature that does not check out, a signer that does not own the fid, a relay fid that differs from the signed one, a malformed message, or no valid user from the host. |
| `network` | Relay or Optimism unreachable, a 5xx or unreadable reply, three failed polls in a row, a missing https link or channel, or the sign-in code (lazy chunk) failed to load. |

Messages are plain English for logs. The app shows its own copy per code.

## Storage

`localStorage["capable.identity.v1"]` holds one JSON `Identity`. It is validated on every read:

- **Core** (any failure: `null`, and the key is removed): `fid` is a positive safe integer; `source` is `"miniapp"` or `"siwf"`; `signedInAt` is ISO 8601 UTC (`…Z`) and a real date. Also `null`: unreadable JSON, a non-object, or a record over 32 KB.
- **Optional** (a failure drops that field alone, and the cleaned record is written back):
  - `username` matches `/^[a-z0-9][a-z0-9._-]{0,63}$/`.
  - `displayName` is 1–80 UTF-16 units and not blank. It has no character in the contract's `FORMAT_CHARS` (C0, C1, soft hyphen, U+061C, U+180E, U+200B–U+200F, U+2028–U+202E, U+2060–U+206F, U+FEFF, U+FFF9–U+FFFB), no tab, LF or CR, and no lone surrogate. The class is copied from `contract/validate-app.mjs`, and a test keeps the two equal. Anything accepted here also passes the contract's `isDisplayName`.
  - `pfpUrl` is `https://` plus a host, at most 2048 characters, in printable ASCII with no quotes, brackets of any kind (`<>()[]{}`) or backslash, and no credentials.
  - `custody` is `0x` plus 40 hex.
  - `verifications` is an array of `0x` plus 40 hex, deduplicated ignoring case and capped at 32. Bad entries are dropped.
- Unknown fields (including `__proto__`) are dropped.

If storage is missing, throws, or refuses writes, a sign-in still lasts for the session (in memory), and an older stored record never wins over it. Sign-out removes the key. Nothing else is stored: no analytics, no server.

Validation is not escaping. A display name like `<img onerror=…>` is valid text. The app renders every field through the `html` tag (`app/src/html.mjs`), which escapes it (I3 tests this).

## Bundling (app lane)

`app/build.mjs` must:

1. Bundle with **`splitting: true`** (with `format: "esm"` and `outdir`). Without splitting, esbuild inlines every `import()` into the one file, and the SDK, the sign-in client and viem all land in the first-paint bundle. With splitting, the entry and each lazy chunk are separate files. `write: false` + `outputFiles[0]` no longer gives the whole bundle: write or hash every output file, and add the chunk files to `dist`.
2. Add **`identityBuildPlugin()`** from `app/src/identity/build-plugin.mjs`. `@farcaster/miniapp-core` declares no `sideEffects`, so without the plugin about 440 KB of zod stays in the Mini App chunk, although the SDK uses none of it at runtime (it only uses error classes and a Solana helper from the core). The plugin marks the core side-effect free, so esbuild drops it.
3. Decide how the service worker treats lazy chunks. Precaching them costs about 570 KB per install for everyone. Caching them on first use costs nothing for people who never sign in.

Measured by `app/test/identity-bundle.test.mjs` (esbuild 0.28.2, minified, not gzipped), with splitting and the plugin:

| Piece | Size |
| --- | --- |
| Identity in the first-paint bundle (store, QR encoder, sync surface) | 11.7 KB (about 5 KB of it is the QR encoder, tree-shaken if unused) |
| Lazy: identity flows | 6.7 KB |
| Lazy, loaded inside a host: flows + SDK | 47.5 KB |
| Lazy, loaded for web sign-in: flows + auth-client + viem | 359.0 KB |
| All lazy chunk files, including viem's own on-demand chunks (about 170 KB of viem "tempo" code that our paths never load) | 573.5 KB in 12 files |
| Same without the plugin | 1022.9 KB (Mini App path 496.9 KB) |

The SPEC-V3 budget is 600 KB for **all** lazy chunks (identity, wallet, chain reads). The stamps lane's chain reads will add their own viem use. Much of it should share chunks with the sign-in client, but measure the combined total in the app's build.

## What the app lane must do

- **Boot:** `ready()` after first paint. `onChange(render)` to redraw the chip, the passport and the sheet.
- **Sign-in sheet:**
  - `const ac = new AbortController(); signIn({ onUrl, signal: ac.signal })`.
  - In `onUrl(url)`, show the QR code as `<img src="${qrDataUrl(url)}" alt="">`. `img-src` already allows `data:`, and the `html` tag cannot inline a raw SVG string. Next to it, an "open on this phone" `<a href="${url}">`. The URL has already been checked as https.
  - Closing the sheet calls `ac.abort()`.
  - Map `err.code` to copy.
  - Inside a host, `signIn()` returns at once with no `onUrl`, so no sheet is needed.
- **Profile picture:** `<img src="${pfpUrl}" referrerpolicy="no-referrer" alt="">`. Validation is no substitute: render every identity field through `html`.
- **Share:** call `share(text, url)` straight from the click handler, without an `await` before it.
- **Minting:** `wallet()`. `null` means hide minting.
- **CSP** (docs/SPEC-V3.md "Budgets"):
  - `connect-src`: `https://relay.farcaster.xyz` (relay) and `https://mainnet.optimism.io` (verification), plus `https://mainnet.base.org` for the stamps lane.
  - `img-src https:` for profile pictures.
  - `script-src 'self'` covers the lazy chunks, which are same-origin files.
  - Inside a host the SDK talks over `postMessage`, so it needs no `connect-src`.
- **Embed tag,** so a shared link opens as a Mini App. The shape is from `@farcaster/miniapp-core` 0.7.0 `schemas/embeds.ts`: `version` `"1"`; `imageUrl` https, at most 1024 characters, no localhost or IP; optional `aspectRatio` `"3:2"` (default) or `"1:1"`; `button.title` at most 32 characters; `action.type` `"launch_miniapp"`; `action.name` at most 32 characters; optional https `url` and `splashImageUrl`; optional hex `splashBackgroundColor`. Escape the JSON as an attribute value (`escAttr` in build.mjs):

  ```html
  <meta name="fc:miniapp" content='{"version":"1","imageUrl":"https://p-u-c.github.io/Capable/embed.png","button":{"title":"Open capable","action":{"type":"launch_miniapp","name":"capable","url":"https://p-u-c.github.io/Capable/","splashImageUrl":"https://p-u-c.github.io/Capable/icon-192.png","splashBackgroundColor":"#F7F4EA"}}}'>
  <meta name="fc:frame" content='{ same JSON, with "action":{"type":"launch_frame", …} }'>
  ```

  The schema still parses `fc:frame` for older clients ("remove after compatibility period"). The embed image must be a raster file: hosts don't render SVG previews. Render a 3:2 PNG (for example 1200×800) from the art lane's seal or lockup at build time. Keep the button title free of `BANNED` words; "Open capable" is enough.
- **Copy that may name Farcaster:** only these keys, which the safety test allow-lists:
  - `signIn`: "Sign in with Farcaster" (the button)
  - `signInTitle`: the sheet heading, e.g. "Sign in with Farcaster"
  - `signInScan`: e.g. "Scan with your phone to approve in Farcaster"
  - `signInOpenHere`: e.g. "Open Farcaster on this phone"
  - `shareLabel`: e.g. "Share on Farcaster"
  - `handleLine`: e.g. `(u) => \`@${u} on Farcaster\``

  The error copy per code, "Sign out", and everything else need not name it.
- **Safety test, if its source scan goes recursive:** the only strings in `app/src/identity/` that match `BANNED` are the package specifiers `"@farcaster/miniapp-sdk"` (lazy-miniapp.mjs) and `"@farcaster/auth-client"` (lazy-auth.mjs). Exclude import specifiers from the scan; its own comment already intends that.
- **Gestures:** `ready()` passes no options. If a host's native swipe gestures fight the deck's horizontal swipes, the SDK accepts `ready({ disableNativeGestures: true })`; ask the identity lane to expose it.

## Tests

All offline. Network access fails the tests.

| File | Proves |
| --- | --- |
| `app/test/identity-miniapp.test.mjs` (I1) | With a mocked SDK: detection (the SDK is never loaded on a top-level page; a frame asks the SDK; false on reject, failed load or garbage; false within 1.5 s when the host hangs), `ready()` (once; no-op; never throws or hangs), context user → identity (no prompt, no network, stored, announced; hostile fields dropped; invalid user → `verify-failed`; cancel), host wallet with EIP-6963 fallback, host compose. Web share opens synchronously with the encoded compose URL and `noopener`. Web wallet: first announcement, `window.ethereum`, `null` after 300 ms. The API has exactly the contract's keys. |
| `app/test/identity-host.test.mjs` (I1) | The real `@farcaster/miniapp-sdk` 0.4.0, loaded through the module's own lazy path, talks to a simulated host over its real comlink/postMessage wire: detect, ready, context user, compose, and an EIP-1193 request reaching the host wallet. |
| `app/test/identity-siwf.test.mjs` (I2) | The real `@farcaster/auth-client` against a fake relay (`fetch`) and a fake Optimism verifier. A throwaway key generated in memory for each run signs real SIWE messages. Tested: success (channel params, deep link before polling, same nonce and domain to verify, stored fields, custody = signer); fresh nonces; timeout (pending, and a silent relay); cancel (before, while polling, during verification, `onUrl` throws); rejected (no signature, 401, 404, 400); verify-failed (wrong nonce, wrong domain, stranger's key, custody signing another fid, relay fid mismatch, swapped signature, garbage, oversize message, relay-chosen nonce, and our own checks with a verifier that says yes to anything); network (relay down, failed polls, 502 HTML, non-https link, no channel, 503, chunk load failure, Optimism unreachable); two failed polls tolerated; auth-address sign-in; hostile relay profile data. Every failure stores nothing, announces nothing, and leaves an earlier identity intact. |
| `app/test/identity-store.test.mjs` (I3) | Round trip; every bad core value clears the key; about 65 hostile optional values (javascript:, data:, http:, quote/bracket/backslash/space injection, credentials, RTL and other bidi controls, zero-width, C0/C1, a 10 KB username, …) are dropped while the account is kept, and the hostile bytes leave storage; boundaries; `__proto__`; frozen copies; sign-out; subscribers; other tabs; missing, throwing or full storage; `FORMAT_CHARS` equals the contract's; anything accepted passes `isDisplayName`; hostile-but-valid text stays text through `html`. |
| `app/test/identity-qr.test.mjs` | Bit-for-bit equal to python-qrcode 8.2 (forced mask) at v2, v3, v5 and v8 (with version info), including UTF-8. An in-test decoder (layout from the standard's tables, both format copies with BCH, Reed-Solomon syndromes of every block, data read back) decodes `qrMatrix` for every mask, and the drawn SVG, for many strings up to v15. The decoder fails on a flipped module. Also: SVG grammar and colours, quiet zone, no input text in the SVG, determinism, capacity, and `RangeError` past v40. |
| `app/test/identity-bundle.test.mjs` | The static import graph. An esbuild build with splitting and the plugin: no SDK, auth-client, viem, zod or ox in first paint; lazy total within 600 KB; zod gone; the plugin saves more than 300 KB. |

Checked once while building, not in the tests: zxing-cpp decoded 52 more of our codes (v3–v40, UTF-8), and two `qrSvg` outputs rasterised by cairosvg. python-qrcode matched all 88 forced-mask matrices from v1 to v40. Its automatic mask choice differs from ours for 2 of 11 inputs: its penalty rule N3 is non-standard, and ours follows ISO/IEC 18004. Any mask is valid.

## Not verified offline

- The live relay and Optimism RPC. In particular, the tests assume the relay's channel `url` is an https link to the client (`https://farcaster.xyz/~/siwf?channelToken=…`), as the contract says. A `farcaster://` link would be refused as `network`.
- Real host clients: the SDK is exercised only against a simulated host.
- How the `fc:miniapp` embed renders without a hosted manifest. The image size guidance comes from public docs, not from the installed code.
