// Service Worker NEUTRALIZADO (kill-switch).
//
// El SW previo (cache-first) dejaba la app en estados rotos: servía HTML/JS
// cacheados y obsoletos → login muerto, favicon viejo y navegación sin hidratar.
// El navegador SIEMPRE comprueba /sw.js por red (sin pasar por el SW), así que
// esta versión se instala, BORRA todas las cachés, se desregistra y recarga las
// pestañas abiertas. Tras correr una vez, el navegador queda sin SW y carga todo
// fresco desde la red. No hay handler de fetch: nada se cachea.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      // No recargamos las pestañas desde aquí (evita bucles de recarga); el
      // usuario recarga una vez y queda sin SW.
    } catch {
      /* noop */
    }
  })());
});
