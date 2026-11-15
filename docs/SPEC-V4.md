# v4: open calls

Planner-owned. Readers can help teach the next idea. When a lesson's idea has an
open call for explainers, capable shows it and helps the reader take part.
Contract: `contract/app.d.ts` (`App.calls`, `OpenCall`), validated by
`contract/validate-app.mjs`.

## Independence, amended again

Lessons, cards, captions, art and stamps still never mention prizes, contests,
rewards or deadlines (`BANNED`). An **open-call panel** is the one other place
that may: it names the reward, when the call closes, that entries are posted as
replies on Farcaster, and links to Dylan Brodeur's Earn app
(`https://earn.dylanbrodeur.org/`) for past winners. The app's safety test
allow-lists exactly the open-call copy keys and fields, as it does the identity
copy.

## Data (ingest lane)

`compileApp` emits `calls`: one per prize whose status is `open` and whose
deadline is after `now`, mapped to its lesson like the work slots are (topics
map, else the draft id).

- `reward`: the prize's `pool`, e.g. "$1,024".
- `brief`: the prize's neutral `deliverable`, cut to 300 chars.
- `kind`: build for site/repo calls, else video.
- `entries`: the qualifying entries counted so far.
- `castHash` and `replyUrl`: the call's own post.

Calls that fail validation are dropped with a warning; they never fail the build.

## App (app lane)

- **Where:** any lesson whose topic has an open call, whether it's in progress
  or already written. Home's tile gets a small "open call · closes Sun" badge.
  The lesson's cover shows the badge too, and the deck gains a **Make the
  explainer** card just before the trait card.
- **What the card says:**
  - the reward and the closing time in the reader's time zone ("$1,024 for
    short videos on this idea · closes Sun 16 Nov, 6:24 pm"), with a countdown
    when under 48 h;
  - the brief, and how many entries are in so far;
  - one line of how-to: make a short video (about a minute, vertical works) or
    a build, and post it as a reply.
- **Contribute:**
  - Inside a Farcaster client: `sdk.actions.composeCast` with `parent` set to
    the call's cast and a short prefilled line. The reader attaches their
    video in the host's composer and posts it themselves.
  - On the web: open `replyUrl` in a new tab to reply there.
  - Nothing is posted for the reader, ever.
- **Past winners:** inside a Farcaster client, `sdk.actions.openMiniApp`
  opens `https://earn.dylanbrodeur.org/`; on the web, a plain link. Credited as
  "Earn by @dylanb.eth".
- **Timing:** a call disappears when `closesAt` passes on the reader's clock,
  even if `app.json` is stale.
- The panel needs no sign-in. Signed-in readers get the in-app composer when
  inside a host.

## Readiness

| Row | Lane | Outcome | Closed by |
| --- | --- | --- | --- |
| K1 | ingest | `calls` compiled from open prizes (mapping, reward, brief, kind, entries, reply URL; closed or past-deadline calls omitted; invalid ones dropped) | `ingest/test/compile-app.test.mjs` |
| K2 | app | Badge on tile and cover, Make-the-explainer card, reply flow (Mini App compose with parent; web link), Earn link (openMiniApp / link), hides at `closesAt`, copy allow-list exact | `app/test/calls.test.mjs`, safety test, screenshots |
