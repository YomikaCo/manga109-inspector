/* App-shell-only service worker. Local File objects and blob: URLs are never cached here. */
const CACHE_NAME = "manga109-inspector-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./src/app.js",
  "./src/core/dataset.js",
  "./src/core/fixture-dataset.js",
  "./src/core/geometry.js",
  "./src/core/image-cache.js",
  "./src/core/lru-cache.js",
  "./src/core/mapping.js",
  "./src/core/utils.js",
  "./src/core/xml-parser.js",
  "./fixtures/annotations/DemoBook.xml",
  "./fixtures/images/DemoBook/000.png",
  "./fixtures/images/DemoBook/001.png",
  "./fixtures/images/DemoBook/002.png",
];

const scopedUrl = (path) => new URL(path, self.registration.scope).href;
const APP_SHELL_URLS = new Set(APP_SHELL.map(scopedUrl));
const INDEX_URL = scopedUrl("./index.html");

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll([...APP_SHELL_URLS]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(INDEX_URL).then((response) => response ?? Response.error())));
    return;
  }

  if (!APP_SHELL_URLS.has(request.url)) return;
  event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
});
