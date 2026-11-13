# capable: the app

The phone-first PWA described in [SPEC-APP.md](SPEC-APP.md), styled by
[DESIGN-APP.md](DESIGN-APP.md). It reads one `App` (`contract/app.d.ts`) and
shows a home feed of lessons and, for each lesson, a deck of cards to swipe.
App-lane owned: `app/` and this file.

## Build and test

```bash
cd app
npm ci
npm test                      # node:test, pure modules, no network
npm run build                 # → app/dist/ (fails if the App fails the contract)
node build.mjs --app <app.json> --out <dir>
```

`--app` defaults to `content/build/app.json` when it exists, else
`contract/fixtures/app.sample.json`. The build validates with
`contract/validate-app.mjs` and stops on any error. `dist/` is not committed.

Output, with the four real lessons: first paint about 250 KB (budget 400 KB:
page with the App and the styles inlined, the bundle and its static chunks), lazy
chunks about 754 KB in 14 files (budget 900 KB, every file counted once; on
use: video 361 KB, sign-in 389 KB, stamps 303 KB, sharing viem), fonts about
246 KB. `node build.mjs` prints the breakdown; `--site <https url>` sets the
absolute URLs in the embed tags (default `https://p-u-c.github.io/Capable/`).

| File | What |
| --- | --- |
| `index.html` | shell, strict CSP, the App inlined as `<script type="application/json">` (`<` escaped), the styles inlined in one `<style>` pinned by its sha256 in `style-src`, home's header prerendered into `#app` as a static first paint, two font preloads, `modulepreload` for the entry's static chunks, the icon links, and the `fc:miniapp` / `fc:frame` embed tags |
| `app.<hash>.js`, `chunk.<hash>.js` | the first-paint bundle (esbuild, code splitting) and its static chunks |
| `hls.<hash>.js` | hls.js 1.7 (light build) from npm, a lazy chunk imported on the first HLS play |
| `flows`, `lazy-miniapp`, `lazy-auth`, `codec` and their `chunk.*` | the identity flows, the Mini App SDK, the web sign-in client and viem, the stamps codec: lazy, loaded only on use |
| `<face>.<hash>.woff2` | the nine self-hosted faces from the `@fontsource` packages, latin only, `font-display: swap` |
| `app.json` | the same App; fetched on load, network-first, for updates |
| `manifest.webmanifest` | name from `app.name`, standalone, theme `#f7f4ea`, the hashed icons |
| `favicon.<h>.svg`, `favicon-16/32.<h>.png`, `apple-touch-icon.<h>.png`, `icon-192/512.<h>.png`, `icon-maskable-512.<h>.png` | the art lane's seal, copied from `art/icons/` (`lib/icons.mjs`) under content-hashed names |
| `embed.png` | the 3:2 card (1200×800, about 340 KB) a host client shows for a shared link; `assets/embed.png`, committed, drawn by `tools/embed.py` |
| `sw.js` | precaches the shell, the first-paint files, icons and fonts; caches lazy chunks on first use; never video, never the embed card |

**First paint on a slow link (review T7).** The page used to stay blank until
the bundle ran. Now home's header (logo, headline, what this is, free/no
account, "Start lesson 01") is rendered at build by the app's own pure
`renderHome(…, { shellOnly: true })` into `#app`, and the stylesheet is
inlined, so the HTML alone paints it; the app replaces it on boot. The CSP
still has no `'unsafe-inline'`: `style-src` adds exactly the sha256 of that
one stylesheet (`cspFor`, `styleHashOf` in build.mjs). Measured with the user
test's harness (`slow3g_gz.py`: gzip, 320×568, 4× CPU), first contentful
paint on slow 3G (2 s RTT, 50 KB/s): 7.46 s before, 5.02 s with the static
header alone (the HTML → CSS round trip), 2.30 s with the styles inlined; on
fast 3G 2.24 s → 0.82 s. A returning reader is served from the service worker.

The browser bundle never carries the banned-word list (review C12):
`contract/banned.mjs` resolves to `contract/banned.stub.mjs`, the
validator's banned-word lines are dropped, and its `VIDEO_HOSTS` are read
from the page's CSP (`src/csp.mjs`), which the build writes from the real
list. The build fails if the contract file changes shape; a test checks that
no `dist/*.js` contains a banned word. So in the browser a fetched
`app.json` is checked for structure only; the build and compile enforce the
word list.

## How it fits together

Everything that renders is a pure function returning escaped markup, so it is
tested in Node. The DOM halves are thin.

| Module | Role |
| --- | --- |
| `src/html.mjs` | the `html` tag (escapes every value), `safeUrl` (https only), `extLink` (`target=_blank rel="noopener noreferrer"`), `rich` (`*emphasis*` only) |
| `src/deck.mjs` | A1 pure engine: `deckCards` (work slots resolved, empty ones skipped, a final "next" card, a stable `key` per card, step ids), the state machine, `resumeAt`, `isFinishedAt`, segments, `stackPose`, `settle`, `rubberBand`, `tapZone`, `keyAction` |
| `src/model.mjs` | reading order, trait progress, `upNext` (home), `nextAfter` (the hand-off), `homeFacts`, the context a deck renders with; drafts never count toward any total |
| `src/cards.mjs` | every card type and the deck chrome; idea looks (`ideaLook`, `keyPhrase`); `pixelLabel` (the "//" is `aria-hidden`) |
| `src/fit.mjs` | long cards step their type down, then scroll with a cue in its own strip; never clip. Big titles (Shouts, the passport's name) never break inside a word: they shrink (`--title-scale`, CSSOM) until the longest word fits, and only below 55% break as a last resort; a name too long beside the photo puts the photo above it |
| `src/work.mjs` | A2 lead/more rendering, credits, video controls markup, `pickSource` (native HLS, mp4, hls.js, external) |
| `src/player.mjs` | the `<video>` per frame, created on first play; hls.js imported once from `src/hls.mjs`; play/pause/seek and the frame's controls; `mayAutoplay` |
| `src/home.mjs` | A3 the intro, tiles and the "you" panel |
| `src/store.mjs` | progress in `localStorage` (`capable.progress@<base path>`), by card key and step id, every access guarded; converts the old index-based `citizen.v1` lesson by lesson |
| `src/shell.mjs` | boot: routing, history, titles, updates, SW registration; every browser object injected (tested with a fake DOM) |
| `src/gesture.mjs`, `src/view-deck.mjs`, `src/view-home.mjs`, `src/main.mjs` | pointer and keyboard input, focus, players, the "more" sheet; `main.mjs` only calls `boot` |
| `src/data.mjs` | reads the inlined App; a fetched `app.json` replaces it when valid, not older, and different in content (`generatedAt` ignored) |
| `src/csp.mjs` | the hosts a CSP directive of this page allows (the browser's `VIDEO_HOSTS`) |
| `src/passport.mjs` | v3, pure: your passport, a public passport, the chip's avatar, the sign-in sheet; `earnedTraitIds` |
| `src/view-passport.mjs` | v3, DOM: the passport (on-chain reads, share, sign in/out, the sheet), the public passport, the picture fallback |
| `src/mint.mjs` | v3, DOM: the trait card's stamp: wallet lookup, `stamps.check()`, the mint flow, the receipt wait, its states |
| `src/citizen.mjs` | v3: the local citizen record (`capable.citizen@<base path>`: a random local id, the wallet address a wallet shared, mint records keyed by chain, contract and stamp), the preview holder, the addresses the passport reads and the one a share may carry |
| `src/stale.mjs` | review V7: after a deploy, a lazy chunk that won't load → is the live `sw.js` still listing this page's bundle? If not, "capable was updated — reload to continue" |
| `src/seen.mjs` | review T10: what a returning reader hasn't seen (`capable.seen@<base path>`: per lesson, the work ids shown), for the "new" stickers |
| `src/identity/`, `src/stamps/` | the identity and stamps lanes' modules, used as they are (docs/IDENTITY.md, docs/STAMPS.md) |

Routes: `#/` home, `#/you` the you panel, `#/l/<id>` a lesson (it opens at the
remembered card), `#/passport` your passport, `#/p/<0x address>` anyone's
public passport. An unknown lesson id or a malformed address is replaced by
home.

History: a lesson or a passport opened from home is marked on its history entry. Closing it
(the close button, Esc, "All lessons") goes back to that entry, so Back from
home leaves the app, as an installed app should; a lesson reached by a deep
link or reload is replaced by home. Moving to the next lesson or to "See your
traits" replaces the entry. Each lesson titles the page ("Own Your Exit ·
capable").

### The deck

Cards sit in a stack: the current one on top, the next one 16px to the right
(10px of paper past the shadow), the ones already read dealt off to the left
and turned 3°. A drag moves only `transform`. Release past 22% of the width,
or a flick faster than 0.35 px/ms, moves one card; anything less springs back.
Past either end the card is rubber-banded. Taps: the left third goes back,
the right third goes forward, and the middle plays or pauses a video. A press
held 350ms on a video pauses it until release; on text cards a long press is
left to the browser, so text can be selected, copied and looked up, and a
mouse drag that starts on text selects it. A swipe may start anywhere on a
card: `.card__body` scrolls, and touch-action stops at a scroll container,
so it says `touch-action: pan-y` itself, or the browser would claim the
horizontal pan and cancel the pointer (review T1). A tap moves the deck on
pointerup; for 400 ms after it the stage swallows pointer clicks, so the
tap's own click can't land on what is now under the finger (the "up next"
link, a practice step; review T2). Keyboard clicks are never swallowed. Keys: ←/→, Space and Shift+Space,
Home/End, Esc to close; on a video card Space and K play or pause. With
reduced motion, cards crossfade and never move.

Below 560px of viewport height (a phone in landscape, or any screen zoomed to
200% and more) the stack is dropped: the current card sits in the page at its
full height, the page scrolls, and the progress bar stays at the top. Below
300px of width the segments become one bar and paddings shrink.

Each card is a `<section role="region">` named "Card 3 of 14: idea". Inactive
cards are `inert`, and focus moves to the new card, which names itself (there
is no second, live-region announcement). The segmented bar is a
`progressbar`: read cards are filled and hatched in ink, the current one is
filled on arrival with a heavier outline (or follows the video), unread ones
are empty.

The lesson is finished when its trait card is on screen (End jumps past it
and does not count), and only a ready lesson is ever recorded as done. The
last card hands off to the first unfinished ready lesson after this one,
wrapping round ("2 lessons left"), and says "All caught up" only when every
ready lesson is done.

Practice steps are checkboxes; ticks are kept by each step's id (a hash of
its text), and ticking every step shows "done this week".

### Counting

Lessons with `status: "draft"` are shown and can be read, but never count
toward any total: the trait card's count, the logo's fill, the trait chips and
the "N of 4" on home and in the you panel. The trait card shows one count,
"// N of M lessons done", where M is the ready lessons in the whole app and N
is how many of those the reader has finished (this one included). Lesson
`number` only orders lessons; the reader sees their position ("// 03").

### Work slots

`lead` renders each lead work full size: a 9:16 frame for video, or the
caption with "open the guide ↗" / "see the code ↗" for a build. `more`
stacks the other works; a video opens in a sheet. Credits read "by @username"
(or "a creator"), with a quiet "original ↗". A slot with no work for its role
is skipped.

Video: nothing is fetched before play (`preload="none"`). A lead video may
start on its own when its card becomes active, always muted, and not at all
with reduced motion, Save-Data, `prefers-reduced-data`, or a 2G/3G or
cellular connection; then the play button starts it, with sound if the
reader turned sound on before. Once started the frame shows its controls: a
44px play/pause button, a scrub bar (its keys and drags never move the deck)
and the clock, plus the sound pill. Safari plays HLS natively; elsewhere an
mp4 plays directly, or hls.js is imported once from its local chunk, starts
at the lowest level, keeps a 10s buffer and stops loading while paused. A
swiped-away video pauses; players more than one card away are released, and
all are released when the deck closes. On any failure the frame shows the
lesson's art and a "watch the original ↗" link. No captions yet: the
contract has no caption field.

## Design (A6)

All visual decisions are in two files:

- `src/tokens.css`: colours, outline, hard shadows, radii, the five font roles
  and their measured fallbacks, the grain tile, spacing, motion.
- `src/art.mjs`: trait colour from `trait.hue` (the four candies are exact;
  any new hue gets a bright candy with AA ink contrast, tested for all 360),
  seeded pixel confetti, the four hand-drawn two-tone scenes, and (v3) the
  bridges to the art grammar (`art/index.mjs`): the seal lockup, generated
  scenes for any lesson without a hand-drawn one (new lessons and drafts),
  portraits and stamp previews. Every generator's SVG is admitted through
  `svgMarkup` (`src/html.mjs`), which refuses anything but one plain `<svg>`
  (no script, style, foreign content, links, external or `data:` references).

Scenes are drawn inside a 320×240 safe box and bleed far past it, so they fit
any frame shape (wide tile, square, 9:16 poster) without cropping the subject.
Grain is one tiled SVG-filter image laid over frames in CSS, which is far
cheaper than a filter per scene.

Card treatments (A6 polish):

- **Idea** cards rotate three looks by their place among the lesson's ideas
  (`ideaLook(ord)`: 1st fill, 2nd paper, 3rd ink, then again): trait-colour
  fill with ink text; off-white paper with the key phrase marked in the trait
  colour (the text's own `*emphasis*`, else a short first sentence, else a
  short lead-in ending in a colon); ink with off-white text and emphasis in
  the trait colour. Text is Inter 700, about 32px, top-weighted under the
  eyebrow. A big outlined Archivo numeral (the idea's number) and a seeded
  confetti cluster sit bottom-left in the space left below the text, sized to
  it, and are hidden when there is no room, so they never touch text.
- **Counter** is two stacked stickers: the objection in a white box with an
  ink `// but` tab, the reply in a trait-tinted box with a trait `// reply`
  tab. Body type is 16–19px.
- **Story** headings carry a trait-colour marker stroke; story text is 17–20px.
- **Fit**: on mount, on resize and when web fonts arrive, each text card
  steps its type down (`data-fit` 1 = 92%, 2 = 85%, with 14px floors) until
  its body fits. Past that the body scrolls and a "more below" tab shows in
  its own strip under the body (never over text) until it is scrolled to the
  end. On 390×844 every real card fits
  at step 0 or 1; on 320×568 the longest counters and practices scroll.

Trait colours reach the DOM only through CSSOM (`src/paint.mjs` sets
`--trait` on `[data-hue]` elements), so the markup never carries `style=""`.

## Home

The header carries the citizen seal and wordmark (`seal({mode: "lockup",
filled})`): its ring fills with the traits earned (a trait is earned by
finishing any of its ready lessons; drafts never count). On a first run the
ring is empty: the wordmark's four candies carry the brand, and the ring only
ever gains colour (the full ring would drop to one quarter after the first
lesson). The "you" chip opens the passport; signed in, it shows a 48px
portrait or profile picture.

The intro under the headline says what this is and where to start: the
citizen line, "4 lessons · 3 min each · 4 traits to earn", "Free. No account
needed. Your progress stays in this browser." (review T6), and one magenta
button, "Start lesson 01" (later "Continue lesson 02", and "See your traits"
when every ready lesson is done). The tile of the lesson up next has the only
magenta tile button; finished lessons are quiet (a short art strip, a white
"Read again", a "done" sticker), and unstarted ones say "not started" instead
of an empty bar. Tiles are named by title and state and described by their
promise; their art is hidden from screen readers. From 900px wide the tiles
sit in two columns.

What's new (review T10): a first visit takes every lesson and work as seen.
Later, a lesson the reader hasn't seen gets a "new" sticker, a lesson with
works added since gets "N new", and the intro links the first of them ("2
new since your last visit: Own Your Exit"), until the reader opens it. The
chip reads "// passport | 1/4" (review T19). The you panel ends with "Made by
zoz · open source ↗" (the repository; also on both passports, review T6).

## Citizens (v3)

**Trait card (U6, review V1, V12).** The card takes the trait colour. The
stamp is pressed on with a scale-and-rotate thud (a fade under reduced
motion). Until it is minted it is a preview, printed with no serial ("#—"),
and the mint note says so ("This is a preview: your stamp's own pattern is
set when it's added"): the real pattern depends on the minting account and
the token id the chain assigns. Its preview holder is the connected wallet's
account, else the signed-in person's listed address, else a stand-in from
the local id. Then:

- no contract configured, no `stampId` for the trait, or no wallet: "Saved to
  your passport" (a link to it); a draft says it stays off the passport. The
  wallet code is not even loaded without a contract.
- a contract and a wallet: `stamps.check()` for the wallet's shared account
  (or, before one is shared, a fixed stand-in, to learn only whether the
  trait is open). Open and not held: "Add this stamp to your wallet". Held:
  "Already in your wallet". Closed: saved, and "adding this stamp to wallets
  is paused for now". The chain can't be read: just "Saved", nothing about
  minting.
- minting: `stamps.mint()` (it re-checks for the account the wallet picks and
  refuses held/closed before sending, with a pinned chainId). A watching
  provider shows the step. Sent: the record is kept as pending and the card
  says "Sent. Confirming…" with the receipt link; `stamps.receipt({ holder:
  from })` is polled ~2 s after the send, then every 2/3/5/8/10 s (a pending
  answer with an error is a failed read, not a failed mint). Success: the
  real stamp is drawn (holder and token id from the chain, its serial
  printed), recorded as minted, and "Share my public passport" is offered with
  the address shown first. Reverted: "That transaction failed, so nothing was
  added", the link, and "Check again" (a fresh `check()` before any new
  attempt; the record is forgotten). No receipt after ~5 min: "Sent, still
  confirming", the link, the record kept; a later visit looks again, and one
  older than 10 min with no receipt never landed (forgotten after a check, or
  "held" if the chain has it anyway). Nothing is ever sent again by itself.
- errors: only "wallet" can follow a send ("check your wallet", no retry);
  held/closed are their own states; every other code means nothing was sent
  and offers Try again.

**Mint records (review V8).** Keyed `"<chainId>:<contract>:<stampId>"` with
`{ txHash, explorerUrl, chainId, contract, stampId, from, status, tokenId,
sentAt }`, so a new contract or chain starts clean. Records the first v3 build
kept by trait id migrate at boot, once the App gives each trait's stamp id,
as pending (they were never confirmed).

**Addresses (review V9, V14).** The relay's `verifications` are not covered by
the sign-in signature, so they are never proof of ownership: the connected
wallet's account comes first everywhere, and verifications are a last resort
for this browser's own display. A share, and the passport's link to your
public passport, carry only an address the reader chose in their own wallet
here (one they minted from), shown on the page first ("It shows only the
stamps in your wallet (0x5e5f…9e8f). Share links to it."). A wallet seen
silently through `eth_accounts` never goes into anything shared.

**Passport (`#/passport`).** A portrait (seeded `fid:<fid>` when signed in,
else the local id), the profile picture over it (https only, no referrer;
removed on error so the portrait shows), the name and "@username on
Farcaster", the citizen line, the lockup filled with earned and on-chain
traits, each trait's stamp (earned here / on chain via `stamps.owned()` for
the known addresses when a contract exists, or from this browser's minted
records / on its way / not yet), lessons done, "See your public passport"
when there is a chosen address (review T4, T9), Share (`identity.share`,
called straight from the tap: "I'm becoming capable: 2 of 4 traits." and the
chosen address's public passport, else the app URL), Sign in / Sign out, and
the about line. Sign out also forgets the wallet address and the mint records,
so the next person on a shared browser sees none of them (review T5); inside
a host client there is no Sign out (the host signs you straight back in, T17).
The profile picture and the portrait under it share one circular frame with a
3px ink outline (the hard shadow follows the circle), on the passport and in
the 48px chip, so a picture that fails to load swaps without a jump.

**Public passport (`#/p/<address>`).** Read-only. It opens, above the fold,
on what capable is for someone new: "capable is 4 short lessons, 3 minutes
each. Free, no account." with the citizen line and "Start lesson 01" (review
T3). Then a portrait seeded by the address, "Someone's passport", "wallet
0x7a11…ffee", the address's stamps from chain ("Each stamp was earned by
finishing a lesson, then added to this wallet"), "Start your own passport"
and the about line. States: reading, none yet, the RPC down (Try again), no
contract configured.

**Sign-in.** At boot `identity.isMiniApp()`. Inside a host: `ready()` after
the first frame, then `signIn()` from the host's context (no prompt, no sheet).
On the web, "Sign in with Farcaster" opens a sheet: a QR code of the deep link
(`identity.qrSvg`, inline), "Open Farcaster on this phone" to the same link
on a touch screen ("Open the sign-in link here" elsewhere, review T8; the
scan line hides once the code has failed), Cancel and Esc (both abort through the AbortController), and copy per
`IdentityError` code. Signing in or out, here or in another tab, redraws the
chip and the passport.

**Identity copy.** Only `signIn`, `signInTitle`, `signInScan`,
`signInOpenHere`, `shareLabel` and `handleLine` may name the provider; the
safety test allow-lists exactly those keys.

**After a deploy (review V7).** A page still running old code can't load
its lazy chunks (Pages replaced them; the new service worker deleted the old
caches). When sign-in, the wallet or chain code, or hls.js fails to load (and
whenever `check()` can't read), the shell asks `stale.mjs`: the live `sw.js`
(never cached by the worker, fetched with `cache: "no-store"`) lists the
first-paint bundle; if it no longer lists the one this page runs (or a new
worker has taken the page over), a yellow bar says "capable was updated —
reload to continue" with a Reload button. The route is in the hash and the
deck saved the card, so the reload resumes right there. A "no" is remembered
for 30 s; offline it says no and the usual error stays.

**Embed.** `fc:miniapp` and `fc:frame` carry version 1, the absolute
`embed.png`, and a button ("Open capable") that launches the app with the
hashed 192px icon as splash. (A hosted manifest needs a custom domain.)

## Safety (A4)

- Every App string is escaped by `html` or `rich`; markup reaches the DOM only
  through `innerHTML = String(render…())` (a test enforces this).
- Only `https:` URLs become links or media. Bad URLs render nothing.
- External links: `target="_blank" rel="noopener noreferrer"`.
- CSP (meta): everything `'self'` (scripts, styles, fonts, the lazy chunks),
  plus, in `style-src`, the sha256 of the one inlined stylesheet (review T7),
  `img-src 'self' data: https:` (the grain; profile pictures), `media-src
  'self' blob:` plus the contract's `VIDEO_HOSTS`, `connect-src 'self'` plus
  the same hosts and exactly `https://relay.farcaster.xyz`,
  `https://mainnet.optimism.io` and `https://mainnet.base.org`, `worker-src
  'self'`, `object-src 'none'`, `frame-src 'none'`, `base-uri 'none'`,
  `form-action 'none'`. No `unsafe-inline`, no wildcard; the one bare `https:`
  is in `img-src`. Inside a host the SDK talks over postMessage and wallets
  over their own channels, so they need nothing more. (A Base Sepolia dry run
  would need `https://sepolia.base.org`.) Trusted Types are not enforced yet:
  the identity and chain libraries have not been checked against them.
- viem's Tempo-chain error resolver (about 170 KB, imported only when a Tempo
  action fails; nothing here uses Tempo) is replaced at build by a stub that
  returns the error unchanged (`viemTempoStub` in build.mjs).
- No inline event handlers anywhere.
- App chrome is checked against the contract's `BANNED` list: every string in
  `src/copy.mjs`, every string literal in `src/`, the rendered visible text and
  accessible labels of every view (passports, sheet and stamp states
  included), the built shell and manifest, and every script of ours in
  `dist/`. The six identity copy keys and the identity module's two endpoint
  URLs are the only exceptions; chunks made only of third-party code (the
  SDK, the sign-in client, viem, hls.js) are library text, never shown, and
  are checked only for the list itself.
- The service worker stores only the shell and hashed assets, only good
  responses (200, and the right content type for the page and `app.json`),
  under cache names that carry its scope; other in-scope pages are never
  stored.

## Tests

`npm test` runs the pure modules and, through a small fake DOM
(`test/dom.mjs`: a parser for the app's own markup, the selectors it uses,
events, a window with history), the DOM halves: progress saving and resuming
by key, finishing, video pause/release and autoplay rules, Space/K, ticks,
the sheet, gestures, and the shell's history, titles, unknown routes and
updates (`test/view.test.mjs`).

v3: `test/passport.test.mjs` (P1: routes, the passport signed out and in, on-chain
stamps, share without a silent address and with a chosen one, sign out
forgetting, no sign out in a host, the about line, round pictures, the chip,
the sign-in sheet in every phase and error and on touch or not, Cancel/Esc
aborting, the Mini App boot path, the public passport in every state and its
newcomer strip, the header logo's fill), `test/trait.test.mjs` (P2/U6, V1,
V8, V12: the trait card's look and preview, no contract / no stamp id / no
wallet, check() open / held / closed / RPC error, mint refused held/closed,
receipt success / reverted / timeout / dropped / unreadable, rejected, wrong
network, failed without resend, record keys and migration, a v2 contract,
and the real stamps module against a scripted RPC), `test/stale.test.mjs`
(V7: the chunk-error words, the update check, and recovery in the mint,
sign-in and video entry points with the reload resuming the deck),
`test/home.test.mjs` (T10: what's new), `test/view.test.mjs` (T1 swipes from
the body, T2 the tap's own click, titles that shrink instead of breaking),
`test/safety.test.mjs` (the exact identity allow-list), `test/build.test.mjs`
(P3: the exact CSP, budgets with static chunks, identity and chain code lazy,
hashed icons from `art/icons/`, the maskable icon decoded, the embed tags).

## Dev tools (not part of the build)

- `node tools/compose.mjs > /tmp/real.json`: the fixture with the decks from
  `content/lessons/` swapped in, for realistic screenshots.
- `python3 -I tools/shoot.py --dist <dist> --out <dir> [--only v3a]`:
  screenshots in headless Chrome at 390×844, 320×568, 1280×800, 200% zoom
  and landscape, for every lesson in the built `app.json`, plus a per-card fit
  report. Fonts and hls.js come from `dist`; every `.m3u8`/`.ts` is answered
  from a local ffmpeg test stream (see the header of `shoot.py`).
- `python3 -I tools/shoot.py --dist <dist> --out <dir> --section v3b`: only
  the citizens pass (logo, trait card states with a mocked wallet, passports,
  the sign-in sheet with a mocked relay, a public passport with a mocked Base
  RPC, a draft's generated scene, the favicon in a mock tab strip). Nothing
  leaves the machine. Build the dist from `tools/compose.mjs` output (which
  includes the draft and the v3 trait fields).
- `python3 -I tools/shoot.py --dist <dist> --out <dir> --section fix`: the
  review-fix pass (the trait card's states from the chain, confirming → the
  real stamp, reverted, the update bar and its reload, the newcomer's public
  passport, your public-passport link, round pictures, long names, what's
  new). Build the dist from the offline compile, as deploy.yml does (review
  T18): `node ingest/bin/refresh.mjs --offline --out /tmp/book.json --app-out
  /tmp/app.json` then `node build.mjs --app /tmp/app.json --out <dist>`.
- `python3 -I tools/embed.py`: renders `tools/embed.mjs` (the lockup, the four
  stamps and six portraits on paper) to `assets/embed.png` at 1200×800.
- `python3 -I tools/check.py --dist <dist>`: behaviour checks in Chrome:
  keys, taps, swipes, text selection, focus, titles, fonts, resume, ticks,
  Esc, history (Back from home leaves), live update, offline, CSP.

## Known gaps

- Review items not taken here: T15 (focus starts on the passport's name, which
  announces the page; Shift+Tab reaches the close button and Esc closes),
  T16 (at 200% zoom the page scrolls like any page, and Tab and Esc reach the
  actions), T20 (muted autoplay is a product choice; reduced-motion and
  reduced-data readers already get tap-to-play), T11 in the README (planner).
- A tap on the right of the practice card lands on a step and ticks it (the
  steps span the card); the hint says "then swipe on".

- Captions: the contract has no caption field for videos, so there is no
  `<track>`; ingest would need to collect VTT files first.
- The Playfair fallback metrics against Georgia are estimated, not measured.
- The ink idea card's top corner still shows the peeking card through its
  radius (U18's second glitch); the logo's "e" glitch went with the old logo.
- A host's native swipe gestures may compete with the deck's; the SDK's
  `ready({ disableNativeGestures: true })` is not exposed by the identity
  module yet.
