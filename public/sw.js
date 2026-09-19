/*
 * Minimal service worker.
 *
 * Two jobs, and deliberately no more:
 *
 *   1. It makes the site installable on Android, which requires a worker with
 *      a fetch handler.
 *   2. It serves the last-seen page when the network is gone, so opening the
 *      app on a train shows yesterday's rankings instead of a dinosaur.
 *
 * NETWORK FIRST, ALWAYS. This app is about prices and scores that change; a
 * cache-first worker would happily show a month-old ranking as though it were
 * today's, which is the one failure this project refuses to ship. The cache is
 * only ever a fallback, and anything served from it is by definition stale.
 */

const CACHE = "f20-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never cache the control surfaces or anything that spends money.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/dashboard")) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit ?? caches.match("/"))),
  );
});

/**
 * Push notifications.
 *
 * The payload is produced by /api/push/dispatch, which only fires when the
 * sell rules flag something that was not flagged last time. The worker's job
 * is simply to show it and to open the right page when it is tapped.
 *
 * A malformed payload still shows something useful rather than nothing: a
 * notification that fails to render is an alert the reader never learns about.
 */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "Factor20";
  const options = {
    body: data.body || "Something changed on the latest scan.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // One tag, so a second alert replaces the first instead of stacking up a
    // column of notifications nobody reads.
    tag: "f20-exit",
    renotify: true,
    data: { url: data.url || "/exits" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/exits";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Reuse an open window rather than piling up tabs.
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
