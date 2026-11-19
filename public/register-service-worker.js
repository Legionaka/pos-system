self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data !== 'CACHE_POS') return;
  event.waitUntil((async () => {
    const response = await fetch('/pos', { credentials: 'include' });
    if (!response.ok) return;
    await (await caches.open('register-shell-v1')).put('/pos', response.clone());
    const html = await response.text();
    const assets = [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^\"]+)"/g)].map((match) => match[1]);
    const cache = await caches.open('register-assets-v1');
    await Promise.all(assets.map(async (asset) => {
      try {
        const result = await fetch(asset);
        if (result.ok) await cache.put(asset, result);
      } catch { /* Keep the remaining register assets available. */ }
    }));
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate' && url.pathname === '/pos') {
    event.respondWith((async () => {
      const cache = await caches.open('register-shell-v1');
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put('/pos', response.clone());
        return response;
      } catch {
        const cached = await cache.match('/pos');
        return cached || Response.error();
      }
    })());
    return;
  }

  if (request.mode === 'navigate' && (url.pathname === '/login' || url.pathname === '/auth/confirm')) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) await caches.delete('register-shell-v1');
        return response;
      } catch { return Response.error(); }
    })());
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith((async () => {
      const cache = await caches.open('register-assets-v1');
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
  }
});
