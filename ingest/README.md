# ingest

Turns public Farcaster protocol data into `content/build/book.json`, the
`Book` described in `contract/book.d.ts`. Node 22, ESM, no dependencies.

## What it reads

| Input | Path | Role |
| --- | --- | --- |
| Book meta | `content/book.meta.json` | title, editor's note (`thesis`), archetype, strands, paths, watched fids, default nodes |
| Seed | `content/seed/{prizes,submissions,people}.json` | hand-checked items; **authoritative** for every field they carry |
| Chapter files | `content/chapters/*.json` | editorial ideas (`ChapterDoc`), read in file-name order |
| Previous build | the `--out` file, if it exists | items fetched by earlier runs are carried forward |
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

- **Prize** (`src/detect.mjs`): a cast by a watched fid whose first line matches
  `/\$[\d,]+\s+(IN PRIZES\s+)?FOR\b/i`, or reads `$N Prize for …` or
  `…: $N Prize`, or contains the capitalized word `PRIZE`; and that is top-level
  (no parent, or a channel `parentUrl`) or replies to the same author's own cast.
  Results posts are never prizes. Seed prizes are matched by cast hash and keep
  their ids. A new prize that replies to another prize-like cast by the same
  author (the Elias pattern) keeps that parent as its `context` instead of
  becoming two prizes.
  - `id` / `chapter`: slug of the headline topic, without the amount and
    boilerplate ("$1024 IN PRIZES FOR VIDEOS ON TIEBOUT SORTING" →
    `tiebout-sorting`); a hash suffix avoids collisions and reserved ids.
  - `deadline`: post time + "seven days" / "3 days" / "one week" from the text;
    3 days when it says nothing.
  - `pool`: the first dollar amount. `deliverable`: the first two sentences
    after the headline, as plain text, at most 600 characters.
- **Results** (`src/detect.mjs`, `src/results.mjs`): a watched-author cast
  starting "Thank you to everyone who submitted" or "One more set of winners".
  It applies to the prize it replies to or quotes; otherwise to any prize whose
  submissions it links. Each `farcaster.xyz/<user>/0x<8+ hex>` link marks the
  submission whose hash starts with that prefix; a project's site host or repo
  written in the text marks that project. Places go in order: 1st, 2nd, then
  honorable mentions (no 2nd when the pool names runners-up but no second
  prize). Amounts come from the link's line, else from the pool. Links that
  match nothing are reported, never guessed.
- **Submission** (`src/classify.mjs`): a reply to a prize cast that embeds or
  links a video (stream.farcaster.xyz, any `.m3u8` or `.mp4`, YouTube watch /
  shorts / youtu.be, video.bsky.app, bsky.app posts, media.firefly.land); or,
  on a build prize (deliverable mentions a microsite, repo, tool or open-source
  code, or the prize is `clients`), a GitHub repo and/or a microsite, with an
  optional `farcaster.xyz/<user>/0x…` vouch; or an x.com / twitter.com status
  link when the text calls it an entry. Everything else ("Gm", emoji, promo or
  claim links, images, quotes, plain comments, the prize author's own replies)
  is conversation and is dropped.
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

## How to run

```bash
node ingest/bin/refresh.mjs --offline --now 2026-11-12T17:00:00Z   # seed + chapters + meta, no network
node ingest/bin/refresh.mjs --now "$(date -u +%FT%TZ)"              # read the nodes in meta
node ingest/bin/refresh.mjs --nodes https://haatz.quilibrium.com,https://snap.farcaster.xyz:3381
node --test ingest/test/                                           # all tests, offline (local stub servers only)
```

Options: `--offline`, `--now <ISO>` (the injected clock; defaults to the wall
clock), `--out <path>` (default `content/build/book.json`), `--nodes a,b`,
`--chapters <dir>` (default `content/chapters`).

It prints one line: prizes, ideas (drafts), submissions, and how many
submissions are new since the previous file.

`--offline` compiles only seed + chapters + meta, so it drops items that earlier
online runs fetched. The scheduled workflow never runs it.

## Fail-closed behavior

- Each request has a 5 s timeout. A network error, timeout, 5xx or malformed
  body moves to the next node; a 4xx is an answer and is surfaced. Pages of one
  listing all come from one node; a failure part-way restarts the listing on
  the next node. If every node fails, `NodeUnavailable` is thrown.
- Any node failure ends the run with exit code 1 and **nothing written**. A
  prize whose replies could not be read is never recorded as having zero
  submissions. (A 4xx from `userDataByFid` only means that author stays "fid N".)
- The compiled book must pass `validateBook` or nothing is written. The file is
  written atomically (temp file + rename).
- A previous build that is not valid JSON is not overwritten; delete it to
  rebuild from the seed.
- Online runs write only when the content changed (ignoring `generatedAt` and
  `provenance.refreshedAt`) or the last refresh is a day old, so the workflow
  does not commit every 30 minutes.

Output is deterministic for the same inputs: stable sorts (ideas by number,
prizes and submissions by date then id/hash, people by fid), fixed key order, no
randomness, and the clock comes from `--now`.

## Scheduled refresh

`.github/workflows/refresh.yml` runs every 30 minutes (and on demand): it runs
`refresh.mjs`, commits `content/build/` only if it changed, then builds `web/`
and deploys `web/dist/hosted` to GitHub Pages. If the refresh fails, nothing is
committed or deployed.

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
src/refresh.mjs     fetchUpdates + runRefresh (the CLI's engine)
test/               node:test suites; fixtures/ are Snapchain-shaped responses
```
