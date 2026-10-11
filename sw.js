/**
 * Service worker.
 *
 * Casca do app em cache para abrir offline; o que sai para a rede (Supabase,
 * CDN de módulos) passa direto, porque agenda compartilhada desatualizada é
 * pior do que erro de conexão.
 */

const CACHE = 'om-v8';

const CASCA = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/app.css',
  '/js/app.js',
  '/js/config.js',
  '/js/db.js',
  '/js/regras.js',
  '/js/ui.js',
  '/js/util.js',
  '/js/vendor/supabase.js',
  '/js/modules/inicio.js',
  // Para ?demo abrir mesmo num celular sem sinal: sem ele em cache, a
  // semeadura falha e a demonstração cai na tela de sem conexão.
  '/js/demo.js',
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

  // Biblioteca do Supabase: cache primeiro.
  //
  // São 206 KB de build de terceiro versionado junto com o app — o arquivo
  // mais pesado que existe aqui e o que menos muda. Na estratégia de rede
  // primeiro, abaixo, ele era rebaixado inteiro a cada abertura do app, e era
  // isso que segurava a primeira tela em conexão lenta.
  //
  // O preço é explícito: ele só volta pela rede quando o cache troca de nome.
  // TROCAR QUALQUER ARQUIVO EM /js/vendor/ EXIGE SUBIR A VERSÃO EM `CACHE`.
  if (url.pathname.startsWith('/js/vendor/')) {
    e.respondWith(
      caches.match(request).then(guardado => guardado || fetch(request).then((r) => {
        if (r.ok) {
          const copia = r.clone();
          caches.open(CACHE).then(c => c.put(request, copia));
        }
        return r;
      })),
    );
    return;
  }

  // Estáticos: rede primeiro, cache como rede de segurança.
  //
  // Já foi cache-first, e isso fazia cada publicação chegar só na SEGUNDA
  // visita — a pessoa abria o app, via a versão antiga e concluía que o deploy
  // não tinha funcionado. Num app que ainda muda toda semana, servir o atual
  // vale mais do que economizar um pedido; o cache continua garantindo o
  // funcionamento offline.
  e.respondWith(
    fetch(request)
      .then((r) => {
        if (r.ok) {
          const copia = r.clone();
          caches.open(CACHE).then(c => c.put(request, copia));
        }
        return r;
      })
      .catch(() => caches.match(request)),
  );
});
