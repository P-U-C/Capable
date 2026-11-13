// v3, the DOM half of the trait card's stamp (review U6, V1, docs/SPEC-V3.md):
// the stamp is pressed when the card arrives (CSS, .is-earned), then the card
// says where it went.
//
//   - No contract configured (stamps.config(app) is null), no on-chain id for
//     the trait, or a draft lesson: "Saved to your passport" (or the draft
//     note), and the wallet code is never loaded.
//   - Otherwise, the first time the card is shown, identity.wallet() looks for
//     a wallet. None: still "Saved to your passport". One: stamps.check() asks
//     the chain whether the trait is open and whether the wallet's account
//     (eth_accounts, no prompt) already holds it. Open and not held: the mint
//     button. Held: "Already in your wallet". Closed: saved, and paused. The
//     chain can't be read: nothing about minting at all (review V1).
//   - Minting: stamps.mint() switches the network, asks for an account,
//     re-checks for it and sends one transaction. The provider is watched (not
//     changed) so the card can say which step the wallet is on. Sent: the
//     record is kept as "pending" and stamps.receipt() is polled with backoff:
//     success → the real stamp (its token id and holder) is drawn and recorded
//     as minted; reverted → nothing was added, the record is forgotten, and a
//     fresh attempt needs a re-check first; no receipt within the wait → "sent,
//     still confirming" with the link. Nothing is ever sent again by itself.
//   - A pending record from an earlier visit is checked again when the card
//     shows; one older than DROP_MS with no receipt never landed: forgotten.
//   - A chunk that fails to load (an open page after a deploy) is reported to
//     onLazyFail, so the shell can offer a reload (review V7).

import { renderStampAct, renderTraitStamp, RETRYABLE, PREVIEW_HOLDER } from "./cards.mjs";
import { previewHolder, isAddress } from "./citizen.mjs";
import { fitCard } from "./fit.mjs";
import { publicHref } from "./router.mjs";
import { COPY } from "./copy.mjs";

const STEP = (method) =>
  method === "eth_requestAccounts" ? "account" : method === "eth_sendTransaction" ? "confirm" : method === "eth_chainId" || /^wallet_/.test(method) ? "network" : null;

/** A provider that reports which step the wallet is on and the account it shares; requests pass through unchanged. */
export function watchProvider(provider, { onStep = () => {}, onAccount = () => {} } = {}) {
  return {
    request(args) {
      const step = STEP(args?.method);
      if (step) onStep(step);
      const r = provider.request(args);
      if (args?.method === "eth_requestAccounts")
        Promise.resolve(r)
          .then((a) => Array.isArray(a) && isAddress(a[0]) && onAccount(a[0]))
          .catch(() => {});
      return r;
    },
  };
}

/**
 * The stamp module's error code as the card's. Only "wallet" can follow a
 * send: that one is "failed" (check the wallet, no resend). "held" and
 * "closed" are the chain refusing before anything was sent (their own
 * states). Every other code means nothing was sent: its own copy where there
 * is one, else "unsent"; all of those offer Try again.
 */
export function mintErrorCode(code) {
  if (code === "held" || code === "closed" || RETRYABLE.has(code)) return code;
  if (code === "wallet" || typeof code !== "string" || !code) return "failed";
  return "unsent";
}

/**
 * The receipt wait (review V1): the first look ~2 s after the send, then
 * backoff 2/3/5/8 s capped at 10 s; stop waiting in this view after ~5 min
 * (keeping the link); a receipt-less tx older than dropMs never landed.
 */
export const RECEIPT_TIMING = Object.freeze({ first: 2000, delays: [2000, 3000, 5000, 8000, 10000], giveUpMs: 5 * 60_000, dropMs: 10 * 60_000 });

const isTokenId = (n) => Number.isInteger(n) && n >= 1 && n <= 999_999_999;

/** The on-chain stamp id of a trait, or null when the App does not give one. */
const stampIdOf = (trait) => (Number.isInteger(trait?.stampId) && trait.stampId >= 0 && trait.stampId <= 255 ? trait.stampId : null);

/** What the card says before anything happens (also the markup's first state). `cfg`: stamps.config(app). */
export function stampInitial({ lesson, trait, citizen, cfg = null }) {
  if (lesson?.status !== "ready") return { phase: "draft" };
  const rec = cfg && citizen?.mintFor ? citizen.mintFor(cfg, stampIdOf(trait)) : null;
  if (rec?.status === "minted") return { phase: "minted", explorerUrl: rec.explorerUrl };
  if (rec) return { phase: "confirming", explorerUrl: rec.explorerUrl };
  return { phase: "saved" };
}

/** The real stamp a success receipt recorded ({ holder, tokenId }), for the card's first paint. */
export function mintedStamp({ trait, citizen, cfg = null }) {
  const rec = cfg && citizen?.mintFor ? citizen.mintFor(cfg, stampIdOf(trait)) : null;
  return rec?.status === "minted" && isTokenId(rec.tokenId) && isAddress(rec.from) ? { holder: rec.from, tokenId: rec.tokenId } : null;
}

export function mountStamp(card, { app, lesson, trait, identity, stamps, citizen, ctx, onLazyFail = () => {}, timing = {} }) {
  const t = { ...RECEIPT_TIMING, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now(), ...timing };
  const act = card.querySelector("[data-stamp-act]");
  const press = card.querySelector(".trait__press");
  const doc = card.ownerDocument;
  const win = doc?.defaultView;
  const sid = stampIdOf(trait);
  const cfgNow = () => (sid !== null && stamps?.config ? stamps.config(app) : null);
  const cfg0 = cfgNow();
  let state = stampInitial({ lesson, trait, citizen, cfg: cfg0 });
  let provider = null;
  let started = false;
  let destroyed = false;
  let holder = ctx.holder;
  let account = null; // the account the wallet shared without a prompt
  let lastFrom = null; // the account that sent the last mint
  const set = (a) => {
    state = a;
    if (destroyed) return;
    act.innerHTML = String(renderStampAct(a));
    fitCard(card); // a taller action may make a short card scroll: show the "more below" cue
  };
  const lazy = (err) => {
    try {
      onLazyFail(err);
    } catch {
      /* the notice is a nicety */
    }
  };

  function redrawPreview(next) {
    if (!next || next === holder || destroyed) return;
    holder = next;
    press.innerHTML = String(renderTraitStamp({ ...ctx, holder, minted: null }));
  }
  function drawMinted(m) {
    if (destroyed) return;
    press.innerHTML = String(renderTraitStamp({ ...ctx, minted: m }));
  }

  /** Ask the chain, then show the one honest state (review V1). `who`: the account to check, else the wallet's shared one. */
  async function look({ who = null } = {}) {
    if (!provider) {
      let p = null;
      try {
        p = await identity.wallet();
      } catch {
        p = null;
      }
      if (destroyed) return;
      if (!p || typeof p.request !== "function") {
        // a wallet is in the page but its code didn't come: maybe this page is older than the deployed app
        if (win?.ethereum) lazy(new Error("the wallet code did not load"));
        if (state.phase === "busy") set({ phase: "saved" });
        return;
      }
      provider = p;
    }
    try {
      const a = await provider.request({ method: "eth_accounts" });
      account = Array.isArray(a) && isAddress(a[0]) ? a[0] : null;
    } catch {
      account = null;
    }
    if (destroyed) return;
    if (account) {
      citizen?.setWallet(account);
      redrawPreview(previewHolder(identity?.current?.(), citizen));
    }
    const holderToCheck = isAddress(who) ? who : account;
    let r;
    try {
      // no account shared yet: ask only whether the trait is open (a fixed stand-in that holds nothing)
      r = await stamps.check({ app, holder: holderToCheck || PREVIEW_HOLDER, stampId: sid });
    } catch (err) {
      r = { open: false, held: false, error: err?.message || "the chain could not be read" };
    }
    if (destroyed) return;
    if (!r || r.error) {
      lazy(new Error(r?.error || "the chain could not be read"));
      return set({ phase: "saved" }); // can't tell: offer nothing about minting
    }
    if (holderToCheck && r.held === true) return set({ phase: "held" });
    if (r.open !== true) return set({ phase: "closed" });
    set({ phase: "mint" });
  }

  function mint() {
    if (!provider || !(state.phase === "mint" || (state.phase === "error" && RETRYABLE.has(state.code)))) return;
    set({ phase: "busy", step: "network" });
    const watched = watchProvider(provider, {
      onStep: (step) => state.phase === "busy" && set({ phase: "busy", step }),
      onAccount: (a) => {
        citizen?.setWallet(a);
        redrawPreview(a); // the preview for the account that will mint (review V12)
      },
    });
    Promise.resolve()
      .then(() => stamps.mint({ provider: watched, stampId: sid, app }))
      .then(({ txHash, explorerUrl, from }) => {
        lastFrom = isAddress(from) ? from : null;
        if (lastFrom) redrawPreview(lastFrom);
        const rec = { txHash, explorerUrl, from: lastFrom, status: "pending", sentAt: t.now() };
        citizen?.recordMint(cfgNow(), sid, rec);
        set({ phase: "confirming", explorerUrl });
        return watch({ ...rec, explorerUrl }, { fresh: true });
      })
      .catch((err) => {
        const code = mintErrorCode(err?.code);
        // refused before anything was sent: the chain says no (review V1); no mint is offered
        if (code === "held" || code === "closed") return set({ phase: code });
        if (code === "offline") lazy(err);
        set({ phase: "error", code });
      });
  }

  /**
   * Poll for the receipt with backoff. Never sends anything; never records a
   * mint without a success receipt. The holder is mint()'s `from`, so a smart
   * wallet's mint (sent by a bundler) isn't read as reverted. A "pending" with
   * an error is a failed read, not a failed mint: keep polling.
   */
  async function watch(rec, { fresh = false } = {}) {
    const start = t.now();
    const old = !rec.sentAt || start - rec.sentAt > t.dropMs;
    if (fresh) await t.sleep(t.first);
    for (let i = 0; ; i++) {
      if (destroyed) return;
      let r;
      try {
        r = await stamps.receipt({ app, txHash: rec.txHash, ...(isAddress(rec.from) ? { holder: rec.from } : {}) });
      } catch (err) {
        r = { status: "pending", error: err?.message || "the chain could not be read" };
      }
      if (destroyed) return;
      if (r?.status === "success") return succeed(rec, r.tokenId);
      if (r?.status === "reverted") {
        citizen?.forgetMint(cfgNow(), sid);
        return set({ phase: "reverted", explorerUrl: rec.explorerUrl, from: rec.from });
      }
      // a clean "not mined yet" long after sending: it never landed
      if (old && !r?.error) return dropped(rec);
      if (t.now() - start >= t.giveUpMs) return set({ phase: "slow", explorerUrl: rec.explorerUrl });
      await t.sleep(t.delays[Math.min(i, t.delays.length - 1)]);
    }
  }

  async function succeed(rec, tokenId) {
    let id = isTokenId(tokenId) ? tokenId : null;
    if (!id && isAddress(rec.from) && stamps.owned) {
      // the receipt had no readable log: the chain's own list says which token it is
      try {
        const o = await stamps.owned(rec.from, { app });
        id = o?.stamps?.find?.((s) => s.stampId === sid && isTokenId(s.tokenId))?.tokenId ?? null;
      } catch {
        id = null;
      }
      if (destroyed) return;
    }
    citizen?.recordMint(cfgNow(), sid, { ...rec, status: "minted", tokenId: id });
    if (id && isAddress(rec.from)) drawMinted({ holder: rec.from, tokenId: id });
    set({ phase: "minted", explorerUrl: rec.explorerUrl, share: isAddress(rec.from) && identity?.share ? rec.from : null });
  }

  /** No receipt long after sending: it never landed (or was replaced). The chain says whether the account holds the stamp now. */
  async function dropped(rec) {
    let r = null;
    if (isAddress(rec.from)) {
      try {
        r = await stamps.check({ app, holder: rec.from, stampId: sid });
      } catch {
        r = null;
      }
      if (destroyed) return;
      if (!r || r.error) return set({ phase: "slow", explorerUrl: rec.explorerUrl });
    }
    citizen?.forgetMint(cfgNow(), sid);
    if (r?.held === true) return set({ phase: "held" });
    set({ phase: "dropped", explorerUrl: rec.explorerUrl, from: rec.from });
  }

  /** After a revert or a drop, a fresh attempt starts with a fresh check (never a resend). */
  function recheck() {
    if (state.phase !== "reverted" && state.phase !== "dropped") return;
    const who = state.from || lastFrom;
    set({ phase: "busy", step: "check" });
    look({ who });
  }

  /** Share the public passport of the account that just minted: the reader sees the address before they tap (review V9). */
  function shareMine() {
    const addr = state.share;
    if (!isAddress(addr) || !identity?.share) return;
    const url = String(win?.location?.href ?? "").split("#")[0] + publicHref(addr);
    Promise.resolve(identity.share(COPY.shareStamp(trait.name, app.name), url)).catch(() => {});
  }

  const onClick = (e) => {
    const b = e.target.closest?.("[data-mint], [data-recheck], [data-share-mine]");
    if (!b || !act.contains(b)) return;
    e.preventDefault();
    e.stopPropagation();
    if (b.hasAttribute("data-mint")) mint();
    else if (b.hasAttribute("data-recheck")) recheck();
    else shareMine();
  };
  act.addEventListener("click", onClick);

  return {
    get state() {
      return state;
    },
    /** The card is on screen: follow a pending mint, or look for a wallet once, only when minting is possible at all. */
    activate() {
      if (started) return;
      started = true;
      if (!cfg0) return;
      const rec = citizen?.mintFor?.(cfg0, sid);
      if (rec?.status === "pending") watch(rec);
      else if (state.phase === "saved") look();
    },
    destroy() {
      destroyed = true;
      act.removeEventListener("click", onClick);
    },
  };
}
