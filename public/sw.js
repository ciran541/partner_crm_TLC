// SW Version: 2
// Minimal Service Worker to satisfy PWA requirements
self.addEventListener('install', (event) => {
    console.log('SW installed');
});

self.addEventListener('fetch', (event) => {
    // Pass-through fetch (required for PWA installability)
    event.respondWith(fetch(event.request));
});
