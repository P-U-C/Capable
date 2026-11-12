# ingest

Turns public Farcaster protocol data into two files, written together on every
run (offline and online):

- `content/build/app.json`: the `App` for **capable**, the swipe app
  (`contract/app.d.ts`, `docs/SPEC-APP.md`). This is what is deployed.
- `content/build/book.json`: the `Book` (`contract/book.d.ts`), the full
  record of prizes, entries and results the app is compiled from (and the
  legacy atlas's input).

Node 22, ESM, no dependencies.

## What it reads

| Input | Path | Role |
| --- | --- | --- |
| Book meta | `content/book.meta.json` | title, editor's note (`thesis`), archetype, strands, paths, watched fids, default nodes |
| Seed | `content/seed/{prizes,submissions,people}.json` | hand-checked items; **authoritative** for every field they carry |
| Chapter files | `content/chapters/*.json` | editorial ideas (`ChapterDoc`), read in file-name order |
| App meta | `content/app.meta.json` | the app's name, the citizen, and the traits |
| Lesson files | `content/lessons/*.json` | written lessons (`LessonDoc`), read in file-name order |
| Works seed | `content/seed/works.json` | `topics` (prize id → lesson id for drafts) and our curated `captions` by cast hash |
| Previous build | the `--out` file, if it exists | items fetched by earlier runs are carried forward (and reconciled, see below) |
| Nodes | `meta.provenance.nodes`, or `--nodes` | Snapchain / Hypersnap `/v1` HTTP API, read only |

From the nodes it reads, per run:

- `castsByFid` for each watched fid (1 and 37), newest first, at most 3 pages of 100;
- `castsByParent` (at most 10 pages of 100) only for prizes that are open, within
  14 days after their deadline, or have no known submissions yet;
- `userDataByFid` for authors it cannot name yet (at most 100 per run).

It never posts, never signs, and never handles keys. It does not verify message
signatures: it trusts the nodes it is pointed at.

## Detection rules

The same rules as `docs/SPEC.md` ("Live updates") and `docs/REFRESH.md`.

- **Prize** (`src/detect.mjs`): a cast by a watched fid whose **first line**
  names a dollar amount in one of these forms: `$N FOR …` / `$N IN PRIZES FOR …`
  (`/\$[\d,]+\s+(IN PRIZES\s+)?FOR\b/i`), `$N Prize for …`, or `…: $N Prize`;
  and that is top-level (no parent, or a channel `parentUrl`) or replies to the
  same author's own cast. A caps `PRIZE` alone is not enough: award and winners
  announcements ("THE FARCASTER PRIZE", "TIEBOUT PRIZE WINNERS", "THE
  RESTORATION OF FRIEND SPEECH ($2048 PRIZE)") are not prizes. Results posts are
  never prizes. Seed prizes are matched by cast hash and keep their ids. A new
  prize that replies to the same author's own cast (the Elias pattern) keeps
  that cast as its `context`. A prize carried from an earlier build whose
  headline no longer reads as a prize is dropped.
  - `id` / `chapter`: slug of the headline topic, without the amount and
    boilerplate ("$1024 IN PRIZES FOR VIDEOS ON TIEBOUT SORTING" →
    `tiebout-sorting`); a hash suffix avoids collisions and reserved ids.
  - `deadline`: post time + "seven days" / "3 days" / "one week" from the text;
    3 days when it says nothing.
  - `headline`: the first line, as plain text. `pool`: the first dollar
    amount. `deliverable`: the first two sentences after the headline, as plain
    text, at most 600 characters.
- **Results** (`src/detect.mjs`, `src/results.mjs`): a watched-author cast
  starting "Thank you to everyone who submitted" or "One more set of winners".
  It applies to the prize it replies to or quotes; otherwise to any prize whose
  submissions it links. Each `farcaster.xyz/<user>/0x<8+ hex>` link marks the
  submission whose hash starts with that prefix; a project's site host or repo
  written in the text marks that project.
  - **Places come from the post's labels**: "1st place", "First:", "2nd",
    "second", "Honorable/Honourable mention(s)", "HM", "Runners-up", "grand
    prize". A label heads the links after it until the next label; a label
    written after a link on the same line ("… (1st)") is that link's own.
    "first" in prose ("our first prize!") is not a label: a label starts its
    line, sits in parentheses, or is followed by ":" or a dash.
  - Only a post with **no labels at all** is read in order: 1st, 2nd, then
    honorable mentions (no 2nd when the pool names runners-up but no second
    prize).
  - A link that matches no submission, or more than one (an ambiguous prefix or
    site), is reported in `unmatched` (and `ambiguous`, with the candidates) and
    never moves another winner: with labels it simply places no one; in order
    it still holds its slot. In a labelled post, a link with no label is
    reported, not placed. Links to the prize itself are skipped.
  - Amounts come from the link's line, else the label's line, else the pool.
  - Results for a prize found by an earlier run are read again while their
    post is still in the feed (so a winner captured later is placed), and kept
    once it has scrolled out.
- **Submission** (`src/classify.mjs`): a **direct reply to the prize cast**
  (its `parentCastId` is the prize's hash and author; anything else a node
  lists is skipped) that embeds or links a video (stream.farcaster.xyz,
  any `.m3u8` or `.mp4`, YouTube watch / shorts / youtu.be, video.bsky.app,
  bsky.app posts, media.firefly.land); or, on a build prize (deliverable
  mentions a microsite, repo, tool or open-source code, or the prize is
  `clients`), a GitHub or `replit.com/@…` repo, or a site when the text calls
  it an entry ("entry", "submission", "microsite", "tutorial", "quickstart"),
  with an optional `farcaster.xyz/<user>/0x…` vouch; or an x.com / twitter.com
  status link when the text calls it an entry. A lone ordinary link (a news
  article, a blog) is not an entry. Everything else ("Gm", emoji, promo or
  claim links, images, quotes, plain comments, the prize author's own replies)
  is conversation and is dropped.
  - URLs from the network are kept as the exact string, only if https, at
    most 2048 characters, and free of whitespace, quotes, `<`, `>`, `{`, `}`,
    `[`, `]`, backslash and control characters; de-duplicated; at most 8
    `embeds` per submission (the URL the entry rests on is always kept).
  - The `gloss` is ours and neutral, never the author's words: "Video entry",
    "Video entry, 54 seconds", "Build entry: <name or host>", "Entry hosted
    off-platform". `seconds` comes from "54 s" / "54 seconds"; `ai` is set when
    the text discloses AI generation.
- **Drafts** (`src/compile.mjs`): every `kind: "prize"` prize without a chapter
  file becomes a draft idea, numbered after the highest non-coda chapter in
  prize-date order, with the prize's `strands` hint (or `[]`, "unplaced") and
  `connections: []`. Kicker "New pick · just dropped", or "From the archive ·
  <year>" for prizes posted more than a year before `--now`.
- **Status**: `open` before the deadline, `judging` up to 14 days after it,
  `closed` after that, `awarded` once results exist. Always recomputed from
  `--now`, so a seed status is never stale.

All text from the network passes through `plain()` (`src/text.mjs`): no HTML,
no link, emphasis or citation markup, no control characters. Only https URLs
are kept.

## The app (`src/compile-app.mjs`)

`compileApp` turns the app meta, the lesson files, `works.json` and the
compiled Book into an `App`, validated with `validateApp` (non-strict) before
anything is written.

- **Lessons**: every lesson file, sorted by `number`, as written (any `work` in
  a file is ignored), plus `work` from its `topic`'s results.
- **Work**: from the topic's prize results. The 1st-placed entry is `lead`; 2nd
  and honorable mentions are `more`: lead, then 2nd, then honorable mentions,
  each in the results post's order, then `postedAt`. Places are never written.
  A site entry is `kind: "build"` with `{ site, repo }`; anything else is
  `kind: "video"` with `{ hls }` from the first `.m3u8` or stream embed, else
  `{ mp4 }`, else `{ external }` (YouTube, Bluesky, Firefly, x.com). An entry
  with none of these is left out, with a warning. `original` is the entry's
  cast URL. A topic with no results has `work: []`, and the app skips its slots.
- **Captions** are ours: `works.json` `captions[hash]`, else a neutral one,
  "A short explainer" (", 54 seconds" when the length is known) or "A guide to
  building it yourself". Never the creator's words. A curated caption that
  fails the text rules is replaced, with a warning.
- **Drafts**: a `kind: "prize"` prize with no lesson file on its topic becomes
  a draft lesson, except the 2024 archive prizes (series "Earlier prizes
  (2024)"), which never become lessons. Its id comes from `works.json`
  `topics`, else the slug of the prize's subject (`new-idea-<hash>` if that
  slug has a banned word); its number is the next free one, in prize-date
  order. The title is the subject in Title Case, at most 32 characters, with no
  amount or prize wording, or "New idea" if nothing clean is left. Promise "A
  new idea, just arrived. The full lesson is on its way.", trait from the
  prize's `strands` hint (tools → sovereign, trust → civil, choice → mobile,
  founding → enduring, otherwise mobile), 1 minute, cards: cover, one idea
  ("Short explainers on this idea are collected below; the full lesson is being
  written."), work lead, work more, trait; no sources. No draft text comes from
  the announcement. A draft that would fail the validator (`BANNED` included)
  is skipped, with a warning.
- **Creators**: every fid with work in the app, with its username when known.
- Deterministic: the same inputs give the same bytes, whatever their order.

## How to run

```bash
node ingest/bin/refresh.mjs --offline --now 2026-11-12T17:00:00Z   # seed + chapters + lessons + meta, no network
node ingest/bin/refresh.mjs --now "$(date -u +%FT%TZ)"              # read the nodes in meta
node ingest/bin/refresh.mjs --nodes https://haatz.quilibrium.com,https://snap.farcaster.xyz:3381
node --test ingest/test/                                           # all tests, offline (local stub servers only)
```

Options: `--offline`, `--now <ISO>` (the injected clock; defaults to the wall
clock), `--out <path>` (the book; default `content/build/book.json`),
`--app-out <path>` (the app; default `content/build/app.json`, or beside
`--out`: `app.json` next to a `book.json`, `<name>.app.json` next to any other
name), `--nodes a,b`, `--chapters <dir>` (default `content/chapters`),
`--lessons <dir>` (default `content/lessons`).

It prints two lines: the book (prizes, ideas and drafts, submissions, how many
are new since the previous file) and the app (lessons, drafts, works per
lesson), each saying whether it was written.

`--offline` compiles only seed + chapters + meta, so it drops items that earlier
online runs fetched. It never claims a network read: `provenance.nodes` and
`refreshedAt` are the previous build's (its last network read) when there is
one, else `[]` and `--now`, and `provenance.note` ends "Offline compile: no node
was read for this build." The scheduled workflow never runs it (a test checks).

## Fail-closed behavior

- Each request has a 5 s timeout. A network error, timeout, 5xx, malformed
  body, or a 404, 408, 425 or 429 (a lagging, pruned or rate-limited node)
  moves to the next node; any other 4xx is an answer and is surfaced. Pages of
  one listing all come from one node; a failure part-way restarts the listing
  on the next node. If every node fails, `NodeUnavailable` is thrown; if every
  node answered 404, that is an answer (`NodeHttpError` 404).
- Any node failure ends the run with exit code 1 and **nothing written**. A
  prize whose replies could not be read is never recorded as having zero
  submissions. (A 4xx from `userDataByFid` only means that author stays "fid N".)
- **Deleted entries**: when a prize's replies are read completely (every page,
  no page cap hit), an entry carried from an earlier build that is no longer an
  entry in that thread (deleted, or it no longer qualifies) is dropped, with a
  warning. If the read hit the page cap, everything carried is kept. Seed
  entries are never dropped. A reply read again is classified again.
- The compiled book must pass `validateBook` and the app `validateApp`, or
  neither file is written (a lesson file that is not valid JSON, or that breaks
  the rules, fails the run the same way). Files are written atomically (temp
  file + rename); `content/build/.gitignore` keeps a
  temp file left by a crash out of the workflow's commit. A fetched entry whose
  idea is no longer in the book is dropped rather than failing the run.
- A previous build that is not valid JSON is not overwritten; delete it to
  rebuild from the seed.
- Online runs write the book only when its content changed (ignoring
  `generatedAt` and `provenance.refreshedAt`) or the last refresh is a day old,
  so the workflow does not commit every 30 minutes. The app is written whenever
  the book is, or when its own content changed (a lesson edit rebuilds only the
  app). The app carries nothing forward, so an unreadable previous `app.json`
  is simply rebuilt.

Output is deterministic for the same inputs: stable sorts (ideas by number,
prizes and submissions by date then id/hash, people by fid), fixed key order, no
randomness, and the clock comes from `--now`.

## Scheduled refresh

`.github/workflows/refresh.yml` runs every 30 minutes, on demand, and on a push
to `main` that touches `app/`, `content/`, `contract/` or `ingest/`.

- Scheduled and manual runs check out the branch head, run `refresh.mjs`
  (online), and commit `content/build/` only if it changed (`git add --
  content/build/`, never `commit -a`, never a force push). A push does not
  refresh or commit; it redeploys what was merged.
- The deploy job (read-only contents) runs when `content/build/` changed, on
  every push and on every manual run: `cd app && npm ci && npm test && npm run
  build` (the app reads `../content/build/app.json` and writes `app/dist`),
  then uploads `app/dist` as the Pages artifact and deploys it. The legacy
  `web/` atlas is not built or deployed.
- Runs never overlap (`concurrency`, not cancelled). If the refresh or the app
  build fails, the job fails (no `continue-on-error`) and nothing is committed
  or deployed.

## Layout

```
bin/refresh.mjs     CLI
src/time.mjs        Farcaster epoch (unix = ts + 1609459200), ISO helpers
src/text.mjs        plain-text sanitizing, slugs, Title Case, URLs in text
src/node.mjs        /v1 HTTP client: fallback, timeouts, NodeUnavailable
src/detect.mjs      isPrize, isResults, derivePrize
src/classify.mjs    classifyReply → Submission | null
src/results.mjs     parseResults → places, unmatched
src/compile.mjs     compile → Book (drafts, statuses, paths, provenance)
src/compile-app.mjs compileApp → App (lessons, work slots, draft lessons, creators)
src/refresh.mjs     fetchUpdates + runRefresh (the CLI's engine)
test/               node:test suites; fixtures/ are Snapchain-shaped responses
```
