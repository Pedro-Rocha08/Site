/* Aurora Keys — service worker: funciona offline depois da primeira visita */
const VERSION = 'aurora-keys-v12';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/midi-parser.js', 'js/synth.js', 'js/songs.js', 'js/storage.js', 'js/player.js', 'js/ambient.js', 'js/sheets.js', 'js/ar.js', 'js/vendor/three.min.js', 'js/app.js', 'data/mutopia.json',
  'assets/icon.svg', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
  'assets/icons/maskable-512.png', 'assets/icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  // Cada arquivo separado: se um faltar, o resto continua funcionando (addAll falharia inteiro)
  e.waitUntil(caches.open(VERSION)
    .then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => console.warn('SW: não consegui guardar', u)))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function fetchFresh(req, url) {
  if (url.origin !== location.origin) return fetch(req);
  // navegação não aceita RequestInit; refaz pela URL
  if (req.mode === 'navigate') return fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
  return fetch(req, { cache: 'no-cache' });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !isFont) return;

  // Rede primeiro (para receber atualizações), cache se estiver offline
  e.respondWith(
    // 'no-cache': sempre confere com o servidor (evita misturar página nova com script antigo)
    fetchFresh(req, url).then(res => {
      if (res && (res.ok || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});
