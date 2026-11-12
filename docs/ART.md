# capable art: one grammar, many pieces

Art-lane owned (`art/`, this file). Spec: docs/SPEC-V3.md "Art grammar".
Contract: `ArtAPI` in contract/citizen.d.ts. Readiness: R1, R2 in
docs/READINESS-V3.md.

`art/` is a pure ESM package with no dependencies. Everything visual in v3
(the logo, the favicon and app icons, each lesson's scene, a citizen's
portrait, the stamps) comes from it, so every piece belongs to one family and
no two pieces are the same.

```bash
node --test art/test/          # R1 (also: node scripts/gate.mjs --lane art)
node art/bin/gallery.mjs       # R2: writes art/gallery.html
python3 art/bin/shoot.py       # screenshots of each gallery section → /tmp/art-gallery/
node art/bin/icons.mjs         # app icon set → art/icons/ (SVG; PNG when Playwright is available)
```

## API

```js
import { seal, iconSvg, lessonScene, portrait, stamp } from "./art/index.mjs";

seal({ mode: "logo" | "lockup" | "favicon", size?, filled? })   // → SVG string
iconSvg({ size, maskable? })                                      // → SVG string
lessonScene({ lessonId, color, title?, uid?, grain? })            // → SVG string
portrait({ seed, color?, uid?, title? })                          // → SVG string
stamp(...)  // === contract/badge-art.mjs badgeSvg (imported, not copied)
```

| Call | Notes |
| --- | --- |
| `seal({mode:"logo"})` | The citizen seal, 240-unit square. `size` = rendered px (default 240). Under 96 px it drops the beaded rim and ring rules (optical sizing). |
| `seal({mode:"lockup"})` | Seal + the "capable" wordmark, as paths. `size` = height in px; width follows (≈ 3.3×). |
| `seal({mode:"favicon"})` | 64-unit square: ring + solid head and shoulders. Plain at ≤ 24 px; adds eight broad sun rays above that, and the collar above 48 px. |
| `filled` *(extension)* | Logo and lockup only. Trait ids (`"sovereign"`, `"civil"`, `"mobile"`, `"enduring"`) whose ring quarter is coloured; the others print as paper between the ink rules, so the home logo can fill in as traits are earned. Omitted = full ring. Ids without a quarter light nothing; a non-array throws. |
| `iconSvg({size, maskable})` | Solid paper square. Maskable keeps the whole seal, shadow included, inside the central 80% circle. ≤ 48 px uses the favicon. |
| `lessonScene` | `lessonId` is the seed (non-empty, ≤ 256 chars). `color` is the trait colour, `#RRGGBB` in any case (uppercased; anything else throws). `title` makes it `role="img"`; without one the scene is decorative (`aria-hidden`). |
| `uid` *(extension)* | Salts the id prefix, for the same scene or portrait twice on one page (a tile and a cover). |
| `grain:false` *(extension)* | Drops the built-in grain, for frames that already carry the app's `--grain` overlay (avoids double grain). |
| `portrait` | `seed` is a string or number (fid, address, local id). `color` (optional) is the garment colour. `title` *(extension)* defaults to "A citizen's portrait"; `""` makes it decorative. |

Rules every generator keeps (all tested in `art/test/`):

- **Deterministic**: same input → byte-identical SVG, in any process, any
  TZ or locale. No `Math.random`, no clock, no locale formatting. Numbers are
  rounded to one decimal.
- **Palette only**: every `fill`/`stroke` and every hex literal is in
  `ALLOWED` (`art/palette.mjs`) or is the caller's trait colour. No named or
  functional colours, no `style` attributes.
- **Self-contained**: no `<image>`, `<use>`, `<script>`, `<style>`,
  `<foreignObject>`; no `http(s):` or `data:` anywhere except the SVG
  namespace; `url()` only to an internal `#id`.
- **Namespaced ids**: every id in a piece starts with one prefix, a kind
  letter plus a base-36 hash of the kind, seed, colour and `uid`
  (`s1k3j9a-d`). Every reference resolves inside the same piece. The seal,
  lockup, favicon and icons have no ids at all.
- **Small**: each SVG ≤ 16 KB (scenes run 4–10 KB, portraits 2–4 KB).
- **Accessible**: titled pieces are `role="img"` with `aria-label` and a
  first-child `<title>` (no id, so copies never clash). Text is escaped and
  control characters are stripped.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| paper | `#F7F4EA` | ground of everything, the seal's rim, unfilled ring quarters |
| ink | `#161616` | line work, hard shadows, windows, hair |
| cyan / magenta / lime / yellow | `#18C8F0` `#FF1FC8` `#5CF27E` `#FFE11A` | the four candies: ring order, trait colours |
| surface | `#FFFDF6` | faces, open doors, the seal's disc, card white |
| slate | `#5B6488` | the riso second tone: halftone dots, water, ground, shade |
| lilac / blush / sky | `#E4DDF7` `#F7D9EF` `#DDEBFA` | portrait backgrounds and blush (the app's confetti tints) |

That is the whole allow-list. A scene or portrait may also use the one trait
colour its caller passes in (a new trait's candy from `traitColor(hue)`).

Shape rules:

- **Ink line** 2.6 units in scenes (detail lines 1.6–2.4), 3.5 in portraits,
  5–6 in the seal; round joins and caps.
- **Hard offset shadow**: solid ink, offset down-right (the seal by 8/108 of
  its radius, the wordmark by 4, portraits by 5).
- **Misregistration**: a scene's big trait-colour shape is printed 1.5/1 units
  off its ink outline, like a second riso pass (`regPath`, `regCircle`).
- **Riso grain**: two `feTurbulence` filters (dark specks, light specks), the
  same recipe as the app's `--grain`, over the whole bleed. Seeded per scene.
- **Halftone**: slate dots (6-unit cell, 28°), ink dots (5-unit cell, −20°,
  45%), slate hatch (7-unit, 45°). Patterns, not images.
- **Pixel confetti**: only in corners, never over the subject (portraits;
  the stamp has its own).
- **The citizen**: a round head over rounded shoulders, the head floating just
  clear of the body. Faces are blank or minimal. Full-body in scenes
  (`figure`, `sitter`), head and shoulders in the seal, portraits and crowds
  (`bust`).

## The seal

```
 rim: paper, ink edge, 36 ink beads        r 105–108
 ring: four candy quarters                 r 70–94   (top cyan, right magenta,
       ink rules on the diagonals                     bottom lime, left yellow)
 disc: surface with a yellow sunburst       r 70      (14 wedges, 10 when small)
 citizen: surface head, ink shoulders       head r 21; shoulders end on the disc
          with a surface V collar           edge, so no clipPath is needed
 shadow: the whole seal in ink, +8/+8
```

The sunburst makes the citizen rise like a sun, which reads as a civic emblem
rather than an avatar placeholder, and echoes the sun in the scenes. The ring
quarters match the founding traits (`TRAIT_QUARTER`), the same order as the
stamp's ring.

**Wordmark.** "capable" in monoline rounded letters: each glyph is a list of
centre-line strokes (bowl radius 14.5, stem width 11) drawn three times: an
ink shadow (+4/+4), an ink outline (width 18), then the candy (width 11).
Counters stay open because strokes never fill a bowl. Letter colours cycle
cyan, magenta, lime, yellow. No font is involved.

**Favicon.** Ink disc, the ring as four thick quarters, a surface disc, a solid
ink head and shoulders. `FAVICON` exports the geometry, and the raster test
samples those exact points at 16 and 32 px in Chromium.

## Lesson scenes

A scene is a 320×240 safe box. Paper, sky and ground bleed to
x −160…480 and y −240…480, so `preserveAspectRatio="xMidYMid meet"` fills a
wide tile or a 9:16 card with no bars (the same approach as the hand-drawn
scenes in app/src/art.mjs).

### How a seed becomes a scene

1. `rand("scene|" + lessonId)`: xmur3 hashes the string into four 32-bit
   words that seed sfc32 (warmed up 12 steps). Every later choice is the next
   draw from this one stream, in a fixed order.
2. Draw 1 picks the **template** (uniform over `TEMPLATE_NAMES`); draw 2
   picks **mirror** (50%: the whole picture flipped horizontally).
3. The defs draw two **grain seeds**.
4. The template draws its own parameters: horizon, hero shape and size,
   positions, how many figures, their poses and items, fills, the background
   treatment (halftone dots 5 : hatch 2 : plain 2 : banded dots 2).
5. The id prefix is `"s" + base36(hash("scene|" + lessonId + "|" + color + "|" + uid))`.

The colour never changes the composition: the same lesson in another trait
colour is the same picture, recoloured.

### Templates

Each template is one small, legible picture of a civic idea. The seed varies
everything inside it, never the idea.

| Template | The picture | What the seed varies |
| --- | --- | --- |
| `threshold` | a door ajar in a brick wall (trait colour); someone walks out | wall height and end, door size and place, brick course, wall decor (key on a nail, lamp, flag, plaque), walker's item and hat, a second figure waving in the doorway, sky dots or hatch |
| `table` | people at a long table under a big disc or arch; one talks | disc or arch and its place, 2–4 people, who raises a hand, fills, hats, cups / papers / bowls, the speech bubble, bunting |
| `towns` | small towns on rolling hills (trait colour), a path walked between them | one of four town layouts with jitter, 2–4 houses each, fills, footprints or a dotted path, pines, a signpost, the sun placed away from every town |
| `street` | a row of houses and one civic building under a big sun | sun size and place, the civic building (hall with columns, sawtooth workshop, block), house sizes, an empty lot, a lamp post, passers-by |
| `bridge` | a humped bridge (trait colour) over a river; people meet on it | bank height, river width, hump, two meeting or one crossing, trees on the banks, sun or clouds |
| `ballot` | a ballot box on a plinth before a big disc; a queue of voters | disc place, queue length, fills, items (paper, bag), hats, a flag, bunting |
| `commons` | a big tree (trait-colour canopy) on the commons, a bench, people resting | canopy cluster, trunk, bench side, 1–2 sitters, a standing figure, a mound, a second tree, a fence, birds, a sun |
| `crossroads` | a road to the horizon, a road across it, a signpost (one board in the trait colour) | horizon, hills, field side, sign boards, a town at the vanishing point, roadside pines, a far traveller, the traveller in front |
| `assembly` | someone speaks from the steps; a crowd listens, seen from behind | disc or banner, steps, 5–7 people in the crowd, their fills, raised hands, placards |
| `gate` | a picket fence with an open gate (trait-colour arch); a path through it | gate width and height, which leaf is open, trees behind the fence, the walker, someone waiting beyond, the sun |

`sceneChoice(lessonId)` returns `{template, mirror}` (the gallery labels each
scene with it). Every rendered scene carries `data-template="…"`.

### Motifs (`art/lib/motifs.mjs`)

Primitives: `P` (filled, outlined path), `line`, `rect`, `circle`, `blot`,
`regPath`/`regCircle` (misregistered trait-colour shapes), `rrPath`.
Figures: `figure` (standing; poses `down`, `up`, `wave`, `out`, `hold`; items
`bag`, `flag`, `sign`, `paper`, `key`; hats `cap`, `beanie`), `sitter`, `bust`.
Objects: `house`, `block`, `win`, `workshop`, `hall`, `flag`, `doorway`,
`bricks`, `bigKey`, `lamp`, `tree` (+ `shade`), `pine`, `bench`, `fence`,
`bubble`, `cup`, `signpost`, `ballotBox`, `bunting`, `footprints`, `sun`,
`cloud`, `birds`, `lampPost`, `speed`.

### Adding a motif

1. Write it in `art/lib/motifs.mjs` as a pure function of explicit numbers and
   colours: no randomness inside a motif (the template decides). Use `P`,
   `line`, `rect`, `circle` so it gets the ink line, round joins and
   palette-safe fills. Fill with `SURFACE`, `SLATE`, `INK` or the trait colour
   the template passes in; never a new hex.
2. Draw it at the scale of its neighbours: a standing figure is about 74 units
   tall, a house 20–40 wide, the ground line sits near y 185–205.
3. Use it from a template, taking its parameters from that template's `r`.
   Keep the draws in a fixed order. Adding draws in the middle of a template
   changes every later choice for that template's scenes (allowed, but review
   the gallery).
4. If it needs a pattern or filter, add it to `defs()` in `scene.mjs` with an
   id built from the prefix `p` (`${p}-x`), never a bare id.
5. Run `node --test art/test/`, then `node art/bin/gallery.mjs` (the
   committed gallery must match) and `python3 art/bin/shoot.py`, and look at
   the screenshots.

### Adding a template

Add a function to `TEMPLATES` in `art/lib/scene.mjs` returning
`{ body, about }`, and a row to the table above. Adding or removing a template
re-maps which template many lesson ids get (draw 1 is `r.pick` over the list).
That is fine: scenes are drawn at run time, never stored. Stamps are the only
art that must never change, and they are not drawn here.

## Portraits

160×160. `rand("portrait|" + seed)` draws, in order: background colour (four
candies, lilac, blush, sky); garment colour (replaced by the caller's `color`
when given); hat
(none 10 : beanie 2 : cap 2 : beret, headband, bucket 1.5 each); hair (11
styles: none, crop, fringe, bun, puff, long, bob, spikes, curls, ponytail,
undercut); hair colour (mostly ink, then slate, rarely a candy); hat colour;
collar (crew, v-neck, shirt collar, turtleneck, hoodie, overalls, scarf,
stripes, lapels); background block (full square, disc, arch, split);
backdrop (plain, dots, stripes, rays); eyes (none, dots, happy arcs, glasses);
blush; smile; head tilt (±7°); head position and size; then confetti. Hats hide
the hair cap but keep long hair, a bob, a puff or a ponytail behind. The
garment draw always happens, so passing `color` changes the clothes, not the
person. A hard ink shadow
sits under the bust. Line weights hold from a 48 px avatar to a 320 px page.
1,000 seeds give over 950 distinct feature combinations before confetti.

## Stamps

`stamp` is `badgeSvg` from contract/badge-art.mjs, imported unchanged. It
shares the grammar (paper, ink, the candy ring, the citizen, hard shadow) but
has no grain or halftone, so the Solidity port can be byte-identical. Any
change to its look is a planner change there (docs/BADGE-ART.md).

## Notes for the app

- Scenes: inline `lessonScene({lessonId, color: traitColor(hue), title,
  grain: false})` inside frames that already tile `--grain`; pass `uid` when
  the same scene shows twice on one page (home tile + cover). The hand-drawn
  scenes stay for their four lessons unless the planner prefers generated ones.
- Logo: `seal({mode: "lockup", size, filled: earnedTraitIds})` for the home
  header; `seal({mode: "logo"})` where a mark alone fits.
- Icons: `node art/bin/icons.mjs` writes `art/icons/` (favicon.svg,
  favicon-16/32.png, icon-192/512.png, icon-maskable-512.png,
  apple-touch-icon.png). Copy them at build; the SVGs are checked fresh by the
  tests.
- Portraits: `portrait({seed: String(fid)})`, or a local random id when
  signed out, or the address on `#/p/<address>`.
