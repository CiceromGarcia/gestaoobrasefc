// Service worker mínimo — existe só para o navegador considerar o site
// "instalável" como PWA (critério do Chrome exige um service worker
// registrado). Não faz cache de nada de propósito: o sistema já usa
// Cache-Control: no-cache nas páginas HTML para sempre refletir dados
// atualizados do Firestore, e um cache aqui entraria em conflito com isso.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Intencionalmente vazio: sem respondWith(), o navegador segue com o
  // fetch normal, sem interceptação nem cache.
});
