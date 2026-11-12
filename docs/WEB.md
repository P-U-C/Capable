# Primer — web lane notes

The web lane owns `web/` and this file. It renders a `Book` (contract/book.d.ts)
and, inside the artifact, an optional live `Overlay`. It holds no detection or
classification logic of its own.

## Layout of `web/`

| Path | What it is |
| --- | --- |
| `src/html.mjs` | The only way markup is built: an `html` tagged template that escapes every interpolated value unless it is already `SafeHtml` from this module; `safeUrl` (https only). |
| `src/inline.mjs` | W1. Tokenizes contract `Inline` text into text / `*em*` / `[label](https://…)` / `{{sub:0x…}}` and renders each token escaped. |
| `src/router.mjs` | W2. `#cover` (default), `#glossary`, `#credits`, `#about`, `#<id>`, `#<id>-essay`, `-source`, `-voices`, `-end`. Plain names only; unknown → cover. |
| `src/overlay.mjs` | W3. `collect` (db snapshots → contract `Overlay`), `mergeOverlay` (pure), `readOverlay` (one read, 10 s timeout, any rejection → null). |
| `src/model.mjs` | Derived lookups: as-published order, the editor's path, neighbours, voice order, prize status, countdown, UTC dates. Pure; the clock is a parameter. |
| `src/figure.mjs` | W6. The Founder-Citizen SVG. |
| `src/map.mjs` | W7. Map layout (pure, testable geometry) and SVG render. |
| `src/views.mjs` | W5. Cover, idea, glossary, credits, about, voice card, prize card, popover. |
| `src/app.mjs` | The UI layer: mounts, routes, delegates events, stores progress, reads the overlay, ticks countdowns. The only module that touches the DOM or `Date.now()`. |
| `src/main-link.mjs` / `main-inline.mjs` | Entry points for the artifact and hosted builds. |
| `src/player.mjs`, `src/miniapp.mjs` | Hosted build only: inline HLS, and the Mini App `ready()` call. |
| `src/styles.css` | All styles. Tokens from DESIGN.md. |
| `build.mjs` | Validates the Book, bundles with esbuild, writes the single-file outputs. |
| `static/` | `og.png` (1200×800), `icon.png` (1024×1024, no alpha), `splash.png` (200×200), copied into the hosted build. Regenerate with `tools/images.py`. |
| `test/` | `node:test` suites (see "Proof" below). `test/index.js` exists because Node 22 does not search a directory passed to `node --test`; it imports every `*.test.mjs`. |
| `tools/` | Local checks in headless Chrome: `shoot.py` (screenshots), `interact.py` (40 interaction checks), `images.py` (share images). Not run by the gate. |

## Build

```bash
cd web
npm ci
npm test                       # node --test test/
npm run build                  # both outputs
node build.mjs --media=link    # artifact only  → dist/index.html
node build.mjs --media=inline  # hosted only    → dist/hosted/index.html (+ .well-known/farcaster.json, images)
node build.mjs --book ../content/build/book.json --out /tmp/out
BASE_URL=https://primer.example.org npm run build
```

`--book` defaults to `content/build/book.json` when it exists, else the contract
fixture. The Book is checked with `validateBook`; any error fails the build and
nothing is written.

**Artifact (`--media=link`)**: one HTML file; inline `<style>`, inline
`<script type="module">`, the Book as `<script type="application/json" id="book">`
with every `<` written as `<`. The only remote loads are the Google Fonts
stylesheet and its font files. No images, no media, no fetch. Videos open on
Farcaster ("Watch on Farcaster ↗"); voices use monogram discs.

**Hosted (`--media=inline`)**: the same app, plus inline playback (native HLS on
Safari; hls.js 1.5.20 from cdnjs elsewhere, loaded only when a reader presses
Play), the `fc:miniapp` embed meta, `og:` tags, a CSP meta tag (inline script
and style pinned by sha256; scripts only from cdnjs; fonts only from Google;
media and connections https), and `.well-known/farcaster.json`.

The artifact deliberately has **no CSP meta tag**: the artifact runtime injects
`window.claude` by means we do not control, and a page-level policy could block
it. The artifact sandbox has its own policy.

The contract validator ends in a Node CLI block; an esbuild plugin cuts it off
for the browser bundle (`// CLI:` marker), so the bundle has no `node:` imports.

## Design decisions

The brief in DESIGN.md is specific (paper, ink, rubric, Newsreader, Plex Mono,
hairlines). The choices below are what DESIGN.md left open.

- **Rubrication, literally.** Rubric marks wayfinding and liveness only: the
  catalogue numerals (large and light, so a 128px numeral is a thin stroke, not
  a block of colour), the drop-cap on the editor's note (a rubricated initial),
  depth-section numbers, the current depth underline/tick, open countdowns and
  draft pills, winner places, the newest facet of the Figure, and the focus
  ring. Everything else is ink.
- **Book conventions over app conventions.** Paragraphs inside prose are set
  without space between them and with a first-line indent, like a printed
  book. Asides are sidenotes in the right margin at ≥ 1100px, aligned to the
  block they follow, and indented pilcrow notes on phones. Previous/next at
  the foot of an idea read like a catchword: the next title, flush right, in
  italic.
- **The depth bar carries information.** Each segment shows its cost: the
  line ("5 sec"), minutes for minute/essay/source (from word counts), and the
  voice count. Each depth section ends with a "Go deeper" line naming the next
  depth and its cost, shown only at the depth where it applies.
- **Default depth is Minute.** First visits show the line and the minute; a
  reader opts into the essay. The chosen depth is stored. A deep link
  (`#id-voices`) raises the depth for that visit only and does not overwrite
  the stored choice.
- **Read means reached the end.** An idea counts as read when its end pieces
  stay in view for 1.2 s (so arriving on `#id-end`, or flicking past, does not
  count by itself), or when the reader presses Mark as read. Mark as unread
  exists too. Updating progress refreshes only "You, now" and the rail, so a
  playing video is never torn down.
- **The editor's note line, then the Figure.** The cover shows the dated note
  line with its drop-cap and folds the paragraph into "Read the whole note",
  so Begin is reachable on a phone without a long scroll.
- **Index.** Rows are whole-row links (the title link stretches over the row).
  On the editor's path the index lists the path, then "Not on the editor's
  path yet" (in as-published order), then "Just in · unplaced". The book's
  frame (prologue and coda) opens and closes the editor's path even if the
  path data leaves them out, so Begin is always the prologue when there is one.
- **As published** is the prize `postedAt` order; ideas without a prize keep
  their slot in catalogue order (prologue first, coda last). Prev/next follow
  the chosen path. An idea that is not on the editor's path falls back to as
  published, and the pager says so.
- **Prize status is the Book's.** The UI never reclassifies. An `open` prize
  whose deadline has passed in the reader's clock reads "Open · deadline
  passed" until the next refresh says otherwise. Status is derived (by the
  SPEC rules) only if a Book leaves it out.
- **Monograms.** First letter of the username; for an unresolved person, the
  first digit of the fid (so chips still differ from each other).
- **Voices filter**: All, Winners, and Videos/Builds when present, done with a
  data attribute (no re-render).

### The Figure

120×120 grid, centre (60, 58), 1.5px strokes (1.25 on the cover).
`tools` is an r=44 circle with a 28° gap at the bottom; `trust` two r=30 arcs
facing each other inside it; `choice` a line from inside the circle through
the gap ending in a chevron; `founding` a ground line at y=114 with an 8×8
square. Notches are short ticks: inward on the circle, outward on the trust
arcs (alternating arcs), across the choice line, below the ground line
(stepping around the square). Positions are evenly spaced over all ideas on the
strand ordered by catalogue number, so a notch never moves when the reader
reads in a different order. Unknown strands get a 20° arc on an outer ring
(r=54) in slots that fill the top first and alternate outwards, never reaching
the ground; past 11 unknown strands, shorter arcs at half-slot offsets. States:
dotted `--rule` (no reads), `--ink`, `--rubric` (all strands of the most
recently read idea). Each group has `<title>` "Civil — 2 of 3 ideas". Adding a
strand never changes an existing mark (tested).

### The map

- One column per idea in as-published order, so time reads left to right and
  no two ideas share a column; labels wrap to two lines inside their column,
  so visible labels cannot collide (tested at 40 ideas and several widths).
- A 104px sticky gutter holds the band names (buttons that filter the index),
  so on a phone the bands stay named while the map scrolls sideways inside its
  frame. The page never scrolls sideways (checked at 320px).
- Bands are reordered (exhaustively for ≤ 7 strands) so two-strand ideas sit on
  adjacent bands when possible; such an idea sits between its bands, with a
  stem if they cannot be adjacent. Strandless drafts get a "Just in · unplaced"
  band. Prologue and coda are square bookends at the far left and right.
- Column width fills the frame on wide screens (up to 168px) and drops to 84px
  on phones; past 12 nodes in a band, the column narrows to 60px and labels in
  that band show only on hover or focus.
- Edges are quadratic curves bowing to the left of travel, so A→B and B→A do
  not overlap. `in-tension-with` is dashed. Edges to the bookends are faint.
  Hovering or focusing a node darkens its edges and shows their kinds.
- On first load the map scrolls to its right end (the newest picks); after
  that it keeps the reader's position across re-renders.

### Type and layout shift

Google Fonts: Newsreader (ital, opsz 6–72, wght 200–800) and IBM Plex Mono
400/500, `display=swap`. Fallback faces use `size-adjust` and ascent/descent
overrides computed from `@capsizecss/metrics` (Newsreader vs Georgia: 96.12%,
76.47%, 27.57%; vs Times New Roman: 105.48%, 69.68%, 25.12%; Plex Mono vs
Menlo/Courier New: 100%, 102.5%, 27.5%), so the swap does not move text.

### Contrast

`test/contrast.test.mjs` checks every text pair in the stylesheet. Light:
ink-2 on paper-2 5.60:1, rubric on paper 4.94:1, rubric on paper-2 4.56:1.
Dark: ink-2 on paper-2 6.78:1, rubric on paper 5.55:1. The unread Figure marks
are decorative ghosts and are not text.

## Security model

- Every value reaches HTML through `html\`…\`` and is escaped (`& < > " ' \``).
  No `innerHTML` of anything that did not come out of a view function; no
  inline `style=` or `on*=` attributes anywhere in rendered markup (tested).
- Inline text is tokenized, not regex-replaced in place. Only exact forms
  match: `*x*` (no nesting), `[label](https://…)` (no whitespace, quotes,
  backticks, brackets, parentheses or backslashes in the URL), and
  `{{sub:0x` + 40 lower-case hex `}}`. Everything else is literal. A fuzz test
  renders 3 000 random markup soups and checks that only `a, em, button, span,
  p` with known attributes and https hrefs ever appear.
- All external links: https only, `rel="noopener noreferrer" target="_blank"`.
- Overlay docs are validated with the contract validators, their doc id must
  equal their natural key, invalid docs are dropped and counted, and the merge
  never mutates the snapshot. Connections and strands pointing at unknown ids
  are ignored at render. The db is read once; nothing is written.
- No `alert/confirm/prompt`, `window.open`, downloads, workers or service
  workers (the build test greps the artifact bundle). `localStorage` access is
  wrapped; stored state is sanitized on load.

## Farcaster Mini App (hosted build)

The hosted `index.html` carries:

```html
<meta name="fc:miniapp" content='{"version":"1","imageUrl":"<BASE_URL>/og.png","button":{"title":"Read Primer","action":{"type":"launch_miniapp","name":"Primer","url":"<BASE_URL>","splashImageUrl":"<BASE_URL>/splash.png","splashBackgroundColor":"#F3EFE6"}}}'>
```

and `dist/hosted/.well-known/farcaster.json` is a manifest template with
`accountAssociation` placeholders. The page calls the host's `actions.ready()`
over the same comlink channel the official SDK uses (`src/miniapp.mjs`, ~5 KB)
instead of bundling the 500 KB SDK, and only when it is embedded (an iframe
or a React Native WebView). Without `ready()` a Mini App host shows its splash
screen forever.

### Deploying and signing

1. Build with the public URL: `BASE_URL=https://your.domain npm run build`.
   `BASE_URL` must be https, with no trailing slash.
2. Serve `web/dist/hosted/` at that URL, including `og.png`, `icon.png`,
   `splash.png` and `.well-known/farcaster.json` (served as
   `application/json`).
3. Sign the domain: open
   `https://farcaster.xyz/~/developers/mini-apps/manifest?domain=your.domain`
   in the Farcaster app or web while signed in with the account that will own
   the Mini App, and sign. The payload is `{"domain":"your.domain"}`; the
   domain must match the host exactly (no scheme, no path). The tool returns
   `header`, `payload` and `signature` (a JSON Farcaster Signature made with the
   account's custody or auth address).
4. Paste those three values over the `REPLACE_WITH_…` placeholders in
   `.well-known/farcaster.json` and redeploy. Keep the signed values out of the
   repo if the deploy target allows (they are public anyway once served, but
   they bind the domain to the account).
5. Check with the Mini App preview tool in Farcaster's developer settings, and
   cast the URL to see the embed.

No key or seed phrase is handled by the build or the page; signing happens in
the Farcaster client. The embed spec page at the time of writing lists
`launch_frame` as the action type; this build uses `launch_miniapp` as briefed.
If a client rejects the embed, switch the type in `build.mjs` (`miniappEmbed`).

## Proof

| Row | Test |
| --- | --- |
| W1 | `test/inline.test.mjs` — escaping, `<script>`, `javascript:`/`http:`/`data:`/protocol-relative/upper-case schemes, attribute break-outs, malformed `{{sub}}` (10 shapes), unclosed and nested markup, paragraphs, fuzz. |
| W2 | `test/router.test.mjs` — every page and every idea × section round-trips; unknown ids, unknown sections, non-plain hashes → cover. |
| W3 | `test/overlay.test.mjs` — append, replace by key, drop + count invalid, re-sort by number, people/strands/prizes, snapshot untouched, last-write-wins, refresh time, id/key mismatch, `readOverlay` for absent / null / rejecting / hanging / working db, unknown links ignored at render. |
| W4 | `test/build.test.mjs` — builds both outputs into a temp dir; the artifact has no script/style/img/media src outside the allowlist, no remote CSS, no fetch/open/alert/worker in the bundle, the Book round-trips, size < 3 MB; hosted embed meta, manifest, CSP; invalid Book fails; deterministic output. |
| W5 | `test/views.test.mjs` — every view from the fixture: landmarks, one h1, the unofficial notice, all five depth sections and four end pieces, depth state, essay blocks, draft banner, countdown, cover parts, voice order and cards, popover, connections, You now, Your turn, glossary, credits, about, overlay footer, escaping across all views, a 43-idea book. |
| W6 | `test/figure.test.mjs` — 0 reads; reads on 2 strands; a two-strand idea; all 4 + a 5th unknown strand; marks stable when strands are added; notch positions independent of reading order; 18 strands distinct and deterministic; highlight mode; escaping. |
| W7 | `test/map.test.mjs` — every idea is a node on its strand(s), two-strand ideas between bands, publish order left to right, every connection an edge (tension dashed), drafts hollow and reads checked, unplaced band and index group, 40 ideas with no overlapping visible labels and hidden labels past 12, labels within columns at several widths, band filter, path switch changes prev/next, pager and index order. |

Also `test/contrast.test.mjs` (AA for every text pair, light and dark).

Local, not in the gate: `python3 web/tools/interact.py` (Begin, keys 1–5 and
←/→, chip popover and Escape, deep-link depth, mark as read, read on scroll,
path switch, band filter, 320px overflow on six views, a fake `window.claude`
overlay arriving late, storage that throws) and `python3 web/tools/shoot.py`
(screenshots at 390×844, 1280×800 and 320×640, light and dark).
