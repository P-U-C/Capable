// hls.js from npm, bundled as its own lazy chunk (review S6): imported only the
// first time a stream needs it (src/player.mjs), served from this origin, so
// the CSP needs no script host. The light build: no subtitles, alternate
// audio or DRM, none of which the app uses.
export { default } from "hls.js/light";
