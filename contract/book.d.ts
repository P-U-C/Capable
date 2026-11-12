// The contract between lanes. Planner-owned: ask, do not edit.
//
// ingest   writes  content/build/book.json  (a Book)
// editorial writes content/chapters/<id>.json (a ChapterDoc each)
// web      reads   a Book, and optionally an Overlay from the artifact db
//
// All strings are untrusted plain text. Renderers escape everything and then
// apply only the inline markup described on `Inline`.

/** ISO-8601 UTC, e.g. "2026-11-09T19:06:15Z". */
export type ISODate = string;
/** Full Farcaster cast hash: "0x" + 40 lowercase hex. */
export type CastHash = string;

/**
 * Inline text. Plain text plus exactly three markups, nothing else:
 *   *emphasis*            → <em>
 *   [label](https://…)    → <a> (https only; anything else renders as text)
 *   {{sub:0x…}}           → a citation chip linking a Submission by full hash
 * Paragraph breaks are "\n\n" inside strings that allow them.
 */
export type Inline = string;

export interface Book {
  version: 1;
  generatedAt: ISODate;
  title: string; // "Primer"
  subtitle: string;
  thesis: { line: Inline; paragraph: Inline };
  archetype: Archetype;
  chapters: Chapter[]; // reading order; number 0 is the prologue
  prizes: Prize[];
  submissions: Submission[];
  people: Record<string, Person>; // key = String(fid)
  provenance: Provenance;
}

export interface Archetype {
  name: string; // "The Founder-Citizen"
  line: Inline; // one sentence
  facets: Facet[]; // one per chapter that grants one, in reading order
}

export interface Facet {
  id: string; // kebab-case, e.g. "sovereign"
  name: string; // "Sovereign"
  grant: Inline; // "You can leave with your name." (second person, present tense)
  chapter: string; // Chapter.id that grants it
}

export type ChapterKind = "prologue" | "chapter" | "coda";
export type ChapterStatus = "published" | "draft";

/** What an editorial lane writes: one file per chapter, content/chapters/<id>.json */
export interface ChapterDoc {
  id: string; // kebab-case, unique, also the URL hash: #<id>
  number: number; // 0 prologue, 1..n chapters, 99 coda
  kind: ChapterKind;
  status: ChapterStatus;
  title: string; // ≤ 40 chars
  kicker: string; // ≤ 60 chars, e.g. "Chapter 3 · Book club pick #1"
  line: Inline; // the idea in one sentence, ≤ 200 chars
  minute: Inline; // the idea in a minute: 110–180 words, may contain "\n\n"
  essay: Block[]; // the long form: 700–1400 words total
  source?: Source; // primary source, absent for prologue/coda
  objections: Objection[]; // ≥ 1 for kind "chapter"
  terms: Term[]; // ≥ 3 for kind "chapter"
  thread: Inline; // what this chapter adds to the argument, 40–90 words
  facet?: string; // Facet.id granted on finishing
  prize?: string; // Prize.id this chapter is built from
  featured?: CastHash[]; // submissions to feature first (winners, best examples)
  practice?: Practice; // "your turn" prompt shown at chapter end
}

export type Chapter = ChapterDoc;

export type Block =
  | { type: "p"; text: Inline }
  | { type: "h"; text: string } // section heading inside the essay
  | { type: "quote"; text: Inline; cite: string } // cite = attribution text; ≤ 25 words quoted
  | { type: "aside"; text: Inline }; // a margin note (sidenote on wide screens)

export interface Source {
  title: string;
  author: string;
  year: number;
  about: Inline; // 40–90 words: what the work is and why it matters here
  read?: string; // https URL where it can be read free, if one exists
}

export interface Objection {
  claim: Inline; // the strongest version of the objection, steelmanned
  reply: Inline; // how a defender answers — or "open question" honestly
}

export interface Term {
  term: string;
  def: Inline; // ≤ 45 words
}

export interface Practice {
  prompt: Inline; // what the reader can make or do now
  action?: { label: string; url: string }; // https; e.g. reply on the prize cast
}

export type PrizeStatus = "open" | "judging" | "awarded";

export interface Prize {
  id: string;
  kind: "prize" | "announcement";
  chapter?: string;
  castHash: CastHash;
  parentHash?: CastHash;
  authorFid: number;
  postedAt: ISODate;
  headline: string;
  gloss?: Inline;
  pool?: string;
  deliverable?: Inline;
  deadline?: ISODate;
  status?: PrizeStatus; // computed by ingest from deadline/results when absent
  series?: string;
  references?: string[];
  context?: { castHash: CastHash; headline: string; gloss: Inline };
  results?: {
    castHash: CastHash;
    authorFid: number;
    postedAt: ISODate;
    places: { place: Place; amount: string; submission: CastHash; label: string }[];
  };
}

export type Place = "1st" | "2nd" | "hm";

export interface Submission {
  hash: CastHash;
  fid: number;
  postedAt: ISODate;
  chapter: string;
  kind: "video" | "site" | "link";
  gloss: Inline; // OUR one-line description, never presented as the author's words
  embeds: string[]; // exact URLs from the cast
  url: string; // https://farcaster.xyz/~/conversations/<hash>
  seconds?: number;
  ai?: boolean; // author disclosed AI use
  place?: Place;
  name?: string; // project name (site kind)
  site?: string;
  repo?: string;
  voucher?: string;
}

export interface Person {
  fid: number;
  username?: string; // absent until resolved; render "fid 1234"
  displayName?: string;
}

export interface Provenance {
  nodes: string[]; // HTTP API base URLs read from
  watchedFids: number[];
  refreshedAt: ISODate;
  note: Inline;
}

/**
 * Live overlay, held in the artifact db and written by the refresh job.
 * Collections (each doc's id = its natural key):
 *   submissions/<hash>  → Submission
 *   prizes/<id>         → Prize
 *   chapters/<id>       → ChapterDoc   (new picks arrive as status "draft")
 *   people/<fid>        → Person
 *   meta/refresh        → { refreshedAt: ISODate, note?: string }
 * Merge rule: overlay docs that validate replace the snapshot item with the
 * same key; invalid docs are dropped and counted, never rendered.
 */
export interface Overlay {
  submissions: Submission[];
  prizes: Prize[];
  chapters: ChapterDoc[];
  people: Person[];
  refreshedAt?: ISODate;
}
