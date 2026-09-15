# Conceptos Novedosos para Diferenciar DrivePass

> Generado por el agente `explorador-creativo` · 2026-06-05 · WebSearch usado. **[conocimiento]** = criterio propio.
> Todo respeta el tema oscuro premium: lienzo `#0A1422`, superficies `#0F1E33/#16263F/#1B3356`, acento único naranja `#F25C2B` con disciplina, Geist (Mono para cifras/placas/fechas), glass solo en barras flotantes/overlays, motion 150–250ms, sin emojis en UI, tuteo.

## Tabla resumen
| # | Idea | Impacto | Esfuerzo | Pantallas/archivos |
|---|------|---------|----------|--------------------|
| 1 | Precio total transparente "Sin sorpresas" | Alto | Bajo–Medio | `vehiculos/[id]`, `pago`, `VehiculoCard`, `lib/lugares.ts` |
| 2 | Calculadora de ingresos para propietarios | Alto | Medio | `propietarios-info`, `dashboard/propietario` |
| 3 | Confianza progresiva: badges + "Trust meter" | Alto | Medio | `vehiculos/[id]`, perfil, dashboard, schema |
| 4 | "Tu viaje en Medellín": pico y placa + peajes + clima | Alto | Medio | `vehiculos/[id]` (reusa `pico-placa.ts` + `lugares.ts`) |
| 5 | Reseñas con fotos del viaje | Alto | Medio–Alto | `vehiculos/[id]`, tabla `resenas`, `FotoUpload` |
| 6 | Handoff guiado: checklist + fotos antes/después | Alto | Medio | flujo reserva, `FotoUpload`, `reservas/[id]` |
| 7 | Reserva exprés (1 toque, glass sticky bar) | Medio–Alto | Bajo–Medio | `vehiculos/[id]`, `CalendarioReserva` |
| 8 | Command palette Cmd+K + voz | Medio | Medio | global, `lib` nuevo |
| 9 | Estados vacíos y de carga con personalidad | Medio | Bajo | global, skeletons, empty states |
| 10 | Mapa de recogida con "punto seguro" | Medio | Medio–Alto | `LugarSelector`, `vehiculos/[id]`, dep. mapa |

---

## Fichas (resumen)

**1. Precio total transparente "Sin sorpresas".** Desglose completo (días × tarifa + recargo aeropuerto + depósito + seguro) antes de avanzar, estilo upfront pricing de Uber. Reusa `calcularRecargo`/`LUGARES` (`lib/lugares.ts`). Mantener paridad client/server. Bajo–medio.

**2. Calculadora de ingresos ("Monetiza tu carro").** Widget con slider de días → estimado mensual animado (Airbnb "What's my place worth"). Ataca el cuello de botella del marketplace (oferta). Fórmula = `precio_dia_promedio_por_tipo × días − comisión`. Medio. Riesgo: no sobre-prometer ("aprox." + supuestos).

**3. Confianza progresiva (badges + Trust meter).** Verificación por etapas (correo→teléfono→documento→licencia→primer viaje) como badges + barra. Nubank/Revolut KYC en micro-pasos; Airbnb +25% bookings con confianza. Schema: flags en `usuarios` (SQLite **y** `supabase/schema.sql`). Medio. Pasar por `auditor-seguridad`.

**4. "Tu viaje en Medellín".** Panel contextual: días de pico y placa (de `diasPicoYPlaca`), peajes estimados por destino, clima del rango. Diferenciador **hiperlocal** imposible de clonar por Turo global. Medio. Centralizar reglas en `lib`.

**5. Reseñas con fotos del viaje.** Al completar, subir 1–3 fotos + nota → prueba social visual en la ficha. Reusa `FotoUpload`. Tabla `resenas`. Medio–alto. Riesgo: moderación/PII, lazy-load.

**6. Handoff guiado.** Entrega/devolución paso a paso con checklist (combustible, golpes, llantas) + comparador deslizante antes/después. Las reservas ya guardan `fotos_antes`/`fotos_despues`/`firma_contrato`. Slider = CSS puro. Medio. Comprimir fotos client-side.

**7. Reserva exprés.** Barra inferior flotante glass que, con fechas/lugar ya en `sessionStorage`, reserva en un toque. El DS define esta "mobile sticky reserve bar". Reusa `.glass`/`lib/lugares.ts`. Bajo–medio.

**8. Command palette Cmd+K + voz.** Paleta global para buscar carros/acciones (Linear). Voz = Web Speech API nativa. Sensación "producto premium". Medio. A11y (focus trap), degradar sin Speech API.

**9. Estados vacíos/carga con personalidad.** Skeletons con shimmer de marca + empty states con tuteo + CTA. El DS ya trae `.shimmer`/`.fade-up`. Bajo. Respetar `prefers-reduced-motion`.

**10. Mapa de recogida + "punto seguro".** Mini-mapa con puntos de encuentro recomendados (CC, estaciones) marcados como seguros, integrado a `LugarSelector`. Medio–alto. Necesita dep de mapa (MapLibre) o imagen estática en MVP; mostrar zona, no dirección exacta.

---

## Top 3 recomendadas + hoja de ruta
- **Top 1 — Precio transparente (#1):** mayor impacto en conversión con menor esfuerzo; el recargo ya está modelado. `<DesgloseReserva>` en `vehiculos/[id]` y `pago` + "desde $X total" en `VehiculoCard`.
- **Top 2 — Confianza progresiva (#3):** núcleo de un marketplace P2P; combina con #2 para captar propietarios. Schema de verificación + `<TrustMeter>` + microcopy del DS. Auditar con `auditor-seguridad`.
- **Top 3 — Calculadora de ingresos (#2):** ataca el lado de la oferta con gancho claro. Widget en `propietarios-info` + CTA en `dashboard/propietario`.

**Secuencia:** #1 (semana 1) → #2 (semana 2) → #3 (semanas 3–4, requiere migración de schema + auditoría). Luego #7 y #9 (baratos y visibles); reservar #4/#5/#6/#10 para diferenciación profunda.

> Las ideas #1, #4, #6 y #7 reusan helpers/componentes existentes (`lib/lugares.ts`, `lib/pico-placa.ts`, `FotoUpload`, `.glass/.shimmer/.fade-up`) → esfuerzo real menor. Todo lo que toque schema debe replicarse en `supabase/schema.sql`; lo que toque identidad/uploads/roles pasa por `auditor-seguridad`.

### Fuentes
Uber upfront pricing · unicornplatform (car rental booking 2026) · Airbnb earnings tool · craftinnovations (Revolut/Nubank/Monzo onboarding) · raw.studio (Airbnb +25% trust UX) · First Round (marketplace trust & liquidity) · miracuves (cómo funciona Turo) · Quora-Turo (convencer dueños) · Mantlr (Stripe/Linear/Vercel premium UI) · Medium/yousufraza (car rental mobile UI) · SafetyCulture / MobileCarCare (inspección/handoff) · Axios (Turo seguridad).
