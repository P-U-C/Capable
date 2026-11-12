// Hosted build only: tell a Farcaster Mini App host the page is ready, so it
// hides its splash screen. This is the SDK's `actions.ready()` call made over
// the same comlink channel, without bundling the whole SDK.
import { wrap, windowEndpoint } from "comlink";

export function miniappReady() {
  const rn = window.ReactNativeWebView;
  let embedded = false;
  try {
    embedded = window.parent && window.parent !== window;
  } catch {
    embedded = true;
  }
  if (!rn && !embedded) return;
  const endpoint = rn
    ? {
        postMessage: (data) => rn.postMessage(JSON.stringify(data)),
        addEventListener: (_, listener, ...args) => document.addEventListener("FarcasterFrameCallback", listener, ...args),
        removeEventListener: (_, listener) => document.removeEventListener("FarcasterFrameCallback", listener),
      }
    : windowEndpoint(window.parent);
  try {
    const host = wrap(endpoint);
    Promise.resolve(host.ready({})).catch(() => {});
  } catch {
    /* not a mini app host */
  }
}
