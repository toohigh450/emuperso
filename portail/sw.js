/* EMUPERSO — service worker v1.
 * Stratégie prudente : l'enveloppe de l'appli est mise en cache pour un
 * démarrage rapide, mais le réseau reste prioritaire pour les navigations
 * afin que les mises à jour du portail arrivent toujours.
 * Aucune ROM personnelle n'est mise en cache : les fichiers de jeu sont
 * lus en local par le navigateur et ne transitent jamais par ce worker
 * autrement que comme requêtes réseau normales (non mises en cache ici).
 */
const VERSION = 'emuperso-sw-v1';
const PRECACHE = [
  '/',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Seulement les GET de même origine. Le reste passe direct.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Jamais de cache pour les envois de fichiers (import de ROM) ni les flux partiels.
  if (request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    // Navigations : réseau d'abord, repli sur le cache si hors-ligne.
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('/')))
    );
    return;
  }

  // Actifs statiques : cache d'abord, revalidation en arrière-plan.
  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || network;
    })
  );
});
