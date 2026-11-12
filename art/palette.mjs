// The art grammar's colours (docs/ART.md "Tokens"). Every colour any generator
// writes is in ALLOWED, or is the trait colour the caller passed in.

import { PAPER as BADGE_PAPER, INK as BADGE_INK, RING as BADGE_RING } from "../contract/badge-art.mjs";

export const PAPER = BADGE_PAPER; // #F7F4EA warm off-white
export const INK = BADGE_INK; // #161616 outlines, shadows, line work
export const CYAN = "#18C8F0"; // sovereign
export const MAGENTA = "#FF1FC8"; // civil
export const LIME = "#5CF27E"; // mobile
export const YELLOW = "#FFE11A"; // enduring
/** The four candies, in ring order (same order as the stamp's ring). */
export const CANDIES = [CYAN, MAGENTA, LIME, YELLOW];

/**
 * Tints: the only colours beyond paper, ink and the candies.
 * SURFACE is the app's card white (figures' faces, open doors).
 * SLATE is the riso second tone from docs/DESIGN-APP.md (shade, water, ground).
 * LILAC, BLUSH and SKY are the app's pixel-confetti tints.
 */
export const SURFACE = "#FFFDF6";
export const SLATE = "#5B6488";
export const LILAC = "#E4DDF7";
export const BLUSH = "#F7D9EF";
export const SKY = "#DDEBFA";
export const TINTS = [SURFACE, SLATE, LILAC, BLUSH, SKY];

/** The allow-list. Uppercase #RRGGBB. */
export const ALLOWED = Object.freeze([PAPER, INK, ...CANDIES, ...TINTS]);

if (BADGE_RING.join() !== CANDIES.join()) throw new Error("palette: candies drifted from contract/badge-art.mjs RING");

const HEX = /^#[0-9a-fA-F]{6}$/;

/** "#rrggbb" in any case → "#RRGGBB"; anything else throws (fail closed). */
export function normColor(c, what = "color") {
  if (typeof c !== "string" || !HEX.test(c)) throw new TypeError(`${what}: expected "#RRGGBB", got ${JSON.stringify(c)}`);
  return c.toUpperCase();
}

/** True when `c` is a palette colour. */
export const isPalette = (c) => typeof c === "string" && ALLOWED.includes(c.toUpperCase());
