// Teder's service worker: a push wakes it with no words in it, and it asks Teder, behind the owner's session,
// what to show. Nothing about a post travels through the push service (src/notify).
self.addEventListener('push', (e) => {
  e.waitUntil(
    fetch('/notifications/latest.json', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((n) => self.registration.showNotification(n?.title || 'תדר', { body: n?.body || 'יש משהו חדש בתדר', data: { url: n?.url || '/' }, lang: 'he', dir: 'rtl', tag: n ? `n-${n.id}` : 'teder' }))
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((list) => {
      const open = list.find((c) => new URL(c.url).origin === self.location.origin);
      return open ? open.navigate(url).then((c) => c?.focus()) : self.clients.openWindow(url);
    })
  );
});
