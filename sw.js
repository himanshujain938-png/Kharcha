// Kharcha Service Worker — caches app shell + Firebase SDK for offline use
// Bump CACHE_VERSION to force re-cache after updates
const CACHE_VERSION = 'kharcha-v6';
const APP_SHELL = [
  './',
  './index.html'
];
const FIREBASE_URLS = [
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'
];

// On install: pre-cache app shell and Firebase SDK
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(async (cache) => {
      // Cache app shell — fail loudly if this breaks
      await cache.addAll(APP_SHELL);
      // Cache Firebase SDK — best effort, don't block install if offline
      await Promise.all(FIREBASE_URLS.map(url =>
        fetch(url, { mode: 'cors' })
          .then(resp => resp.ok ? cache.put(url, resp) : null)
          .catch(() => null)
      ));
      self.skipWaiting();
    })
  );
});

// On activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// On fetch: network-first for HTML (so updates are picked up),
// cache-first for everything else (Firebase SDK, fonts, etc.)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache Firebase API/auth endpoints — they're dynamic
  if (url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('identitytoolkit.googleapis.com') ||
      url.hostname.includes('securetoken.googleapis.com') ||
      url.hostname.includes('firebaseinstallations.googleapis.com')) {
    return; // let it pass through normally
  }

  // For HTML/navigation: network first, fallback to cache
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req)
        .then(resp => {
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy));
          return resp;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // For Firebase SDK and static assets: cache first, then network
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(resp => {
        // Only cache successful, cacheable responses
        if (resp && resp.status === 200 && (resp.type === 'basic' || resp.type === 'cors')) {
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
