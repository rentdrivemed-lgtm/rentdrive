# Plan Maestro DrivePass — Cómo ser #1 en Medellín

> Síntesis ejecutable de los 7 reportes de `marketing/` (competencia, SEO, conceptos, marca, captación, go-to-market, campañas). · 2026-06-05
> Lee los reportes individuales para el detalle; este documento define **qué hacer y en qué orden**.

## El consenso (apareció en casi todos los reportes)
1. **Confianza = la palanca #1 para ganar** (reseñas + verificación + respaldo ante daños visible).
2. **Captar oferta (propietarios) es el cuello de botella** — el estimador de ingresos es el mejor gancho.
3. **El foso es lo local** (pico y placa, JMC, municipios, marca paisa) — explotarlo en producto, SEO y marketing.
4. **Marca:** nombre oficial **DrivePass**, categoría *"el alquiler entre paisas: premium, verificado y sin mostrador"*, tagline **"Conduce libre."**

---

## 🚨 PRIORIDAD CERO — Resolver el respaldo ante daños
Apareció como bloqueante #1 en **4 reportes** (competencia, marca, captación, GTM). **Eva ya tiene póliza todo riesgo con SURA.** Sin una respuesta clara a *"¿y si pasa algo?"*, la narrativa "conduce sin miedo" no es creíble y no se debe escalar marketing.

**Decisión de negocio (requiere al fundador), opciones:**
- **A) Convenio asegurador** (SURA/otra) — póliza de alquiler que paga la plataforma. Es lo que hace a Eva creíble. Lo ideal.
- **B) Framework de protección propio** mientras tanto: depósito de garantía + verificación de identidad + contrato (Ley 527) + fotos antes/después + plazo de fotomultas (la C-321/2022 deja la multa al conductor identificado). Se **mercadea como "protección", NO como "seguro todo riesgo"** hasta tener la póliza.

> Hasta resolver esto: el copy no promete "seguro todo riesgo". Es la decisión que desbloquea todo lo demás.

---

## FASE 1 — Producto: confianza & conversión (quick wins, 1–2 semanas)
Bajo esfuerzo, alto impacto. Ejecuta `implementador-rentdrive` + `verificador-qa`.
1. **Precio transparente "sin sorpresas"** — desglose (días + recargo JMC + depósito + total) en `vehiculos/[id]` y `pago`. Reusa `calcularRecargo`. *(competencia R5, conceptos #1)*
2. **Bloque de confianza estático** — "Cómo protegemos tu reserva" (depósito, contrato, verificación, fotos antes/después) comunicando lo que ya existe. *(competencia R3)*
3. **Reglas por vehículo** — `km_dia_incluidos`, `politica_combustible`, `deposito` (paridad SQLite + `supabase/schema.sql`). *(competencia R3, TodosEn4)*
4. **Estimador de ingresos para dueños** — calculadora en `propietarios-info` con `AVG(precio_dia)` por tipo. *(competencia R4, conceptos #2, captación)* — gancho clave de oferta.
5. **SEO quick wins** — `robots.ts` (bloquear /dashboard, /pago, /chat, /historial), `sitemap.ts`, `metadataBase` + title/description con keywords + OG, JSON-LD `Organization`/`LocalBusiness` (areaServed desde `lib/lugares.ts`), NAP en footer, corregir doble `<h1>` en registro. *(auditoría-seo Fase 1)* → ejecuta `estratega-seo`.

## FASE 2 — Producto: confianza profunda (2–4 semanas)
Toca schema → replicar en `supabase/schema.sql` + pasar por `auditor-seguridad` (datos sensibles, Ley 1581).
1. **Reseñas y calificaciones** bidireccional (tabla `resenas`, POST tras `completada`, promedio en card/detalle). *(competencia R1, conceptos #5)*
2. **Verificación de identidad del arrendatario** con estado aprobado/rechazado (replica patrón `documentos_estado`). **Mover uploads sensibles fuera de `public/`.** *(competencia R2, captación)*
3. **Badge "Anfitrión Destacado" + Trust meter** (depende de reseñas). *(competencia R6, conceptos #3)*
4. **SEO Fase 2** — refactor de páginas indexables a Server Component + `generateMetadata` por vehículo + JSON-LD `Car`/`Offer` + `next/image`. *(auditoría-seo Fase 2)*

## FASE 3 — Marca & siembra de oferta (en paralelo a Fase 1–2)
1. **Cerrar marca:** registrar `drivepass.co` + handles; búsqueda marcaria SIC (clases 39/42). *(posicionamiento-marca)*
2. **Sembrar liquidez a mano:** reclutar 30–40 carros en **El Poblado** (onboarding asistido, fotos pro, **0% comisión a los 50 pioneros**). No abrir demanda sin oferta. *(go-to-market)*
3. **Referidos:** propietario→propietario **$150k** (ataca el arranque en frío), usuario→usuario $60k. *(go-to-market)*

## FASE 4 — Lanzamiento & campañas (cuando hay oferta + confianza)
Ejecuta con el respaldo (Prioridad 0) ya resuelto.
1. **Campaña "Conduce libre"** (marca + primeras reservas/propietarios). LEAN $4M / AGRESIVO $14M COP/mes.
2. **Adquisición arrendatarios always-on** (Meta Advantage+/DPA + Google). ROAS ≥3, CAC ≤$30k.
3. **Captación de propietarios** (Lead Ads + WhatsApp + grupos FB). CPL ≤$15k, foco lead→publicado.
4. **Estacional: Feria de las Flores (31 jul–9 ago 2026)** como gran hito — reserva anticipada. LEAN $5M / AGRESIVO $18M.
- **WhatsApp = canal de cierre** en todas. Gancho recurrente: **"sin tarjeta de crédito"**. *(campanas, go-to-market)*

---

## Cross-cutting (siempre)
- **Contenido SEO local:** volver `lib/picoYPlaca.ts` página pública + guías ("requisitos para alquilar en Medellín", "pico y placa 2026", "¿Rionegro tiene pico y placa?"). Bajo costo, alto retorno. *(auditoría-seo, go-to-market)*
- **Google Business Profile** + Search Console.
- **Alianzas:** aeropuerto JMC, hoteles El Poblado, nómadas digitales (~8.000/mes), parqueaderos residenciales.

## Métrica norte
**Reservas completadas/semana en Medellín** (mide oferta + demanda + confianza en una unidad). Densificar por micro-zona antes de expandir.

## Supuestos a validar antes de gastar
Todos los CAC/ROAS/CPL y descuentos (-15% 1ª reserva, 0% comisión 30 días) van marcados **[SUPUESTO]** en los reportes — recalibrar con datos reales tras el primer mes.

---

### Orden recomendado de ejecución
**0)** Decisión de seguro/respaldo (negocio) → **1)** Fase 1 quick wins (producto + SEO) → **2)** Fase 3 siembra de oferta en paralelo → **3)** Fase 2 confianza profunda → **4)** Fase 4 campañas + Feria de las Flores.
