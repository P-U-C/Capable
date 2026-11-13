// Every word of app chrome lives here, so it can be read in one place and
// checked against the contract's BANNED list (test/safety.test.mjs).
// Content strings (lesson text, captions, names) come from app.json, never here.

export const COPY = {
  // home
  lessons: "Lessons",
  you: "you",
  youChip: "passport", // the home chip opens the passport (review T19)
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
  // review T6: what it costs and who made it
  freeLine: "Free. No account needed. Your progress stays in this browser.",
  madeBy: "Made by zoz",
  openSource: "open source\u00a0↗",
  openSourceA11y: "Open source: the code, opens in a new tab",
  // review T10: what's new since the reader's last visit
  newSticker: "new",
  newWorks: (n) => `${n} new`,
  newA11y: "New since your last visit.",
  whatsNew: (n) => `${n} new since your last visit`,
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
  stepsHint: "// tap each step once you've done it, then swipe on",
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
  chipCount: (d, t) => `${d}/${t}`, // the home chip: "// passport | 1/4" (review T19), short enough for 320px
  homeShout: (name) => `Become ${name}`,
  homeAccent: "one idea at a time",

  // misc
  noscript: "This app needs JavaScript to run.",
  updated: "Lessons updated",
  // review V7: the app changed under an open page
  appUpdated: (name) => `${name} was updated — reload to continue.`,
  reload: "Reload",

  // v3: the trait card's stamp (review U6)
  stampA11y: (name) => `Your ${name} stamp`,
  stampSaved: "Saved to your passport",
  stampDraft: "This lesson is still a draft, so it stays off your passport for now.",
  mintStamp: "Add this stamp to your wallet",
  mintNote: "Optional. It stays in your wallet for good and can't be sold or moved. Your wallet charges a network fee of a few cents.",
  mintPreview: "This is a preview: your stamp's own pattern is set when it's added.",
  mintPhase: {
    check: "Checking…",
    network: "Asking your wallet to switch to Base…",
    account: "Choose an account in your wallet…",
    confirm: "Confirm in your wallet…",
  },
  mintConfirming: "Sent. Confirming…",
  mintSlow: "Sent, still confirming. It can take a while when the network is busy.",
  mintDone: "It's in your wallet, for good.",
  mintHeld: "Already in your wallet",
  mintClosed: "Adding this stamp to wallets is paused for now.",
  mintReverted: "That transaction failed, so nothing was added. Your wallet may still have charged the network fee.",
  mintDropped: "That transaction never went through, so nothing was added.",
  checkAgain: "Check again",
  mintView: "see the receipt ↗",
  mintViewA11y: "See the transaction on Basescan, opens in a new tab",
  mintError: {
    rejected: "Cancelled in your wallet. Nothing was sent.",
    "wrong-chain": "Your wallet is on another network. Switch it to Base, then try again.",
    offline: "The stamp tools didn't load. Check your connection, then try again.",
    "no-account": "Your wallet didn't share an account. Try again.",
    unsent: "That didn't go through, and nothing was sent. Try again.",
    failed: "Your wallet reported a problem. Check it before trying again: the stamp may already be on its way.",
  },
  // after a stamp is added: share the public passport, with the address shown first (review V9)
  shareMine: "Share my public passport",
  shareMineNote: (addr) => `The link shows your wallet address, ${addr}.`,
  shareStamp: (trait, app) => `My ${trait} stamp, from ${app}.`,
  tryAgain: "Try again",

  // v3: the passport
  passport: "passport",
  passportOpen: "Your passport",
  passportDoc: "Your passport",
  passportEyebrow: "// passport",
  passportAnon: "Your passport",
  passportAnonLine: "Sign in to put your name and face on it.",
  passportLocal: "Signed in or not, your progress stays in this browser. Stamps added to a wallet are public.",
  portraitA11y: "Your passport portrait",
  pfpA11y: (name) => `${name}'s picture`,
  stampsHeading: "// stamps",
  stampState: { earned: "saved here", minted: "in wallet", sent: "on its way", none: "not yet" },
  stampStateA11y: (name, state) => `${name}: ${state}`,
  passportLessons: (d, t) => `// ${d} of ${t} ${t === 1 ? "lesson" : "lessons"} done`,
  shareLine: (name, d, t) => `I'm becoming ${name}: ${d} of ${t} traits.`,
  signOut: "Sign out",
  // review T4, T9, V9: your own public passport, only for an address you chose
  publicMine: "See your public passport",
  publicMineNote: (addr) => `It shows only the stamps in your wallet (${addr}). Share links to it.`,
  signingIn: "Signing in…",
  backHome: "Back to lessons",

  // v3: identity UI. Only these six keys may name the sign-in provider
  // (docs/SPEC-V3.md "Independence, amended"); test/safety.test.mjs
  // allow-lists exactly them.
  signIn: "Sign in with Farcaster",
  signInTitle: "Sign in with Farcaster",
  signInScan: "Scan this with your phone's camera to approve in Farcaster.",
  signInOpenHere: "Open Farcaster on this phone ↗",
  shareLabel: "Share on Farcaster",
  handleLine: (u) => `@${u} on Farcaster`,

  // v3: the sign-in sheet (provider-neutral)
  signInWaiting: "Getting a code…",
  signInPending: "Waiting for you to approve…",
  signInQrA11y: "Sign-in code to scan",
  signInCancel: "Cancel",
  signInClose: "Close",
  signInOpenLink: "Open the sign-in link here ↗", // desktop: the deep link opens in this browser (review T8)
  signInError: {
    timeout: "The code expired before it was approved. Try again for a fresh one.",
    cancelled: "Sign-in was cancelled. Nothing was saved.",
    rejected: "The request was declined or closed. Nothing was saved.",
    "verify-failed": "That sign-in couldn't be verified, so nothing was saved.",
    network: "Couldn't reach the sign-in service. Check your connection, then try again.",
  },

  // v3: a public passport (#/p/<address>); review T3: it explains itself to someone new
  publicDoc: "A shared passport",
  publicEyebrow: "// a shared passport",
  publicName: "Someone's passport",
  publicA11y: "This reader's portrait",
  walletLine: (short) => `wallet ${short}`,
  publicWhat: ({ name, lessons, minutes: [lo, hi] }) => `${name} is ${lessons} short ${lessons === 1 ? "lesson" : "lessons"}${lo ? `, ${lo === hi ? lo : `${lo}–${hi}`} minutes each` : ""}. Free, no account.`,
  publicStart: (n) => `Start lesson ${String(n).padStart(2, "0")}`,
  publicStampsNote: "Each stamp was earned by finishing a lesson, then added to this wallet.",
  publicLoading: "Reading the stamps…",
  publicNone: "No stamps in this wallet yet.",
  publicError: "Couldn't read the stamps just now. Try again in a moment.",
  publicOff: "Stamps can't be added to wallets yet, so there's nothing to show here.",
  publicCta: "Start your own passport",
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
