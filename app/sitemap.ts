import { MetadataRoute } from 'next';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://drivepass.com.co';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE,                          lastModified: new Date(), changeFrequency: 'daily',   priority: 1.0 },
    { url: `${BASE}/para-usuarios`,       lastModified: new Date(), changeFrequency: 'weekly',  priority: 0.9 },
    { url: `${BASE}/propietarios-info`,   lastModified: new Date(), changeFrequency: 'weekly',  priority: 0.9 },
    { url: `${BASE}/registro`,            lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/login`,               lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/terminos`,            lastModified: new Date(), changeFrequency: 'monthly', priority: 0.3 },
  ];
}
