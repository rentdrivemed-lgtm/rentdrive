# Captación y retención de PROPIETARIOS — DrivePass Medellín

> Entregable del agente **captacion-propietarios**. Lado oferta del marketplace.
> Marca: **DrivePass / RentDrive** (mismo producto). Tono de marca: tuteo, verbos de acción, frases cortas, empoderador ("Conduce libre"). Acento naranja `#FF6B35` solo en CTAs.
> Fecha: 2026-06-05. Aterrizado a Medellín / Colombia.
>
> **Convención de supuestos:** todo lo marcado **[SUPUESTO]** es estimación del agente, no dato confirmado del producto ni cifra verificada de mercado. Validar antes de publicar cifras al mercado. Las cifras de competidores y de ley sí están citadas con fuente.

---

## 0. Por qué este lado importa (y por qué es el difícil)

Sin carros publicados no hay catálogo, sin catálogo no hay reservas, sin reservas no llegan más dueños. Es el problema del huevo y la gallina del marketplace, y **la oferta es el cuello de botella**: conseguir un dueño que confíe su carro a un desconocido es 10x más difícil que conseguir a alguien que quiera alquilar.

**Dato que ancla toda la propuesta de valor:** un carro particular pasa estacionado entre el **92% y el 97% de su vida útil** (cifras UITP/UCLA citadas por Semana). En Colombia mantener un carro de gama media cuesta **~$1,7 millones/mes (~$20M/año)**, y solo el parqueadero va de **$250.000 a $400.000/mes** (Semana, Portafolio). Es un activo caro que produce cero la mayor parte del tiempo. **Ese es el dolor que monetizamos.**

Fuentes: ver §11.

---

## 1. Cómo lo hacen los referentes (benchmark)

Resumen de la investigación; detalle y fuentes en §11.

| Plataforma | Reparto al host | Seguro durante el viaje | Gancho de captación | Retención |
|---|---|---|---|---|
| **Turo** (USA) | Host se queda **65–90%** según plan de protección elegido (planes "60/70/80/90"; más comisión a Turo = menos deducible) | Responsabilidad hasta **USD 750k** (USD 1,25M en NY), automático cada viaje; **no** cubre fuera de viaje | **USD 1.000 por carro publicado** (programa por invitación) + **USD 75 por referir un host** + USD 25 por referir guest | Loyalty (día bonus cada 10 días de viaje en 90 días); planes que dejan al host elegir riesgo vs ingreso |
| **Getaround** (USA/EU) | Host se queda **60%**; el 40% cubre seguro, screening, soporte 24/7 | Responsabilidad host hasta **USD 1M** + cobertura tipo todo riesgo durante el viaje; no cubre desgaste normal | Hardware **Connect** (sin entrega de llaves) + **garantía de ingresos** para power hosts | **Power Host program**: gerente de cuenta dedicado, mapas de calor de demanda, parqueaderos reservados, soporte 24/7 → los flotilleros crecen su flota |
| **Eva** (Colombia 🇨🇴) | Eva toma **10–20%** + el seguro; paga al dueño **semanal** | **Seguro todo riesgo SURA** obligatorio, inspección en centro SURA, **lo paga Eva** | "Gana **$120.000–$600.000 al día** con tu carro" (titulares LaFM/Semana) | Filtro riguroso de arrendatarios (Procuraduría, Policía, antecedentes, comparendos); requisitos de vehículo modelo ≥2009, papeles al día |

**Lecciones para DrivePass:**
1. **El seguro/garantía es EL argumento, no un detalle.** Eva lo resolvió haciendo que la póliza SURA todo riesgo la pague la plataforma. Es la primera objeción del dueño colombiano y la barrera de entrada del mercado.
2. **El bono por publicar funciona** (Turo paga hasta USD 1.000/carro). En early stage, pagar por oferta es inversión, no gasto.
3. **Dar control al dueño** (elegir plan/riesgo/precio/disponibilidad) reduce el miedo a "perder el control de mi carro".
4. **Pagos rápidos y predecibles** (Eva semanal, Getaround día 15) son retención pura.
5. **Trato preferente a los que tienen 2+ carros** (Power Host) es donde está el crecimiento de oferta de bajo costo de adquisición.

---

## 2. Propuesta de valor para el propietario

### 2.1 Una frase
> **"Tu carro trabaja por ti. Tú pones las reglas, nosotros ponemos la protección."**

Alternativas de campaña (tono de marca, ≤12 palabras):
- *"Tu carro parqueado no paga el parqueadero. Publicado, sí."*
- *"Gana con tu carro los días que no lo usas."*
- *"Tú decides el precio, los días y a quién. Nosotros cubrimos el resto."*

### 2.2 Funcional + emocional

| Eje | Funcional (qué obtiene) | Emocional (qué siente) |
|---|---|---|
| **Ingreso** | Renta su carro ocioso y cubre cuota/seguro/parqueadero | Alivio: "el carro dejó de ser un hueco en el bolsillo" |
| **Control** | Fija precio, días disponibles, lugar de recogida, y **acepta o rechaza** cada solicitud | Tranquilidad: "sigue siendo MI carro, yo mando" |
| **Protección** | Verificación del arrendatario, contrato firmado, depósito, fotos antes/después | Seguridad: "si algo pasa, tengo cómo responder" |
| **Cero fricción** | Publica en minutos, soporte local en Medellín, pagos a su cuenta | Confianza: "hay gente real detrás, no una app fantasma" |
| **Pertenencia** | Comunidad de dueños, niveles, reportes de ingresos | Orgullo: "soy anfitrión DrivePass" |

### 2.3 Cada miedo → respuesta concreta (mercadeando lo que YA existe)

DrivePass **ya tiene** en producto: verificación de documentos/licencia, contrato firmado (firma_contrato), depósito, fotos antes/después (fotos_antes/fotos_despues), chat propietario↔usuario, y reglas de pico y placa. Hay que **mercadearlo como argumentos de venta**.

| Miedo del dueño colombiano | Respuesta de venta DrivePass | En qué se apoya (producto/ley) |
|---|---|---|
| **"Me dañan el carro"** | Fotos obligatorias del estado **antes y después** de cada reserva. Evidencia con fecha que protege al dueño en cualquier reclamo. | `fotos_antes` / `fotos_despues` por reserva (PROYECTO §3) |
| **"No me responden por los daños"** | **Depósito de garantía** retenido + contrato firmado que define responsabilidades. **[SUPUESTO/recomendación]:** cerrar una **póliza todo riesgo para alquiler** (SURA/HDI/Sura-aliado) como hizo Eva — hoy NO está en el código; es el #1 a resolver para competir. | Depósito + `firma_contrato` existen. La póliza es brecha a cerrar (ver §6 y §10) |
| **"Quién es el que va a manejar mi carro"** | **Verificación de identidad y licencia** del arrendatario antes de aprobar. **Tú apruebas o rechazas** cada solicitud desde el chat. | Documentos/licencia verificados, rol y aprobación del propietario (PROYECTO §3–4) |
| **"Me dejan las fotomultas / comparendos"** | En Colombia, por la **Sentencia C-321/2022**, las multas del conductor las paga **el conductor identificado**; el propietario responde solo por estado/papeles del carro (SOAT, tecnomecánica). El **contrato DrivePass identifica al arrendatario** como conductor responsable durante la reserva. **[SUPUESTO]:** habilitar **plazo de fotomultas** (retener depósito X días tras devolución para cubrir comparendos que llegan tarde). | Marco legal citado (§11); plazo de fotomultas = recomendación de producto |
| **"Y si no me lo devuelven / se lo roban"** | Verificación + contrato (validez legal **Ley 527 de 1999**, firma electrónica) + depósito. **[SUPUESTO/recomendación]:** cobertura de hurto vía póliza de alquiler (como SURA en Eva). | Contrato firmado existe; hurto depende de póliza (brecha) |
| **"Es un enredo, no tengo tiempo"** | Publicas en **minutos** con el celular. Soporte local te ayuda con fotos y precio. Tú no haces nada más que aprobar y recibir el pago. | Onboarding guiado (§7) |
| **"No sé cuánto cobrar / si vale la pena"** | **Calculadora de ingresos**: te decimos cuánto puedes ganar con TU carro este mes (§4). | Feature propuesto (§4) |

> **Honestidad obligatoria de marca:** no prometer "seguro todo riesgo" en copy hasta que la póliza esté contratada. Hoy el argumento sólido y veraz es **verificación + contrato (Ley 527) + depósito + fotos antes/después + plazo de fotomultas**. Mientras la póliza no exista, el copy debe decir "protección" y describir esos mecanismos, no "seguro". Marcar esto en rojo para el equipo legal/producto.

---

## 3. Segmentación de propietarios (mensaje + canal)

| Segmento | Quién es | Dolor / motivación | Mensaje (gancho) | Canal principal |
|---|---|---|---|---|
| **1. Particular con carro ocioso** | Asalariado/independiente, 1 carro, lo usa fines de semana o casi no | Cuota + seguro + parqueadero le pesan; carro parado | *"Tu carro pasa parqueado el 90% del tiempo. Que al menos pague su parqueadero."* | Facebook/Instagram pauta segmentada Medellín; grupos de barrios |
| **2. Dueño de 2º carro** | Familia con carro extra, heredado o "para cuando se necesite" | Segundo carro produce cero, ocupa garaje | *"¿Un carro de más en la casa? Conviértelo en ingreso sin venderlo."* | Marketplace FB, grupos de compraventa, referidos |
| **3. Pequeñas flotas / inversionistas** | 2–8 carros, busca rentabilidad, ya piensa en negocio | Quiere maximizar ocupación y ROI | *"Tu flota, ocupada. Reportes, soporte y prioridad de demanda."* (programa tipo Power Host) | LinkedIn, WhatsApp directo, alianzas con concesionarios |
| **4. Conductores de plataformas** (Uber/DiDi/InDrive) | Ya monetizan su carro, mentalidad de negocio, sin miedo a "prestar" el carro | Días que no manejan = cero ingreso; pico y placa los frena | *"Los días que no rueda en app, que ruede en DrivePass."* | Grupos de conductores FB/WhatsApp, comunidades, paraderos |
| **5. Concesionarios / seminuevos** | Lote con inventario parado esperando venta | Inventario cuesta tener; carros parados = capital muerto | *"Tus seminuevos en exhibición, generando renta mientras se venden."* | Visita comercial B2B directa, alianzas |
| **6. Diáspora / dueño ausente** | Vive fuera o viaja, dejó el carro en Medellín | Carro parado meses, cero supervisión | *"¿Tu carro en Medellín mientras tú no estás? Que produzca, nosotros lo cuidamos."* | Pauta geo-targeting, grupos de colombianos en el exterior |

**Prioridad de captación early stage:** 4 (conductores de plataforma) y 2 (segundo carro) → menor miedo, mentalidad de monetización ya formada, conversión más rápida. Luego 3 (flotas) por volumen de oferta. 1 y 6 con pauta a escala.

---

## 4. Calculadora de ingresos (gancho principal) — propuesta de feature

**Idea:** widget público (sin login) "**¿Cuánto puedes ganar con tu carro?**". Es el imán de captación de oferta y el primer paso del embudo.

**Cómo funciona (UX):**
1. El dueño elige **marca / modelo / año** (o escribe su placa → autocompleta [SUPUESTO: requiere catálogo o integración RUNT, fuera de alcance v1; en v1 selección manual]).
2. Opcional: **días disponibles al mes** (slider) y **ubicación** (reusar `lib/lugares.ts`).
3. Resultado: **rango de ingreso mensual estimado** + "lo que dejas de ganar cada mes que tu carro está parado".
4. CTA naranja: **"Publicar mi carro"** → registro/onboarding.

**Lógica de estimación [SUPUESTO — calibrar con datos reales]:**
- Precio/día sugerido por gama (anclado a mercado Eva $82.000+/día usuario y a `precio_dia` del catálogo propio).
- Ocupación estimada conservadora: **8–12 días/mes** en early stage (no prometer 30).
- Ingreso = precio/día × días × (1 − comisión). Mostrar **rango** (pesimista–optimista), nunca un número único.
- Ejemplo de copy de resultado (gama media, ~$110.000/día, 10 días, comisión introductoria 0%):
  > **"Tu Mazda 3 podría generarte ~$880.000 – $1.320.000 al mes.**
  > Hoy, parqueado, te genera $0 — y te cuesta. Publícalo gratis."*
- **Honestidad:** etiqueta visible "Estimación, no garantía. Depende de demanda, tu precio y disponibilidad." (clave de confianza de marca).

**Copy del gancho (hero del widget):**
> ### ¿Cuánto puede ganar tu carro?
> Tu carro pasa parqueado casi todo el tiempo. Calcula en 10 segundos lo que podrías ganar con DrivePass — tú pones el precio y los días.
> **[ Calcular mis ingresos ]**

**Para implementación:** descrito para evaluación del usuario; lo ejecuta `implementador-rentdrive`. Reusa `lib/lugares.ts`; nuevo endpoint `GET /api/calculadora` con tabla de tarifas por gama; página pública `/gana-con-tu-carro` (buena para SEO local → coordinar con `estratega-seo`).

---

## 5. Embudo de captación (con fricciones y cómo reducirlas)

`Conciencia → Interés → Registro → Publicación → Verificación → Primera reserva → Recurrencia`

| Etapa | Qué pasa | Fricción real | Cómo reducirla |
|---|---|---|---|
| **Conciencia** | "No sabe que existe" | Categoría nueva, desconfianza al concepto P2P | Pauta + prueba social ("X carros ya publicados en Medellín") + casos de dueños reales |
| **Interés** | "¿Cuánto gano? ¿es seguro?" | Duda de ingreso y de riesgo | **Calculadora (§4)** + página "Protección para tu carro" con los 5 miedos resueltos (§2.3) |
| **Registro** | Crea cuenta como propietario | Otro registro más, pereza | Registro mínimo (nombre, correo, celular). **Empezar por la calculadora, no por el formulario.** Login social [SUPUESTO: no implementado hoy] |
| **Publicación** | Sube carro: fotos, precio, días, documentos | **La fricción #1.** Fotos buenas, fijar precio, subir SOAT/tecnomecánica/tarjeta | (a) **Precio sugerido automático** por la calculadora; (b) guía de fotos en 6 tomas / **servicio de foto asistido** en Medellín; (c) checklist de documentos claro con estados (ya existe `documentos_estado`); (d) guardar borrador y terminar después |
| **Verificación** | Admin revisa documentos del carro | Espera/incertidumbre ("¿me aprobaron?") | SLA visible **"revisamos en <24h"** + notificación (ya existe `notificaciones`) + estado en dashboard. Acompañamiento humano por WhatsApp |
| **Primera reserva** | Llega y acepta su 1ª solicitud | Si no llega demanda, abandona | **Garantía "primera reserva o te ayudamos"** (§6); destacar carros nuevos en el catálogo; empujar demanda hacia oferta nueva |
| **Recurrencia** | Mantiene el carro publicado y repite | Mala experiencia, pago lento, una mala reserva | Pago rápido, reporte de ingresos, soporte local, niveles (§8) |

**Métrica estrella del embudo:** **% de registrados que llegan a su primera reserva** (activación real). Es la que define si el lado oferta vive o muere.

---

## 6. Estructura de incentivos

> Inversión de adquisición de oferta. En marketplace early stage, **pagar por oferta es CAC, no gasto**. Cifras **[SUPUESTO]** — calibrar con presupuesto y unit economics reales.

1. **Comisión introductoria 0% los primeros 2–3 meses** (o primeras 3 reservas) por carro nuevo.
   - Copy: *"Publica hoy: te quedas con el 100% de tus primeras reservas."*
   - Después, comisión estándar. **[SUPUESTO]:** estándar **15–20%** (rango de Eva 10–20%; Getaround 40%, Turo 10–35%). Ajustar según costo de la póliza cuando exista.
2. **Bono por primer carro publicado y verificado:** **[SUPUESTO]** bono en efectivo o crédito (p. ej. $80.000–$150.000) al verificarse el carro y quedar activo. Inspirado en el USD 1.000/carro de Turo, escalado a Colombia y a presupuesto early stage.
3. **Garantía "primera reserva o te acompañamos":** si en 30 días no recibe reserva, el equipo revisa precio/fotos/disponibilidad y **promociona su carro** (destacado en home / pauta dirigida). Inspirado en el *host earnings guarantee* de Getaround.
4. **Programa de referidos entre propietarios:** dueño que trae a otro dueño que **publica y verifica** → bono para ambos. **[SUPUESTO]** $100.000 c/u (modelo Turo USD 75 por host referido).
   - Copy: *"¿Conoces a otro dueño con el carro parado? Tráelo y ganan los dos."*
5. **Power Host / niveles** (retención, §8): comisión decreciente y beneficios por volumen y buen comportamiento.

**Regla de oro:** los bonos se pagan contra **acciones que crean valor real** (carro verificado y activo, primera reserva cumplida), no contra registros vacíos — evita fraude de incentivos.

---

## 7. Onboarding y activación (hasta la primera reserva)

**Objetivo:** que un dueño que se registra **publique un carro verificado y consiga su primera reserva lo más rápido posible.** Todo lo demás es secundario.

**Flujo recomendado (producto + acompañamiento):**
1. **Bienvenida inmediata** (WhatsApp + notificación in-app): "Hola, soy tu anfitrión DrivePass en Medellín. Te ayudo a publicar tu carro hoy."
2. **Asistente de publicación paso a paso** con barra de progreso (estilo "completa tu perfil al 100%"):
   - Datos del carro → **precio sugerido** (calculadora) → **días disponibles** (`CalendarioDisponibilidad`) → **fotos** (guía 6 tomas) → **documentos** (`DocUpload`, estados claros).
3. **Servicio de fotos asistido** en Medellín [SUPUESTO/operativo]: aliado o promotor toma fotos pro de los primeros carros. Mejor foto = más reservas = dueño feliz que se queda. Alto ROI en early stage.
4. **Verificación rápida con SLA visible** (<24h) y notificación de aprobación.
5. **Empujón a la primera reserva:** carros nuevos marcados **"Nuevo en DrivePass"** y priorizados; campañas de demanda dirigidas a oferta recién publicada; al dueño se le avisa cómo aceptar su primera solicitud desde el chat.
6. **Checklist de activación gamificado:** "Publicaste ✓ · Verificado ✓ · Primera reserva ⏳" con micro-recompensas.

**Recomendaciones de producto para `implementador-rentdrive`:**
- Barra de progreso de publicación con guardado de borrador.
- Badge **"Nuevo"** y ordenamiento que dé visibilidad a carros recién publicados (con tope para no canibalizar a los buenos).
- Plantilla de **mensaje de bienvenida** automatizado al rol propietario vía `notificaciones` + enlace WhatsApp.
- **Estado del carro siempre visible** en dashboard propietario (en revisión / activo / con reserva).

---

## 8. Retención (por qué se queda y no se va a Eva/Turo)

| Palanca | Qué hacer | Por qué retiene |
|---|---|---|
| **Pago rápido y predecible** | **[SUPUESTO]** pago semanal a cuenta del dueño (Eva paga semanal; Getaround día 15). Dashboard de ingresos transparente. | El dinero a tiempo es la retención #1 |
| **Reporte de ingresos** | Resumen mensual: cuánto ganó, ocupación, comparación con su gama. Reusar `lib/export.ts` (PDF/Excel ya existe). | El dueño ve el valor y sube disponibilidad |
| **Soporte LOCAL** | Equipo en Medellín, WhatsApp, respuesta rápida en español. Frente a Turo (sin operación local). | Confianza > app fría sin cara |
| **Protección que se siente** | Comunicar cada reserva protegida: "viaje verificado, contrato firmado, fotos OK". Resolver bien el primer incidente. | Un incidente mal manejado = dueño perdido para siempre |
| **Niveles / Power Host** | Bronce→Plata→Oro por reservas completadas y calificación: comisión decreciente, prioridad de demanda, mapas de demanda, soporte prioritario, parqueadero aliado. (modelo Getaround Power Host) | El que tiene 2+ carros es el de mayor valor; hay que premiarlo |
| **Comunidad** | Grupo de anfitriones DrivePass (WhatsApp/eventos), casos de éxito, tips de precio y temporada. | Pertenencia emocional (arquetipo Explorador/Héroe de marca) |
| **Optimización proactiva** | Avisar al dueño: "baja $5.000 tu tarifa este finde y te reservan", alertas de pico y placa (`lib/pico-placa.ts`), temporadas altas. | El dueño siente que la plataforma trabaja PARA él |

**Ventaja defendible vs. Turo/Eva:** **operación y soporte local en Medellín + acompañamiento humano + comunidad.** Turo no tiene presencia local real en Colombia; Eva es nacional y más impersonal. DrivePass puede ganar en cercanía y confianza barrial.

---

## 9. Canales para llegar a dueños en Medellín

**Digitales:**
- **Facebook Marketplace + grupos de compraventa de autos Medellín/Antioquia** (donde ya están los dueños vendiendo/mostrando carro). Mensaje: en vez de vender, renta.
- **OLX / TuCarro / CarroYa:** dueños que publican para vender → pauta/retargeting "¿y si en vez de venderlo lo rentas?".
- **Pauta segmentada FB/IG/Google** geo-Medellín, por intereses (dueños de carro, Uber/DiDi, finanzas personales). Landing = **calculadora**.
- **Grupos y comunidades de conductores de plataforma** (Uber/DiDi/InDrive) en FB/WhatsApp/Telegram.
- **TikTok/Reels:** "cuánto gané con mi carro este mes" (prueba social, tono de marca).
- **SEO local:** página `/gana-con-tu-carro` y `/propietarios` (coordinar con `estratega-seo`, JSON-LD, "alquilar mi carro en Medellín").

**Físicos / presenciales (alta confianza, clave en Colombia):**
- **Parqueaderos y edificios residenciales** (volantes/QR a la calculadora; carros parados = lead perfecto).
- **Lavaderos, talleres, montallantas, centros de diagnóstico (CDA)** donde el dueño espera con tiempo muerto.
- **Concesionarios y lotes de seminuevos** (alianza B2B, segmento 5).
- **Aseguradoras / corredores** (cross-sell a quien acaba de asegurar su carro).
- **Referidos** (§6) — el canal más barato y de mayor confianza en cultura colombiana.

**Mensaje base por canal:** siempre lleva a la **calculadora** (no a un formulario seco). El número personalizado es el que convierte.

---

## 10. Brechas de producto a cerrar (priorizadas)

| # | Brecha | Impacto | Quién |
|---|---|---|---|
| 1 | **Póliza todo riesgo para alquiler** (SURA/HDI/aliado) que la plataforma gestione, como Eva | **Bloqueante competitivo.** Es la objeción #1 del dueño colombiano | Legal/negocio + producto |
| 2 | **Calculadora de ingresos** pública (§4) | Imán de captación de oferta + SEO | `implementador-rentdrive` |
| 3 | **Plazo de fotomultas** (retener depósito X días post-devolución) | Cierra el miedo a comparendos tardíos | producto |
| 4 | **Pagos al propietario** (semanal, dashboard de ingresos) | Retención | producto/negocio |
| 5 | **Asistente de publicación + badge "Nuevo" + SLA verificación** | Activación (embudo §5–7) | `implementador-rentdrive` |
| 6 | **Programa de referidos** entre propietarios (tracking de bonos) | CAC bajo | producto |

> Mientras la **póliza (#1)** no exista, el copy NO puede prometer "seguro todo riesgo": vender **verificación + contrato Ley 527 + depósito + fotos antes/después + plazo de fotomultas**. Honestidad de marca > conversión cortoplacista.

---

## 11. Fuentes

**Competidores / hosts:**
- Turo — planes de protección y reparto al host: https://help.turo.com/en_us/detailed-explanation-of-protection-plans-or-us-hosts-ByMOIVxEc · https://turo.com/us/en/car-rental/united-states/insurance
- Turo — incentivo USD 1.000/carro y referidos host USD 75: https://referraloffer.com/turo-sign-up-bonus · https://turo.com/us/en/car-rental/united-states/guest-to-host-incentive-terms
- Getaround — reparto 60%, seguro hasta USD 1M, Power Host: https://getaround.com/help/articles/1453c295ca9b · https://getaround.com/insurance · https://www.autorentalnews.com/10143825/16-questions-for-getaround
- Getaround — earnings guarantee: https://go.getaround.com/power-hosts/2022-getaround-host-earnings-guarantee-v1

**Eva (Colombia):**
- Cómo funciona, seguro SURA todo riesgo pagado por Eva, requisitos, filtros, reparto 10–20%, pago semanal, ingreso $50.000–$300.000/día: https://www.semana.com/tecnologia/articulo/eva-aplicacion-para-arrendar-carros/274112/
- Ingreso hasta $600.000/día, ciudades (incl. Medellín): https://www.lafm.com.co/sociedad/nueva-app-para-duenos-de-carros-gane-hasta-600-000-al-dia-364717 · https://www.larepublica.co/empresas/eva-la-app-de-alquiler-de-carros-llegara-a-santa-marta-y-cartagena-este-ano-2874088

**Colombia — mercado y mentalidad del dueño:**
- Carro parqueado 92–97% de su vida útil: https://www.semana.com/vehiculos/articulo/cuanto-dura-un-carro-estacionado-durante-toda-su-vida-pasa-mas-parqueado-que-en-las-carreteras/202416/
- Costo de tener carro (~$1,7M/mes; parqueadero $250–400k/mes): https://www.semana.com/finanzas/consumo-inteligente/articulo/cuanto-cuesta-mantener-un-carro-en-colombia-estos-son-los-costos/202315/ · https://www.portafolio.co/negocios/vehiculo/esto-cuesta-tener-un-carro-en-colombia-al-dia-al-mes-y-al-ano-segun-experto-601574
- Seguros P2P todo riesgo SURA (Rennty/Reizen): https://www.semana.com/emprendimiento/articulo/rennty-plataforma-para-alquilar-carros-en-colombia/264084/ · https://alquilerdecarrosencolombiasintarjeta.com/

**Fotomultas / comparendos (responsabilidad propietario vs conductor, Sentencia C-321/2022):**
- https://www.semana.com/vehiculos/articulo/quien-paga-la-multa-el-conductor-o-el-propietario-del-carro-esto-dice-la-ley-en-colombia/202641/
- https://www.eltiempo.com/justicia/servicios/las-fotomultas-son-responsabilidad-directa-del-propietario-del-vehiculo-en-caso-de-no-identificar-al-infractor-3497601
- https://www.medellin.gov.co/es/sala-de-prensa/noticias/fin-de-la-impunidad-los-propietarios-de-vehiculos-deberan-asumir-la-responsabilidad-por-fotodetecciones/

**Producto DrivePass:** `rentdrive/PROYECTO.md` (flujo propietario, documentos/verificación, depósito, fotos antes/después, contrato, chat, pico y placa, calendario de disponibilidad). **Marca:** `Imagen de marca/Identidad_de_Marca_RentDrive.md` (tono, paleta, arquetipo Explorador/Héroe, "Conduce libre").
