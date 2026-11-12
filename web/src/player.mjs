// Hosted build only: plays a voice's video inline in a 9:16 frame.
// Safari plays HLS natively; elsewhere hls.js is loaded once from cdnjs.

export const HLS_SRC = "https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.20/hls.min.js";
const HTTPS = /^https:\/\/[^\s<>"'`\\]+$/;
let hlsLoading = null;

function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!hlsLoading) {
    hlsLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = HLS_SRC;
      s.crossOrigin = "anonymous";
      s.referrerPolicy = "no-referrer";
      s.onload = () => (window.Hls ? resolve(window.Hls) : reject(new Error("hls.js missing")));
      s.onerror = () => reject(new Error("hls.js failed to load"));
      document.head.appendChild(s);
    });
  }
  return hlsLoading;
}

function fail(slot) {
  slot.textContent = "This video can't play here. Use the Farcaster link.";
  slot.classList.add("player-error");
}

/** Toggle an inline player in the voice card that holds `button`. */
export function play(button) {
  const src = button.getAttribute("data-src") || "";
  const card = button.closest(".voice");
  const slot = card && card.querySelector(".player-slot");
  if (!slot || !HTTPS.test(src)) return;
  if (slot.firstChild) {
    const v = slot.querySelector("video");
    if (v) v.pause();
    slot.textContent = "";
    slot.classList.remove("is-open", "player-error");
    button.textContent = "Play here";
    button.setAttribute("aria-expanded", "false");
    return;
  }
  const frame = document.createElement("div");
  frame.className = "player";
  const video = document.createElement("video");
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.setAttribute("playsinline", "");
  frame.appendChild(video);
  slot.appendChild(frame);
  slot.classList.add("is-open");
  button.textContent = "Hide video";
  button.setAttribute("aria-expanded", "true");
  const isHls = /\.m3u8(\?|$)/i.test(src);
  const start = () => video.play().catch(() => {});
  if (!isHls || video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = src;
    video.addEventListener("error", () => fail(slot), { once: true });
    start();
    return;
  }
  loadHls()
    .then((Hls) => {
      if (!Hls.isSupported()) return fail(slot);
      const hls = new Hls({ enableWorker: false });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data && data.fatal) {
          hls.destroy();
          fail(slot);
        }
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      start();
    })
    .catch(() => fail(slot));
}
