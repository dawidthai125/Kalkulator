// Service worker: aplikacja otwiera się też bez internetu (powłoka z pamięci podręcznej).
// Zasady:
//  * tylko zapytania GET do własnej domeny; API Supabase i czcionki Google idą wprost do sieci,
//    więc worker nigdy nie trzyma danych użytkownika ani tokenów,
//  * najpierw sieć (zawsze świeża wersja po wdrożeniu), pamięć podręczna tylko gdy sieci brak lub jest bardzo wolna.
const CACHE = 'dluznik-v1';
const SHELL = ['./', 'index.html', 'app.js', 'loans.js', 'vendor/supabase.js', 'manifest.webmanifest', 'logo.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
const SLOW_MS = 4000;

const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return; // dane i obce zasoby: bez udziału workera
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(r, { ignoreSearch: true });
    try {
      const res = await (cached ? timeout(fetch(r), SLOW_MS) : fetch(r));
      if (res && res.ok) cache.put(r, res.clone());
      return res;
    } catch (err) {
      if (cached) return cached;
      if (r.mode === 'navigate') {
        const shell = await cache.match('index.html');
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});

// --- Powiadomienia push ---
// Ładunek wysyła funkcja send-push: { title, body, tag, url }. Każdy push musi pokazać powiadomienie (wymóg iOS i Chrome).
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Dłużnik 2.0', {
    body: d.body || '',
    icon: 'icon-192.png',
    tag: d.tag || undefined,
    data: { url: d.url || './' },
  }));
});

// Kliknięcie: wróć do otwartej aplikacji albo otwórz nową kartę.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow(target);
  }));
});
