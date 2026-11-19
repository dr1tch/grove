// The generated manifest contains only static app files, never vault data or tokens.
const VERSION = "grove-shell-__BUILD_ID__";
const FILES = __STATIC_FILES__;
const SCOPE = new URL(self.registration.scope).pathname;
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith("grove-shell-") && key !== VERSION) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(SCOPE)
  )
    return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const response = await caches.match(`${SCOPE}index.html`);
        if (!response) throw new Error("Open Grove online once before using it offline.");
        return response;
      }),
    );
    return;
  }
  if (!FILES.includes(url.pathname)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      // Fonts and module scripts carry Origin; servers may send Vary: Origin on the stored copy.
      const saved = await cache.match(request, { ignoreVary: true });
      if (saved) return saved;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })(),
  );
});
