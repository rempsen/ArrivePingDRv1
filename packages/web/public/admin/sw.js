/* ArrivePing admin service worker. Scope: /admin/.
 * Deliberately small: it makes the app installable and shows a friendly page
 * when the network is gone. It never caches API responses or app code, so a
 * deploy is always picked up on the next load. */
const OFFLINE = "/admin/offline.html";
const CACHE = "arriveping-admin-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(OFFLINE)).then(() => self.skipWaiting()));
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
  if (req.mode !== "navigate") return;
  event.respondWith(
    fetch(req).catch(async () => (await caches.match(OFFLINE)) || new Response("Offline", { status: 503 })),
  );
});
