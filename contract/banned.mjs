// The words reader-facing text must never contain, and the hosts a source link must not point at. Planner-owned.
// Kept in its own module so the browser bundle can swap it for a stub (contract/banned.stub.mjs): the
// build and the compile enforce it in Node; the app does not need to ship the list.
export const BANNED = /\b(farcaster|warpcast|network\s+schools?|network\s+states?|balaji|bount(?:y|ies)|prizes?|contests?|competitions?|competing\s+entr(?:y|ies)|winners?|winning\s+entr(?:y|ies)|runners?[- ]ups?|honou?rable\s+mentions?|1st\s+place|2nd\s+place|placed\s+(?:first|second|third)|submissions?|submitted\s+entr(?:y|ies)|judg(?:e|ed|es|ing|ment|ments|ements?)|rankings?|ranked|deadlines?|usdc|neynar|snapchain|hypersnap)\b/i;
export const BANNED_URL = /farcaster|warpcast|snapchain|hypersnap|neynar|ns\.com|thenetworkstate/i;
