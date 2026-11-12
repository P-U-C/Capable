// Contract v2: the swipe app. Planner-owned: ask, do not edit.
//
// lessons lanes write  content/lessons/<id>.json   (a LessonDoc each)
// ingest compiles      content/build/app.json      (an App)
// app lane reads       an App
//
// The app is about ideas and the person they help you become. It never
// mentions Farcaster, the network state, prizes, deadlines, rankings or
// competitions. Creators are credited by name; places are never shown.
// All strings are untrusted plain text; renderers escape everything.

export type ISODate = string; // "2026-11-12T19:06:15Z"
export type CastHash = string; // "0x" + 40 lowercase hex
/** Plain text plus *emphasis* only. No links, no HTML. */
export type Text = string;

export interface App {
  version: 2;
  generatedAt: ISODate;
  name: string; // the app's name
  citizen: { name: string; line: Text }; // who the app helps you become
  traits: Trait[]; // one per broad theme; lessons build them
  lessons: Lesson[]; // ordered by number
  creators: Record<string, Creator>; // key = String(fid)
}

export interface Trait {
  id: string; // kebab-case: "sovereign", "civil", "mobile", "enduring"
  name: string; // "Sovereign"
  grant: Text; // second person, present tense: "You can leave with your name and your work."
  hue: number; // 0–359, drives the trait's colour and art
}

/** What a lessons lane writes. */
export interface LessonDoc {
  id: string; // kebab-case, unique
  number: number; // order in the app, 1..n
  status: "ready" | "draft"; // draft = arrived automatically, not yet written up
  title: string; // ≤ 32 chars
  promise: Text; // one line: what you'll understand after this deck, ≤ 90 chars
  trait: string; // Trait.id this lesson builds
  minutes: number; // honest reading time, video excluded
  cards: Card[]; // 8–16 cards; see rules below
  sources: Source[]; // ≥ 1 for ready lessons
  topic: string; // internal: the subject key this lesson was built from (e.g. "nordhoff"); never shown
}

export type Lesson = LessonDoc & {
  /** Filled by compile from the topic's results: never written by hand. */
  work: Work[];
};

/**
 * Cards, in the order they are swiped. Text limits are hard: a card is one
 * phone screen, read in a few seconds.
 *  cover    — the first card. Title + promise come from the lesson.
 *  idea     — one thought, ≤ 30 words.
 *  story    — a concrete example: heading ≤ 40 chars, text ≤ 70 words.
 *  term     — a word worth owning: term ≤ 40 chars, def ≤ 35 words.
 *  counter  — the strongest objection (claim ≤ 45 words) and a real reply (≤ 55 words).
 *  question — a question for the reader to sit with, ≤ 25 words.
 *  practice — something to do today: prompt ≤ 35 words, 1–4 steps ≤ 18 words each.
 *  work     — a slot the app fills with creators' work on this topic:
 *             role "lead" = the best explainer(s), role "more" = further takes.
 *             Rendered only when work with that role exists; otherwise skipped.
 *  trait    — the trait this lesson builds (always the second-to-last card).
 *  deeper   — where to read more (always the last card).
 * Rules: starts with cover; contains ≥ 3 idea, ≥ 1 story, ≥ 1 term, exactly 1
 * counter, ≥ 1 practice, a work slot "lead" and a work slot "more", then trait,
 * then deeper. Drafts may be shorter: cover, ≥ 1 idea, work "lead", work "more", trait.
 */
export type Card =
  | { type: "cover" }
  | { type: "idea"; text: Text }
  | { type: "story"; heading: string; text: Text }
  | { type: "term"; term: string; def: Text }
  | { type: "counter"; claim: Text; reply: Text }
  | { type: "question"; text: Text }
  | { type: "practice"; prompt: Text; steps: Text[] }
  | { type: "work"; role: "lead" | "more" }
  | { type: "trait" }
  | { type: "deeper" };

export interface Source {
  title: string;
  author: string;
  year: number;
  note: Text; // ≤ 30 words: what it is and why read it
  url?: string; // https; where to read or find it
}

/** A creator's piece of work on a lesson's topic (from winners and runners-up). */
export interface Work {
  id: CastHash; // the original post, used as a stable id
  fid: number;
  role: "lead" | "more"; // lead = the topic's first-placed work; more = the other placed work
  kind: "video" | "build";
  caption: Text; // OUR one-line description, ≤ 120 chars; never the creator's words
  video?: { hls?: string; mp4?: string; external?: string }; // https; at least one for kind video
  build?: { site?: string; repo?: string }; // https; at least one for kind build
  original: string; // https link to the original post (credit + context)
  postedAt: ISODate;
}

export interface Creator {
  fid: number;
  username?: string; // rendered "@username"; absent → "a creator"
  displayName?: string; // 1–80 chars, no control/format chars; escaped like all text; the app does not render it yet
}
