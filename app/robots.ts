import { MetadataRoute } from 'next';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://www.drivepasscol.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/para-usuarios', '/propietarios-info', '/registro', '/vehiculos/'],
        disallow: ['/dashboard/', '/api/', '/chat/', '/historial/', '/pago/', '/m/', '/admin/'],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
