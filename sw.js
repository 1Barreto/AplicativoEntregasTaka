// Service worker: guarda os arquivos do app para abrir sem internet.
// Ao publicar uma versão nova, aumente o número abaixo.
const VERSAO = 'taka-v3';
const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
const ARQUIVOS = [
  './', './index.html', './manifest.json', './css/app.css',
  './js/config.js', './js/app.js', './js/dados.js', './js/ui.js', './js/cadastros.js', './js/estoque.js', './js/entregas.js', './js/caixa.js', './js/pedidos.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  SUPABASE_CDN,
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) =>
    Promise.all(ARQUIVOS.map((u) => c.add(u).catch((err) => console.warn('sw: não guardou', u, err))))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const doApp = url.origin === self.location.origin;
  if (!doApp && req.url !== SUPABASE_CDN) return; // API do Supabase: sempre pela rede

  // Mostra o que está guardado na hora e atualiza em segundo plano
  e.respondWith(caches.open(VERSAO).then(async (cache) => {
    const chave = req.mode === 'navigate' ? './index.html' : req;
    const guardado = await cache.match(chave, { ignoreSearch: req.mode === 'navigate' });
    const rede = fetch(req).then((resp) => {
      if (resp.ok) cache.put(chave, resp.clone());
      return resp;
    }).catch(() => guardado);
    return guardado || rede;
  }));
});
