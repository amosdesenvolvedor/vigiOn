const CACHE = 'vigion-shell-v4';
const SHELL = [
  '/',
  '/monitoring',
  '/manifest.webmanifest',
  '/icons/vigion-192.png',
  '/icons/vigion-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/vigion-maskable-192.png',
  '/icons/vigion-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
        ),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  )
    return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/')));
    return;
  }
  if (
    !url.pathname.startsWith('/assets/') &&
    !url.pathname.startsWith('/icons/') &&
    url.pathname !== '/manifest.webmanifest'
  )
    return;
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (!response.ok) return response;
          const cacheCopy = response.clone();
          return caches
            .open(CACHE)
            .then((cache) => cache.put(request, cacheCopy))
            .then(() => response);
        }),
    ),
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {
    data = {};
  }
  event.waitUntil(
    self.registration.showNotification(String(data.title || 'Vigion Cloud'), {
      body: String(data.body || 'Há uma nova atualização de monitoramento.'),
      icon: '/icons/vigion-192.png',
      badge: '/icons/vigion-192.png',
      data: { path: safePath(data.path) },
      tag: String(data.path || 'vigion-alert'),
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = safePath(event.notification.data?.path);
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const existing = windows[0];
      if (existing) {
        existing.navigate(path);
        return existing.focus();
      }
      return clients.openWindow(path);
    }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_PUBLIC_CACHES')
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))),
    );
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

function safePath(value) {
  return typeof value === 'string' &&
    /^\/(monitoring|alerts|events|notifications)([/?#]|$)/.test(value)
    ? value
    : '/monitoring';
}
