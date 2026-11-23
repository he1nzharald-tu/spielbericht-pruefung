// Service Worker: App-Dateien offline verfügbar, Daten immer zuerst aus dem Netz.
const VERSION = "v1";
const SHELL = [
  "./", "index.html", "css/app.css", "js/app.js", "js/rules.js", "js/names.js", "js/store.js", "js/pdf.js",
  "manifest.webmanifest", "icons/icon.svg", "icons/apple-touch-icon.png",
  "vendor/jspdf.umd.min.js", "vendor/jspdf.plugin.autotable.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open("shell-" + VERSION).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Netz zuerst (Daten und App-Code), bei Offline Cache
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open((url.pathname.includes("/data/") ? "data-" : "shell-") + VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
