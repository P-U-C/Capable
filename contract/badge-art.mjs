// Badge art v1: the reference renderer for capable's soulbound stamps. Planner-owned.
//
// This file is the oracle. The art lane uses it as-is for previews; the badges
// lane ports it to Solidity, and a parity test must show the on-chain SVG is
// byte-identical to badgeSvg() for the same inputs (see docs/BADGE-ART.md).
// Integers only, no floats, no locale, no randomness: everything comes from
// the 32-byte seed. Keep every change here mirrored in the Solidity port.

export const PAPER = "#F7F4EA";
export const INK = "#161616";
/** The citizen ring: the four founding traits, in ring order. */
export const RING = ["#18C8F0", "#FF1FC8", "#5CF27E", "#FFE11A"];
/** Confetti colours: the ring plus ink. */
export const CONFETTI = [...RING, INK];
/** Emblems drawn above the citizen's head: 0 key, 1 speech, 2 arrow, 3 house, anything else a pixel. */
export const EMBLEMS = [
  `<circle cx="186" cy="104" r="10" fill="${PAPER}" stroke="${INK}" stroke-width="5"/><path d="M196 104H222M212 104V113M220 104V111" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`,
  `<rect x="176" y="88" width="30" height="20" rx="6" fill="${PAPER}" stroke="${INK}" stroke-width="4"/><rect x="194" y="100" width="30" height="20" rx="6" fill="${PAPER}" stroke="${INK}" stroke-width="4"/>`,
  `<path d="M178 104H218M206 92L220 104L206 116" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
  `<path d="M182 118V100L200 86L218 100V118Z" fill="${PAPER}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`,
];
const PIXEL = `<rect x="192" y="96" width="16" height="16" fill="${INK}"/>`;
const CORNERS = [[6, 6], [324, 6], [6, 324], [324, 324]];

const HEX = /^#[0-9A-F]{6}$/;
const NAME = /^[A-Z][A-Z ]{0,11}$/;

/** "0x" + 64 hex → 32 numbers 0..255. */
export function seedBytes(seed) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(seed)) throw new Error("seed: 0x + 64 hex");
  const out = [];
  for (let i = 0; i < 32; i++) out.push(parseInt(seed.slice(2 + i * 2, 4 + i * 2), 16));
  return out;
}

/**
 * @param {{seed:string, name:string, color:string, emblem:number, serial:number}} b
 *   seed   0x + 64 hex (on-chain: keccak256(abi.encodePacked(holder, traitId, tokenId)))
 *   name   trait name shown on the ribbon: 1–12 chars, A–Z and space, starts with a letter ("SOVEREIGN")
 *   color  the trait's colour, "#RRGGBB" uppercase (fills the inner disc)
 *   emblem 0..255 (0–3 drawn, else a pixel)
 *   serial token id, 0 ≤ serial < 10^9
 * @returns {string} the SVG, exactly
 */
export function badgeSvg({ seed, name, color, emblem, serial }) {
  const s = seedBytes(seed);
  if (!NAME.test(name)) throw new Error("name: 1–12 of A–Z and space");
  if (!HEX.test(color)) throw new Error("color: #RRGGBB uppercase");
  if (!Number.isInteger(emblem) || emblem < 0 || emblem > 255) throw new Error("emblem: 0..255");
  if (!Number.isInteger(serial) || serial < 0 || serial >= 1e9) throw new Error("serial: 0..999999999");

  let o = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">`;
  o += `<rect width="400" height="400" fill="${PAPER}"/>`;
  // confetti: ten squares in the corners, outside the seal
  for (let k = 0; k < 10; k++) {
    const st = s[20 + k];
    const size = 6 + (Math.floor(st / 4) % 3) * 4;
    const [cx, cy] = CORNERS[st % 4];
    const x = cx + (s[k] % (70 - size));
    const y = cy + (s[10 + k] % (70 - size));
    o += `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${CONFETTI[Math.floor(st / 12) % 5]}"/>`;
  }
  const tilt = (355 + (s[31] % 11)) % 360;
  const rot = s[30] % 90;
  o += `<g transform="rotate(${tilt} 200 200)">`;
  o += `<circle cx="208" cy="208" r="172" fill="${INK}"/>`;
  o += `<circle cx="200" cy="200" r="172" fill="${PAPER}" stroke="${INK}" stroke-width="6"/>`;
  for (let i = 0; i < 4; i++) {
    o += `<circle cx="200" cy="200" r="148" fill="none" stroke="${RING[i]}" stroke-width="24" pathLength="100" stroke-dasharray="25 75" transform="rotate(${rot + 90 * i} 200 200)"/>`;
  }
  o += `<circle cx="200" cy="200" r="160" fill="none" stroke="${INK}" stroke-width="4"/>`;
  o += `<circle cx="200" cy="200" r="134" fill="${color}" stroke="${INK}" stroke-width="4"/>`;
  o += emblem < 4 ? EMBLEMS[emblem] : PIXEL;
  o += `<circle cx="200" cy="168" r="28" fill="${PAPER}" stroke="${INK}" stroke-width="6"/>`;
  o += `<path d="M146 250C146 216 170 204 200 204C230 204 254 216 254 250Z" fill="${PAPER}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>`;
  o += `<rect x="96" y="238" width="208" height="46" rx="12" fill="${INK}"/>`;
  o += `<text x="200" y="270" text-anchor="middle" font-family="'Archivo Black','Arial Black',sans-serif" font-weight="900" font-size="${name.length <= 9 ? 24 : 18}" letter-spacing="1" fill="${PAPER}">${name}</text>`;
  o += `</g>`;
  o += `<text x="12" y="390" font-family="monospace" font-size="14" fill="${INK}">capable</text>`;
  o += `<text x="388" y="390" text-anchor="end" font-family="monospace" font-size="14" fill="${INK}">#${serial}</text>`;
  o += `</svg>`;
  return o;
}

/** ERC-721 metadata for a badge (the contract base64-encodes the SVG into `image`). */
export function badgeMetadata({ name, serial, svgBase64 }) {
  const title = name.charAt(0) + name.slice(1).toLowerCase();
  return `{"name":"capable: ${title} #${serial}","description":"A soulbound stamp for finishing a capable lesson. It cannot be transferred.","image":"data:image/svg+xml;base64,${svgBase64}","attributes":[{"trait_type":"Trait","value":"${title}"}]}`;
}
