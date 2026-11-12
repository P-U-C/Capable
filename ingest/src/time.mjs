// Farcaster time. Message timestamps count seconds from the Farcaster epoch,
// 2021-01-01T00:00:00Z, not from the Unix epoch.

export const FARCASTER_EPOCH = 1609459200; // unix seconds at 2021-01-01T00:00:00Z
const DAY_MS = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** Farcaster timestamp (seconds) → unix seconds. */
export function toUnix(farcasterTs) {
  return Number(farcasterTs) + FARCASTER_EPOCH;
}

/** Unix seconds → Farcaster timestamp (seconds). */
export function fromUnix(unixSeconds) {
  return Number(unixSeconds) - FARCASTER_EPOCH;
}

/** Milliseconds since the Unix epoch → "YYYY-MM-DDTHH:MM:SSZ" (no fractional seconds). */
export function isoFromMs(ms) {
  if (!Number.isFinite(ms)) throw new TypeError(`not a time: ${ms}`);
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Farcaster timestamp → "YYYY-MM-DDTHH:MM:SSZ". */
export function toISO(farcasterTs) {
  const n = Number(farcasterTs);
  if (!Number.isInteger(n) || n < 0) throw new TypeError(`not a Farcaster timestamp: ${farcasterTs}`);
  return isoFromMs(toUnix(n) * 1000);
}

/** ISO-8601 UTC string → milliseconds. Throws on anything else. */
export function msFromISO(iso) {
  if (typeof iso !== "string" || !ISO.test(iso)) throw new TypeError(`not an ISO UTC date: ${String(iso).slice(0, 40)}`);
  return Date.parse(iso);
}

/** Normalize any ISO UTC string to "YYYY-MM-DDTHH:MM:SSZ". */
export function normalizeISO(iso) {
  return isoFromMs(msFromISO(iso));
}

export function addDaysISO(iso, days) {
  return isoFromMs(msFromISO(iso) + days * DAY_MS);
}

export { DAY_MS };
