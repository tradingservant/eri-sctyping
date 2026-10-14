/* Offline cache for the Sucheng practice app.
   Paths are relative so the site works at /eri-sctyping/ on GitHub Pages. */
"use strict";

const CACHE = "sucheng-static-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./data/characters.json",
  "./data/radicals.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  event.respondWith(fromCacheOrNetwork(request));
});

async function fromCacheOrNetwork(request) {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return fetch(request);
  }

  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;

  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (error) {
    if (request.mode === "navigate") {
      return (await cache.match("./index.html")) || (await cache.match("./")) || Response.error();
    }
    throw error;
  }
}
