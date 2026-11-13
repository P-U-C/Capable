// v3, the DOM half of the trait card's stamp (review U6, docs/SPEC-V3.md):
// the stamp is pressed when the card arrives (CSS, .is-earned), then the card
// says where it went.
//
//   - No contract configured (stamps.config(app) is null), no on-chain id for
//     the trait, or a draft lesson: "Saved to your passport" (or the draft
//     note), and the wallet code is never loaded.
//   - Otherwise, the first time the card is shown, identity.wallet() looks for
//     a wallet. None: still "Saved to your passport". One: "Mint this stamp".
//     If the wallet already shares an address (eth_accounts, no prompt) the
//     preview is redrawn for it, and a stamp the chain already has for it says
//     so instead of offering a mint that would revert.
//   - Minting: stamps.mint() switches the network, asks for an account and
//     sends one transaction. The provider is watched (not changed) so the card
//     can say which step the wallet is on. The button is disabled while the
//     wallet works and gone once sent; the transaction is remembered, so this
//     browser never offers to send a second one. Only errors where nothing
//     can have been sent offer "Try again".

import { renderStampAct, renderTraitStamp, RETRYABLE } from "./cards.mjs";
import { previewHolder, isAddress } from "./citizen.mjs";
import { fitCard } from "./fit.mjs";

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

/** The stamp module's error code as the card's: anything that might have reached the wallet's send is "failed". */
export const mintErrorCode = (code) => (RETRYABLE.has(code) ? code : "failed");

/** The on-chain stamp id of a trait, or null when the App does not give one. */
const stampIdOf = (trait) => (Number.isInteger(trait?.stampId) && trait.stampId >= 0 && trait.stampId <= 255 ? trait.stampId : null);

/** What the card says before anything happens (also the markup's first state). */
export function stampInitial({ lesson, trait, citizen }) {
  if (lesson?.status !== "ready") return { phase: "draft" };
  const sent = citizen?.get?.().minted?.[trait?.id];
  if (sent) return { phase: "sent", explorerUrl: sent.explorerUrl };
  return { phase: "saved" };
}

export function mountStamp(card, { app, lesson, trait, identity, stamps, citizen, ctx }) {
  const act = card.querySelector("[data-stamp-act]");
  const press = card.querySelector(".trait__press");
  let state = stampInitial({ lesson, trait, citizen });
  let provider = null;
  let started = false;
  let destroyed = false;
  let holder = ctx.holder;
  const set = (a) => {
    state = a;
    if (destroyed) return;
    act.innerHTML = String(renderStampAct(a));
    fitCard(card); // a taller action may make a short card scroll: show the "more below" cue
  };
  const sid = stampIdOf(trait);
  const cfg = () => (state.phase === "saved" && sid !== null && stamps?.config ? stamps.config(app) : null);

  function redrawStamp() {
    const next = previewHolder(identity?.current?.(), citizen);
    if (next === holder || destroyed) return;
    holder = next;
    press.innerHTML = String(renderTraitStamp({ ...ctx, holder }));
  }

  async function look() {
    let p = null;
    try {
      p = await identity.wallet();
    } catch {
      p = null;
    }
    if (destroyed || !p || typeof p.request !== "function") return;
    provider = p;
    let address = null;
    try {
      const a = await p.request({ method: "eth_accounts" });
      address = Array.isArray(a) && isAddress(a[0]) ? a[0] : null;
    } catch {
      address = null;
    }
    if (destroyed) return;
    if (address) {
      citizen?.setWallet(address);
      redrawStamp();
      try {
        const r = await stamps.owned(address);
        if (!destroyed && !r?.error && r?.stamps?.some((s) => s.stampId === sid)) return set({ phase: "held" });
      } catch {
        /* a failed read changes nothing: offer the mint */
      }
    }
    if (!destroyed && state.phase === "saved") set({ phase: "mint" });
  }

  function mint() {
    if (!provider || state.phase === "busy" || state.phase === "sent") return;
    set({ phase: "busy", step: "network" });
    const watched = watchProvider(provider, {
      onStep: (step) => state.phase === "busy" && set({ phase: "busy", step }),
      onAccount: (a) => {
        citizen?.setWallet(a);
        redrawStamp();
      },
    });
    stamps
      .mint({ provider: watched, stampId: sid, app })
      .then(({ txHash, explorerUrl }) => {
        const c = stamps.config(app);
        citizen?.recordMint(trait.id, { txHash, explorerUrl, chainId: c?.chainId, contract: c?.address });
        set({ phase: "sent", explorerUrl });
      })
      .catch((err) => set({ phase: "error", code: mintErrorCode(err?.code) }));
  }

  const onClick = (e) => {
    const b = e.target.closest?.("[data-mint]");
    if (!b || !act.contains(b)) return;
    e.preventDefault();
    e.stopPropagation();
    mint();
  };
  act.addEventListener("click", onClick);

  return {
    get state() {
      return state;
    },
    /** The card is on screen: look for a wallet once, and only when minting is possible at all. */
    activate() {
      if (started) return;
      started = true;
      if (cfg()) look();
    },
    destroy() {
      destroyed = true;
      act.removeEventListener("click", onClick);
    },
  };
}
