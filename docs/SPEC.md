# Primer — product and editorial spec

Planner-owned. Workers read it; they ask before changing it.

## What it is

Since Network School acquired Farcaster (15 Oct 2026), the Farcaster accounts
@balajis.eth (fid 37) and @farcaster (fid 1) have been posting **prizes**: build
a client, explain an idea in a 59-second vertical video, and get paid in USDC.
@farcaster calls the newest run of them "an interactive book club". Each prize
draws dozens of community submissions as replies.

Those prizes are already a curriculum, but nobody is reading it as one. The
material is scattered across reply threads, ordered by time, uneven in quality,
and has no through-line.

**Primer turns the prize threads into a book.** It is a reading client for one
corner of the Farcaster protocol. Each prize becomes a chapter. The idea comes
first, then the community's best work on it, then the source, then the strongest
objection, then the reader's own turn. A new prize becomes a new chapter, and a
new reply becomes a new voice, without anyone editing the site.

It is unofficial. It reads public protocol data and says so on every view. It
does not use the Farcaster or Network School names as its own brand.

## Shape: an atlas of ideas, not a fixed book

Every prize is a **different subject**. Some connect directly; most connect
only abstractly. More are coming, and nobody knows what they will be. So
Primer is not a four-chapter argument. It is a **growing atlas**:

- **Idea**: one per prize (called a "chapter" in code). Every idea has the same
  five depths and the same end pieces.
- **Strands**: a few broad, abstract themes that ideas hang on (1–2 strands
  per idea). They live in `content/book.meta.json`. A pick that fits none of
  them gets a new strand. The current strands are:

| Strand | What it gathers | Facet of the archetype |
| --- | --- | --- |
| `tools` · Tools you own | protocols, keys, nodes, software you control | **Sovereign** |
| `trust` · Norms & trust | manners, codes, reputation, enforcement | **Civil** |
| `choice` · Exit & choice | many communities, mobile people, competition | **Mobile** |
| `founding` · Founding & endurance | starting, governing, surviving the founder | **Enduring** |

- **Connections**: typed, explained links between ideas. The kinds are
  `builds-on`, `in-tension-with`, `instance-of`, `precondition-for` and
  `echoes`, and each link has one sentence saying why. Abstract links are the
  point: "Nordhoff's communes *echo* Elias's self-restraint" is as valuable as
  a direct dependency. Every published idea has at least 2 connections, of at
  least 2 kinds.
- **Paths**: ways to read in order. *As published* is derived from prize
  dates. *The editor's path* is a curated route that reads as one argument and
  gets revised as picks arrive. Reading from any idea always works.
- **The editor's note**: the book-level through-line, dated (`thesis.asOf`).
  It says what the picks *so far* suggest, and it changes.

### The archetype grows with the series

The atlas states its aim in the UI: it is shaping **the Founder-Citizen**,
someone who can found a community that lasts and can also be a good member of
one. Each strand is one facet. Each idea read on a strand adds a mark to that
facet, so the figure keeps growing as picks accumulate and is never
"complete". A new strand adds a new facet.

### The ideas so far

Post-acquisition series (Oct–Nov 2026):

- 0 **Prologue: The Prize** (`prologue`)
- 1 **Exit** (`exit`, prize `clients`, strands tools + choice)
- 2 **Friend Speech** (`friend-speech`, prize `civility`, strand trust)
- 3 **Vote With Your Feet** (`feet`, prize `tiebout`, strand choice)
- 4 **What Lasts** (`what-lasts`, prize `nordhoff`, strand founding)

Earlier @balajis.eth prizes (Sept 2024). These are archive ideas that ingest
auto-drafts; an editor can write them up later:

- `cloud-cartography` (tools)
- `ai-conference-organizer` (tools)
- `network-state-visuals` (founding)

Closing:

- 99 **Coda: The Next Pick** (`next-pick`)

The editor's path today: prologue → exit → friend-speech → feet → what-lasts →
next-pick. Its argument, as of 12 Nov: *exit makes communities compete,
civility lets strangers cooperate, and the communities that last solve the
founder's oldest problems.* Treat that as one reading of the material, not
the shape of the book.

## Reading at five depths (the signature interaction)

Every chapter can be read at the depth the reader has time for. The depth
control is always visible and remembers its setting:

1. **Line**: the idea in one sentence.
2. **Minute**: 110–180 words, plus the featured submission(s).
3. **Essay**: 700–1400 words that weave in community work through
   `{{sub:0x…}}` citation chips.
4. **Source**: the primary source, what it is, and where to read it free.
5. **Voices**: every submission, with winners first and then newest, showing
   our one-line gloss (never presented as the author's words) and a link to the
   cast.

Each chapter ends with the same four end pieces, styled like a book's
endmatter (after *The Beginning of Infinity*'s chapter-end terminology and
"meanings" sections):

- **Terms**: the words this chapter introduced. They also feed the glossary.
- **Connections**: where this idea sits (the `thread`, 40–90 words), then each
  typed link with its one-line why. Each links to its idea.
- **You, now**: the facet(s) of this idea's strand(s), deepened, as one
  second-person sentence plus the strand's progress ("3 of 5 ideas in Norms &
  trust").
- **Your turn**: the prize prompt. If the prize is open, show a countdown and a
  link to reply. If it is closed, show the results and say the prompt still
  stands as practice.

Readers can start anywhere. The cover is a **map of ideas**: ideas grouped
by strand and connected by their links. Below it is the index of ideas, with
status (open, judging, closed, awarded, draft), the number of voices, the
reader's progress, and a switch between *the editor's path* and *as
published*. Arriving at `#feet` from a cast link works without reading
anything before it.

## Editorial rules (all chapter writers)

- Voice: clear, concrete, calm, and specific. Write like a good science writer
  for a smart 16-year-old. Use short paragraphs. Do not hype, and avoid
  "revolutionary", "game-changing" and "unlock".
- Evenhanded. The prizes come from an owner with a point of view. The book
  explains that view at its strongest and gives the strongest objection its own
  section, with a real reply or an honest "open question". It takes no side on
  the acquisition itself.
- Cite the community. Each essay cites at least 4 submissions with
  `{{sub:0x<full hash>}}`, drawn from `content/seed/submissions.json`, and only
  where the gloss supports the point being made. Winners are featured.
- Glosses are ours. Do not put words in submitters' mouths. The quote block is
  for published sources only, at most 25 words, at most one per source.
- Facts are checked against primary or reputable secondary sources (author,
  year, title, place names, dates). If a fact cannot be verified, cut it.
- No HTML, and only the three inline markups in `contract/book.d.ts`.

## Live updates

The book's content comes in two layers:

1. **Snapshot**: `content/build/book.json`, compiled from `content/seed/`,
   `content/chapters/` and the latest ingest run. It is inlined into the page,
   so the page works offline, signed out and anywhere.
2. **Overlay**: new items written after the snapshot, read at runtime.
   - In the published artifact: the artifact `db` (collections listed under
     `Overlay` in the contract), written by a scheduled refresh job that reads
     a public Hypersnap/Snapchain node.
   - Self-hosted: a GitHub Action runs `ingest` every 30 minutes, commits any
     changed `content/build/book.json`, and redeploys. No overlay is needed.

Detection rules (ingest implements them; the refresh job follows the same
rules):

- Watch fids 1 and 37. A cast is a **prize** when its first line matches
  `/\$[\d,]+\s+(IN PRIZES\s+)?FOR\b/i` or contains `PRIZE` and it has no parent
  (or its parent is the watched author's own announcement).
- A reply to a prize cast is a **submission** when it embeds a video (a
  stream.farcaster.xyz `.m3u8`, any `.m3u8` or `.mp4`, YouTube, a Bluesky video,
  Firefly media) or, for build prizes, a microsite or repo URL. Everything else
  in the thread is conversation and is not shown.
- A watched-author cast starting "Thank you to everyone who submitted" is a
  **results** post. Each `farcaster.xyz/<user>/0x<prefix>` link in it marks the
  submission whose hash starts with that prefix as a winner, in order: 1st, 2nd,
  then honorable mentions.
- A prize with no chapter file gets a **draft idea** generated from the prize
  text: title from the headline, `line` from its first sentence, status
  `draft`, `strands` from the prize's `strands` hint (or `[]` = "unplaced"),
  and `connections` `[]`. Drafts render with a "draft — awaiting editor" mark
  and their voices visible. The refresh job may propose strands and
  connections for a draft; an editor confirms them.
- Status: `open` before the deadline, `judging` up to 14 days after it with no
  results, `closed` after that with no results recorded, and `awarded` once
  results exist.

## Out of scope for the MVP

Posting from the app, sign-in, inline video playback inside the artifact (the
artifact sandbox blocks remote media, so videos open on Farcaster there;
self-hosted builds play HLS inline), translations, and editor tooling beyond the
JSON files.
