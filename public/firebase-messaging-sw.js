/* Background push handler — native Web Push API, no importScripts/CDN required.
 * FCM delivers: { notification: { title, body }, data: { link, notificationId, ... } } */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try { payload = event.data.json(); } catch { return; }

  const title = (payload.notification && payload.notification.title)
    || (payload.data && payload.data.title)
    || 'EL Node ERP';
  const body = (payload.notification && payload.notification.body)
    || (payload.data && payload.data.body)
    || '';
  const link = (payload.data && payload.data.link) || '/';
  const tag  = (payload.data && payload.data.notificationId) || undefined;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/logo high res tp-01.png',
      badge: '/logo high res tp-01.png',
      tag,
      data: { link },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(link).catch(() => {});
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(link);
    })
  );
});
