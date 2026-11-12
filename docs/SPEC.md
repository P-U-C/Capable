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

## Who it is for, and who it is making

Reader: curious, crypto-literate, short on time, often on a phone. They may
arrive from a cast link deep into chapter 3 with no context.

The book has a stated aim, written into the UI: it is shaping **the
Founder-Citizen**. That is someone who can found a community that lasts and
can also be a good member of one. Each chapter adds one facet, and the cover
shows the figure assembling as the reader finishes chapters:

| Chapter | Facet | Grant (second person, present tense) |
| --- | --- | --- |
| 1 Exit | **Sovereign** | You can leave with your name, your graph and your words. |
| 2 Friend Speech | **Civil** | You can disagree with a stranger without making an enemy. |
| 3 Vote With Your Feet | **Mobile** | You choose your communities on purpose, and you let others choose theirs. |
| 4 What Lasts | **Enduring** | You know why communities die, and what the ones that lasted had in common. |

Future picks add facets. The figure is never "complete"; the coda says so.

## The argument (the through-line every chapter serves)

> Exit makes communities compete. Civility lets strangers cooperate.
> Competition plus cooperation lets many small communities exist, and the ones
> that last solve the founder's oldest problems. That is the curriculum of the
> network state, assembled one prize at a time.

Chronological order of the prizes happens to be the logical order:

0. **Prologue: The Prize** (`prologue`). What happened in October 2026: the
   acquisition, the onchain vote, the social smart contract and Network Code,
   the first Farcaster Prize, and the prize-as-curriculum idea ("learn, earn").
   It also covers how to read this book, at five depths and from any page.
   Evenhanded: it names the controversy (retroactive moderation, read-only
   accounts, concentration of control in the reference client) in one fair
   paragraph and notes that the protocol stayed open, which is chapter 1's point.
1. **Exit** (`exit`, prize `clients`, $2,048). Your own node, in three commands.
   Teach the protocol concepts the prize demanded: FIDs, custody addresses,
   app keys (gasless KEY_ADD), Snapchain messages, read nodes vs validators
   (read nodes do accept writes and forward them to validators; this was
   corrected in the prize thread), storage rent, seed-phrase safety. The idea
   underneath is that a reference client can have house rules *because*
   leaving costs nothing: identity and data are portable. That is freedom of
   association made practical. Featured: winners Castyard (1st), Phunk (2nd),
   Kite and runfcx (honorable mentions).
2. **Friend Speech** (`friend-speech`, prize `civility`, $2,048). Norbert
   Elias, *The Civilizing Process* (1939). Warrior nobles became courtiers
   once kings monopolized violence, and external constraint became
   self-restraint. Manners spread downward and became the habits that let
   strangers trade and cooperate at scale. Connect it to friend speech vs foe
   speech, the Network Code, and why Singapore came up. The winning entry
   (@papa) argued that Singapore's measured *trust* is unremarkable and that
   its *predictability* is what's world-class. Use that as a hinge: is civility
   politeness, or predictable enforcement? Objections: who decides what counts
   as civil; retroactive enforcement; Elias's own critics on whether
   "civilizing" is progress.
3. **Vote With Your Feet** (`feet`, prize `tiebout`, $1,024, book club pick #1).
   Charles Tiebout, "A Pure Theory of Local Expenditures," *Journal of
   Political Economy* (1956). Many jurisdictions offer different bundles of
   taxes and services, mobile residents sort themselves among them, and
   competition then does for public goods roughly what markets do for private
   ones. State the model's assumptions plainly (mobility, information, many
   options, no spillovers, …) and show how the internet approximates them.
   Objections: sorting can harden inequality and segregation; exit can starve
   voice (Hirschman, *Exit, Voice, and Loyalty*, 1970); spillovers.
4. **What Lasts** (`what-lasts`, prize `nordhoff`, $1,024, book club pick #2;
   this is the cast the project started from, 0x2ba04801…). Charles Nordhoff,
   *The Communistic Societies of the United States* (1875). He visited the
   Shakers, Harmonists (Rappites), Zoar, Amana, Oneida, Aurora, Bethel, the
   Icarians and others, and recorded how they lived, worked, governed and
   failed. In 1875 "communistic" meant something closer to a profitable
   voluntary commune, or a startup society. Draw the common traits (a shared
   creed, strong leadership, real industry and solvency, rules for admission
   and exit) and the failure modes (succession, celibacy and demography, debt,
   a founder's death). The submissions contrast Rapp's Harmony with Owen's New
   Harmony and discuss Bishop Hill. Objections: survivorship bias; coercion
   inside closed communities; lasting is not the same as good.
99. **Coda: The Next Pick** (`next-pick`). The book is unfinished on purpose.
   It says how new chapters arrive (a new prize cast appears, a draft chapter
   is created automatically, an editor finishes it) and how to be in the next
   one.

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
- **The thread**: what this chapter adds to the argument, and how it hands off
  to the next.
- **You, now**: the facet gained, as one second-person sentence.
- **Your turn**: the prize prompt. If the prize is open, show a countdown and a
  link to reply. If it is closed, show the results and say the prompt still
  stands as practice.

Readers can start anywhere. The cover is a table of ideas with status (open,
judging, awarded, coming), the number of voices, and the reader's progress.
Arriving at `#feet` from a cast link works without reading anything before it.

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
- A prize with no chapter file gets a **draft chapter** generated from the
  prize text: title from the headline, `line` from its first sentence, and
  status `draft`. Drafts render with a "draft — awaiting editor" mark and
  their voices visible.
- Status: `open` before the deadline, `judging` after it, `awarded` once
  results exist.

## Out of scope for the MVP

Posting from the app, sign-in, inline video playback inside the artifact (the
artifact sandbox blocks remote media, so videos open on Farcaster there;
self-hosted builds play HLS inline), translations, and editor tooling beyond the
JSON files.
