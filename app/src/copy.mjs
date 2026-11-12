// Every word of app chrome lives here, so it can be read in one place and
// checked against the contract's BANNED list (test/safety.test.mjs).
// Content strings (lesson text, captions, names) come from app.json, never here.

export const COPY = {
  // home
  lessons: "Lessons",
  you: "you",
  youOpen: "Your traits",
  draft: "new · in progress",
  start: "Start",
  resume: "Resume",
  again: "Read again",
  minutes: (n) => `${n} min`,
  cardsCount: (n) => `${n} cards`,
  lessonLabel: (n) => `// ${String(n).padStart(2, "0")}`,
  progressDone: "done",
  progressPct: (p) => `${Math.round(p * 100)}%`,
  progressA11y: (p, done) => (done ? "Finished" : p > 0 ? `${Math.round(p * 100)} percent read` : "Not started"),
  becoming: "// becoming",
  traitCount: (done, total) => (total === 0 ? "no lessons yet" : `${done} of ${total} ${total === 1 ? "lesson" : "lessons"}`),
  traitA11y: (name, done, total) => `${name}: ${done} of ${total} ${total === 1 ? "lesson" : "lessons"} finished`,
  credits: "Independent. Every video and guide belongs to the person who made it, and links to where they first shared it.",
  noLessons: "Lessons will appear here as they are written.",

  // deck chrome
  close: "Back to lessons",
  prev: "Previous card",
  next: "Next card",
  cardOf: (i, n) => `Card ${i} of ${n}`,
  progressLabel: "Lesson progress",
  swipeHint: "swipe to begin",
  deckLabel: (title) => `Lesson: ${title}`,

  // card labels (lowercase mono micro-labels)
  label: {
    cover: (n) => `// lesson ${String(n).padStart(2, "0")}`,
    idea: "// idea",
    story: "// story",
    term: "// a word",
    counter: "// but",
    reply: "// reply",
    question: "// sit with it",
    practice: "// do this",
    lead: "// watch",
    leadBuild: "// build",
    more: "// more",
    trait: "// earned",
    deeper: "// read more",
    next: "// up next",
    end: "// that's all for now",
  },
  cardName: {
    cover: "cover",
    idea: "idea",
    story: "story",
    term: "term",
    counter: "objection and reply",
    question: "question",
    practice: "practice",
    lead: "featured work",
    more: "more work",
    trait: "trait earned",
    deeper: "further reading",
    next: "next lesson",
  },
  stepDone: (n) => `Step ${n}, mark as done`,

  // work
  by: (name) => `by ${name}`,
  aCreator: "a creator",
  original: "original ↗",
  originalA11y: (name) => `Original post ${name === "a creator" ? "by a creator" : `by ${name}`}, opens in a new tab`,
  watchOriginal: "watch the original ↗",
  openGuide: "open the guide ↗",
  seeCode: "see the code ↗",
  unmute: "tap to unmute",
  mute: "sound on",
  play: "Play",
  playA11y: (name) => `Play video ${name === "a creator" ? "by a creator" : `by ${name}`}`,
  paused: "paused",
  videoUnavailable: "This video can't play here.",
  closeVideo: "Close video",
  buildKind: "build",
  videoKind: "video",

  // trait / deeper / handoff
  traitStrength: (done, total) => `${done} of ${total} ${total === 1 ? "lesson" : "lessons"} toward it`,
  readMore: "read ↗",
  nextLesson: (n) => `Start lesson ${String(n).padStart(2, "0")}`,
  allLessons: "All lessons",
  seeTraits: "See your traits",
  allDone: "New lessons arrive as they are written. Your traits are on the home screen.",
  endShout: "All caught up",
  lessonsDone: (d, t) => `${d} of ${t} ${t === 1 ? "lesson" : "lessons"} done`,
  traitsDone: (d, t) => `${d} of ${t}`,
  homeShout: (name) => `Become ${name}`,
  homeAccent: "one idea at a time",

  // misc
  noscript: "This app needs JavaScript to run.",
  updated: "Lessons updated",
};

/** All literal chrome strings (functions sampled with typical arguments), for the banned-word test. */
export function allCopy() {
  const out = [];
  const walk = (v) => {
    if (typeof v === "string") out.push(v);
    else if (typeof v === "function") for (const args of [[3, 7], ["a creator"], [0.5, false], [1, 2], ["Civil", 1, 2]]) {
      try {
        out.push(String(v(...args)));
      } catch {
        /* argument shape not for this helper */
      }
    }
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(COPY);
  return out;
}
