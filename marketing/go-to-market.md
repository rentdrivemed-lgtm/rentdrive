# Go-To-Market & Growth — DrivePass Medellín

> Plan para que **DrivePass** (marketplace P2P de alquiler de carros entre particulares) **domine Medellín y sea #1**.
> Autor: agente `growth-lanzamiento`. Fecha: 2026-06-05.
> Marca, paleta, tono y arquetipo según `Imagen de marca/Identidad_de_Marca_RentDrive.md`. Producto según `rentdrive/PROYECTO.md`.
>
> **Convención de supuestos:** todo dato sin fuente citada va marcado como **[SUPUESTO]** y debe validarse antes de comprometer presupuesto. Las cifras de mercado tienen fuente al pie.

---

## 0. Tesis en una frase

Medellín ya tiene **demanda probada y creciente** de carros para turistas y nómadas (Localiza hizo 14.406 contratos solo en Medellín en 2025 y la ciudad rompió récord con ~1,2M de extranjeros)¹², pero la **oferta P2P está subatendida**: el único competidor P2P serio (Eva) es nacional, no paisa, y compite en precio sin foso local. DrivePass gana **concentrando liquidez en El Poblado–Laureles–aeropuerto JMC primero**, sembrando oferta de propietarios verificados, y construyendo confianza premium (arquetipo Explorador+Héroe) que ni los rent-a-car tradicionales ni un genérico nacional pueden replicar.

---

## 1. El problema del arranque en frío (chicken-and-egg)

### 1.1 Diagnóstico: ¿qué lado es más difícil?
En un marketplace P2P de carros, **el lado escaso y caro de conseguir es la OFERTA** (propietarios dispuestos a prestar su carro a desconocidos). La demanda (turista/nómada que quiere un carro) ya existe y es captable con marketing; lo que falta es **inventario disponible, verificado y confiable en la zona y fechas correctas**. Turo confirmó este patrón: su fundador arrancó **sembrando oferta a mano** (10.000 volantes para reclutar dueños en Baltimore) antes de empujar demanda³. Airbnb hizo lo mismo: fotografiaron y reclutaron anfitriones uno por uno en Nueva York⁴.

**Regla de oro que adoptamos:** *primero oferta, luego demanda, y nunca toda la ciudad a la vez.*

### 1.2 La trampa de la liquidez geográfica
Si esparcimos 100 carros por toda el Área Metropolitana, ningún barrio tiene suficientes opciones y el usuario que busca "carro en El Poblado este finde" no encuentra match → abandona → la oferta no se reserva → el propietario se va. La solución es **densidad por zona**, no cobertura.

- **Número mágico de Airbnb:** ~300 listings (100 con reseñas) marcaron el punto de inflexión donde las reservas se disparan en un mercado⁴. No es trasladable 1:1 a carros (ticket más alto, menos rotación), así que fijamos un objetivo propio más bajo y por *micro-zona*.
- **Umbral de DrivePass [SUPUESTO, validar]:** **liquidez mínima viable = ~30–40 carros activos y verificados por micro-zona** (El Poblado, Laureles+Estadio, corredor JMC/Rionegro). Con eso un usuario que busca fechas típicas (vie–dom, 3–7 días) encuentra ≥3 opciones reales en su rango. Ese es el "smallest self-sustaining network" por celda geográfica.

### 1.3 Tácticas concretas para resolverlo
**Sembrar oferta (lado difícil) primero — primeras 8 semanas:**
1. **Reclutamiento a mano (el "volante de Turo" en versión 2026):** lista priorizada de propietarios objetivo → dueños de carros 2012+ con papeles al día (Soat, tecnomecánica) en El Poblado/Laureles. Canales: grupos de Facebook de venta de carros usados de Medellín, parqueaderos de edificios residenciales de El Poblado, comunidades de conductores de apps.
2. **Onboarding asistido tipo Airbnb:** un "embajador DrivePass" visita al propietario, **le toma fotos profesionales del carro** (la fotografía premium es parte de la marca), sube documentos y publica el listing por él. Eliminar fricción = más conversión de oferta.
3. **Garantía de ingreso para los primeros (anti-arranque-frío):** a los **primeros 50 propietarios verificados** se les ofrece **0% comisión durante 90 días** + visibilidad destacada ("Pioneros DrivePass"). Convierte la promesa abstracta en plata concreta.
4. **Supply sintética acotada [SUPUESTO]:** sumar 5–10 vehículos de **una microflota aliada** (un parqueadero, un concesionario de usados, o socios fundadores) para que la zona nunca se vea vacía el día 1. Buenas prácticas de marketplaces: cap de oferta sintética ≤30% y convertir a oferta real en ≤60 días³.
5. **Demanda solo cuando hay match:** no gastar en pauta de demanda en una zona hasta que tenga ≥20 carros activos. El dinero de demanda llega *después* de la liquidez.

---

## 2. North-Star Metric, árbol de métricas y OKRs

### 2.1 North-Star Metric (NSM)
> **Reservas completadas por semana en Medellín** (reserva = pagada + carro entregado + devuelto + ambas partes calificadas).

Por qué esta y no "usuarios" o "GMV": una reserva *completada* prueba simultáneamente las dos caras del marketplace (hubo oferta disponible Y demanda que pagó) y la confianza (el ciclo se cerró sin fricción). Es la unidad mínima de valor real. Espeja la lógica de Airbnb (reservas, no listings) y Turo (trips completados sin cancelación, que es su gatillo de payout de referidos)⁵.

### 2.2 Árbol de métricas
```
NSM: Reservas completadas / semana
│
├── OFERTA (liquidez)
│   ├── Carros activos verificados por micro-zona  (meta MVP: 30–40/zona)
│   ├── % vehículos con ≥1 reserva en 30 días (utilización de oferta; muerta = mala)
│   └── Tiempo del propietario a su 1ª reserva (≤14 días = oferta sana)
│
├── DEMANDA
│   ├── Búsquedas con ≥3 resultados reales (tasa de "match disponible")
│   ├── Conversión búsqueda → solicitud → reserva pagada
│   └── Tiempo del usuario a su 1ª reserva
│
├── CONFIANZA / CALIDAD
│   ├── NPS (separado: usuario y propietario)
│   ├── % reservas sin disputa / sin cancelación tardía
│   └── Reseñas por reserva completada
│
└── RETENCIÓN / LOOP
    ├── Recompra a 90 días (usuario)
    ├── Reincidencia de oferta (propietario que repite mes a mes)
    └── Coeficiente de referido (k-factor) por lado
```

### 2.3 OKRs trimestrales hacia "ser #1"
> "#1 en Medellín" se define como: **mayor número de reservas P2P completadas/mes en Medellín y la marca P2P más reconocida** (top-of-mind en turismo/nómadas). [SUPUESTO de definición — fijar con dirección.]

**Q1 (lanzamiento) — Objetivo: encender la liquidez en El Poblado.**
- KR1: 50 propietarios verificados y publicados (con fotos pro).
- KR2: El Poblado cruza el umbral de 30 carros activos.
- KR3: 150 reservas completadas en el trimestre; NPS usuario ≥ 50.
- KR4: Tiempo medio propietario→1ª reserva ≤ 14 días.

**Q2 — Objetivo: segunda zona + loop de referidos vivo.**
- KR1: Laureles+Estadio y corredor JMC superan umbral de liquidez.
- KR2: 120 propietarios totales; utilización de oferta ≥ 45%.
- KR3: k-factor de referido propietario ≥ 0,3 (cada 10 dueños traen ≥3).
- KR4: 600 reservas completadas/trimestre.

**Q3 — Objetivo: dominio de temporada alta (Feria de las Flores 31 jul–9 ago)⁶ y prueba de marca #1.**
- KR1: ocupación de oferta ≥ 70% durante Feria (vs. ocupación hotelera ciudad 77–81%⁶).
- KR2: 1.500 reservas completadas/trimestre.
- KR3: Reconocimiento de marca: aparecer en ≥1 nota de medio local (El Colombiano / Vivir en El Poblado) y top-3 en búsqueda "alquiler carro particular Medellín".

**Q4 — Objetivo: consolidar #1 y defender.**
- KR1: 4 micro-zonas con liquidez sana (sumar Envigado y/o aeropuerto-only).
- KR2: 3.000 reservas completadas/trimestre; recompra usuario a 90 días ≥ 25%.
- KR3: Margen de contribución positivo por reserva (sin subsidio de lanzamiento).

> Todas las metas absolutas son **[SUPUESTO]** y deben recalibrarse tras las primeras 4 semanas de datos reales.

---

## 3. Bucles de crecimiento (growth loops)

Tres loops, cada uno con **mecanismo + incentivo + por qué se auto-refuerza**.

### Loop 1 — Referido de dos lados, mismo lado (propietario → propietario)
- **Mecanismo:** cada propietario tiene un link único. Si un amigo se registra y **completa sus 3 primeras reservas sin cancelar**, ambos cobran. (Copiamos el gatillo de Turo: pago al completar las primeras 3 trips, no al registro — evita fraude y premia oferta *real*)⁵.
- **Incentivo [SUPUESTO de monto, calibrar a unit economics]:** **$150.000 COP a cada uno** (referidor y nuevo propietario). Mucho más barato que el CAC de reclutar oferta a mano vía pauta.
- **Por qué gira:** la oferta es el lado caro; convertir a cada propietario satisfecho en reclutador resuelve el arranque en frío *sin* gasto de marketing lineal. Es el loop más valioso de DrivePass.

### Loop 2 — Referido de dos lados, lado demanda (usuario → usuario)
- **Mecanismo:** "Dale a un amigo **$60.000 en su primera reserva**, y tú recibes **$60.000** cuando él la complete." Saldo no retirable, solo usable en plataforma (devuelve liquidez al marketplace).
- **Incentivo:** crédito de doble cara, se libera al completarse la reserva del referido.
- **Por qué gira:** turistas y nómadas viajan en grupos y se recomiendan servicios; el crédito reembolsable convierte cada viaje feliz en adquisición.

### Loop 3 — Contenido / SEO local (loop de marca y demanda orgánica)
- **Mecanismo:** producir contenido útil-evergreen que captura intención de búsqueda y posiciona la marca:
  - **Calculadora/guía de Pico y Placa Medellín** (ya tenemos `lib/picoYPlaca.ts` — convertirlo en página pública indexable; los visitantes que no saben de pico y placa son justo turistas que necesitan carro).
  - Guías: "Top 10 rutas en carro desde Medellín" (Guatapé, Oriente, Santa Fe de Antioquia), "Cómo moverte en Medellín siendo nómada digital", "¿Conviene alquilar carro o usar apps en Medellín?".
  - Reels/TikTok del proceso de reserva en 30 s y tours en carro (alineado al manual de marca: persona en movimiento, no carro estacionado).
- **Incentivo:** valor gratis → tráfico SEO → reserva. (Coordinar con el agente `estratega-seo`: JSON-LD, sitemap, SEO local Medellín.)
- **Por qué gira:** cada guía rankea, atrae tráfico, genera reservas, y las reseñas/contenido de usuarios alimentan más páginas. Loop compuesto y defendible (foso de contenido en español-Medellín).

### Loop 4 (estructural) — Oferta → Demanda → Oferta
Más carros en una zona → más matches → más reservas → más reseñas y prueba social ("847 reservas este mes" del manual de marca) → más propietarios quieren entrar (ven que se gana plata) → más oferta. **El trabajo de growth es no romper este loop con mala experiencia** (de ahí el NSM = reserva *completada*, no iniciada).

---

## 4. Plan de lanzamiento por fases

### Fase 0 — Pre-lanzamiento (semanas −6 a 0): sembrar oferta + lista de espera
- **Objetivo:** llegar al lanzamiento con **≥30 carros publicados en El Poblado** y una lista de espera de demanda caliente.
- Acciones: reclutamiento a mano de propietarios pioneros (0% comisión 90 días), onboarding asistido con fotos pro, landing de **lista de espera** ("Sé de los primeros en conducir libre en Medellín — primera reserva con descuento").
- **Criterio para pasar de fase:** ≥30 carros activos verificados en El Poblado + ≥300 emails en lista de espera. [SUPUESTO]

### Fase 1 — Lanzamiento (semanas 1–4): beta concentrada en El Poblado
- **Objetivo:** primeras 150 reservas completadas, validar el ciclo de confianza (fotos antes/después, contrato, calificación) en condiciones reales.
- Acciones: abrir a la lista de espera, activar promo "primera reserva -30%", encender Loop 1 y 2, primeras alianzas (hoteles/hostales de El Poblado), primer pulso de PR.
- **Criterio para pasar de fase:** NPS usuario ≥ 50, % reservas sin disputa ≥ 90%, utilización de oferta ≥ 40%. Si no se cumple confianza → **no escalar**, arreglar producto primero.

### Fase 2 — Densificación + segunda zona (meses 2–4)
- **Objetivo:** Laureles+Estadio y corredor JMC cruzan umbral; referidos sostienen ≥30% de la oferta nueva.
- Acciones: replicar el playbook de siembra en Laureles, firmar alianza aeropuerto/transfer, ampliar contenido SEO.
- **Criterio para pasar de fase:** 2 zonas con liquidez sana + k-factor propietario ≥ 0,3.

### Fase 3 — Dominio de temporada y escalado (meses 5–9, incluye Feria de las Flores)
- **Objetivo:** ser la opción default en temporada alta; capturar el pico de agosto y diciembre.
- Acciones: campaña "Feria sin estrés, con carro", pricing dinámico de temporada, empuje fuerte de oferta semanas antes (la oferta debe adelantarse a la demanda).
- **Criterio:** ocupación de oferta ≥70% en Feria; aparición en medios; recompra ≥20%.

### Fase 4 — Consolidación #1 y defensa (meses 10–12)
- 4ª zona, margen positivo sin subsidio, programa de fidelización ("DrivePass" como membresía/pase, guiño al propio nombre), blindaje competitivo (sección 9).

---

## 5. Alianzas estratégicas (priorizadas)

Formato: **Aliado → qué ofrecemos / qué pedimos / prioridad.**

| # | Aliado | Qué ofrecemos | Qué pedimos | Prioridad |
|---|--------|---------------|-------------|-----------|
| 1 | **Aeropuerto JMC (Rionegro) — operadores de transfer / counters** | Entrega/recogida de carro en el aeropuerto (ya soportado: recargo de $100k por trayecto al JMC en el producto), comisión por reserva referida | Espacio/visibilidad para recogida, referidos de pasajeros que aterrizan sin transporte | **Máxima** — el JMC mueve 2M+ internacionales/año¹; es el punto exacto donde nace la necesidad de carro |
| 2 | **Hoteles y hostales de El Poblado/Laureles** | Comisión por huésped referido + "carro a la puerta del hotel", co-branding "tu hotel + tu carro" | QR/flyer en recepción, mención del concierge | **Máxima** — densidad geográfica = donde ya está la demanda; ocupación hotelera 77–81% en temporada⁶ |
| 3 | **Comunidades de nómadas digitales** (coworkings, colivings, grupos de WhatsApp/FB de expats en El Poblado/Provenza) | Tarifa de estancia larga (semanal/mensual), crédito de referido | Posteo en su comunidad, partnership con coliving | **Alta** — ~8.000–8.300 nómadas/mes en Medellín, estancia 1–3 meses, gastan US$1.500–3.500/mes⁷⁸; ticket alto y recurrente |
| 4 | **Agencias de turismo / DMC / operadores de tours a Guatapé–Oriente** | Carro como complemento del paquete, comisión | Inclusión en itinerarios self-drive | **Alta** |
| 5 | **Empresas (B2B): turismo corporativo, productoras, equipos de Colombiamoda/eventos** | Flota flexible sin contratos rígidos, facturación | Volumen de reservas en eventos | **Media-alta** — Colombiamoda + Feria dejan US$68M a la ciudad⁶ |
| 6 | **Parqueaderos de edificios residenciales (El Poblado)** | Comisión por propietario referido; el carro "trabaja" mientras el dueño no lo usa | Acceso a residentes con carro ocioso (= oferta) | **Alta para OFERTA** — canal directo al lado escaso |
| 7 | **Concesionarios de usados** | Sus clientes monetizan el carro recién comprado | Co-promoción en punto de venta | Media |
| 8 | **Universidades (EAFIT, UPB, U. de Medellín)** | Descuento estudiante/profesor; ingreso extra para quien tiene carro | Difusión en canales internos | Media |
| 9 | **Gremios de taxis/conductores** | Posible canal de conductores/entregadores (no competir de frente) | Manejar con tacto político (riesgo de fricción) | Baja / cautela |

**Regla de priorización:** alianzas que aportan **OFERTA** (parqueaderos, comunidades de dueños) o **demanda exactamente en la zona sembrada** (hoteles El Poblado, JMC) van primero. Lo demás espera a tener liquidez.

---

## 6. PR y lanzamiento mediático

### Ángulos de prensa (cada uno para un medio distinto)
1. **Economía colaborativa / ingreso para paisas:** "Tu carro parqueado puede pagarte el arriendo" — dueños que monetizan un activo ocioso. Ángulo de oportunidad económica local. → *El Colombiano (Negocios), Q'hubo, La Chiva*.
2. **Movilidad y turismo:** "Medellín rompe récord de turistas (~1,2M extranjeros en 2025)¹² y los carros no alcanzan" — DrivePass como solución paisa al boom. → *El Colombiano (Medellín), Portafolio, Infobae Colombia*.
3. **Nómadas digitales / ciudad global:** "Cómo se mueven los 8.000 nómadas que llegan cada mes a Medellín"⁷ — DrivePass como infraestructura de movilidad del nómada. → *Vivir en El Poblado, medios de expats, LinkedIn*.
4. **Orgullo tecnológico local:** una app paisa que le compite a los gigantes — David vs. Goliat. → *medios de emprendimiento, La República*.

### Tácticas
- **Embargo de lanzamiento:** historia exclusiva a un medio grande (El Colombiano) + boletín a los demás el mismo día.
- **Dato propietario como gancho de prensa:** "el propietario promedio gana $X/mes" [SUPUESTO — usar datos reales tras Fase 1]. Las notas de prensa colombianas sobre estas apps lideran con "gane hasta $600.000 al día"⁹ — tenemos que tener nuestro propio número verificable.
- **Eventos:** evento de lanzamiento para los 50 propietarios pioneros (comunidad = foso); presencia en Feria de las Flores y en eventos de coworking/nómadas.
- **Vocería:** historias humanas reales (propietario que pagó algo con sus ingresos; turista que conoció Antioquia self-drive). Coincide con el arquetipo Explorador+Héroe y con "personas en movimiento" del manual de marca.

---

## 7. Pricing y promociones de lanzamiento

Principio rector: **promocionar sin romper la marca premium** (Paleta A "Confianza Técnica", arquetipo Héroe). Descontamos *primeras veces* y *fricción*, nunca el valor percibido. Cero lenguaje de "lo más barato".

### Para la DEMANDA (usuarios)
- **Primera reserva −30%** (tope $120.000 COP [SUPUESTO]) — captura prueba.
- **Garantía de satisfacción "Conduce sin miedo":** si el carro no llega como se mostró, cubrimos el cambio o devolvemos. Convierte el miedo #1 del usuario (manual de marca §7) en argumento de venta. No es un descuento — es confianza, y eso *sube* el premium.
- **Tarifa de estancia larga** (semana/mes) para nómadas — descuento por volumen, no por desesperación.
- **Crédito de referido** $60k/$60k (Loop 2).

### Para la OFERTA (propietarios)
- **0% comisión los primeros 90 días** para pioneros (primeros 50); luego **comisión introductoria reducida** (p. ej. 10% vs. tarifa objetivo 15–20% [SUPUESTO]) hasta cierto volumen.
- **Bono de activación:** primer payout con bono pequeño al completar la 1ª reserva (acelera el "tiempo a primera reserva").
- **Referido propietario** $150k/$150k (Loop 1).

### Pricing dinámico de temporada
- Subir precios sugeridos en Feria de las Flores (31 jul–9 ago)⁶, diciembre y puentes; el sistema sugiere, el propietario decide. Anclar a referencia de mercado: rent-a-car y Eva arrancan ~$82.000/día⁵ — DrivePass debe poder ofrecer **mejor valor + experiencia premium** sin ser el más barato.

### Comisiones — referencia competitiva
Eva opera con cobertura todo riesgo de Sura (el costo de inspección lo asume Eva)⁵ — el seguro/confianza es tablestakes en Colombia, no diferenciador. DrivePass debe igualar la **percepción de seguro/respaldo** (clave para vencer el miedo) y diferenciar en **experiencia, comunidad y marca paisa**.

---

## 8. Plan de 90 días accionable

> Responsables sugeridos (equipo pequeño): **Growth** (adquisición/loops/pauta), **Ops** (onboarding oferta, soporte, verificación), **Partnerships** (alianzas/PR), **Producto** (web/SEO/loops en plataforma). Presupuesto **[SUPUESTO, orientativo]** — ajustar a caja real.

### Mes 1 — semana a semana (sembrar oferta + beta El Poblado)
- **Semana 1 — Oferta, a mano.** Ops: lista de 100 propietarios objetivo (El Poblado, carro 2012+, papeles al día); guion de reclutamiento; agenda de visitas. Producto: landing de lista de espera live + página pública de Pico y Placa (SEO). Partnerships: primeros contactos con 5 hoteles/hostales. *Presupuesto: ~$2–4M COP (fotógrafo, landing).*
- **Semana 2 — Onboarding.** Ops: publicar primeros 15 carros con fotos pro; activar 0% comisión pioneros. Growth: definir y montar mecánica de referidos (Loop 1 y 2) en plataforma. *KPI: 15 carros publicados.*
- **Semana 3 — Más oferta + preparar demanda.** Ops: llegar a 25 carros. Partnerships: cerrar 2 hoteles (QR en recepción) + contacto JMC/transfer. Growth: warm-up de lista de espera (emails de cuenta regresiva). *KPI: 25 carros, 300 emails.*
- **Semana 4 — Apertura beta.** Cruzar 30 carros El Poblado → **abrir a lista de espera**; activar promo primera reserva −30%; primer boletín de prensa local. *KPI: primeras 20 reservas completadas, NPS inicial.*

### Mes 2 — Validar confianza + encender loops (semanas 5–8)
- Optimizar el ciclo de confianza (fotos antes/después, contrato, calificación); medir % sin disputa.
- Activar formalmente referidos de ambos lados; medir primeros k-factors.
- Cerrar alianza aeropuerto JMC y 3–5 hoteles más; iniciar siembra de **Laureles**.
- Publicar 3–4 guías de contenido (rutas, nómadas, pico y placa).
- *Meta acumulada: ~70 carros, ~120 reservas completadas, NPS ≥ 50. Presupuesto mes: ~$6–10M COP (incentivos referidos + pauta zonificada El Poblado).*

### Mes 3 — Densificar y preparar escala (semanas 9–12)
- Laureles cruza umbral de liquidez; corredor JMC operativo.
- Primera ronda de PR con **dato real de ingreso de propietario** (ya verificable).
- Pauta de demanda *solo* en zonas con liquidez; doblar lo que funcione en CAC.
- Preparar plan de temporada (Feria de las Flores) con 8–10 semanas de anticipación de oferta.
- *Meta acumulada Q1: ~50–60+ propietarios verificados, 150–250 reservas completadas, 2 zonas encendidas. Presupuesto mes: ~$8–12M COP.*

> **Presupuesto total 90 días [SUPUESTO]:** ~$25–40M COP, mayoritariamente en (a) onboarding/fotografía de oferta, (b) incentivos de referido (CAC eficiente), (c) pauta zonificada solo donde hay liquidez. **No** gastar en pauta de marca masiva antes de tener liquidez — sería tirar plata al arranque en frío.

---

## 9. Riesgos y defensa competitiva

### 9.1 Si Eva (P2P nacional) ataca Medellín con fuerza
Eva ya opera en Medellín, Bogotá y Cali y planea expandirse⁵, con respaldo de seguro Sura. **Es el competidor a vencer.**
- **Foso 1 — Liquidez local densa:** ser #1 en El Poblado/Laureles/JMC *primero* hace que el usuario siempre encuentre match en DrivePass y el propietario tenga más reservas con nosotros. La liquidez geográfica es el foso más duro de copiar (Eva la dispersa entre 3 ciudades; nosotros la concentramos en una).
- **Foso 2 — Marca paisa + comunidad:** identidad local fuerte (manual de marca, tono cercano, "Conduce libre"), comunidad de propietarios pioneros con sentido de pertenencia. Un competidor nacional no es "de Medellín".
- **Foso 3 — Confianza/experiencia:** ciclo de fotos antes/después, contratos firmados, garantía "Conduce sin miedo", verificación visible. Igualar su seguro y ganar en experiencia.
- **Foso 4 — Contenido/SEO local:** dominar las búsquedas en español de Medellín (pico y placa, rutas) es un activo compuesto que tarda en replicarse.

### 9.2 Si Turo entra a Colombia
Turo no tiene presencia confirmada en Colombia⁵ y Getaround cerró EE.UU. en 2025³ — el P2P global está en repliegue, no en expansión agresiva a LatAm. Riesgo medio-bajo. Defensa: misma — liquidez local + marca paisa + relaciones con aliados clave (un Turo recién llegado no tiene el JMC ni los hoteles atados).

### 9.3 Si los rent-a-car tradicionales (Localiza, etc.) bajan precios
Compiten en otra categoría (flota propia, mostrador, papeleo). Nuestra ventaja: variedad, conveniencia barrio-a-barrio, precio, y experiencia app-first. No competir en su terreno; competir en *cercanía y libertad*.

### 9.4 Riesgos operativos/regulatorios a vigilar
- **Seguro y placa amarilla:** Eva exige carro 2012/2009+, placa amarilla y respaldo Sura⁵. Validar el marco de seguro/responsabilidad de DrivePass **antes** de escalar — un siniestro mal cubierto mata la confianza y la marca. **[Riesgo alto — resolver con legal/seguros antes de Fase 1.]**
- **Documentos sensibles:** el producto sube cédulas/licencias a carpeta pública (deuda conocida en `PROYECTO.md` §6.3) — riesgo reputacional/legal; coordinar con `auditor-seguridad` antes de campañas que traigan volumen.
- **Calidad de oferta:** crecer rápido sin verificar = disputas = NPS cae = loop se rompe. Por eso el NSM es *reserva completada*, no reserva iniciada.
- **Concentración de temporada:** dependencia de picos (Feria, diciembre); mitigar con demanda de nómadas (recurrente, no estacional) y B2B.

---

## 10. Resumen de decisiones clave
1. **Oferta primero, El Poblado primero.** Sembrar 30–40 carros verificados por micro-zona antes de empujar demanda.
2. **NSM = reservas completadas/semana en Medellín.** Todo lo demás cuelga de ahí.
3. **Tres loops:** referido propietario→propietario (el más valioso), referido usuario→usuario, y contenido/SEO local.
4. **Fases con criterios de salida basados en confianza,** no en vanidad. No escalar con NPS bajo.
5. **Alianzas que dan oferta o demanda en la zona sembrada van primero:** JMC, hoteles El Poblado, parqueaderos, comunidades de nómadas.
6. **Promos de primeras-veces y garantía,** no descuentos que erosionen el premium.
7. **Foso = liquidez local + marca paisa + confianza + contenido.** Así se gana y se defiende el #1 contra Eva.

---

## Fuentes
1. El Colombiano — "Medellín rompe récord de 1,2 millones de turistas extranjeros en 2025": https://www.elcolombiano.com/medellin/record-historico-rompe-medellin-en-turismo-BA33331330
2. Medellín en Línea — "Turismo Medellín 2025: cifras clave y récord histórico": https://www.medellinenlinea.com/entretenimiento/turismo/cifras-turismo-medellin-2025/
3. Contrary Research — "Turo Business Breakdown & Founding Story" (siembra de oferta, 10.000 volantes, Baltimore; cierre de Getaround EE.UU. 2025): https://research.contrary.com/company/turo
4. Lenny Rachitsky / Andrew Chen — "28 ways to grow supply in a marketplace" y Jonathan Golden — "Lessons Learned Scaling Airbnb 100X" (número mágico ~300 listings, reclutamiento a mano): https://andrewchen.com/grow-marketplace-supply/ · https://medium.com/@jgolden/lessons-learned-scaling-airbnb-100x-b862364fb3a7
5. Turo — Host Incentive / Refer-a-host (pago al completar 3 trips) y Eva (Semana) — funcionamiento, seguro Sura, precios desde $82.000/día, placa amarilla, modelo 2009+: https://turo.com/au/en/car-rental/australia/refer-a-host · https://www.semana.com/tecnologia/articulo/eva-aplicacion-para-arrendar-carros/274112/
6. El Colombiano / Infobae — Feria de las Flores 2026 (31 jul–9 ago), ocupación hotelera 77–81%, US$68M con Colombiamoda: https://www.elcolombiano.com/negocios/feria-de-flores-y-colombiamoda-impacto-economico-medellin-68-millones-dolares-JK28444049 · https://www.colombia.com/turismo/noticias/donde-hospedarse-en-medellin-para-la-feria-de-las-flores-2026-586745
7. InvestWE / El Colombiano — "Medellín recibe ~8.000–8.300 nómadas digitales al mes": https://investwe.co/medellin/medellin-recibe-8-000-nomadas-digitales-al-mes-y-se-consolida-como-epicentro-global-para-trabajadores-itinerantes/ · https://www.elcolombiano.com/medellin/nomadas-digitales-que-llegan-a-medellin-cada-mes-CF24741641
8. El Tiempo / Holafly — gasto del nómada digital US$1.500–3.500/mes, estancia 1–3 meses, zonas El Poblado/Provenza/Laureles: https://www.eltiempo.com/colombia/medellin/las-millonarias-cifras-que-dejan-los-nomadas-digitales-en-medellin-3356588
9. La FM — "Nueva app para dueños de carros en Colombia: puede ganar hasta $600.000 al día" (referencia de gancho de prensa sobre ingresos de propietarios): https://www.lafm.com.co/tecnologia/nueva-app-para-duenos-de-carros-en-colombia-puede-ganar-hasta-600000-al-dia
- Mercado rent-a-car Colombia/Medellín (Localiza 14.406 contratos en Medellín 2025; 52% concentrado en 3 ciudades): https://www.elcarrocolombiano.com/notas-de-interes/alquiler-carros-colombia-ciudades-turismo-2025/
