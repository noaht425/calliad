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

// On Safari 18.4+ the payload is Declarative Web Push and the browser shows it
// itself — this handler doesn't run. Every other browser lands here; read the
// nested `notification` object (what the server now sends), falling back to the
// old flat shape.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const raw = event.data.json();
  const n = raw.notification || raw;
  const url = n.navigate || (n.data && n.data.url) || raw.url || '/';
  const token = (n.data && n.data.actionToken) || raw.actionToken || null;
  const actions = Array.isArray(n.actions) ? n.actions.slice(0, 2)
    : Array.isArray(raw.actions) ? raw.actions.slice(0, 2) : undefined;
  event.waitUntil(
    self.registration.showNotification(n.title ?? 'Calliad', {
      body: n.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: n.tag ?? raw.tag ?? 'calliad-reminder',
      data: { url: url, actionToken: token },
      actions: actions,
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
