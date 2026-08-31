// Calliad service worker — push notifications (with action buttons) + click routing

// No fetch handler here, so taking over immediately is safe and gets new
// versions (e.g. action buttons) live without waiting for every tab to close.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
