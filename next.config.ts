import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  // Safari envía cabecera Origin en fetches del mismo origen (RSC) y el dev server
  // de Next los bloquea ("access control checks") rompiendo la navegación.
  // Declaramos los orígenes de desarrollo permitidos.
  allowedDevOrigins: ['localhost', '127.0.0.1', '192.168.1.34', '192.168.1.15', '192.168.1.67'],
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'images.unsplash.com' }],
  },
};

export default nextConfig;
