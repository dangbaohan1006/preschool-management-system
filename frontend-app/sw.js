const CACHE_NAME = 'tds-pwa-cache-v1';
const PRECACHE_ASSETS = [
  './',
  './admin.html',
  './index.html',
  './app.js',
  './assets/images/TDS_LOGO.png'
];

// Install Event - Precache Core Assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Precaching core assets');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event - Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Caching strategies
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Skip non-GET requests or chrome extension calls
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
    return;
  }

  // Strategy for CDN and external assets (Google Fonts, Tailwind, JS libraries)
  const isCDN = [
    'cdn.tailwindcss.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdn.jsdelivr.net',
    'npmcdn.com',
    'cdnjs.cloudflare.com'
  ].some(domain => requestUrl.hostname.includes(domain));

  if (isCDN) {
    // Cache-First strategy for heavy CDN assets
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const cacheToOpen = caches.open(CACHE_NAME);
            event.waitUntil(
              cacheToOpen.then((cache) => cache.put(event.request, networkResponse.clone()))
            );
          }
          return networkResponse;
        }).catch((err) => {
          console.error('[Service Worker] Failed to fetch CDN asset:', event.request.url, err);
          return new Response('Offline CDN placeholder', { status: 503, statusText: 'Service Unavailable' });
        });
      })
    );
  } else {
    // Network-First with cache fallback strategy for local HTML/JS/CSS/Assets
    event.respondWith(
      fetch(event.request).then((networkResponse) => {
        // Cache dynamic successful responses for same-origin
        if (networkResponse && networkResponse.status === 200 && requestUrl.origin === self.location.origin) {
          const cacheToOpen = caches.open(CACHE_NAME);
          event.waitUntil(
            cacheToOpen.then((cache) => cache.put(event.request, networkResponse.clone()))
          );
        }
        return networkResponse;
      }).catch(() => {
        // Fallback to cache if network fails
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // If offline and request is HTML, return an offline template if available, or just standard response
          if (event.request.headers.get('accept').includes('text/html')) {
            return caches.match('./admin.html') || caches.match('./index.html');
          }
          return new Response('Hệ thống đang offline và tài nguyên chưa được lưu trữ.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
      })
    );
  }
});
