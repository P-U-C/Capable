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

The Founder-Citizen, drawn as a geometric mark on a 120×120 grid with 1.5px
strokes, one stroke group per facet:

- **Sovereign**: a circle (r=44) with a gap at the bottom, about 28° wide.
  It is a boundary with a door in it.
- **Civil**: two arcs facing each other inside the circle, like two people in
  conversation.
- **Mobile**: a line that passes through the gap and ends in a small chevron.
  This is the exit, used.
- **Enduring**: a horizontal ground line across the base with a small square
  standing on it, a foundation.
- Facets from future chapters: add marks that compose with these. Never redraw
  the existing ones.

States: an unearned facet is a dotted `--rule` outline, an earned facet is
`--ink`, and the most recently earned facet is `--rubric`. The cover shows the
Figure large (≈200px). Each chapter's "You, now" end piece shows it small
(≈56px) with that chapter's facet highlighted. Name each facet in its
`<title>` for screen readers.

## Views

- **Cover** (`#cover`, the default): the title "Primer", then the subtitle,
  the thesis line, the Figure with "N of M facets", and the buttons **Begin**
  and **Continue** (when progress exists). Below them is the **Table of
  ideas**: one row per chapter showing the number in rubric, the title, the
  line, status (OPEN with a countdown / JUDGING / AWARDED / DRAFT / COMING), the
  number of voices, and a read mark. The coda row reads "The next pick —
  whenever it drops".
- **Chapter** (`#<id>`, plus `#<id>-essay`, `#<id>-source`, `#<id>-voices` and
  `#<id>-end` to deep-link a section): kicker (mono), a large rubric number,
  the title, the line, the depth sections, and the end pieces. Previous/next
  links at the bottom name the neighbouring chapters.
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
