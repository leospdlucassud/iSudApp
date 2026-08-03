/**
 * Service worker.
 *
 * Casca do app em cache para abrir offline; o que sai para a rede (Supabase,
 * CDN de módulos) passa direto, porque agenda compartilhada desatualizada é
 * pior do que erro de conexão.
 */

const CACHE = 'om-v4';

const CASCA = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/app.css',
  '/js/app.js',
  '/js/config.js',
  '/js/db.js',
  '/js/ui.js',
  '/js/util.js',
  '/js/modules/inicio.js',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(CASCA.map(u => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // Supabase e CDN sempre pela rede

  // Navegação: rede primeiro, cache como rede de segurança.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((r) => {
          const copia = r.clone();
          caches.open(CACHE).then(c => c.put('/index.html', copia));
          return r;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  // Estáticos: cache primeiro, revalidando em segundo plano.
  e.respondWith(
    caches.match(request).then((emCache) => {
      const daRede = fetch(request)
        .then((r) => {
          if (r.ok) {
            const copia = r.clone();
            caches.open(CACHE).then(c => c.put(request, copia));
          }
          return r;
        })
        .catch(() => emCache);
      return emCache || daRede;
    }),
  );
});
