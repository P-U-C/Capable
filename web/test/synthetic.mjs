// Test helpers (not a test file): the fixture, and synthetic Books of any size.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..", "..");
export const FIXTURE_PATH = join(ROOT, "contract/fixtures/book.sample.json");
export const fixture = () => JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

export const hash = (n) => "0x" + n.toString(16).padStart(40, "0");
const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
const KINDS = ["builds-on", "in-tension-with", "instance-of", "precondition-for", "echoes"];

/**
 * A valid Book with `ideas` numbered ideas (plus prologue and coda).
 *   strandOf(i) → array of strand ids for idea i (default: rotates, every 5th on two)
 *   extraStrands → strands beyond the fixture's four
 *   draftsUnplaced → how many extra strandless drafts to append
 *   shuffleDates → publish dates not in number order
 */
export function makeBook({ ideas = 10, strandOf = null, extraStrands = [], draftsUnplaced = 0, shuffleDates = true, subsPerIdea = 2 } = {}) {
  const base = fixture();
  const strands = [...base.strands, ...extraStrands];
  const ids = strands.map((s) => s.id);
  const pick = strandOf || ((i) => (i % 5 === 0 ? [ids[i % ids.length], ids[(i + 1) % ids.length]] : [ids[i % ids.length]]));
  const chapters = [];
  const prizes = [];
  const submissions = [];
  const people = { 1: { fid: 1, username: "farcaster" }, 37: { fid: 37, username: "balajis.eth" } };
  let h = 1;
  const t0 = Date.parse("2026-01-01T00:00:00Z");
  const chapterBase = (id, number, extra) => ({
    id,
    number,
    kind: "chapter",
    status: "published",
    title: `Idea ${number} about things`,
    kicker: `Idea ${number}`,
    line: `The idea numbered ${number} in one line.`,
    minute: "A minute of text.\n\nAnother paragraph.",
    essay: [{ type: "p", text: "Essay text." }],
    objections: [],
    terms: [{ term: `Term ${number}`, def: "A definition." }],
    thread: "Where it sits.",
    strands: [],
    connections: [],
    ...extra,
  });
  chapters.push(chapterBase("prologue", 0, { kind: "prologue", title: "Prologue" }));
  const total = ideas + draftsUnplaced;
  for (let i = 1; i <= total; i++) {
    const id = `idea-${i}`;
    const unplaced = i > ideas;
    const st = unplaced ? [] : pick(i);
    const connections = [];
    if (!unplaced && i > 1) connections.push({ to: `idea-${i - 1}`, kind: KINDS[i % KINDS.length], why: "Because." });
    if (!unplaced && i > 3) connections.push({ to: `idea-${i - 3}`, kind: KINDS[(i + 1) % KINDS.length], why: "Also because." });
    const order = shuffleDates ? (i * 7) % (total + 3) : i;
    const postedAt = iso(t0 + order * 86400e3);
    prizes.push({
      id: `prize-${i}`,
      kind: "prize",
      chapter: id,
      castHash: hash(h++),
      authorFid: 37,
      postedAt,
      headline: `$100 FOR IDEA ${i}`,
      deadline: iso(Date.parse(postedAt) + 3 * 86400e3),
      status: "closed",
    });
    chapters.push(chapterBase(id, i, { status: unplaced ? "draft" : "published", strands: st, connections, prize: `prize-${i}` }));
    for (let k = 0; k < subsPerIdea; k++) {
      const fid = 1000 + ((i * 3 + k) % 50);
      people[fid] = { fid, username: `user${fid}` };
      const sh = hash(h++);
      submissions.push({ hash: sh, fid, postedAt: iso(Date.parse(postedAt) + (k + 1) * 3600e3), chapter: id, kind: "video", gloss: `Entry ${k} on idea ${i}.`, embeds: ["https://stream.farcaster.xyz/v1/video/x.m3u8"], url: `https://farcaster.xyz/~/conversations/${sh}`, seconds: 59 });
    }
  }
  chapters.push(chapterBase("next-pick", 99, { kind: "coda", title: "The Next Pick" }));
  const editorPath = ["prologue", ...chapters.filter((c) => c.kind === "chapter" && c.status === "published" && c.number % 2 === 1).map((c) => c.id), "next-pick"];
  return {
    ...base,
    strands,
    chapters,
    prizes,
    submissions,
    people,
    paths: [{ id: "editors-path", name: "The editor's path", line: "Odd ideas first.", chapters: editorPath }],
  };
}

export const craftStrand = { id: "craft", name: "Craft & making", line: "How things get made.", facet: { name: "Maker", grant: "You can make the thing, not just argue for it." } };
