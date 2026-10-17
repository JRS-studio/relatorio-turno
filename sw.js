// Service worker do Relatório de Turno: guarda os arquivos do app para abrir sem internet.
// Os dados (turnos, ocorrências, solicitações) NÃO passam por aqui: ficam no celular e no servidor.
const C = 'relatorio-turno-v1';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      // apaga só versões antigas DESTE app; não mexe nos caches de outros apps do mesmo endereço github.io
      .then(ks => Promise.all(ks.filter(k => k !== C && k.indexOf('relatorio-turno-') === 0).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || r.url.indexOf('http') !== 0) return;
  // só os arquivos do próprio app; o servidor (script.google.com) nunca é guardado
  if (new URL(r.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(r)
      .then(res => {
        if (res && res.ok) { const cp = res.clone(); caches.open(C).then(c => c.put(r, cp)); }
        return res;
      })
      .catch(() => caches.match(r).then(m => m || caches.match('index.html')))
  );
});
