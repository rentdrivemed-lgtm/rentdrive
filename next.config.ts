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
};

export default nextConfig;
