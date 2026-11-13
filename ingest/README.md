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
- `userDataByFid` for authors it cannot name yet: at most 100 per run, each
  fid at most once a day (`provenance.lookups` remembers when), fids never
  tried first and then the longest-waiting, so the cap starves no one;
- `castById` on a second node, to confirm what the first said (see Trust).

It never posts, never signs, and never handles keys.

## Trust (review S3)

What one message is checked for (`src/verify.mjs`):

- a well-formed 20-byte hash, and the fid it was asked about;
- when the node sends `dataBytes`: BLAKE3 (dependency-free, checked against
  the reference vectors) of the bytes, cut to 20 bytes, equals `hash`, and the
  fields ingest reads (type, fid, timestamp, cast text, embeds, parent; user-data
  type and value) decode from the bytes to what the JSON `data` says. A message
  that fails is ignored, with a warning.

Not checked: the Ed25519 signature and the signer. A signature only binds a
message to a key; whether the key belongs to the fid is on-chain state that a
node could misreport as easily as a cast, and a forger can hash and sign with
its own key. Messages without `dataBytes` are not re-encoded to recompute the
hash (a mismatch would prove nothing about the node).

So the defence against a lying or lagging node is agreement. With more than one
node configured:

- a **new prize** cast (and the announcement it replies to) and a **results**
  cast are used only when another node's `castById` returns the same cast (same
  hash, fid, time, text, parent and embeds). Unconfirmed, a new prize waits for
  the next run, and results found earlier are kept rather than re-derived;
- a **fresh reading of an entry a results post places** is used only when a
  second node agrees; otherwise the carried reading stays (or a new winner's
  work waits);
- a **carried entry missing from a complete thread read** is dropped only when a
  second node also has no such cast, or has it and its copy no longer
  qualifies. A lagging, disagreeing or unreachable second node keeps it.

With a single node, prize and results casts are believed as read and no
carried entry is ever dropped. A node that failed this run (anything but a 404)
is demoted: asked last, and never asked to confirm.

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
no link, emphasis or citation markup, and none of the control or invisible
format characters the app's contract rejects (`FORMAT_CHARS`: bidi marks,
embeddings, overrides and isolates, zero-width characters, U+061C, U+180E,
U+2060–206F, BOM; U+2028/2029 become line breaks; review S1). Only https URLs
are kept, and none carrying such a character.

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
- **Creators**: every fid with work in the app, with its username when known,
  and its display name when it passes the contract's `isDisplayName` and has
  no banned word; otherwise the name is left out with a warning, never a
  failed compile (review S1).
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

`--strict-lessons` (the editor's pull-request check) fails the run when any
lesson file would be left out of the app.

It prints two lines: the book (prizes, ideas and drafts, submissions, how many
are new since the previous file) and the app (lessons, drafts, works per
lesson), each saying whether it was written; and a third when something was
left out of the app (lesson files, works, display names).

`--offline` reads no node. It recompiles from the seed, the chapter and lesson
files and meta, and **carries what earlier online runs fetched** (prizes, their
results, entries, people, lookup times) from the previous build, so the deploy
and the editor's check can rebuild the app without losing any of it. It never
claims a network read: `provenance.nodes` and `refreshedAt` are the previous
build's (its last network read) when there is one, else `[]` and `--now`, and
`provenance.note` ends "Offline compile: no node was read for this build." The
scheduled refresh never runs it (a test checks).

The app's `generatedAt` is the previous app's when the content is unchanged,
and otherwise `--now`, but always later than the previous app's: readers' apps
only take a strictly newer copy, so an edit is always newer and a no-op rebuild
never is (review S10).

## Fail-closed behavior

- Each request has a 5 s timeout and a 5 MB body cap (declared, or counted
  while streaming). A network error, timeout, 5xx, oversized or malformed
  body, or a 404, 408, 425 or 429 (a lagging, pruned or rate-limited node)
  moves to the next node, and (except a 404) demotes the node for the rest of
  the run; any other 4xx is an answer and is surfaced. Pages of
  one listing all come from one node; a failure part-way restarts the listing
  on the next node. If every node fails, `NodeUnavailable` is thrown; if every
  node answered 404, that is an answer (`NodeHttpError` 404).
- Any node failure ends the run with exit code 1 and **nothing written**. A
  prize whose replies could not be read is never recorded as having zero
  submissions. A user lookup no node answers fails the run too (a 4xx from
  `userDataByFid` only means that author stays "fid N").
- **Deleted entries**: when a prize's replies are read completely (every page,
  no page cap hit), an entry carried from an earlier build that is no longer an
  entry in that thread is dropped, with a warning, only when a second node
  agrees (see Trust). If the read hit the page cap, everything carried is
  kept. Seed entries are never dropped. A reply read again is classified again.
- **Dropped and counted** (docs/SWARM.md): a lesson file that is not JSON,
  whose id is not its file name, that fails the contract, or that clashes with
  another (id, number, topic) is left out of the app with a warning and counted,
  and its topic shows as a draft again; so is a work or a creator display name
  that fails the contract. One bad file never stops the app (review S17).
  `--strict-lessons` turns a dropped lesson file into a failure.
- The compiled book must pass `validateBook` and the app `validateApp`, or
  neither file is written. Files are written atomically (temp
  file + rename); `content/build/.gitignore` keeps a
  temp file left by a crash out of the workflow's commit. A fetched entry whose
  idea is no longer in the book is dropped rather than failing the run.
- A previous build that is not valid JSON is not overwritten; delete it to
  rebuild from the seed.
- Every lookup keyed by a string from the network or a content file (topics,
  captions, people, strands, places) reads own properties only, never
  `Object.prototype` ("constructor", "__proto__", "toString"; review S18).
- Online runs write the book only when its content changed (ignoring
  `generatedAt` and `provenance.refreshedAt`) or the last refresh is a day old,
  so the workflow does not commit every 30 minutes. The app is written whenever
  the book is, or when its own content changed (a lesson edit rebuilds only the
  app). The app carries nothing forward, so an unreadable previous `app.json`
  is simply rebuilt.

Output is deterministic for the same inputs: stable sorts (ideas by number,
prizes and submissions by date then id/hash, people by fid), fixed key order, no
randomness, and the clock comes from `--now`.

## Workflows

All actions are pinned by commit SHA; every workflow starts with
`permissions: {}` and each job asks only for what it uses; no checkout keeps
the token on disk; no `${{ }}` expression is expanded inside a script (review
S15). Tests in `test/refresh.test.mjs` check each of these.

- **`refresh.yml`** (every 30 minutes, and on demand). Checks out the branch
  head, runs `refresh.mjs` online, and commits `content/build/` only if it
  changed (`git add -- content/build/`, never `commit -a`, never a force push;
  rebased onto any editor merge, retried three times). It is the only workflow
  that commits, and `content/build/` is only ever written by it (review S9).
  Its second job, after every run (even a failed refresh), runs
  `bin/deploy-if-behind.mjs`: if the newest GitHub Pages deployment is not
  main's head, or did not succeed and is not under way, or has been queued or
  running for more than 30 minutes (stuck; review V22), it dispatches
  `deploy.yml` (review S2).
- **`deploy.yml`** (a push to `main` touching `app/`, `content/`, `contract/`
  or `ingest/`; on demand; dispatched by the other workflows, since their
  `GITHUB_TOKEN` commits and merges start no push workflow). Its own
  concurrency group. A read-only job compiles `app.json` from the sources
  (`refresh.mjs --offline` at the commit's time: lessons, `works.json`, the
  seed and the committed book), then `cd app && npm ci && npm test && npm run
  build`, and uploads `app/dist`; a second job holding only `pages: write` and
  `id-token: write` runs `deploy-pages`. Nothing is committed. The legacy `web/`
  atlas is not built or deployed.
- **`editor.yml`** (a pull request into `main` from this repository's
  `editor/*` branch). Read-only. It checks the branch's own head, and first
  requires that head to contain main's current head (`bin/editor-check.mjs
  current`; review V4): then the files it checks are exactly the files a
  squash-merge would publish, and a lesson that clashes with one on main (id,
  number, topic) fails the strict compile instead of being dropped at deploy.
  Then `editor-check.mjs paths` (only `content/lessons/<slug>.json` added,
  changed, or deleted unless founding, and `content/seed/works.json` added or
  changed; regular files only), `node contract/validate-app.mjs --strict` on
  every lesson file, the contract and ingest tests, `refresh.mjs --offline
  --strict-lessons`, the strict app check, and the app's tests and build. A
  branch that is behind main fails; bring it up to date and push.
- **`editor-merge.yml`** (`workflow_run` after `editor.yml` succeeds). Runs
  main's copy of itself and of `bin/editor-check.mjs`, never pull-request code.
  `editor-check.mjs pr`: opened by the repository variable `EDITOR_LOGIN`,
  open, not a draft, this repository's `editor/<yyyymmdd-hhmm>`, still at the
  checked head, into `main`, and every commit authored by `EDITOR_LOGIN`
  (committed by it or by GitHub's `web-flow`; review V25). `paths` from git
  objects. Then, with main's head fetched again, `editor-check.mjs ready`
  decides: it merges only if main is still contained in the checked head
  (review V4) and every link in each added or changed lesson file and in
  `works.json` (any `url`-like field, and any `scheme://` or `www.` run in
  any text or key) is https, with no user info or port, to a host on
  `LINK_HOSTS` (review V5). Otherwise it comments on the pull request
  (`needs review: <hosts>`, or `main moved`) and leaves it open for a person;
  a push to the branch checks it again. When it merges, it squash-merges at
  the checked head with `GITHUB_TOKEN`, confirms the merged tree is the
  checked tree (else the job fails before deploying), and dispatches
  `deploy.yml`. Without `EDITOR_LOGIN` it does nothing and the pull request
  waits for a person.

`LINK_HOSTS` (in `bin/editor-check.mjs`): `wikipedia.org`, `*.gov`,
`*.gov.uk`, `*.edu`, `*.ac.uk`, `*.uscourts.gov`, `archive.org`, `arxiv.org`,
`doi.org`, `jstor.org`, `gutenberg.org`, `law.justia.com`, `gdpr-info.eu`,
`eur-lex.europa.eu`, `hup.harvard.edu`, `press.princeton.edu`,
`global.oup.com`, `cambridge.org`, `nature.com`, `rcrwireless.com`,
`nybooks.com`. An entry `x.org` covers `x.org` and every host under it; `*.gov`
covers every host under `.gov` but not `gov`. Hosts are compared on whole labels
of the hostname the WHATWG URL parser gives (what a browser opens: lower case,
IDN as punycode). Only a person's pull request can change the list.

## Layout

```
bin/refresh.mjs     CLI
bin/editor-check.mjs the editor's pull-request rules (paths, branch, author, commits, head, containment, links)
bin/deploy-if-behind.mjs dispatch deploy.yml when Pages is not serving main's head
src/time.mjs        Farcaster epoch (unix = ts + 1609459200), ISO helpers
src/text.mjs        plain-text sanitizing, slugs, Title Case, URLs in text
src/node.mjs        /v1 HTTP client: fallback, timeouts, body cap, demotion, probeCast
src/verify.mjs      message checks: hash form, fid, BLAKE3 of dataBytes; castFacts
src/detect.mjs      isPrize, isResults, derivePrize
src/classify.mjs    classifyReply → Submission | null
src/results.mjs     parseResults → places, unmatched
src/compile.mjs     compile → Book (drafts, statuses, paths, provenance)
src/compile-app.mjs compileApp → App (lessons, work slots, draft lessons, creators)
src/refresh.mjs     fetchUpdates + runRefresh (the CLI's engine)
test/               node:test suites; fixtures/ are Snapchain-shaped responses
```
