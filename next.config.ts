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
    qualities: [75, 90],
  },
};

export default nextConfig;
