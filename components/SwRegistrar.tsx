'use client';
import { useEffect } from 'react';

// El Service Worker (cache-first) causó estados rotos repetidos: login muerto,
// favicon obsoleto y navegación sin hidratar al servir HTML/JS cacheados.
// Lo neutralizamos por completo: NO se registra ningún SW; además desregistramos
// cualquiera existente y limpiamos las cachés para auto-sanar navegadores con un
// SW viejo. (El propio /sw.js es ahora un kill-switch que hace lo mismo.)
export default function SwRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistrations()
      .then(regs => Promise.all(regs.map(r => r.unregister())))
      .catch(() => {});
    if ('caches' in window) {
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).catch(() => {});
    }
  }, []);

  return null;
}
