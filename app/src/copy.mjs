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
  doneSticker: "done",
  notStarted: "not started",
  // home intro (review U1): what this is, and where to start
  homeFacts: ({ lessons, minutes: [lo, hi], traits }) =>
    [`${lessons} ${lessons === 1 ? "lesson" : "lessons"}`, lo ? `${lo === hi ? lo : `${lo}–${hi}`} min each` : "", traits ? `${traits} ${traits === 1 ? "trait" : "traits"} to earn` : ""].filter(Boolean).join(" · "),
  heroStart: (n) => `Start lesson ${String(n).padStart(2, "0")}`,
  heroContinue: (n) => `Continue lesson ${String(n).padStart(2, "0")}`,
  heroA11y: (cta, title) => `${cta}: ${title}`,
  heroDone: "// all caught up",
  tileA11y: (n, progress, minutes) => `Lesson ${n}. ${progress}. ${minutes} min.`,
  docTitle: (title, app) => `${title} · ${app}`,
  minutes: (n) => `${n} min`,
  lessonLabel: (n) => `// ${String(n).padStart(2, "0")}`,
  progressDone: "done",
  progressPct: (p) => `${Math.round(p * 100)}%`,
  progressA11y: (p, done) => (done ? "Finished" : p > 0 ? `${Math.round(p * 100)} percent read` : "Not started"),
  traitCount: (done, total) => (total === 0 ? "no lessons yet" : `${done} of ${total} ${total === 1 ? "lesson" : "lessons"}`),
  traitsA11y: (d, t) => `${d} of ${t} traits complete`,
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
  keyHint: "press → to begin",
  deckLabel: (title) => `Lesson: ${title}`,

  // card labels (lowercase mono micro-labels)
  label: {
    cover: (n) => `// lesson ${String(n).padStart(2, "0")}`,
    idea: "// idea",
    story: "// story",
    term: "// a word",
    counter: "// push back",
    but: "// but",
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
  stepsHint: "// tap each step once you've done it",
  practiceDone: "done this week",

  // work
  by: (name) => `by ${name}`,
  aCreator: "a creator",
  original: "original\u00a0↗",
  originalA11y: (name) => `Original post ${name === "a creator" ? "by a creator" : `by ${name}`}, opens in a new tab`,
  watchOriginal: "watch the original\u00a0↗",
  openGuide: "open the guide\u00a0↗",
  seeCode: "see the code\u00a0↗",
  unmute: "unmute",
  mute: "sound on",
  play: "Play",
  pause: "Pause",
  playA11y: (name) => `Play video ${name === "a creator" ? "by a creator" : `by ${name}`}`,
  seek: "Video position",
  time: (cur, dur) => `${clock(cur)} / ${clock(dur)}`,
  timeA11y: (cur, dur) => `${clock(cur)} of ${clock(dur)}`,
  paused: "paused",
  videoUnavailable: "This video can't play here.",
  closeVideo: "Close video",
  buildKind: "build",
  videoKind: "video",

  // trait / deeper / handoff
  readMore: "read\u00a0↗",
  nextLesson: (n) => `Start lesson ${String(n).padStart(2, "0")}`,
  continueLesson: (n) => `Continue lesson ${String(n).padStart(2, "0")}`,
  lessonsLeft: (n) => `${n} ${n === 1 ? "lesson" : "lessons"} left`,
  allLessons: "All lessons",
  seeTraits: "See your traits",
  allDone: "New lessons arrive as they are written. Your traits are on the home screen.",
  endShout: "All caught up",
  lessonsDone: (d, t) => (t === 0 ? "first lessons on the way" : `${d} of ${t} ${t === 1 ? "lesson" : "lessons"} done`),
  traitsDone: (d, t) => `${d}/${t} traits`,
  homeShout: (name) => `Become ${name}`,
  homeAccent: "one idea at a time",

  // misc
  noscript: "This app needs JavaScript to run.",
  updated: "Lessons updated",
};

/** m:ss for the video clock. */
function clock(t) {
  const s = Math.max(0, Math.floor(Number(t) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** All literal chrome strings (functions sampled with typical arguments), for the banned-word test. */
export function allCopy() {
  const out = [];
  const walk = (v) => {
    if (typeof v === "string") out.push(v);
    else if (typeof v === "function") for (const args of [[3, 7], ["a creator"], [0.5, false], [1, 2], ["Civil", 1, 2], [{ lessons: 4, minutes: [3, 4], traits: 4 }]]) {
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
