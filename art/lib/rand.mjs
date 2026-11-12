// Seeds. A string goes through xmur3 (a 32-bit string hash) into sfc32 (a
// small fast counter PRNG). Same string → same sequence, in every process and
// every engine: only 32-bit integer maths (Math.imul, >>>), no Math.random.

/** xmur3: a 32-bit hash generator for a string. Each call returns the next 32-bit word. */
export function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

/** sfc32: four 32-bit words of state → uniform floats in [0, 1). */
export function sfc32(a, b, c, d) {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** A 32-bit hash of a string (first xmur3 word). */
export const hash32 = (str) => xmur3(String(str))();

/**
 * A seeded random source with the helpers the generators use.
 * `key` is any string; the generator kind is mixed in by the caller.
 */
export function rand(key) {
  const h = xmur3(String(key));
  const next = sfc32(h(), h(), h(), h());
  for (let i = 0; i < 12; i++) next(); // warm up: decorrelate near-identical keys
  const r = {
    /** float in [0, 1) */
    f: next,
    /** integer in [lo, hi] inclusive */
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    /** float in [lo, hi) */
    range: (lo, hi) => lo + next() * (hi - lo),
    /** true with probability p */
    chance: (p) => next() < p,
    /** one element of an array */
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** one element of an array, by weights (same length) */
    weighted: (arr, weights) => {
      const total = weights.reduce((a, b) => a + b, 0);
      let x = next() * total;
      for (let i = 0; i < arr.length; i++) if ((x -= weights[i]) < 0) return arr[i];
      return arr[arr.length - 1];
    },
    /** a shuffled copy (Fisher–Yates) */
    shuffle: (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    /** ±1 */
    sign: () => (next() < 0.5 ? -1 : 1),
  };
  return r;
}
