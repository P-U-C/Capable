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

Output (about 167 KB with the four real lessons, budget 400 KB before fonts and video):

| File | What |
| --- | --- |
| `index.html` | shell, strict CSP, the App inlined as `<script type="application/json">` (`<` escaped) |
| `app.<hash>.js`, `app.<hash>.css` | the bundle (esbuild) and styles |
| `app.json` | the same App; fetched on load, network-first, for updates |
| `manifest.webmanifest` | name from `app.name`, standalone, theme `#f7f4ea` |
| `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `favicon-32.png` | rendered at build time in plain Node (`lib/icons.mjs`) |
| `sw.js` | caches the shell and `app.json`; never video or other origins |

## How it fits together

Everything that renders is a pure function returning escaped markup, so it is
tested in Node. The DOM halves are thin.

| Module | Role |
| --- | --- |
| `src/html.mjs` | the `html` tag (escapes every value), `safeUrl` (https only), `extLink` (`target=_blank rel="noopener noreferrer"`), `rich` (`*emphasis*` only) |
| `src/deck.mjs` | A1 pure engine: `deckCards` (work slots resolved, empty ones skipped, a final "next" card), the state machine, segments, `stackPose`, `settle`, `rubberBand`, `tapZone`, `keyAction` |
| `src/model.mjs` | reading order, trait progress, the context a deck renders with; drafts never count toward any total |
| `src/cards.mjs` | every card type and the deck chrome; idea looks (`ideaLook`, `keyPhrase`) |
| `src/fit.mjs` | long cards step their type down, then scroll with a cue; never clip |
| `src/work.mjs` | A2 lead/more rendering, credits, `pickSource` (native HLS, mp4, hls.js, external) |
| `src/player.mjs` | the `<video>` per frame, created on first play; hls.js 1.5.20 loaded once from cdnjs when needed |
| `src/home.mjs` | A3 tiles and the "you" panel |
| `src/store.mjs` | progress in `localStorage` (`citizen.v1`), every access guarded |
| `src/gesture.mjs`, `src/view-deck.mjs`, `src/view-home.mjs`, `src/main.mjs` | pointer and keyboard input, focus, players, routing, updates, SW registration |
| `src/data.mjs` | reads the inlined App; a fetched `app.json` replaces it only if newer and valid |

Routes: `#/` home, `#/you` the you panel, `#/l/<id>` a lesson (it opens at the
remembered card).

### The deck

Cards sit in a stack: the current one on top, the next one 16px to the right
(10px of paper past the shadow), the ones already read dealt off to the left
and turned 3°. A drag moves only `transform`. Release past 22% of the width,
or a flick faster than 0.35 px/ms, moves one card; anything less springs back.
Past either end the card is rubber-banded. Taps: the left third goes back,
the right third goes forward, and the middle plays or pauses a video. A press
held 350ms pauses the video and the progress fill until release. Keys: ←/→,
Space and Shift+Space, Home/End, Esc to close. With reduced motion, cards
crossfade and never move.

Each card is a `<section role="region">` named "Card 3 of 14: idea". Inactive
cards are `inert`, focus moves to the new card, and a polite live region
announces it. The segmented bar is a `progressbar`; the current segment fills
with reading time (or video time).

Reaching the trait card finishes the lesson. The last card hands off to the
next lesson, or to the you panel after the last one.

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

Video starts muted when its card becomes active, with a "tap to unmute" pill,
and pauses when the card leaves. Safari plays HLS natively; elsewhere an mp4
plays directly, or hls.js is fetched once on first play. On any failure the
frame shows the lesson's art and a "watch the original ↗" link.

## Design (A6)

All visual decisions are in two files:

- `src/tokens.css`: colours, outline, hard shadows, radii, the five font roles
  and their measured fallbacks, the grain tile, spacing, motion.
- `src/art.mjs`: trait colour from `trait.hue` (the four candies are exact;
  any new hue gets a bright candy with AA ink contrast, tested for all 360),
  the blob-letter **capable** logo, seeded pixel confetti, and the two-tone
  screenprint scenes per lesson (seed scene for drafts and unknown lessons).

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
  its body fits. Past that the body scrolls and a small round "more below"
  cue shows until it is scrolled to the end. On 390×844 every real card fits
  at step 0 or 1; on 320×568 the longest counters and practices scroll.

Trait colours reach the DOM only through CSSOM (`src/paint.mjs` sets
`--trait` on `[data-hue]` elements), so the markup never carries `style=""`.

## Safety (A4)

- Every App string is escaped by `html` or `rich`; markup reaches the DOM only
  through `innerHTML = String(render…())` (a test enforces this).
- Only `https:` URLs become links or media. Bad URLs render nothing.
- External links: `target="_blank" rel="noopener noreferrer"`.
- CSP (meta): `script-src 'self' https://cdnjs.cloudflare.com`, `style-src 'self'
  https://fonts.googleapis.com`, `font-src https://fonts.gstatic.com`,
  `media-src 'self' blob: https:`, `connect-src 'self' https:`, `worker-src
  'self' blob:`, `object-src 'none'`, `base-uri 'none'`. No `unsafe-inline`.
- No inline event handlers anywhere.
- App chrome is checked against the contract's `BANNED` list: every string in
  `src/copy.mjs`, every string literal in `src/`, the rendered visible text and
  accessible labels of every view, and the built shell and manifest.

## Dev tools (not part of the build)

- `node tools/compose.mjs > /tmp/real.json`: the fixture with the decks from
  `content/lessons/` swapped in, for realistic screenshots.
- `python3 -I tools/shoot.py --dist <dist> --out <dir>`: screenshots at
  390×844, 320×568 and 1280×800 in headless Chrome, for every lesson in the
  built `app.json` (each card type, the first six idea cards by look), plus a
  per-card fit report (`fit`: step, scrolls, overflow px).
- `python3 -I tools/check.py --dist <dist>`: behaviour checks in Chrome:
  keys, taps, swipes, focus, resume, ticks, Esc, live update, offline, CSP.

The sandbox cannot reach Google Fonts, cdnjs or the video hosts. `shoot.py`
answers those requests locally: fonts from `@fontsource` packages, hls.js from
its npm package, and every `.m3u8`/`.ts` from a test stream made with ffmpeg
(`/tmp/appassets`; see the header of `shoot.py`).

## Known gaps

- hls.js is loaded without SRI: its cdnjs bytes could not be fetched here to
  hash. Add `integrity` to `src/player.mjs` once checked.
- The Playfair fallback metrics against Georgia are estimated, not measured.
- The service worker does not cache Google Fonts; offline, text falls back to
  the local faces.
