import { MetadataRoute } from 'next';
import { getDb } from '@/lib/db';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://www.drivepasscol.com';

// Fuerza render dinámico (por request): el sitemap consulta la BD para listar
// vehículos activos. Sin esto, Next intenta prerenderizarlo en build time, y en
// el Dockerfile el build corre antes de que exista el volumen /app/data (la BD
// solo está montada en runtime), lo que tumbaría el build.
export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
  const db = getDb();
  const vehiculos = db
    .prepare('SELECT id FROM vehiculos WHERE disponible = 1')
    .all() as { id: number }[];

  return [
    { url: BASE,                          lastModified: new Date(), changeFrequency: 'daily',   priority: 1.0 },
    { url: `${BASE}/para-usuarios`,       lastModified: new Date(), changeFrequency: 'weekly',  priority: 0.9 },
    { url: `${BASE}/propietarios-info`,   lastModified: new Date(), changeFrequency: 'weekly',  priority: 0.9 },
    { url: `${BASE}/calculadora-propietarios`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE}/registro`,            lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/login`,               lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/terminos`,            lastModified: new Date(), changeFrequency: 'monthly', priority: 0.3 },
    ...vehiculos.map((v) => ({
      url: `${BASE}/vehiculos/${v.id}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}
