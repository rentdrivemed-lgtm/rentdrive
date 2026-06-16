# Auditoría SEO + Estrategia de Posicionamiento — DrivePass

> Generado por el agente `estratega-seo` · 2026-06-05 · Alcance: auditoría + estrategia (no se editó código).
> Marca: DrivePass/RentDrive · Medellín + AMVA + Rionegro/JMC · Next.js 16, React 19, español, tema oscuro.

---

## FASE 1 — Auditoría del estado actual

### Hallazgo arquitectónico crítico
**Las 15 páginas (`page.tsx`) son `'use client'`**, incluidas inicio y detalle. Consecuencias:
1. Un componente `'use client'` **no puede exportar `metadata` ni `generateMetadata`** → hoy solo `layout.tsx` tiene metadata, global para todo el sitio.
2. El contenido se renderiza client-side tras `fetch` en `useEffect` → el HTML inicial que ve Googlebot llega casi vacío (degrada indexación, velocidad, CWV).
3. Las páginas que deben posicionar (inicio, detalle, `para-usuarios`, `propietarios-info`) necesitan **refactor a Server Component + `metadata`/`generateMetadata`**, dejando la interactividad en subcomponentes cliente. Es el trabajo de mayor impacto y mayor esfuerzo.

### Checklist técnico
| Ítem | Estado |
|---|---|
| `<html lang="es">` | ✔ |
| Metadata global title/description | parcial (solo layout; description es eslogan, sin keywords) |
| `metadataBase` | ✖ (OG/canonical relativos rotos en prod) |
| Metadata por página | ✖ (todas `'use client'`) |
| `generateMetadata` en `vehiculos/[id]` | ✖ |
| `openGraph`/`twitter` cards | ✖ |
| `canonical` | ✖ |
| `app/sitemap.ts` | ✖ |
| `app/robots.ts` | ✖ |
| Bloqueo de rutas privadas (`/dashboard`, `/pago`, `/chat`, `/historial`) | ✖ (indexables hoy) |
| JSON-LD (Organization/LocalBusiness/Car/Breadcrumb) | ✖ |
| `next/image` | ✖ (0 usos; 8 `<img>` crudos) |
| `alt` en imágenes | parcial |
| Un solo `<h1>` por página | parcial (`registro` tiene 2) |
| `manifest.json`/PWA, favicon | ✔ |
| `NEXT_PUBLIC_SITE_URL` | ✖ (necesaria para metadataBase/sitemap/JSON-LD) |

**Resumen:** base PWA/idioma bien, pero SEO indexable casi en cero. Rutas sensibles (`/dashboard/admin`, `/pago`, `/chat`, `/historial`, `/acceso-drivepass`) hoy son rastreables → **falta robots + `noindex` urgente.**

### Keywords e intención (Colombia)
**Transaccional:** "alquiler de carros Medellín", "renta de autos Medellín", "rent a car Medellín", "alquiler de carros en Medellín sin tarjeta de crédito" (nicho fuerte, encaja con modelo P2P/depósito), "alquiler aeropuerto José María Córdova/Rionegro", "por días", "económicos", "entre particulares", "alquilar mi carro Medellín" (lado oferta).
**Informacional (bajo costo):** "requisitos para alquilar carro en Medellín", "pico y placa Medellín 2026" (DrivePass ya tiene `lib/picoYPlaca.ts` → ventaja para una landing real), "alquiler para extranjeros", "licencia extranjera en Colombia", "¿Rionegro tiene pico y placa?".

**Competidores:** tradicionales (Localiza, Hertz, Budget, Europcar, Sixt) y **P2P directos (Turo, Eva [app CO en Medellín, asegura con Sura], Rennty, Alquilo Mi Carro)** + nicho "sin tarjeta de crédito". Los locales rankean con blogs de pico y placa y páginas de requisitos.

---

## FASE 2 — Estrategia priorizada (✅ = quick win)

### A. SEO técnico
| # | Acción | Impacto | Esfuerzo | Archivos |
|---|---|---|---|---|
| A1 ✅ | `app/robots.ts`: bloquear `/dashboard`, `/pago`, `/chat`, `/historial`, `/acceso-drivepass`, `/api`, `/login`, `/registro`; declarar sitemap | Alto | Bajo | crear `app/robots.ts` |
| A2 ✅ | `app/sitemap.ts`: estáticas + dinámicas `/vehiculos/[id]` (consultando `getDb()`, `disponible=1`) | Alto | Bajo-Medio | crear `app/sitemap.ts` |
| A3 ✅ | `metadataBase` + `NEXT_PUBLIC_SITE_URL`; title/description con keywords ("Alquiler de carros en Medellín y el Área Metropolitana \| DrivePass"); `openGraph` + imagen social + `twitter` | Alto | Bajo | `app/layout.tsx`, `.env.example` |
| A4 | **Refactor de páginas indexables a Server Component** (extraer interactividad a `*Client.tsx`). Prioridad: `vehiculos/[id]`, `/`, `para-usuarios`, `propietarios-info`, `terminos` | Muy alto | Alto | esas páginas + nuevos client |
| A5 | `generateMetadata` por vehículo (title/description/OG/canonical por carro) | Muy alto | Medio | `vehiculos/[id]` |
| A6 | `canonical` por página | Medio | Bajo | páginas refactorizadas |
| A7 ✅ | `noindex` defensivo en privadas | Medio | Bajo | `middleware.ts` o metadata |

### B. Datos estructurados (JSON-LD) — sin reseñas falsas
- B1 ✅ `Organization` · B2 ✅ `LocalBusiness`/`AutoRental` con `areaServed` = municipios de `lib/lugares.ts` · B3 `Car`/`Product`+`Offer` por vehículo (`priceCurrency: COP`) · B4 `BreadcrumbList` · B5 `AggregateRating` **solo si** hay reseñas reales (hoy no). Helper nuevo `components/JsonLd.tsx`.

### C. SEO local (clave)
- C1 NAP consistente (Footer + JSON-LD). C2 **Google Business Profile** (no-código, muy alto). C3 Landings por intención: "Alquiler en aeropuerto JMC/Rionegro" y por municipio. C4 `areaServed` con municipios reales.

### D. Contenido (bajo costo)
- Guías que la competencia ya rankea: "Requisitos para alquilar carro en Medellín 2026", "Pico y placa Medellín 2026" (con `lib/picoYPlaca.ts` → contenido veraz y único), "¿Rionegro tiene pico y placa?", "Alquiler para extranjeros". Copy con "Medellín y Área Metropolitana", "por días", "sin tarjeta de crédito internacional", "entre particulares". Optimizar `propietarios-info` para "alquilar mi carro Medellín".

### E. Rendimiento / CWV
- E1 `<img>` → `next/image` (8 usos; foto principal con `priority`/`sizes`). E2 el refactor a Server Components mejora LCP/CLS. E3 fuentes ya self-hosted (Geist) ✔. E4 revisar peso del bundle.

### F. Medición
- F1 Google Search Console + sitemap. F2 `next build` (rutas estáticas/dinámicas). F3 Lighthouse/PageSpeed. F4 Rich Results Test.

---

## Plan de implementación (para tu visto bueno antes de editar)
**Fase 1 — Quick wins técnicos (1 sesión, bajo riesgo):** A1 robots, A2 sitemap, A3 metadataBase + title/desc/OG + `NEXT_PUBLIC_SITE_URL`, B1 Organization + B2 LocalBusiness (areaServed desde `lib/lugares.ts`), C1 NAP en Footer, corregir doble `<h1>` en `registro`. Verificar: `tsc`, `lint`, `build`, Rich Results.
**Fase 2 — Metadata por página:** A4 refactor + A5 generateMetadata por vehículo + B3 Car/Offer + B4 Breadcrumb + A6 canonical + E1 next/image.
**Fase 3 — Contenido y local:** D guías (pico y placa con `lib/picoYPlaca.ts`), C3 landings, C2/F1 GBP + Search Console.

> Todo vía `getDb()` parametrizado, sin reseñas falsas en JSON-LD, sin tocar auth ni el tema oscuro. El refactor de Fase 2 es el único de esfuerzo alto por la arquitectura `'use client'` actual.

### Fuentes
rentacarmedellin.co (sin tarjeta), alquilerdecarrosmedellinsintarjeta.com (REIZEN), Noticias Caracol (plataformas P2P), Semana (Eva), evolutionrentacar.com (pico y placa), alquilatucarro.com (guía 2026), localiza.com/colombia.
