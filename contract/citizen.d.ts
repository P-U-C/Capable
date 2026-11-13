// Contract v3: citizens — identity, passports, stamps, art. Planner-owned: ask, do not edit.
//
// identity lane writes  app/src/identity/index.mjs  (this file's Identity API)
// stamps lane writes    app/src/stamps/index.mjs    (this file's Stamps API) and chain/
// art lane writes       art/index.mjs               (this file's Art API)
// app lane wires them into screens (sign-in, passport, trait card, logo, lesson art).
//
// Everything here runs in the browser of a static site. There is no server.
// Identity data is display data the person chose to share, kept in their own
// localStorage. Nothing is posted anywhere without the person tapping a button
// that opens their own client with a prefilled draft.

import type { ISODate } from "./app";

// ───────────────────────── identity ─────────────────────────

export interface Identity {
  fid: number; // positive integer
  username?: string; // [a-z0-9][a-z0-9._-]{0,63}; rendered "@username"
  displayName?: string; // 1–80 chars, no control/format chars; escaped like all text
  pfpUrl?: string; // https only; shown as an <img> with referrerpolicy=no-referrer
  source: "miniapp" | "siwf"; // inside a Farcaster client, or Sign In With Farcaster on the web
  custody?: string; // 0x + 40 hex (siwf only: the address that signed)
  verifications?: string[]; // 0x + 40 hex each: the person's verified wallet addresses, when known
  signedInAt: ISODate;
}

export interface IdentityAPI {
  /** True when running inside a Farcaster client as a Mini App. Resolves within 1.5 s; false on any error. */
  isMiniApp(): Promise<boolean>;
  /** Mini App only: tell the host the app is ready (hides its splash). Safe to call when not a Mini App (no-op). */
  ready(): Promise<void>;
  /** The stored identity, or null. Synchronous; validated on read (bad data → null and cleared). */
  current(): Identity | null;
  /**
   * Mini App: read the host's context user (no prompt).
   * Web: Sign In With Farcaster through relay.farcaster.xyz. `onUrl` receives the
   * https deep link to show as a QR code and an "open on this phone" button. The
   * message is verified (domain = location.host, nonce matches, signature valid
   * for the fid's custody address) before anything is stored. Rejects on timeout
   * (5 min), cancel (`signal`), or any verification failure.
   */
  signIn(opts?: { onUrl?: (url: string) => void; signal?: AbortSignal }): Promise<Identity>;
  signOut(): void;
  /** Subscribe to sign-in / sign-out. Returns an unsubscribe function. */
  onChange(fn: (id: Identity | null) => void): () => void;
  /**
   * Share a line and a link. Mini App: the host's compose sheet. Web: opens the
   * compose URL in a new tab. Never posts by itself.
   */
  share(text: string, url: string): Promise<void>;
  /** An EIP-1193 provider: the Mini App host wallet, else an injected browser wallet (EIP-6963), else null. */
  wallet(): Promise<EIP1193Provider | null>;
}

export interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
}

// ───────────────────────── stamps ─────────────────────────
// CapableStamps: ERC-721 + ERC-5192 (locked) on Base. Free mint, one per
// (holder, trait). Fully on-chain art: tokenURI = data:application/json;base64
// with image = data:image/svg+xml;base64 of contract/badge-art.mjs badgeSvg()
// for seed = keccak256(abi.encodePacked(holder, uint8 traitId, uint256 tokenId)).
// Honor system: the app offers a mint only after the lesson's trait is earned
// in this browser; the contract cannot check that, and says so.

export interface StampTrait {
  stampId: number; // 0..255
  name: string; // "SOVEREIGN" (as printed)
  color: string; // "#RRGGBB"
  emblem: number;
  open: boolean; // minting allowed
}

export interface OwnedStamp {
  tokenId: number;
  stampId: number;
  svg?: string; // when fetched
}

export interface StampsAPI {
  /** From App.stamps: null when no address is configured (stamps stay local). */
  config(app: import("./app").App): { chainId: number; address: string } | null;
  /** The person's stamps on chain (read-only RPC; no wallet needed). [] on any RPC error, with a reason. */
  owned(address: string, opts?: { app?: import("./app").App }): Promise<{ stamps: OwnedStamp[]; error?: string }>; // opts.app → contract address (else the last config())
  /** A local preview of what a stamp would look like (no chain). */
  preview(opts: { holder: string; stampId: number; tokenId: number; trait: StampTrait }): string; // SVG
  /**
   * Before offering or sending a mint (review V1): is the trait open on chain, and does `holder` already hold it?
   * Read-only RPC. On any RPC error resolves { open: false, held: false, error } — callers must not offer a mint then.
   */
  check(opts: { app: import("./app").App; holder: string; stampId: number }): Promise<{ open: boolean; held: boolean; error?: string }>;
  /**
   * Mint the stamp for `stampId` with the given wallet: switch to the chain (asking to add it if missing),
   * re-run check() for the sending account (refuse when closed or held), then send mint(stampId) with an explicit
   * chainId (V11). Resolves with the tx hash once submitted. Never retries a sent tx.
   */
  mint(opts: { provider: EIP1193Provider; stampId: number; app: import("./app").App }): Promise<{ txHash: string; explorerUrl: string; from: string }>;
  /**
   * Poll for the receipt of a sent mint (V1). "success" carries the minted tokenId (from the Stamped/Transfer log);
   * "reverted" when mined but failed; "pending" while unmined (caller polls with backoff, gives up after ~5 min and
   * keeps the tx link). Read-only RPC.
   */
  receipt(opts: { app: import("./app").App; txHash: string }): Promise<{ status: "pending" | "success" | "reverted"; tokenId?: number; error?: string }>;
}

// ───────────────────────── art ─────────────────────────
// One visual grammar (docs/SPEC-V3.md "Art grammar"). Every generator is pure and
// deterministic: same input → byte-identical SVG. Only palette colours. No
// external references (no <image href>, no fonts beyond named families, no url()
// except internal #ids). Each SVG ≤ 16 KB.

export interface ArtAPI {
  /** The citizen seal. "logo" = seal only; "lockup" = seal + wordmark; "favicon" = simplified, legible at 16 px. */
  seal(opts: { mode: "logo" | "lockup" | "favicon"; size?: number; filled?: string[] }): string; // filled: trait ids whose ring quarter is coloured (default all)
  /** App icons: a paper square with the seal; maskable keeps it inside the 80% safe zone. PNGs are pre-rendered in art/icons/. */
  iconSvg(opts: { size: number; maskable?: boolean }): string;
  /** A unique scene for a lesson, in the riso two-tone style of the hand-drawn ones. */
  lessonScene(opts: { lessonId: string; color: string; title?: string; uid?: string; grain?: boolean }): string; // uid: id prefix when the same scene is inlined twice; grain:false inside frames that already add grain
  /** A passport portrait: the citizen figure, unique per seed (fid or a local random id). */
  portrait(opts: { seed: string; color?: string; uid?: string; title?: string }): string;
  /** The stamp, exactly contract/badge-art.mjs badgeSvg(). */
  stamp: typeof import("./badge-art.mjs").badgeSvg;
}
