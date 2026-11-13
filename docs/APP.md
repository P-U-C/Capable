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

Output, with the four real lessons: first paint about 217 KB (budget 400 KB:
page with the App inlined, the bundle and its static chunks, styles), lazy
chunks about 754 KB in 14 files (budget 900 KB, every file counted once; on
use: video 361 KB, sign-in 389 KB, stamps 303 KB, sharing viem), fonts about
246 KB. `node build.mjs` prints the breakdown; `--site <https url>` sets the
absolute URLs in the embed tags (default `https://p-u-c.github.io/Capable/`).

| File | What |
| --- | --- |
| `index.html` | shell, strict CSP, the App inlined as `<script type="application/json">` (`<` escaped), two font preloads, `modulepreload` for the entry's static chunks, the icon links, and the `fc:miniapp` / `fc:frame` embed tags |
| `app.<hash>.js`, `chunk.<hash>.js`, `app.<hash>.css` | the first-paint bundle (esbuild, code splitting) and its static chunks, and styles (with the `@font-face` rules) |
| `hls.<hash>.js` | hls.js 1.7 (light build) from npm, a lazy chunk imported on the first HLS play |
| `flows`, `lazy-miniapp`, `lazy-auth`, `codec` and their `chunk.*` | the identity flows, the Mini App SDK, the web sign-in client and viem, the stamps codec: lazy, loaded only on use |
| `<face>.<hash>.woff2` | the nine self-hosted faces from the `@fontsource` packages, latin only, `font-display: swap` |
| `app.json` | the same App; fetched on load, network-first, for updates |
| `manifest.webmanifest` | name from `app.name`, standalone, theme `#f7f4ea`, the hashed icons |
| `favicon.<h>.svg`, `favicon-16/32.<h>.png`, `apple-touch-icon.<h>.png`, `icon-192/512.<h>.png`, `icon-maskable-512.<h>.png` | the art lane's seal, copied from `art/icons/` (`lib/icons.mjs`) under content-hashed names |
| `embed.png` | the 3:2 card (1200×800, about 340 KB) a host client shows for a shared link; `assets/embed.png`, committed, drawn by `tools/embed.py` |
| `sw.js` | precaches the shell, the first-paint files, icons and fonts; caches lazy chunks on first use; never video, never the embed card |

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
| `src/fit.mjs` | long cards step their type down, then scroll with a cue in its own strip; never clip |
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
| `src/mint.mjs` | v3, DOM: the trait card's stamp: wallet lookup, the mint flow, its states |
| `src/citizen.mjs` | v3: the local citizen record (`capable.citizen@<base path>`: a random local id, the wallet address once shared, mint transactions sent), the preview holder |
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
mouse drag that starts on text selects it. Keys: ←/→, Space and Shift+Space,
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
citizen line, "4 lessons · 3 min each · 4 traits to earn", and one magenta
button, "Start lesson 01" (later "Continue lesson 02", and "See your traits"
when every ready lesson is done). The tile of the lesson up next has the only
magenta tile button; finished lessons are quiet (a short art strip, a white
"Read again", a "done" sticker), and unstarted ones say "not started" instead
of an empty bar. Tiles are named by title and state and described by their
promise; their art is hidden from screen readers. From 900px wide the tiles
sit in two columns.

## Citizens (v3)

**Trait card (U6).** The card takes the trait colour. The stamp module's
`preview()` (the exact on-chain art, tokenId 0) is pressed onto it with a
scale-and-rotate thud (a fade under reduced motion); its holder is the
signed-in person's first verified address, else the wallet once it has shared
one, else a stand-in derived from the local id. Then:

- no contract configured (`stamps.config(app)` is null, as in production
  until the owner deploys), no `stampId` for the trait, or no wallet: "Saved to
  your passport" (a link to it); a draft says it stays off the passport. The
  wallet code is not even loaded without a contract.
- a contract and a wallet (`identity.wallet()`): "Mint this stamp". The flow
  is `stamps.mint()`; a watching provider wrapper shows the step (switching to
  Base, choosing an account, confirm in your wallet). Sent: the explorer link,
  and the transaction is remembered so this browser never offers a second one.
  Rejected, wrong network, offline, no account: say so and offer Try again
  (nothing was sent). Any other wallet failure: "check your wallet", no retry.
  A wallet that already holds the stamp on chain says so.

**Passport (`#/passport`).** A portrait (seeded `fid:<fid>` when signed in,
else the local id), the profile picture over it (https only, no referrer;
removed on error so the portrait shows), the name and "@username on
Farcaster", the citizen line, the lockup filled with earned and on-chain
traits, each trait's stamp (earned here / on chain via `stamps.owned()` for
the known addresses when a contract exists / on its way / not yet), lessons
done, Share (`identity.share`, called straight from the tap: "I'm becoming
capable: 2 of 4 traits." and the public passport URL when an address and a
contract exist, else the app URL), and Sign in / Sign out.

**Public passport (`#/p/<address>`).** Read-only: a portrait seeded by the
address, the short address (no name), the address's stamps from chain. States:
reading, none yet, the RPC down (Try again), no contract configured.

**Sign-in.** At boot `identity.isMiniApp()`. Inside a host: `ready()` after
the first frame, then `signIn()` from the host's context (no prompt, no sheet).
On the web, "Sign in with Farcaster" opens a sheet: a QR code of the deep link
(`identity.qrSvg`, inline), "Open Farcaster on this phone" to the same link,
Cancel and Esc (both abort through the AbortController), and copy per
`IdentityError` code. Signing in or out, here or in another tab, redraws the
chip and the passport.

**Identity copy.** Only `signIn`, `signInTitle`, `signInScan`,
`signInOpenHere`, `shareLabel` and `handleLine` may name the provider; the
safety test allow-lists exactly those keys.

**Embed.** `fc:miniapp` and `fc:frame` carry version 1, the absolute
`embed.png`, and a button ("Open capable") that launches the app with the
hashed 192px icon as splash. (A hosted manifest needs a custom domain.)

## Safety (A4)

- Every App string is escaped by `html` or `rich`; markup reaches the DOM only
  through `innerHTML = String(render…())` (a test enforces this).
- Only `https:` URLs become links or media. Bad URLs render nothing.
- External links: `target="_blank" rel="noopener noreferrer"`.
- CSP (meta): everything `'self'` (scripts, styles, fonts, the lazy chunks),
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
stamps, share, the chip, the sign-in sheet in every phase and error, Cancel/Esc
aborting, the Mini App boot path, the public passport in every state, the
header logo's fill), `test/trait.test.mjs` (P2/U6: the trait card's look and
stamp, no contract / no stamp id / no wallet / wallet → mint → sent, rejected,
wrong network, failed without resend, already held, the preview holder),
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
- `python3 -I tools/embed.py`: renders `tools/embed.mjs` (the lockup, the four
  stamps and six portraits on paper) to `assets/embed.png` at 1200×800.
- `python3 -I tools/check.py --dist <dist>`: behaviour checks in Chrome:
  keys, taps, swipes, text selection, focus, titles, fonts, resume, ticks,
  Esc, history (Back from home leaves), live update, offline, CSP.

## Known gaps

- Captions: the contract has no caption field for videos, so there is no
  `<track>`; ingest would need to collect VTT files first.
- The Playfair fallback metrics against Georgia are estimated, not measured.
- The ink idea card's top corner still shows the peeking card through its
  radius (U18's second glitch); the logo's "e" glitch went with the old logo.
- A host's native swipe gestures may compete with the deck's; the SDK's
  `ready({ disableNativeGestures: true })` is not exposed by the identity
  module yet.
