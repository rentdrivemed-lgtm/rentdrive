# Campañas DrivePass / RentDrive — Medellín, Colombia

> Entregable del agente **director-campanas**. Campañas COMPLETAS y listas para ejecutar.
> Objetivo doble: **generar reservas (ventas)** y **captar propietarios**.
> Mercado: Medellín y Área Metropolitana (default), con extensión Antioquia/Rionegro-JMC.
> Voz de marca: premium, tuteo, paisa cuando suma cercanía. Tema oscuro + acento naranja `#F25C2B`.
> Última actualización: 2026-06-05.

---

## 0. Cómo leer este documento

- **Moneda:** todo en pesos colombianos (COP). Conversión de referencia **TRM ≈ $3.565 COP/USD** (TRM oficial 2026-06-05). [Fuente: dolarhoy.co]
- **[SUPUESTO]** marca toda cifra estimada por falta de dato propio (DrivePass aún no tiene histórico de campañas; CAC/ROAS reales se ajustan tras el primer mes con datos del pixel/GA4).
- **Benchmarks de pauta** usados (ver §1):
  - **Meta (IG/FB)** CPM Colombia ≈ **USD 2,0–2,7** (≈ $7.000–$9.600 COP). CPC Latam ≈ USD 0,20–0,40.
  - **TikTok** CPM Colombia ≈ **$4.000–$10.000 COP** in-feed; CPC ≈ **$200–$1.200 COP**. Mínimo útil ≈ $800k–$1,5M COP/mes.
  - **Google Search** CPC automotriz/servicio local ≈ **$200–$1.500 COP**; presupuesto mínimo local ≈ $600k COP/mes.
- **Producto:** plataforma P2P (Next.js). Flujos clave que la pauta debe explotar: reserva con fechas/lugar (recargo $100k JMC aeropuerto), perfiles verificados, fotos antes/después, contrato firmado, chat, WhatsApp para confirmación. **WhatsApp es el canal de cierre dominante** en alquiler de carros en Medellín (toda la competencia confirma por WhatsApp).
- **Eventos a trackear** (definidos una vez, válidos para todas las campañas): ver §7.

---

## 1. Investigación: benchmarks, estacionalidad y comportamiento (Colombia/Medellín)

### 1.1 Costos de pauta (lo que vamos a pagar)

| Plataforma | Métrica | Rango Colombia 2025–2026 | Nota |
|---|---|---|---|
| Meta (IG/FB) | CPM | USD 2,0–2,7 (~$7.000–$9.600 COP) | Sube ~30–40% en Q4 (nov-dic) por competencia. CPM conversión > CPM tráfico. |
| Meta | CPC | USD 0,20–0,40 (~$700–$1.400 COP) | [SUPUESTO] para audiencia local segmentada. |
| TikTok | CPM | $4.000–$10.000 COP in-feed | Video con >50% retención a 6s baja CPM efectivo hasta 40%. Mínimo útil $800k–$1,5M/mes. |
| TikTok | CPC | $200–$1.200 COP | Creatividad = principal palanca de costo. |
| Google Search | CPC | $200–$1.500 COP (automotriz/servicio) | Conversión sector automotriz/servicio entre las más altas (12–14%). Mínimo local ~$600k/mes. |
| Google PMax | CPA | [SUPUESTO] $25k–$60k COP/lead | Requiere señales de conversión; activar tras tener pixel maduro. |

Fuentes: §8.

### 1.2 Estacionalidad de demanda (cuándo vender)

Calendario que rige el plan de 90 días y la campaña estacional:

- **Temporada alta nacional:** dic–mar (pico fin de dic–mediados de ene) + jun–jul (vacaciones mitad de año).
- **2026 = año histórico de 15 puentes festivos** (11 lunes, 4 viernes). Cada puente = pico de viaje en carro.
- **Junio 2026:** tres festivos lunes (8, 15, 29 jun) → micro-temporada alta justo al arrancar.
- **Semana Santa 2026:** 29 mar – 5 abr (alta).
- **Feria de las Flores 2026:** **31 jul – 9 ago**. ~50.000–60.000 visitantes, ocupación hotelera 77–97%, impacto >USD 68M con Colombiamoda. Reservar con anticipación es el comportamiento esperado → ventana de captación jun–jul.
- **Mundial de fútbol 2026** (jun-jul): presión adicional de demanda/precios de transporte.

Implicación: subir presupuesto y pujas en ventanas de puente; capturar la **reserva anticipada** (la gente reserva semanas antes para Feria/Semana Santa). En temporada baja, peso a captación de propietarios (oferta para la alta que viene) y always-on de eficiencia.

### 1.3 Comportamiento del público

- **WhatsApp es el canal de cierre**: la competencia (Reizen, Alquicarros, Go Drive, etc.) confirma disponibilidad y reserva por WhatsApp. DrivePass debe llevar el tráfico de pauta a un **WhatsApp Business** con respuesta rápida, aunque la reserva se complete en la plataforma. Click-to-WhatsApp en Meta es el formato de mayor cierre local.
- **Sin tarjeta de crédito**: un dolor recurrente del mercado (varias marcas se posicionan en "sin tarjeta"). Mensaje fuerte para BOFU.
- **Móvil primero**, video corto (Reels/TikTok) domina el descubrimiento en <35 años; Facebook/Marketplace pesa más en +35 y en propietarios.
- **Miedos del arrendatario** (de la guía de marca): estado del carro, cobros sorpresa, que el propietario no aparezca → la pauta debe vender **verificación + fotos antes/después + contrato**.
- **Motivación del propietario**: monetizar un carro parado. Mensaje: ingreso pasivo, control, verificación de quién maneja.

---

## 2. CAMPAÑA 1 — LANZAMIENTO "Conduce libre" (pulso de marca + primeras reservas)

### 2.1 Objetivo y KPI
- **Objetivo:** instalar la marca en Medellín y arrancar el flywheel (primeras reservas + primeros propietarios) en 30–45 días.
- **Audiencia:** doble — arrendatarios 25–45 (turistas nacionales, viajeros de puente, locales sin carro) y propietarios 30–55 con carro subutilizado.
- **KPIs:**
  - Reservas: **80–150 reservas** en la ventana de lanzamiento [SUPUESTO].
  - **CAC objetivo arrendatario ≤ $45.000 COP** [SUPUESTO]; mejora a ≤$30k al madurar.
  - Propietarios registrados con ≥1 vehículo publicado: **40–70**.
  - CPL propietario ≤ **$18.000 COP** [SUPUESTO].
  - Recall asistido / alcance único: 250k–400k personas en Medellín.

### 2.2 Embudo TOFU → MOFU → BOFU
- **TOFU (alcance + video):** "Llegó DrivePass a Medellín. Alquila o pon a rodar tu carro." Reels/TikTok de marca, alcance e interacción. Formato: video 9:16 6–15s.
- **MOFU (consideración):** "Cómo funciona en 3 pasos" + prueba social (verificación, fotos antes/después). Carrusel + video explicativo; tráfico a landing/`/para-usuarios` y `/propietarios-info`. Retargeting de quien vio ≥50% del video TOFU.
- **BOFU (conversión):** Click-to-WhatsApp + reserva. Oferta de lanzamiento: **-15% primera reserva** (cupón `ARRANCA15`) y para propietarios **"0% comisión los primeros 30 días"** [SUPUESTO de oferta — validar con negocio]. Retargeting de visitantes de ficha de vehículo y de quien escribió por WhatsApp sin cerrar.

### 2.3 Mix de canales priorizado (Medellín)
1. **Meta Ads (IG/FB + Reels) — 45%.** Núcleo del lanzamiento: alcance + Click-to-WhatsApp + retargeting. Reels para <35, Marketplace/Feed para propietarios +35.
2. **TikTok Ads — 20%.** Hook de marca y "reservé en 2 minutos"; barato para alcance joven.
3. **Google Search — 15%.** Captura demanda existente ("alquiler de carros Medellín", "rent a car Medellín sin tarjeta").
4. **Influencers paisas — 12%.** 3–5 micro/medianos (viajes, lifestyle Medellín, "carros") para credibilidad local.
5. **WhatsApp Business — incluido (cierre).** Catálogo + respuestas rápidas + plantillas.
6. **OOH selectivo — 8% [escenario agresivo].** Aeropuerto JMC (llegadas), El Poblado, Laureles. Solo si hay caja; alto impacto de marca, difícil de medir.

### 2.4 Conceptos creativos (5)

**C1 — "Llegó la libertad a Medellín" (lanzamiento de marca).**
Guion Reel 15s:
- 0–2s: pantalla negra, llaves cayendo en cámara lenta, brillo naranja. Texto: "Tu ciudad, a tu ritmo."
- 2–8s: cortes rápidos — alguien sube a un carro, arranca, recorre Las Palmas / El Poblado al atardecer.
- 8–12s: UI de la app (oscura, acento naranja) reservando en 3 toques.
- 12–15s: logo + "DrivePass. Conduce libre." CTA: "Reserva hoy con -15%."
Visual: tema oscuro, acento naranja en CTA y precio, personas en movimiento (no carros estáticos).

**C2 — "Reservé en 2 minutos" (proceso, TikTok nativo).**
Guion TikTok 20s, estilo POV cámara en mano, sin filtro:
- "Necesitaba carro para el puente y no tenía tarjeta de crédito…" → abre app → elige fechas y lugar → confirma por WhatsApp → "listo, salí a rodar." Trend audio. Termina: "Sin trámites raros. DrivePass."

**C3 — "Tu carro parqueado es plata quieta" (propietarios).**
Guion Reel 15s:
- 0–3s: carro cubierto de polvo en un parqueadero. Texto: "¿Tu carro lleva días sin moverse?"
- 3–10s: el dueño lo publica en DrivePass; verificación de quién maneja; notificación de reserva; transferencia.
- 10–15s: "Pon tu carro a generar. Tú pones las reglas." CTA: "Publica gratis."

**C4 — "Sin miedo" (confianza, MOFU).**
Carrusel 5 tarjetas: Perfil verificado → Fotos antes/después → Contrato firmado → Chat directo → Soporte. Cada tarjeta tema oscuro, ícono line 1.5px, acento naranja. Copy de cierre: "Alquila sin miedo. Todo queda registrado."

**C5 — "Medellín en tus manos" (aspiracional, turista).**
Guion 15s: dron de Medellín → carro saliendo a Guatapé/Santa Fe de Antioquia/Oriente → "Llegas, recoges, exploras." Pensado para puentes. CTA: "Tu próxima aventura empieza aquí."

### 2.5 Banco de copys (listo para pegar — variantes A/B)

**Headlines (arrendatario)**
- A: "Conduce libre por Medellín."
- B: "Tu carro ideal, disponible hoy."
- C: "Alquila sin tarjeta de crédito. Sin trámites raros."
- D: "Reserva en minutos. Conduce cuando quieras."

**Primary text (arrendatario) — variante 1**
> Llegó DrivePass a Medellín. Alquila el carro que necesitas, de personas reales y verificadas, en minutos. Eliges fechas, lugar de recogida y listo: confirmas por WhatsApp y sales a rodar. Primera reserva con -15% 👉

**Primary text (arrendatario) — variante 2 (dolor "sin tarjeta")**
> ¿Sin tarjeta de crédito y necesitas carro para el puente? En DrivePass reservas fácil: fechas, lugar y confirmación por WhatsApp. Perfiles verificados, fotos antes y después, todo queda registrado. Estrena con -15% en tu primera reserva.

**Headlines (propietario)**
- A: "Tu carro parqueado es plata quieta."
- B: "Pon tu carro a generar. Tú pones las reglas."
- C: "Gana con tu carro sin perder el control."

**Primary text (propietario)**
> ¿Tu carro pasa días sin moverse? En DrivePass lo pones a generar ingresos. Tú decides cuándo y a quién: solo conductores verificados, fotos antes/después y contrato firmado en cada reserva. Publicar es gratis y en lanzamiento: **0% comisión los primeros 30 días**. [SUPUESTO de oferta]

**Descriptions (Google / corto)**
- "Alquiler de carros entre particulares en Medellín. Verificado. Reserva en minutos."
- "Carros desde particulares, sin trámites raros. Confirma por WhatsApp."

**CTAs:** Reservar ahora · Reserva con -15% · Publica tu carro gratis · Escríbenos por WhatsApp · Ver carros disponibles

### 2.6 Presupuesto (mensual, ventana de lanzamiento)

| Canal | LEAN ($4M COP/mes) | AGRESIVO ($14M COP/mes) |
|---|---|---|
| Meta Ads | $1.800.000 (45%) | $6.300.000 |
| TikTok Ads | $800.000 (20%) | $2.800.000 |
| Google Search | $600.000 (15%) | $2.100.000 |
| Influencers paisas | $500.000 (12%) | $1.680.000 |
| OOH selectivo | — | $1.120.000 (8%) |
| WhatsApp/creatividad/buffer | $300.000 | — |
| **Total** | **$4.000.000** | **$14.000.000** |

[SUPUESTO] En LEAN, OOH se omite. Influencers en LEAN = 2 micro con canje + fee bajo.

### 2.7 Medición / A/B
- **Eventos:** ver §7. Foco lanzamiento: `Lead` (Click-to-WhatsApp), `InitiateCheckout` (inicia reserva), `Purchase` (reserva confirmada), `CompleteRegistration` (propietario publica).
- **A/B:** Headline A ("Conduce libre") vs C ("sin tarjeta"); Reel C1 (marca) vs C2 (proceso); destino Landing vs Click-to-WhatsApp directo.
- **Éxito:** CAC arrendatario ≤ $45k y CPL propietario ≤ $18k a los 21 días; si no, recortar el canal de peor CAC y mover a Meta retargeting.

---

## 3. CAMPAÑA 2 — ADQUISICIÓN DE ARRENDATARIOS (always-on)

### 3.1 Objetivo y KPI
- **Objetivo:** flujo constante de reservas todo el año a CAC eficiente; es el motor de ingresos.
- **Audiencia:** arrendatarios 23–50 en Medellín/AM: locales sin carro o con un solo carro familiar, turistas nacionales, viajeros de negocios, planes de fin de semana/puente.
- **KPIs:**
  - **ROAS objetivo ≥ 3,0** [SUPUESTO] (mejora con retargeting maduro).
  - **CAC ≤ $30.000 COP** en estado estable [SUPUESTO].
  - CTR Meta ≥ 1,2%; tasa landing→`InitiateCheckout` ≥ 8% [SUPUESTO].
  - Reservas/mes incrementales y % de reservas recurrentes (segunda compra).

### 3.2 Embudo TOFU → MOFU → BOFU
- **TOFU:** Reels/TikTok útiles ("3 carros perfectos para el puente", "rutas desde Medellín en carro"), Advantage+ alcance.
- **MOFU:** "Cómo funciona" + reseñas + escasez real ("solo quedan 2 para este finde" cuando sea cierto). Tráfico a fichas de vehículo y categorías (SUV, económico, lujo).
- **BOFU:** Catálogo dinámico (DPA) + retargeting de visitantes de ficha y carritos abandonados + Click-to-WhatsApp + Search de marca y genérico. Cupón segunda reserva por email/WhatsApp.

### 3.3 Mix de canales (Medellín)
1. **Meta Advantage+ Shopping / DPA — 40%.** Retargeting de catálogo es el mejor ROAS; prospecting con creativos ganadores.
2. **Google Search — 25%.** Demanda intencional alta-conversión ("alquiler de carros medellín", "rent a car medellin", "+ sin tarjeta", "+ aeropuerto rionegro"). Incluir marca para defender.
3. **Google Performance Max — 12%.** Solo tras pixel maduro; aprovecha conversión alta del sector.
4. **TikTok Ads — 13%.** Prospecting joven barato; creativos nativos.
5. **Retargeting/email/WhatsApp — 10%.** Carrito abandonado, segunda reserva, reactivación.

### 3.4 Conceptos creativos (4)
- **C1 — "El carro para tu plan".** Reel: 3 planes (Guatapé, partido en el Atanasio, mudanza) → 3 carros → "el tuyo te espera". CTA "Ver carros".
- **C2 — DPA dinámico.** Plantilla oscura con foto del vehículo, precio en naranja, ubicación y "Disponible este finde". Se alimenta del catálogo.
- **C3 — "Sin tarjeta, sin drama".** TikTok POV resolviendo el dolor de pago; cierre por WhatsApp.
- **C4 — Reseña real.** Testimonio en 12s de un arrendatario (UGC): "el carro estaba impecable, todo por la app". Refuerza confianza (BOFU).

### 3.5 Banco de copys (A/B)

**Search (RSA) — titulares**
- "Alquiler de Carros Medellín" / "Rent a Car en Medellín 24h" / "Sin Tarjeta de Crédito" / "Reserva en Minutos por WhatsApp" / "Carros Verificados desde $X/día" / "Recoge en el Aeropuerto JMC"

**Search — descripciones**
- "Carros de particulares verificados. Reserva fácil y confirma por WhatsApp. Conduce libre."
- "Sin trámites raros. Fotos antes y después, contrato firmado. Reserva hoy."

**Meta — primary text**
- A: "¿Plan de fin de semana? Tu carro te espera en DrivePass. Reserva en minutos, recoge donde quieras y arranca. Carros verificados, todo por la app 👉"
- B (escasez real): "Quedan pocos carros para este puente en Medellín. Asegura el tuyo antes de que se agoten. Reserva en minutos 👉"

**Headlines:** "Tu carro te espera" · "Reserva tu finde" · "Conduce libre este puente" · "Carros verificados en Medellín"
**CTAs:** Reservar ahora · Ver disponibilidad · Escríbenos por WhatsApp

### 3.6 Presupuesto (mensual, sostenido)

| Canal | LEAN ($3M/mes) | AGRESIVO ($10M/mes) |
|---|---|---|
| Meta Advantage+/DPA | $1.200.000 | $4.000.000 |
| Google Search | $750.000 | $2.500.000 |
| Google PMax | — | $1.200.000 |
| TikTok | $400.000 | $1.300.000 |
| Retargeting/email/WhatsApp | $350.000 | $1.000.000 |
| Buffer/creatividad | $300.000 | — |
| **Total** | **$3.000.000** | **$10.000.000** |

Regla always-on: subir 30–50% en semanas de puente (ver §6) y bajar en valles.

### 3.7 Medición / A/B
- **Eventos clave:** `ViewContent` (ficha), `InitiateCheckout`, `AddPaymentInfo`, `Purchase`, valor de compra para ROAS.
- **A/B:** prospecting Meta vs TikTok (CAC); Search marca vs genérico; landing por categoría vs home; con cupón vs sin cupón (efecto en margen).
- **Optimización:** podar keywords con CPC alto y baja conversión; escalar el creativo con menor CPA cada 7–10 días; activar PMax solo con ≥30 conversiones/mes de señal.

---

## 4. CAMPAÑA 3 — CAPTACIÓN DE PROPIETARIOS (oferta del marketplace)

### 4.1 Objetivo y KPI
- **Objetivo:** crecer la oferta de vehículos (sin oferta no hay reservas). Marketplace de dos lados: esta campaña alimenta a la #2 y #5.
- **Audiencia:** propietarios 28–60 en Medellín/AM con carro subutilizado; segundo carro familiar; gente que dejó de usar el carro por trabajo remoto; conductores de apps buscando ingreso extra.
- **KPIs:**
  - **CPL propietario ≤ $15.000 COP** [SUPUESTO]; vehículo **publicado y verificado** ≤ $60.000 COP de costo de adquisición [SUPUESTO].
  - Tasa lead→publicado ≥ 25%; ≥1ª reserva del vehículo en 30 días.
  - Meta de oferta: +X vehículos/mes según capacidad de verificación del equipo.

### 4.2 Embudo TOFU → MOFU → BOFU
- **TOFU:** "Tu carro parqueado es plata quieta" — alcance/video a +30. Calculadora de ingreso ("¿Cuánto puede generar tu carro?").
- **MOFU:** "Cómo funciona para propietarios" + control y seguridad (solo conductores verificados, fotos antes/después, contrato, tú apruebas). Lead form / landing `/propietarios-info`.
- **BOFU:** Lead Ads + Click-to-WhatsApp para acompañar el registro y la publicación; retargeting de quien empezó registro sin publicar. Oferta: **0% comisión 30 días** + acompañamiento para subir fotos.

### 4.3 Mix de canales (Medellín)
1. **Meta Lead Ads + Facebook Feed/Marketplace — 50%.** Propietarios +30 viven en FB; Lead Ads barato para CPL.
2. **Google Search — 18%.** "cómo rentar mi carro", "ganar dinero con mi carro", "poner mi carro a trabajar medellín".
3. **WhatsApp Business — 12%.** Onboarding asistido (clave para subir tasa lead→publicado).
4. **Grupos de Facebook / comunidades — 10%.** Conductores de apps, motor, compraventa de carros en Medellín (orgánico + posts pauteados).
5. **Influencers de finanzas/ingreso extra paisas — 10%.** "side income" creíble.

### 4.4 Conceptos creativos (3)
- **C1 — "Plata quieta".** (ver C3 de §2.4) carro empolvado → ingreso. CTA "Calcula cuánto ganas".
- **C2 — "Tú pones las reglas".** El propietario aprueba al conductor, ve su verificación, recibe fotos antes/después. Mensaje de control = mata el miedo a prestar el carro.
- **C3 — Testimonio propietario (UGC).** "Mi carro me deja $X al mes sin hacer nada raro." Credibilidad local paisa.

### 4.5 Banco de copys (A/B)
**Headlines**
- A: "Tu carro parqueado es plata quieta."
- B: "Gana con tu carro sin perder el control."
- C: "Convierte tu carro en ingreso pasivo."

**Primary text — v1 (ingreso)**
> Tu carro pasa más tiempo parqueado que rodando. Ponlo a generar en DrivePass: tú decides cuándo está disponible y a quién se lo prestas. Solo conductores verificados, fotos antes/después y contrato firmado. Publicar es gratis y este mes: 0% comisión los primeros 30 días. [SUPUESTO]

**Primary text — v2 (control/miedo)**
> Prestar tu carro da miedo, lo sabemos. Por eso en DrivePass tú apruebas quién maneja: ves su verificación, quedan fotos del estado antes y después y un contrato firmado en cada reserva. Tú pones las reglas, nosotros la tecnología. Publica gratis 👉

**Lead form intro:** "Déjanos tus datos y te ayudamos a publicar tu carro en minutos. Sin costo."
**CTAs:** Publica tu carro gratis · Calcula tu ingreso · Quiero más info por WhatsApp

### 4.6 Presupuesto (mensual)

| Canal | LEAN ($2,5M/mes) | AGRESIVO ($7M/mes) |
|---|---|---|
| Meta Lead Ads/Feed/Marketplace | $1.250.000 | $3.500.000 |
| Google Search | $450.000 | $1.260.000 |
| WhatsApp onboarding | $300.000 | $840.000 |
| Grupos FB/comunidades | $250.000 | $700.000 |
| Influencers ingreso extra | $250.000 | $700.000 |
| **Total** | **$2.500.000** | **$7.000.000** |

### 4.7 Medición / A/B
- **Eventos:** `Lead` (form/WhatsApp), `CompleteRegistration` (cuenta propietario), evento custom `VehiclePublished`, `VehicleVerified`.
- **A/B:** ángulo ingreso vs control/miedo; Lead Ads vs landing; con calculadora vs sin.
- **Optimización:** priorizar el ángulo con mayor tasa lead→publicado (no solo CPL barato — un lead que no publica no sirve). Reforzar onboarding WhatsApp donde cae el embudo.

---

## 5. CAMPAÑA 4 — ESTACIONAL "Feria de las Flores / Temporada Alta" (reserva anticipada)

> Plantilla reutilizable para cualquier pico (Semana Santa, puentes de junio, fin de año). Aquí instanciada en **Feria de las Flores: 31 jul – 9 ago 2026**.

### 5.1 Objetivo y KPI
- **Objetivo:** capturar la **reserva anticipada** del pico (la gente reserva semanas antes para Feria) y captar oferta extra antes del evento.
- **Audiencia:** turistas nacionales que viajan a Medellín para la Feria, paisas que reciben visita y necesitan carro, locales para planes de Feria. Secundario: propietarios (subir oferta para el pico).
- **KPIs:**
  - Volumen de reservas con fecha dentro de 28 jul–10 ago: **meta de pico** (2–3× una semana normal) [SUPUESTO].
  - CAC puede subir 30–40% (CPM Q3 sube por demanda) y aún ser rentable por ticket más alto y días por reserva mayores.
  - % de reservas hechas con ≥10 días de anticipación (medir efectividad de la anticipación).

### 5.2 Embudo TOFU → MOFU → BOFU + calendario interno del evento
- **6–7 semanas antes (mediados jun):** TOFU — "La Feria se vive mejor en carro. Reserva con tiempo, los carros se agotan." Alcance + captación de propietarios para el pico.
- **3–5 semanas antes (jul):** MOFU — rutas/planes de Feria (Silletas, Santa Elena, Súper Concierto, pueblos del Oriente), escasez real ("quedan X carros para esas fechas"). Retargeting.
- **0–2 semanas antes + durante (28 jul–9 ago):** BOFU — urgencia: "Últimos carros para la Feria", Click-to-WhatsApp, retargeting agresivo, Search de intención alta ("alquiler carro feria de las flores medellín").

### 5.3 Mix de canales
1. **Meta (Reels + DPA + retargeting) — 40%.** Empuje de anticipación + cierre.
2. **Google Search — 25%.** Intención de viaje pico ("alquiler carro Medellín agosto", "feria de las flores carro").
3. **TikTok — 15%.** Contenido de Feria (alto consumo estacional).
4. **Influencers paisas/viajes — 12%.** Activan justo antes; cobertura de Feria.
5. **OOH aeropuerto JMC — 8% [agresivo].** Llegadas de turistas en la ventana del evento.

### 5.4 Conceptos creativos (3)
- **C1 — "Vive la Feria a tu ritmo".** Reel: silletas, Santa Elena, pueblos del Oriente, todo en carro propio de DrivePass; "no dependas de nadie para moverte en la Feria". CTA "Reserva antes de que se agoten".
- **C2 — "Se agotan" (urgencia).** Contador/visual de disponibilidad cayendo; "X carros disponibles para Feria". Solo si la escasez es real.
- **C3 — "Recibe a los tuyos" (paisa local).** El que recibe visita para la Feria y necesita carro grande: "que tu familia llegue y tú ya tengas las llaves".

### 5.5 Banco de copys (A/B)
**Headlines**
- A: "Vive la Feria de las Flores a tu ritmo."
- B: "Los carros para la Feria se agotan. Reserva ya."
- C: "Medellín en agosto, en tus manos."

**Primary text — v1 (anticipación)**
> La Feria de las Flores se vive mejor con carro propio: Santa Elena, las silletas, los pueblos del Oriente, el Súper Concierto… sin depender de nadie. En DrivePass reservas con tiempo y aseguras el tuyo antes de que se agoten. Carros verificados, confirmación por WhatsApp 👉

**Primary text — v2 (urgencia, durante)**
> ⚠️ Últimos carros disponibles para la Feria en Medellín. Si lo necesitas del 31 de julio al 9 de agosto, asegúralo hoy: las fechas de Feria vuelan. Reserva en minutos y confirma por WhatsApp.

**Copy propietario (subir oferta pre-Feria)**
> Llega la Feria y Medellín se llena. Si tienes un carro parqueado, esta es la semana de más demanda del año. Publícalo gratis en DrivePass y aprovecha el pico. Tú pones las reglas.

**CTAs:** Reserva tu carro para la Feria · Asegura tu finde de Feria · Publica antes de la Feria

### 5.6 Presupuesto (concentrado en la ventana de ~6 semanas)

| Canal | LEAN ($5M total) | AGRESIVO ($18M total) |
|---|---|---|
| Meta | $2.000.000 | $7.200.000 |
| Google Search | $1.250.000 | $4.500.000 |
| TikTok | $750.000 | $2.700.000 |
| Influencers | $700.000 | $2.160.000 |
| OOH JMC | — | $1.440.000 |
| Buffer | $300.000 | — |
| **Total** | **$5.000.000** | **$18.000.000** |

[SUPUESTO] Gasto front-loaded: ~60% en las 4 semanas previas (captura anticipación), ~40% en la ventana del evento (urgencia/cierre).

### 5.7 Medición / A/B
- Mismos eventos §7; segmentar reservas por **rango de fecha del evento**.
- **A/B:** anticipación vs urgencia; con escasez vs sin; turista nacional vs local paisa.
- **Éxito:** lograr el pico de reservas manteniendo CAC dentro de +40% del baseline; medir cuánta reserva se adelantó (anticipación) vs last-minute.

---

## 6. Calendario 90 días (jun–ago 2026) — integrado

Asume arranque **mié 10-jun-2026**. Cifras = presupuesto total/mes en escenario **LEAN** (multiplicar ~3,3× para agresivo).

| Semana | Fechas | Hito / contexto | Lanzamiento | Always-on arrend. | Propietarios | Estacional Feria |
|---|---|---|---|---|---|---|
| S1 | 10–14 jun | Arranque + festivo lun 8/15 jun (puentes) | ON full (pulso marca) | warm-up | ON (subir oferta) | — |
| S2 | 15–21 jun | Festivo lun 15 (Sagrado Corazón) | ON | ON +30% puente | ON | — |
| S3 | 22–28 jun | — | ON | ON | ON | teaser TOFU "reserva con tiempo" |
| S4 | 29 jun–5 jul | Festivo lun 29 (San Pedro) | cierre lanzamiento | ON +30% puente | ON | TOFU Feria activa |
| S5 | 6–12 jul | Vacaciones mitad de año (alta) | OFF (→ always-on) | ON alta | ON | TOFU+MOFU Feria |
| S6 | 13–19 jul | Alta | — | ON alta | ON | MOFU Feria (rutas, escasez) |
| S7 | 20–26 jul | Pre-Feria, festivo lun 20 (Independencia) | — | ON | push final oferta | MOFU→BOFU |
| S8 | 27 jul–2 ago | **Inicia Feria 31 jul** | — | ON | — | **BOFU urgencia full** |
| S9 | 3–9 ago | **Feria pico**, festivo lun 7 (Boyacá) | — | ON | — | **BOFU full + OOH JMC** |
| S10 | 10–16 ago | Post-Feria | — | ON (reactivación) | ON (retener oferta) | cierre + email reseñas |
| S11–13 | 17 ago–7 sep | Valle | — | ON eficiencia | ON (oferta para Q4) | plantilla lista p/ Amor y Amistad (sep) |

Hitos de gestión:
- **Día 0–3:** instalar pixel/GA4 + eventos (§7), catálogo Meta, WhatsApp Business + plantillas, cupones `ARRANCA15`.
- **Día 21:** primera revisión de CAC/CPL → podar canal peor.
- **Día 45:** decidir activar Google PMax (si ≥30 conversiones/mes) y escalar creativos ganadores.
- **Día 60:** evaluar escenario agresivo según ROAS y caja.
- **Día 90:** retro completa + plantilla estacional para fin de año (dic).

---

## 7. Medición — setup único (válido para todas las campañas)

**Stack:** Meta Pixel + Conversions API, GA4, TikTok Pixel, Google Ads conversion tags, WhatsApp Business (clic como `Lead`).

**Eventos estándar a trackear:**
| Evento | Disparo | Campaña principal |
|---|---|---|
| `ViewContent` | ver ficha de vehículo | Always-on, Estacional |
| `Lead` | clic Click-to-WhatsApp / lead form | Todas |
| `InitiateCheckout` | iniciar reserva (fechas+lugar) | Always-on, Estacional, Lanzamiento |
| `AddPaymentInfo` | paso de pago | Always-on |
| `Purchase` (con `value`) | reserva confirmada | Todas (ROAS) |
| `CompleteRegistration` | crea cuenta propietario | Propietarios |
| `VehiclePublished` (custom) | publica vehículo | Propietarios |
| `VehicleVerified` (custom) | doc/vehículo verificado | Propietarios |

**Tableros:** CAC por canal, ROAS, CPL propietario, tasa lead→publicado, reservas/día, % reservas anticipadas (estacional), embudo TOFU→BOFU. Revisión semanal; decisión de presupuesto cada 7–10 días.

**Criterios de éxito globales [SUPUESTO, ajustar con datos reales del mes 1]:**
- CAC arrendatario estado estable ≤ $30.000 COP · ROAS ≥ 3,0.
- CPL propietario ≤ $15.000 · costo por vehículo publicado-verificado ≤ $60.000.
- Lanzamiento: ≥80 reservas y ≥40 propietarios en la ventana.

**Reglas de optimización:**
1. Cada creativo nuevo entra contra el ganador actual (1 variable por test).
2. Apaga adsets con CPA > 1,5× objetivo tras gasto suficiente (≥ 3–5× CPA en gasto).
3. Escala 20–30% cada 3–4 días el ganador; nunca dupliques presupuesto de golpe (resetea aprendizaje).
4. En puentes/Feria sube pujas y presupuesto; en valles baja a always-on de eficiencia.

---

## 8. Fuentes (benchmarks y estacionalidad)

- Meta CPM/CPC Colombia: SuperAds — Facebook Ads CPM Colombia (superads.ai/facebook-ads-costs/cpm-cost-per-mille/colombia); AdAmigo — Meta Ads CPM/CPC by Country 2026 (adamigo.ai/blog/meta-ads-cpm-cpc-benchmarks-by-country-2026); Lebesgue — Facebook CPM by Country (lebesgue.io/facebook-ads/facebook-cpm-by-country).
- TikTok Ads Colombia: Consolidación Digital (consolidaciondigital.com/blog/performance-marketing/tiktok-ads-colombia); Webhexup (webhexup.com/cuanto-cuesta-tiktok-ads-colombia); Laboratorio Web (laboratorioweb.com.co/cuanto-cuesta-la-publicidad-en-tiktok-en-colombia).
- Google Ads Colombia: MarketingCPE (marketingcpe.com.co/blog/google-ads/cuanto-cuesta-la-publicidad-en-google-ads-colombia); Laboratorio Web (laboratorioweb.com.co/cuanto-cuesta-google-ads-en-colombia); ToGrow Agencia (togrowagencia.com/cuanto-debo-invertir-en-google-ads).
- Estacionalidad/puentes 2026: El Espectador — temporada baja/alta 2026; Pulzo — 15 puentes festivos 2026; Aviatur — festivos Colombia; El País — destinos junio 2026.
- Feria de las Flores 2026: VisitMedellín (visitmedellin.co); Holafly (esim.holafly.com); El Colombiano — impacto USD 68M; Travel Trade Caribbean — 50.000 turistas; Infobae — Súper Concierto Feria 2026.
- Comportamiento WhatsApp/“sin tarjeta”: Reizen (reizenconnections.com); Alquiler de Carros Medellín sin Tarjeta; Alquicarros; Go Drive Medellín.
- TRM USD/COP 2026-06-05: DolarHoy Colombia (dolarhoy.co); Banrep TRM.

---
*Documento generado por el agente director-campanas — DrivePass / RentDrive Medellín. Las cifras marcadas [SUPUESTO] deben recalibrarse con datos propios tras el primer mes de pauta.*
