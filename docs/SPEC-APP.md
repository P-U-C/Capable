# The swipe app: spec v2

Planner-owned. This replaces the atlas (SPEC.md, DESIGN.md), which is kept for history only.

## What it is

A phone-first app of short, swipeable lessons. Each lesson teaches one big
idea and helps the reader become **the citizen**: someone who can found a
community that lasts, and be a good member of one. The citizen's working name
is set in `content/app.meta.json`; the owner will rename it.

It is **independent**. The text a reader sees never mentions Farcaster,
the network state, Network School, Balaji, prizes, bounties, competitions,
winners, rankings, deadlines or submissions. The validator enforces this
(`BANNED` in `contract/validate-app.mjs`). The ideas come from a curriculum
that someone else funds, but the app presents only the ideas and the best
work people made about them. Creators are credited by name ("by @papa"),
with a quiet link to the original. Places are never shown.

## Shape

- **Home**: one card per lesson, swiped vertically, like a feed of decks.
  Each shows its title, its promise, the trait it builds, and the reader's
  progress. Below them sits a small **you** panel: the citizen's traits, each
  filling in as lessons are finished.
- **Lesson**: a deck of 8–16 full-screen cards, swiped horizontally. Tap the
  right edge for next and the left edge for back, and press-hold to pause a
  video. A segmented progress bar sits at the top. Card types are in
  `contract/app.d.ts`:
  - cover
  - three or more ideas
  - a story (a concrete example)
  - a term
  - **the lead work**: the best explainer video, full-bleed 9:16
  - one counterpoint, with its reply
  - a question to sit with
  - a practice: something to do today
  - **more work**: other strong takes
  - the trait earned
  - deeper reading

  The lessons lane writes the text cards. The two work slots fill
  automatically.
- **Work slots**: `lead` holds the creator who placed first on the topic;
  `more` holds the others who placed. A topic that has no placed work yet
  skips its slots, so the deck ships as text, and the videos appear when
  results arrive. Build topics (software) show their guide and repo as a card,
  not a video.
- **Trait**: finishing a lesson strengthens one of the citizen's four traits:
  - Sovereign: you can leave with your name and your work
  - Civil: disagree without making enemies
  - Mobile: choose communities on purpose
  - Enduring: know why communities die

  New topics can add traits.

## The four lessons now

| id | topic | title (working) | trait |
| --- | --- | --- | --- |
| own-your-exit | clients | Own Your Exit | sovereign |
| friend-speech | civility | Friend Speech | civil |
| vote-with-your-feet | tiebout | Vote With Your Feet | mobile |
| what-lasts | nordhoff | What Lasts | enduring |

The lessons lanes condense the existing, fact-checked chapters in
`content/chapters/` (which went through review: see
`docs/reviews/2026-11-12-content.md`). They strip every reference to the
platform and the contest and turn the ideas toward the reader becoming the
citizen. They do not add facts that the chapters don't already source. The
2024 archive topics are dropped because they have no placed work.

## Writing rules

- One thought per card, readable in five seconds. Use second person where it
  helps ("you").
- Concrete over abstract. Name real people, places and years, as the chapters
  do.
- Every lesson has exactly one counter card. It gives the strongest objection
  and a real reply, or says honestly that the question is open.
- Practice cards are things a person can actually do this week, offline or
  online, with no product to buy.
- No hype words, no HTML, no links in text. The only markup is `*emphasis*`.

## Updates

`ingest` compiles `content/build/app.json` from `content/app.meta.json`,
`content/lessons/*.json`, `content/seed/` and anything fetched. Work comes
from each topic's results post: first place is `lead`, the others are
`more`. A new topic produces a **draft** lesson with a cover, one idea card,
work slots and a trait card. Its text cannot contain banned words, so a
draft's idea card is written from the topic's subject, not from the
announcement. The scheduled refresh job writes drafts and new results into
the repo, and a GitHub Action rebuilds and redeploys the app.

## Hosting

Static PWA on GitHub Pages. Video is HLS played inline (hls.js, native on
Safari). It has a manifest, icons, and an offline shell. It does not use the
Farcaster Mini App wrapper.

## Design

Pending the owner's screenshot of Sui's Beep. What's known so far:
**bold colour and rendered art**, as opposed to the cream-and-serif look of
the atlas, which read as "too Claude". Each trait has a `hue`. Each lesson
has generated, rendered-looking art (WebGL or SVG) in its trait's colour.
