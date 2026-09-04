const SHELL_CACHE = "alza-shell-v21";
const RUNTIME_CACHE = "alza-runtime-v14";
const EXERCISE_CACHE = "alza-exercises-v2";
const MAX_RUNTIME_ENTRIES = 80;
const MAX_EXERCISE_ENTRIES = 180;
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
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const currentCaches = new Set([SHELL_CACHE, RUNTIME_CACHE, EXERCISE_CACHE]);
    await Promise.all(keys.filter((key) => key.startsWith("alza-") && !currentCaches.has(key)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function cacheResponse(cacheName, request, response, maxEntries) {
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  const keys = await cache.keys();
  const excess = Math.max(0, keys.length - maxEntries);
  await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
  return response;
}

async function updateCachedResponse(cacheName, request, maxEntries) {
  const response = await fetch(request);
  if (!response.ok) return response;
  return cacheResponse(cacheName, request, response, maxEntries);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || request.headers.get("rsc") === "1") return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cacheControl = response.headers.get("cache-control") ?? "";
        if (response.ok && !url.search && !cacheControl.toLowerCase().includes("no-store")) {
          const cache = await caches.open(SHELL_CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        return (await caches.match(request)) ?? (await caches.match("/")) ?? Response.error();
      }
    })());
    return;
  }

  if (url.pathname.startsWith("/exercises/")) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      const refresh = updateCachedResponse(EXERCISE_CACHE, request, MAX_EXERCISE_ENTRIES);
      if (cached) {
        event.waitUntil(refresh.catch(() => undefined));
        return cached;
      }
      return refresh.catch(() => Response.error());
    })());
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response.ok) return response;
        return cacheResponse(RUNTIME_CACHE, request, response, MAX_RUNTIME_ENTRIES);
      });
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.tag === "alza-deferred-workout"
    ? "/?quick=calendar"
    : event.notification.tag?.startsWith("workout:")
      ? "/?quick=workout"
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
