// The hosts a directive of this page's Content-Security-Policy allows, read
// from its <meta http-equiv> tag. The build writes media-src from the
// contract's VIDEO_HOSTS, so in the browser this is that list without the
// bundle having to spell the hosts out (review C12; see build.mjs).
export function cspHosts(doc = globalThis.document, directive = "media-src") {
  try {
    const meta = doc?.querySelector?.('meta[http-equiv="Content-Security-Policy"]');
    const policy = String(meta?.getAttribute?.("content") ?? meta?.content ?? "");
    const d = policy
      .split(";")
      .map((x) => x.trim().split(/\s+/))
      .find(([name]) => name === directive);
    return (d || []).slice(1).flatMap((t) => (/^https:\/\/[a-z0-9.-]+$/i.test(t) ? [t.slice(8).toLowerCase()] : []));
  } catch {
    return [];
  }
}
