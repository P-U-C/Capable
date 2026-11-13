// The service worker, generated at build with the precache list and a
// version hash.
//
// - It caches only the app shell (the page, app.json, the manifest, icons)
//   and content-hashed assets (the bundle, styles, fonts, the lazy hls.js
//   chunk once used). Nothing else in scope is ever stored: visiting the
//   manifest or any other URL can never replace the offline page (review S13).
// - Only good responses are stored: status 200, and for the page and
//   app.json the right content type (M38).
// - The page and app.json go network-first so updates arrive; hashed assets
//   are cache-first. Install fetches the unhashed shell past the HTTP cache.
// - Cache names carry the registration scope, so two deployments on one
//   origin never delete each other's caches (S23).
// - Video, ranges and anything cross-origin are never touched.

export function serviceWorker({ version, shell }) {
  return `// capable service worker ${version}
const SCOPE = new URL("./", self.location).pathname;
const PREFIX = "capable:" + SCOPE + ":";
const CACHE = PREFIX + ${JSON.stringify(version)};
const SHELL = ${JSON.stringify(shell)};
const HASHED = /\\.[A-Za-z0-9]{8,12}\\.(?:js|css|woff2)$/;
const VIDEO = /\\.(m3u8|ts|m4s|mp4|webm|mov|aac)$/i;
const abs = (u) => new URL(u, self.location).href;

const good = (res, type) =>
  !!res && res.status === 200 && res.type !== "opaque" && res.type !== "opaqueredirect" && (!type || (res.headers.get("content-type") || "").toLowerCase().includes(type));

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(abs(u), { cache: HASHED.test(u) ? "default" : "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => (k.startsWith(PREFIX) && k !== CACHE) || /^capable-[0-9a-f]{10}$/.test(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(req, key, type) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req, { cache: "no-cache" });
    if (good(res, type)) await cache.put(abs(key), res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(abs(key));
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (good(res)) await cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return; // fonts, streams, other apps: the network as usual
  if (req.headers.has("range") || VIDEO.test(url.pathname) || req.destination === "video" || req.destination === "audio") return; // never video
  const path = url.pathname.slice(SCOPE.length);
  if (req.mode === "navigate") {
    if (path === "" || path === "index.html") return e.respondWith(networkFirst(req, "./", "text/html"));
    return; // any other page is left to the network and never stored
  }
  if (path === "app.json") return e.respondWith(networkFirst(req, "./app.json", "json"));
  if (HASHED.test(path) || SHELL.includes("./" + path)) return e.respondWith(cacheFirst(req));
});
`;
}
