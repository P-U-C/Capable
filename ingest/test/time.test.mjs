// Farcaster epoch arithmetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FARCASTER_EPOCH, addDaysISO, fromUnix, toISO, toUnix } from "../src/time.mjs";
import { fixture, seedPrizes } from "./helpers.mjs";

test("unix = farcasterTs + 1609459200; ISO without fractions", () => {
  assert.equal(FARCASTER_EPOCH, 1609459200);
  assert.equal(toISO(0), "2021-01-01T00:00:00Z");
  assert.equal(toUnix(184793727), 1794252927);
  assert.equal(fromUnix(1794252927), 184793727);
  assert.equal(toISO(184793727), "2026-11-09T19:35:27Z", "the sample reply in the Snapchain docs shape");
  assert.equal(addDaysISO("2026-11-08T21:34:58Z", 3), "2026-11-11T21:34:58Z");
  assert.throws(() => toISO(-1));
  assert.throws(() => toISO("soon"));
});

test("fixture timestamps reproduce the seed's postedAt", () => {
  const nordhoff = seedPrizes().find((p) => p.id === "nordhoff");
  const m = fixture("casts-fid1.json").messages.find((x) => x.hash === nordhoff.castHash);
  assert.equal(toISO(m.data.timestamp), nordhoff.postedAt);
});
