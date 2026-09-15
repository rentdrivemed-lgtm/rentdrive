# Análisis de Inteligencia Competitiva — DrivePass

> Generado por el agente `analista-competencia` · 2026-06-05
> DrivePass = plataforma P2P de alquiler de carros en Medellín (Next.js 16, tema oscuro premium).
> WebSearch/WebFetch disponibles. `turo.com`, `alquilomicarro.com`, `localiza.com` dieron 403 (anti-bot); en esos casos se usaron snippets oficiales/help centers. **[H]** = verificado por fuente · **[INF]** = inferencia.

**Referentes analizados (9):** Turo, Getaround, SIXT Colombia, Localiza Colombia, Hertz/Avis Colombia, Kayak/RentCars (agregadores), **Alquilo Mi Carro (P2P CO)**, **TodosEn4 (P2P CO)**. Los dos P2P locales son el hallazgo más relevante.

---

## 1. Tabla comparativa por dimensión
Leyenda: ✔ sólido · ◐ parcial · ✖ ausente.

### A — Flujo de reserva
- **DrivePass ◐**: búsqueda → detalle con `CalendarioReserva` (rango tocando calendario) → pago; recogida/entrega vía `LugarSelector` (sessionStorage). Falta reserva instantánea formal vs. solicitud.
- **Turo ✔**: destino+fechas → resultados → "Book Instantly" o solicitud; check-in/out con fotos [H].
- **Getaround ✔**: Instant Booking + desbloqueo del carro desde el móvil (Connect), sin llaves [H].
- **SIXT/Localiza/Hertz ✔**: flujo clásico; mostrador en aeropuerto JMC.
- **Alquilo Mi Carro / TodosEn4 ◐**: P2P; TodosEn4 valida identidad antes de reservar [H].
- **Kayak/RentCars ✔**: comparador con filtro "cancelación gratis" [H].

### B — Confianza y verificación
- **DrivePass ◐**: documentos de vehículo con estado/revisiones; fotos antes/después; contrato firmado. **Falta** reseñas/ratings, badges, verificación de identidad del renter, seguro visible.
- **Turo ✔**: liability $750k–$1M, screening de licencia/antecedentes, reseñas bidireccionales, badge All-Star Host (≥85% 5★, ≤3% cancelación), soporte 24/7 [H].
- **Getaround ✔**: seguro $1M, walkaround de 8 fotos [H].
- **TodosEn4 ✔**: verificación por Registraduría + 17 fuentes; póliza opcional ~90%, deducible del depósito [H].
- **Alquilo Mi Carro ◐**: póliza colectiva SURA [H]; menos señales de reseñas/verificación.
- **SIXT/Localiza/Hertz ✔**: marca consolidada, RNT, seguros, depósito en tarjeta.

### C — Presentación de precios
- **DrivePass ◐**: `precio_dia` + recargo por lugar ($150.000/trayecto JMC; $35.000 Medellín y Olaya Herrera) server-side. **Falta** desglose visible y total "todo incluido".
- **Turo ✔**: precio + protección desde $10/día; descuentos semanal/mensual [H].
- **Getaround ✔**: precios upfront, predictive pricing [H].
- **Kayak ✔**: comparación por categoría + "free cancellation".
- **Localiza/SIXT/Hertz ◐**: tarifa base clara, extras aparte.
- **TodosEn4 ◐**: precio/día + reglas (300 km/día, $600/km extra, +12,5%/hora) [H].

### D — Búsqueda y filtros
- **DrivePass ◐**: tipo/ubicación/precio/fechas; oculta inactivos y solapados. **Falta** mapa y filtros avanzados.
- **Turo ✔**: por make/model, filtros precio/entrega/distancia/highly-rated [H].
- **Getaround ✔**: ubicación + tipo + disponibilidad en mapa [H].
- **Kayak ✔**: tipo/marca/cancelación, reseñas verificadas.
- **Localiza/SIXT/Hertz ◐**: por categoría y sucursal.

### E — Propuesta de valor del propietario
- **DrivePass ◐**: dashboard, publica vehículo, `CalendarioDisponibilidad`, docs. **Falta** estimador de ingresos, seguro al dueño, alta rápida por placa.
- **Turo ✔**: Carculator (ingreso estimado), alta solo con placa + datos, badge All-Star [H].
- **Getaround ✔**: "hasta $1.000+/mes", pago 5 días tras renta, Connect +80% rentas [H].
- **Alquilo Mi Carro ✔**: 0% comisión + póliza SURA + $20.000 por domicilio [H].
- **TodosEn4 ✔**: km extra, hora extra, domicilio; seguro opcional 90% [H].

### F — UX/UI y mobile
- **DrivePass ✔**: PWA, tema oscuro premium, BottomNav, chat SSE, i18n. Buena base.
- **Turo/Getaround ✔**: app-first; check-in/out por fotos; desbloqueo sin llaves [H].
- **Localiza/SIXT/Hertz ◐**: web corporativa.

### G — Localización Colombia
- **DrivePass ✔**: `lib/pico-placa.ts`, municipios AMVA + Rionegro/JMC con recargo, español nativo. **Mejor localización que cualquier referente.**
- **Localiza ✔**: 12 ciudades, pico y placa, central 24h, RNT, WhatsApp [H].
- **TodosEn4/Alquilo Mi Carro ✔**: P2P CO, SURA, Registraduría, domicilio [H].
- **Turo/Getaround ✖**: no operan en Colombia [INF]; sin pico y placa ni peajes.
- **SIXT/Hertz ◐**: vía franquicias, requisitos internacionales (edad 25, tarjeta internacional) [H].

---

## 2. Brechas de DrivePass
1. Sin reseñas/ratings bidireccional.
2. Sin verificación de identidad del arrendatario (TodosEn4 usa Registraduría + 17 fuentes).
3. Sin seguro visible ni framework de depósito/deducible.
4. Sin estimador de ingresos para captar dueños (Carculator de Turo).
5. Sin badges/reputación de propietario (All-Star Host).
6. Desglose de precio poco transparente en UI.
7. Sin reserva instantánea explícita vs. solicitud.
8. Sin mapa ni filtros avanzados.
9. Onboarding de dueño largo (Turo: solo con la placa).
10. No comunica reglas de uso (km/día, horas extra, combustible).

---

## 3. Recomendaciones priorizadas
- **R1 — Reseñas y calificaciones bidireccional ★ máxima.** Tabla `resenas(reserva_id, autor_id, calificado_id, estrellas, texto, created_at)` (SQLite + `supabase/schema.sql`); API en `app/api/reservas/[id]/resena`; UI en `historial`, `VehiculoCard`, `vehiculos/[id]`. Solo reservas `completada`. Riesgo: moderación, IDOR. Impacto Alto / Esfuerzo Medio.
- **R2 — Verificación de identidad del arrendatario** con estado aprobado/rechazado (replicar patrón `documentos_estado` de vehículos para personas). Riesgo: datos sensibles a `public/uploads/` (deuda conocida) — mover a almacenamiento privado; Ley 1581 habeas data. Alto / Medio.
- **R3 — Capa de confianza visible: seguro + depósito + reglas claras** en detalle y pago. Campos `vehiculos.deposito, km_dia_incluidos, politica_combustible`. **Legal**: no afirmar seguro inexistente; si no hay convenio asegurador, hablar de "depósito de garantía". Alto / Bajo-Medio.
- **R4 — Estimador de ingresos para dueños** en `propietarios-info` con `AVG(precio_dia)` por tipo. Sin schema nuevo. Alto (captación) / Bajo.
- **R5 — Desglose de precio transparente** (subtotal + recargo + depósito + total) en `vehiculos/[id]` y `pago`, reusando `calcularRecargo`. Medio-Alto / Bajo.
- **R6 — Badge "Anfitrión Destacado"** (≥X reseñas, ≥85% 5★) — depende de R1. Medio / Bajo.
- **R7 — Reserva instantánea vs. solicitud** (toggle del propietario): `vehiculos.reserva_instantanea`; encadenar con R2. Medio / Medio.
- **R8 — Mapa y filtros avanzados** en el listado (requiere coords/geocoding). Medio / Alto. Mostrar zona, no dirección exacta.

---

## 4. Top 5 Quick Wins (para `implementador-rentdrive`)
1. **Desglose de precio en UI (R5)** — exponer subtotal + recargo + depósito + total. Bajo esfuerzo, alto valor.
2. **Estimador de ingresos para dueños (R4)** — calculadora en `propietarios-info`. Sin schema nuevo.
3. **Bloque de confianza estático (R3 fase 1)** — sección "Cómo protegemos tu reserva" comunicando lo que ya hace DrivePass.
4. **Reglas de uso por vehículo (R3)** — `km_dia_incluidos, politica_combustible, deposito` + mostrarlos en detalle.
5. **Reseñas MVP (R1)** — tabla `resenas`, POST tras `completada`, promedio en card y detalle.

> **Ventaja defendible:** la localización Medellín/Colombia (pico y placa, recargo JMC, municipios AMVA, español, tema oscuro premium) supera a Turo/Getaround (ausentes) y a las multinacionales (genéricas). Estrategia: **cerrar la brecha de confianza** (reseñas + verificación + seguro/depósito visible) **y de captación de dueños** (estimador + badges) sin perder esa ventaja local.

### Fuentes
Turo: how it works/earnings, trust & safety, protection plans, All-Star Host, Carculator, Book Instantly, reviewing a trip, 2026 marketplace updates · Getaround: share a car, how it works, business model · P2P Colombia: alquilomicarro.com, todosen4.com/como-funciona-propietarios, ENTER.CO · Multinacionales/agregadores: localiza.com/colombia, sixt.com Medellín, hertz.com Medellín, kayak.com Medellín, rentcars.com Medellín.
