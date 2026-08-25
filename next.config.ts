import type { NextConfig } from "next";

// Compartido con lib/csrf.ts (allowlist de Origin también en dev) para no mantener
// dos listas separadas de las mismas IPs LAN que usa el equipo para probar por
// celular (ver comentario de allowedDevOrigins abajo).
export const LAN_DEV_ORIGINS = ['localhost', '127.0.0.1', '192.168.1.34', '192.168.1.15', '192.168.1.67'];

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  // Safari envía cabecera Origin en fetches del mismo origen (RSC) y el dev server
  // de Next los bloquea ("access control checks") rompiendo la navegación.
  // Declaramos los orígenes de desarrollo permitidos.
  allowedDevOrigins: LAN_DEV_ORIGINS,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'res.cloudinary.com' },
    ],
    // Next 16 bloquea por defecto las imágenes locales con query string
    // (p. ej. "/uploads/mazda3.jpg?v=2", usado por lib/db.ts como cache-buster
    // de las fotos semilla). Sin este patrón, next/image lanza
    // "is using a query string which is not configured in images.localPatterns"
    // en tiempo de ejecución (no falla el build).
    localPatterns: [
      { pathname: '/uploads/**' },
    ],
    qualities: [75, 90],
  },
  // El sitio se sirve en DOS dominios que hoy responden 200 por separado:
  // drivepasscol.com (apex) y www.drivepasscol.com (el canónico, valor de
  // NEXT_PUBLIC_APP_URL). Tener dos orígenes vivos parte la app en dos:
  //   1) La cookie de sesión `token` se setea host-only (app/api/auth/login
  //      no manda atributo `domain`), así que quien inicia sesión en un
  //      dominio aparece deslogueado en el otro.
  //   2) El login con Google falla en el apex: Google Identity Services valida
  //      el origen contra los "Authorized JavaScript origins" de Google Cloud
  //      Console, donde solo está registrado el www.
  // La solución de raíz es que exista UN solo origen: el apex redirige al www
  // conservando ruta y query string.
  async redirects() {
    // Se deriva el par apex/www de NEXT_PUBLIC_APP_URL (misma fuente que usa
    // lib/csrf.ts para su allowlist de Origin) en vez de hardcodear el dominio,
    // pero con guardas anti-bucle: un bucle de redirección aquí tumbaría el
    // sitio entero, así que ante cualquier valor raro se prefiere NO redirigir.
    // OJO: `redirects()` se evalúa en `next build` y queda horneado en
    // .next/routes-manifest.json, no se relee en cada request; cambiar el
    // dominio exige rebuild (igual que cualquier NEXT_PUBLIC_*, que Next
    // inlinea en el bundle — ver los ARG del Dockerfile).
    let canonico: URL;
    try {
      canonico = new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://www.drivepasscol.com');
    } catch {
      return [];
    }
    // Si el canónico configurado NO es el www (o alguien puso el apex como
    // canónico), no hay nada que redirigir: emitir la regla al revés crearía
    // el bucle que queremos evitar.
    if (canonico.protocol !== 'https:' || !canonico.hostname.startsWith('www.')) return [];
    const apex = canonico.hostname.slice(4);
    if (!apex || apex === canonico.hostname || !apex.includes('.')) return [];

    return [
      {
        // `:path((?!...).*)` matchea la ruta completa incluidas las anidadas
        // (el `.*` sí cruza los `/`), así que también cubre las URLs públicas
        // de las tarjetas NFC ya impresas (/tarjeta/<slug>, un Route Handler):
        // el navegador sigue la redirección y termina en el www. También
        // matchea la raíz `/` (el grupo puede capturar vacío). El query string
        // se conserva solo: al preparar la redirección Next mezcla la query de
        // la petición con la del destino (prepareDestination en
        // next/dist/shared/lib/router/utils).
        //
        // EXCEPCIÓN /sw.js: `redirects()` se evalúa ANTES del filesystem
        // (incluido /public), así que sin este lookahead negativo el
        // kill-switch de public/sw.js quedaría redirigido en el apex. Por spec
        // el navegador pide el script del Service Worker con
        // `redirect: 'error'`: si /sw.js contesta 3xx la actualización del SW
        // FALLA y la registración vieja (cache-first) sobrevive para siempre,
        // sirviendo HTML/JS obsoleto y roto a esos usuarios, que además nunca
        // llegan a ver esta redirección. Dejando /sw.js en 200 el kill-switch
        // se instala, borra cachés y se desregistra. El patrón de exclusión
        // por lookahead es el que documenta Next para `source`.
        source: '/:path((?!sw\\.js$).*)',
        // El `value` de un `has` de tipo host lo compila Next como regex
        // ANCLADA (`^valor$`, ver matchHas en prepare-destination.js) y sin
        // puerto, por lo que "drivepasscol\\.com" NO matchea
        // "www.drivepasscol.com": el destino nunca vuelve a entrar a esta
        // regla y no puede haber redirección circular. Los puntos van
        // escapados para que el `.` de la regex no matchee cualquier caracter.
        has: [{ type: 'host', value: apex.replace(/\./g, '\\.') }],
        destination: `${canonico.origin}/:path`,
        // TEMPORAL A PROPÓSITO (307, no 308). Un permanente lo cachea el
        // navegador de forma persistente y la regla además queda horneada en
        // el build, así que un error de configuración aquí NO se podría
        // deshacer para quien ya lo cacheó: pasar a permanente es una puerta
        // de un solo sentido. Se despliega temporal, se confirma en producción
        // unos días (apex→www OK, www sin Location, /sw.js en 200) y RECIÉN
        // AHÍ se cambia a `permanent: true` para que el SEO consolide el
        // canónico.
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
