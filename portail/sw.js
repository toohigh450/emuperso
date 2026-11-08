/* EMUPERSO : seul le portail et ses ressources PWA sont mis en cache.
 * Les moteurs, jeux, BIOS, sauvegardes et autres routes passent au réseau.
 * Le premier chargement et les émulateurs nécessitent une connexion.
 */
const VERSION = 'emuperso-sw-v2';
const PREFIX = 'emuperso-sw-';
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    // addAll échouerait entier si une icône répond 404 : on met en cache
    // chaque ressource séparément et on ignore les échecs.
    caches.open(VERSION).then((cache) => Promise.all(SHELL.map((path) =>
      fetch(path).then((r) => (r.ok ? cache.put(path, r) : undefined)).catch(() => {})
    ))).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(PREFIX) && key !== VERSION)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.headers.has('range') || url.search || !SHELL.includes(url.pathname)) return;

  // Réseau prioritaire : les mises à jour web sont visibles sans reconstruire l'APK.
  // Une erreur HTTP reste visible et ne remplace jamais une bonne copie du portail.
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && !response.redirected && response.type === 'basic') {
        // Un cache plein ou indisponible ne doit pas empêcher la réponse réseau.
        try {
          const cache = await caches.open(VERSION);
          await cache.put(request, response.clone());
        } catch { /* Le réseau a réussi : renvoyer sa réponse. */ }
      }
      return response;
    } catch {
      const cache = await caches.open(VERSION);
      return (await cache.match(request)) || Response.error();
    }
  })());
});
