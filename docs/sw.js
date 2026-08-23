const SHELL_CACHE = "alza-shell-v8";
const RUNTIME_CACHE = "alza-runtime-v8";
const MAX_RUNTIME_ENTRIES = 80;
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/icons/alza-192.png",
  "/icons/alza-512.png",
  "/icons/alza-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(Promise.all([
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)),
    self.skipWaiting(),
  ]));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || request.headers.get("rsc") === "1") return;

  if (request.mode === "navigate") {
    const refresh = fetch(request)
      .then((response) => {
        if (!response.ok) return response;
        return caches.open(SHELL_CACHE)
          .then((cache) => cache.put("/", response.clone()))
          .then(() => response);
      });
    event.waitUntil(refresh.catch(() => undefined));
    event.respondWith(
      caches.match("/").then((cached) => cached ?? refresh)
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response.ok) return response;
        return caches.open(RUNTIME_CACHE).then(async (cache) => {
          await cache.put(request, response.clone());
          const keys = await cache.keys();
          await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_RUNTIME_ENTRIES)).map((key) => cache.delete(key)));
          return response;
        });
      });
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.tag === "alza-deferred-workout"
    ? "/?quick=calendar"
    : event.notification.tag?.startsWith("alza-body-checkin")
      ? "/?view=progress&quick=measurements"
      : "/?quick=workout";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => "focus" in client);
      if (existing) {
        return existing.navigate(targetUrl).then((client) => client.focus());
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
