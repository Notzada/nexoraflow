self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'NexoraFlow', {
      body: data.body || 'Você tem tarefas pendentes hoje!',
      icon: '/nexcoin.png',
      badge: '/nexcoin.png',
      vibrate: [200, 100, 200],
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length > 0) return list[0].focus();
      return clients.openWindow(event.notification.data?.url || '/');
    })
  );
});
