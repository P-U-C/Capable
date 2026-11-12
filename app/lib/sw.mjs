// The service worker, generated at build with the shell's file list and a
// version hash. It caches the app shell and app.json. app.json and page
// navigations go network-first so updates arrive; hashed assets are
// cache-first. Video (and anything cross-origin: fonts, streams, hls.js) is
// never cached by it.

export function serviceWorker({ version, shell }) {
  return `// capable service worker ${version}
const CACHE = "capable-${version}";
const SHELL = ${JSON.stringify(shell)};
const VIDEO = /\\.(m3u8|ts|m4s|mp4|webm|mov|aac)$/i;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("capable-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(req, key) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req, { cache: "no-cache" });
    if (res.ok) await cache.put(key || req, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(key || req)) || (await cache.match(req, { ignoreSearch: true }));
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  return hit || fetch(req);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fonts, streams, hls.js: the network as usual
  if (req.headers.has("range") || VIDEO.test(url.pathname) || req.destination === "video" || req.destination === "audio") return; // never video
  if (url.pathname.endsWith("/app.json")) return e.respondWith(networkFirst(req, "./app.json"));
  if (req.mode === "navigate") return e.respondWith(networkFirst(req, "./index.html"));
  if (SHELL.some((p) => new URL(p, self.location).pathname === url.pathname)) return e.respondWith(cacheFirst(req));
});
`;
}
