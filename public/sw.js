// BSB IMS service worker: cangkang aplikasi tetap terbuka saat sinyal hilang.
// - /_next/static (JS/CSS/font): cache dulu.
// - Halaman isian lapangan (P2H, hazard, absen): jaringan dulu (maks 6 dtk), cadangan salinan terakhir yang pernah dibuka.
// - Halaman lain: jaringan; bila gagal tampil halaman /offline.
// Data kiriman (server action = POST) tidak pernah disentuh di sini; antrean offline ditangani di aplikasi.
const V = 'bsb-v1';
const STATIC = `${V}-static`;
const PAGES = `${V}-pages`;
const FIELD = ['/', '/she/p2h', '/she/hazard', '/absen', '/tugas'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(PAGES).then(c => c.add('/offline')).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => !k.startsWith(V)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => {
  if (e.data === 'clear') e.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))));
});

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(caches.open(STATIC).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const field = FIELD.includes(url.pathname);
      try {
        const res = await withTimeout(fetch(req), field ? 6000 : 15000);
        // hanya simpan halaman isian bila ia memang halaman (bukan pengalihan ke login)
        if (field && res.ok && !res.redirected) (await caches.open(PAGES)).put(url.pathname, res.clone());
        return res;
      } catch {
        const c = await caches.open(PAGES);
        return (field && (await c.match(url.pathname))) || (await c.match('/offline')) || Response.error();
      }
    })());
  }
});
