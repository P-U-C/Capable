# Primer — design system

Planner-owned. The web lane implements it and records decisions in `docs/WEB.md`.

## The idea in one line

A field guide printed on good paper that is also a live client: you can read it
like a book, while it quietly keeps up with the network.

It should not look like a crypto dashboard, a generic AI landing page, a
Farcaster clone, or an Apple clone. Its quality should come from typography,
spacing and restraint, plus one signature object (the Figure) and one signature
control (the Depth bar).

## Craft reference: rubrication

Medieval books were written in black ink, with the openings, numbers and
navigational marks in red. That red ink is called *rubric*. Primer uses the same
rule. Ink is for reading. Rubric is for wayfinding and for things that are
*live*: chapter numbers, the current depth, an open prize's countdown, and the
newest facet of the Figure. Use rubric sparingly. If more than about 5% of a
screen is rubric, it is too much.

## Tokens

| Token | Light | Dark |
| --- | --- | --- |
| `--paper` | `#F3EFE6` | `#14130F` |
| `--paper-2` (cards, end pieces) | `#ECE6D9` | `#1C1A15` |
| `--ink` | `#1B1A17` | `#ECE6D8` |
| `--ink-2` (secondary text) | `#5E594F` | `#A8A193` |
| `--rule` (hairlines) | `#D6CEBD` | `#34302A` |
| `--rubric` | `#B3412A` | `#E2674A` |
| `--rubric-wash` (rubric at ~10%) | `#B3412A1A` | `#E2674A22` |

Follow `prefers-color-scheme`. Text pairs must pass WCAG AA; check `--ink-2` on
`--paper-2` in particular.

**Type** (Google Fonts, the only allowed remote stylesheet host):
- *Newsreader* (variable, with optical size) for everything you read: body at
  18/30 on mobile and 19/32 on desktop, display at large optical sizes with
  tight tracking.
- *IBM Plex Mono* for metadata only: kickers, fids, hashes, timestamps,
  counts, status pills. Use 12–13px, uppercase, letter-spacing 0.06em.
- Use old-style numerals in running text and lining numerals in mono.
- The fallback stack must look right if the fonts fail to load:
  `Georgia, "Times New Roman", serif` and `ui-monospace, Menlo, monospace`.

**Space**: a 4px base and the scale 4, 8, 12, 16, 24, 32, 48, 72, 112. Keep the
reading measure at 34rem or less. Separate sections with hairline rules and
generous space, not with boxes.

**Shape**: corners at 2px or less, or none. Hairlines are 1px `--rule`. No
shadows except the 1px top hairline on the sticky bar. No gradients and no glow.

## Layout

- **Mobile first.** Use a single column. The **Depth bar** is a fixed bottom
  bar with five segments (Line, Minute, Essay, Source, Voices), at least 44px
  tall, padded with `env(safe-area-inset-bottom)`. Add `viewport-fit=cover`
  only together with safe-area padding.
- **Desktop (≥ 1100px)**: three columns. A left rail holds the vertical Depth
  bar and the chapter list with progress. The centre holds the reading column.
  A right margin holds `aside` blocks as sidenotes aligned to their paragraphs;
  on mobile those become indented notes marked with a rubric pilcrow.

## The Depth bar (signature control)

- There are five depths. Choosing one scrolls to that section of the current
  chapter and shows only that depth and the ones above it: *Minute* shows the
  line and the minute, *Essay* adds the essay, and so on. The end pieces always
  show at the bottom.
- The current depth is marked with a rubric underline (mobile) or a rubric tick
  (desktop rail). It is remembered across chapters (localStorage, try/catch).
- The keys `1`–`5` set the depth, and `←`/`→` move to the previous or next
  chapter.
- Transitions are a 160ms opacity fade only. With
  `prefers-reduced-motion: reduce` there is no motion.

## The Figure (signature object)

The Founder-Citizen is drawn as a geometric mark on a 120×120 grid with 1.5px
strokes. It has **one stroke group per strand**, plus **one notch per idea
read** on that strand, so it grows with the series. It is never complete.

- **Base marks** for today's strands:
  - `tools` / Sovereign: a circle (r=44) with a ~28° gap at the bottom, a
    boundary with a door in it.
  - `trust` / Civil: two arcs facing each other inside the circle.
  - `choice` / Mobile: a line through the gap that ends in a chevron.
  - `founding` / Enduring: a ground line across the base with a small square
    on it.
- **Notches**: each read idea on a strand adds a short tick along that
  strand's mark (on the circle's arc, along the arcs, along the line, or along
  the ground line), spaced evenly. The positions are deterministic from the
  idea's catalogue number.
- **Unknown strands** (new ones added later): give each a deterministic mark
  that composes with the rest, such as a small arc on an outer ring (r=54)
  at an angle derived from the strand's index. Never redraw existing marks.
- **States**: a strand with no reads shows a dotted `--rule` outline; a strand
  with reads is `--ink`; the most recently deepened strand is `--rubric`.
  Each strand's `<title>` names its facet and progress ("Civil — 2 of 3
  ideas").

## The map (signature view on the cover)

The map shows ideas as small nodes placed by strand, with their connections
drawn as hairline curves.

- On desktop, strands are horizontal bands (named in mono at the left).
  Nodes sit along each band by publish date, and an idea on two strands sits
  between its bands.
- On mobile, the same bands are stacked and the map scrolls horizontally
  inside its frame. The page itself never scrolls horizontally.
- Node style: a published idea is a filled `--ink` dot with its short title;
  a draft is a hollow `--rubric` ring that pulses once on load (no pulse with
  reduced motion); a read idea gets a small check.
- Connection style: `in-tension-with` is dashed and the other kinds are
  solid. The kind shows on hover or focus.
- Choosing a node opens the idea. Choosing a band filters the index below.
- Draw it as plain SVG generated from the Book. It must stay legible at 40+
  ideas: past 12 nodes per band, labels show only on hover or focus.

## Views

- **Cover** (`#cover`, the default): the title "Primer", the subtitle, and
  the editor's note line with its date ("Editor's note · as of 12 Nov"). Then
  the Figure with "N ideas read across M strands", and the buttons **Begin**
  (the first idea on the editor's path) and **Continue** (when progress
  exists). Then the **Map**. Then the **Index of ideas**: a path switch (The
  editor's path / As published), strand filter chips, and one row per idea
  showing the catalogue number in rubric, the title, the line, strand names in
  mono, status (OPEN with a countdown / JUDGING / CLOSED / AWARDED / DRAFT),
  the number of voices, and a read mark. Drafts with no strand are grouped
  under "Just in · unplaced".
- **Chapter** (`#<id>`, plus `#<id>-essay`, `#<id>-source`, `#<id>-voices` and
  `#<id>-end` to deep-link a section): kicker (mono), a large rubric number,
  the title, the line, the strand names, the depth sections, and the end
  pieces (Terms, Connections, You now, Your turn). Previous/next links at the
  bottom follow the path the reader chose (the editor's path by default; as
  published if switched) and name the neighbouring ideas.
- **Voice card**: a monogram disc (the username's first letter, in mono) and
  `@username` (or `fid 1234`); the gloss in serif; a meta row with the date,
  duration, an `AI-assisted` tag when disclosed, and a place badge (1ST / 2ND /
  HM) in rubric; then an action. In the artifact build the action is
  **Watch on Farcaster ↗**. In the hosted build it plays the HLS inline in a
  9:16 frame, with the Farcaster link kept. Site-kind voices show Site, Repo
  and Vouch links. Cards are separated by hairlines, not boxed.
- **Citation chip** `{{sub:…}}`: an inline superscript-sized rubric marker
  with the voice's monogram. On tap it opens a small popover with the voice card.
  It must be keyboard reachable.
- **Prize card** (in "Your turn"): the headline in mono, the pool, the
  deliverable, a status pill, a deadline countdown while open
  (`2h 41m left`), the results list when awarded, and a **Reply on Farcaster ↗**
  action.
- **Glossary** (`#glossary`): every term A–Z, each linking back to its chapter.
- **Credits** (`#credits`): "This book was written by N people", followed by
  usernames grouped by chapter, with winners marked.
- **About** (`#about`): what Primer is, the unofficial notice, the provenance
  (nodes, last refresh time, watched fids), how updates work, and the license.

## Always-on furniture

- A top bar with "Primer" (a link to the cover), the chapter kicker as the
  breadcrumb, and links to Glossary and About.
- A footer line on every view, in mono: "Unofficial · reads public Farcaster
  data · refreshed 12 Nov, 17:00 UTC". When an overlay is applied, append "· N
  new since snapshot".
- A draft chapter shows a full-width hairline banner: "Draft — this pick just
  dropped; an editor hasn't written it up yet. The voices below are live."

## Quality bar

- No layout shift on font load (use `size-adjust` on the fallback faces, or
  reserve the space).
- No horizontal scroll at 320px wide.
- Works without JavaScript for the first paint? Not required. It must not
  flash unstyled content.
- Touch targets ≥ 44px, a visible `:focus-visible` ring in rubric, and
  landmarks (`header`, `nav`, `main`, `footer`).
- Every untrusted string is escaped. The renderer allows only the three inline
  markups, and only https links, opened with `rel="noopener noreferrer"
  target="_blank"`.
