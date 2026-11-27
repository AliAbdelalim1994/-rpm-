/* Service worker: network first (always the newest files), last copy when offline. */
const V = 'rpm-static-v17';
const SHELL = ['./', './index.html', './app.js?v=17', './config.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== 'rpm-cdn').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET') return;
  if (u.origin !== location.origin) { // Excel reader from the CDN: cache after first use. Everything else (Apps Script API) goes straight to the network.
    if (u.hostname === 'cdnjs.cloudflare.com') e.respondWith(caches.open('rpm-cdn').then(async c => { const hit = await c.match(r); if (hit) return hit; const res = await fetch(r); if (res.ok) c.put(r, res.clone()); return res; }));
    return;
  }
  e.respondWith(fetch(r.url, { cache: 'no-cache' }).then(res => { if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r.url, cp)); } return res; })
    .catch(() => caches.match(r.url, { ignoreSearch: true }).then(h => h || (r.mode === 'navigate' ? caches.match('./') : null)).then(h => h || Response.error())));
});
