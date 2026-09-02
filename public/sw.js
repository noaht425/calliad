// Calliad service worker — push notifications (with action buttons) + click
// routing, plus a bare offline fallback. It deliberately does NOT precache app
// pages (that served stale HTML after deploys) — the only cached asset is a
// static /offline.html shown when a navigation request fails with no network.

const OFFLINE_CACHE = 'calliad-offline-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE).then((c) => c.addAll(['/offline.html', '/icons/icon-192.png'])),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== OFFLINE_CACHE).map((k) => caches.delete(k)))),
    ]),
  );
});

// Only intervene on page navigations that fail — everything else goes straight
// to the network (no caching of API responses, JS, or real pages).
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match('/offline.html', { cacheName: OFFLINE_CACHE });
      return cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }),
  );
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Calliad', {
      body: data.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag ?? 'calliad-reminder',
      data: { url: data.url ?? '/', actionToken: data.actionToken ?? null },
      actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : undefined,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  const notif = event.notification;
  notif.close();

  const action = event.action;
  const token = notif.data && notif.data.actionToken;

  // A button was tapped and we have a signed token → answer server-side, then
  // replace the notification with a short confirmation. No app window needed.
  if (action && token) {
    event.waitUntil(
      fetch('/api/push/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, action: action }),
      })
        .then((r) => r.json())
        .catch(() => ({ message: 'Could not reach Calliad — try again in the app.' }))
        .then((j) =>
          self.registration.showNotification('Calliad', {
            body: (j && j.message) || 'Got it.',
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            tag: 'calliad-ack',
          })
        )
    );
    return;
  }

  // Body tap (or no token) → open / focus the app.
  const url = (notif.data && notif.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
