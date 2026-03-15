/* ═══════════════════════════════════════════════════
   BUGÜN NƏ ÖYRƏNİM? — SERVICE WORKER v1.0
   Offline cache + Push Notifications + Background Sync
═══════════════════════════════════════════════════ */

const CACHE_NAME    = 'bno-v1';
const DYNAMIC_CACHE = 'bno-dynamic-v1';

// Yüklənəcək fayllar (App Shell)
const APP_SHELL = [
  '/index.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400&family=Outfit:wght@300;400;500;600;700&display=swap'
];

// ─── INSTALL: App Shell-i cache-ə yaz ────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching app shell');
        // Font URL-ləri CORS problemi ola bilər, no-cors ilə yüklə
        return Promise.allSettled(
          APP_SHELL.map(url =>
            cache.add(url).catch(err => console.warn('[SW] Cache miss:', url, err))
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE: Köhnə cache-ləri sil ──────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== DYNAMIC_CACHE)
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ─── FETCH: Cache-first, sonra şəbəkə ────────────
self.addEventListener('fetch', event => {
  // Yalnız GET sorğularını idarə et
  if (event.request.method !== 'GET') return;

  // Chrome extension sorğularını keç
  if (event.request.url.startsWith('chrome-extension://')) return;

  // Naviqasiya sorğuları (HTML) — Network-first
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Digər resurslar — Cache-first, sonra şəbəkə
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request)
        .then(response => {
          // Yalnız uğurlu cavabları cache-ə yaz
          if (!response || response.status !== 200 || response.type === 'opaque') {
            return response;
          }
          const clone = response.clone();
          caches.open(DYNAMIC_CACHE).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          // Şəkil sorğusu üçün placeholder
          if (event.request.destination === 'image') {
            return new Response(
              '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#F7F4EE"/></svg>',
              { headers: { 'Content-Type': 'image/svg+xml' } }
            );
          }
        });
    })
  );
});

// ─── PUSH: Gündəlik bildiriş ──────────────────────
self.addEventListener('push', event => {
  console.log('[SW] Push received');

  let data = {
    title: 'Bugün nə öyrənim? 📚',
    body: 'Bugünkü konseptini öyrənmək vaxtıdır!',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    tag: 'daily-lesson',
    renotify: true,
    requireInteraction: false,
    data: { url: '/index.html' }
  };

  // Push-dan data gəlirsə istifadə et
  if (event.data) {
    try {
      const pushed = event.data.json();
      data = { ...data, ...pushed };
    } catch(e) {
      data.body = event.data.text() || data.body;
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      badge: data.badge,
      tag: data.tag,
      renotify: data.renotify,
      requireInteraction: data.requireInteraction,
      data: data.data,
      actions: [
        { action: 'open',    title: '📖 Dərsi aç'   },
        { action: 'dismiss', title: '⏰ Sonra'        }
      ],
      vibrate: [200, 100, 200]
    })
  );
});

// ─── NOTIFICATION CLICK ───────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const url = event.notification.data?.url || '/index.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        // Artıq açıq pəncərə varsa fokusla
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.focus();
            client.postMessage({ type: 'NOTIFICATION_CLICK', url });
            return;
          }
        }
        // Yoxdursa yeni tab aç
        if (clients.openWindow) return clients.openWindow(url);
      })
  );
});

// ─── BACKGROUND SYNC ─────────────────────────────
self.addEventListener('sync', event => {
  console.log('[SW] Background sync:', event.tag);

  if (event.tag === 'sync-progress') {
    event.waitUntil(syncUserProgress());
  }
});

async function syncUserProgress() {
  // İstifadəçi məlumatlarını (streak, XP) server ilə sinxronlaşdır
  // Gələcəkdə backend əlavə edildikdə burda API çağrışı olar
  console.log('[SW] Syncing user progress...');
  return Promise.resolve();
}

// ─── MESSAGE: Ana səhifədən mesaj ────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CACHE_LESSON') {
    // Spesifik dərsi offline üçün cache-ə yaz
    caches.open(DYNAMIC_CACHE).then(cache => {
      cache.put('/offline-lesson', new Response(JSON.stringify(event.data.lesson)));
    });
  }
});
