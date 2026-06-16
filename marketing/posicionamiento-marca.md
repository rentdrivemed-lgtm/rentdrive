# DrivePass — Estrategia de Posicionamiento de Marca

> **Objetivo del fundador:** no ser bueno, ser **EL #1** del alquiler de vehículos en Medellín.
> **Categoría:** alquiler de carros **P2P** (entre particulares), Medellín / Área Metropolitana + aeropuerto JMC (Rionegro).
> **Autor:** agente `estratega-marca`. **Fecha:** 2026-06-05.
> Coherente con `Imagen de marca/Identidad_de_Marca_RentDrive.md` y el `DrivePass Design System`. Cita fuentes al final.

---

## 0. Resolución del nombre oficial (decisión, no debate)

El proyecto vive con una esquizofrenia de marca: el **código y la identidad escrita** dicen *RentDrive*; el **producto público, el logo, el design system y el dominio implícito** dicen *DrivePass* (`drivepass_lugares`, cache `drivepass-v2`, `acceso-drivepass`, `LogoWordmark` con texto "DrivePass", README del DS titulado "DrivePass — Design System").

**Recomendación: el nombre oficial de cara al mercado es `DrivePass`.** Razones:

1. **El frente ya está construido sobre DrivePass.** El logo vectorial, los íconos PWA, el manifest (`background_color #0A1422`), el wordmark, las páginas de acceso y el design system completo dicen DrivePass. Revertir a "RentDrive" significa rehacer activos terminados; mantener DrivePass solo exige limpiar referencias internas de código.
2. **DrivePass es un activo de categoría, no solo un nombre.** "Pass" = pase/membresía/acceso habilitante. Encaja con el arquetipo Explorador+Héroe ("las llaves que te habilitan") y abre de forma natural un **programa de fidelización / membresía** (DrivePass Plus, beneficios, acceso prioritario) que "RentDrive" no sugiere. La propia identidad lo reconoce: DrivePass "suena a app moderna y sistema de beneficios… potencial para programa de fidelización".
3. **Diferenciación fonética frente a Turo/Eva/Localiza.** "RentDrive" colisiona con el genérico "rent a car" y con "Rent**c**ars", "Rentadora", etc. (ruido SEO altísimo en Medellín). "DrivePass" es un término más propietario y registrable.
4. **RentDrive describe la transacción; DrivePass describe el beneficio.** Las marcas #1 nombran el beneficio, no el trámite (Turo nombra aventura, no "alquiler"). DrivePass nombra el acceso, no el papeleo.

**RentDrive queda como nombre técnico legado** (nombre de repo, archivo `rentdrive.db`, correos semilla `@rentdrive.com`). No es urgente migrarlo, pero el plan de acción es:

| Acción | Prioridad | Impacto |
|---|---|---|
| Registrar `drivepass.co` / `.com.co` y handles `@drivepass` (IG, TikTok, FB, WhatsApp Business) | **Alta** | Dominio + redes coherentes |
| Búsqueda de antecedentes marcarios en SIC (Superintendencia de Industria y Comercio) clase Niza 39 (transporte/alquiler) y 42 (software) | **Alta** | Riesgo legal de registro |
| Unificar copy público a DrivePass (ya en su mayoría hecho) | Media | Coherencia de marca |
| Migrar correos semilla y `@rentdrive.com` a `@drivepass.co` | Baja | Limpieza interna |
| Renombrar repo/DB/cookies internas | Baja (cosmético) | Higiene de código |

> Verificar disponibilidad real del dominio y del registro marcario antes de imprimir nada. No se validó disponibilidad en esta entrega.

---

## 1. Diagnóstico de categoría

### 1.1 Mapa competitivo (cómo se posiciona cada líder)

| Marca | Modelo | Posicionamiento real | Mensaje núcleo | Fortaleza | Hueco que deja |
|---|---|---|---|---|---|
| **Turo** | P2P global | "Rent cars *better*" / "Find your drive" / "Open the door to extraordinary". Eleva el carro de commodity a **protagonista del viaje**. Valores: Grounded, Expressive, Bold, Driven. Visión: "un mundo donde todos los carros se comparten". | Aventura + variedad de inventario único | Marca, escala, seguro Travelers ($750k), screening de huéspedes, soporte 24h | **No opera fuerte/local en Medellín**; cero contexto colombiano (pico y placa, aeropuerto JMC, paisa) |
| **Getaround** | P2P, foco urbano | "Empowering people to carshare everywhere". **Acceso sobre propiedad.** Diferenciador técnico: *unlock remoto* (sin entrega de llaves), alquiler por horas, check de daños antes/después, doble reseña. | Conveniencia instantánea, self-service | Tecnología (cerradura conectada), micro-movilidad urbana | Requiere hardware en cada carro; **no existe en Colombia**; frío, transaccional |
| **Localiza** | Flota propia (tradicional) | "Independencia y autonomía". Red más grande de LATAM, 19 ciudades CO, +41 agencias, **4,7/5 en Medellín**. Cambio de carro, sin preocuparte de mantenimiento/seguro. | Respaldo, escala, confiabilidad corporativa | Cobertura aeroportuaria, flota nueva, marca sólida | **Caro, corporativo, impersonal, inventario homogéneo**; experiencia de mostrador, no de comunidad |
| **Eva** | P2P, Colombia | "Democratiza el uso del carro" / economía colaborativa, marco legal. Verificación dura con **DataCrédito** (20–40 min: licencia, judicial, crediticio), **seguro todo riesgo Sura**, inspección en centro Sura. Opera Bogotá/Cali/Medellín. | Confianza legal + seguro Sura | Es el competidor P2P **directo y local** más serio; arquitectura de confianza fuerte | **Fricción de onboarding (ir a Sura, 20–40 min), UX poco premium, expansión a varias ciudades = foco diluido**, marca tibia |

### 1.2 Lectura estratégica

- El **enemigo a vencer en Medellín no es Turo** (no juega local) sino **Eva** (P2P local con confianza vía Sura/DataCrédito) y **Localiza** (la opción "segura" por defecto del turista/ejecutivo).
- Los tradicionales (Localiza, Sixt, Alamo, rentadoras locales) ganan por **confianza** pero pierden por **precio, rigidez y frialdad**. Los P2P (Eva) ganan por **precio y variedad** pero pierden por **fricción y miedo al fraude**.
- **El espacio libre es el cruce que nadie ocupa bien en Medellín:** *la confianza de un tradicional con el precio/variedad de un P2P, hablado en paisa y diseñado como producto premium.* Eva tiene la confianza pero no el premium ni el foco-Medellín; Turo tiene el premium pero no está aquí; Localiza tiene el respaldo pero no es P2P ni cercano.

### 1.3 Ángulo ganador (recomendación)

**No competir como "alquiler tradicional barato". Crear y liderar una categoría local:**

> ### **El alquiler entre paisas: premium, verificado y sin mostrador.**

DrivePass no es "Turo de Medellín" ni "Eva más barato". Es **la red de carros de los paisas para los paisas (y para quien llega a Medellín)**: cada carro tiene dueño con nombre y cara, cada parte está verificada, cada entrega está documentada, y todo el contexto local (pico y placa, recogida en JMC, barrios del Área Metropolitana) viene resuelto de fábrica. Defendible porque combina **hiperlocalidad + premium + confianza P2P**, una esquina que ningún líder global puede copiar rápido y ningún tradicional quiere ocupar.

---

## 2. Statements de posicionamiento

*(Formato: Para [segmento] que [necesidad], DrivePass es [categoría] que [beneficio diferencial], a diferencia de [competencia], porque [razón para creer].)*

### 2.1 Arrendatario (usuario que reserva)

> **Para** viajeros, ejecutivos y paisas que necesitan moverse por Medellín y Antioquia sin la rigidez, el precio inflado y el mostrador de las rentadoras tradicionales,
> **DrivePass es** la red de alquiler de carros entre particulares de Medellín —premium y verificada—
> **que** te da el carro que quieres, con dueño real, recogida hasta en el aeropuerto y el pico y placa ya resuelto, en minutos y desde la app,
> **a diferencia de** Localiza (caro y de mostrador) y de Eva (lenta de verificar y poco cuidada),
> **porque** cada carro y cada persona están verificados, cada viaje queda documentado con fotos antes/después y contrato firmado, y el soporte es local y habla tu idioma.

### 2.2 Propietario (dueño que publica)

> **Para** dueños de carro en Medellín que tienen su vehículo parado depreciándose y quieren ingresos extra sin volverlo un dolor de cabeza,
> **DrivePass es** la plataforma que convierte tu carro en renta
> **que** te trae arrendatarios verificados, deja todo documentado (fotos, contrato firmado, depósito) y te paga,
> **a diferencia de** alquilar por tu cuenta o por Marketplace (cero respaldo, cero filtro, puro riesgo) o de una rentadora que te compra el carro,
> **porque** controlas precio, días y a quién le entregas, y la plataforma pone la verificación, la evidencia y el respaldo que te protegen.

---

## 3. Propuesta de valor por lado del marketplace

### 3.1 Arrendatario

**Funcional**
- Carro listo en minutos desde la app, sin fila ni mostrador.
- Variedad real: del económico al premium, con dueño que lo cuida.
- **Pico y placa resuelto**: la app te dice qué día rueda cada placa (`lib/picoYPlaca.ts`).
- **Recogida/entrega donde estés**, incluido el **aeropuerto JMC de Rionegro** (sin pico y placa por estar fuera del área metropolitana), con recargo claro y calculado server-side.
- Precio competitivo P2P, sin sobrecostos de flota corporativa.
- Evidencia que te protege: fotos antes/después, contrato firmado, depósito explicado.

**Emocional**
- **Libertad sin miedo**: "alquilo entre particulares pero con la red protegiéndome".
- **Pertenencia paisa**: no es una multinacional fría, es tu ciudad poniéndote un carro.
- **Control**: tú eliges el carro, la persona, el punto de entrega. Eres el héroe del viaje, no un número de reserva.

### 3.2 Propietario

**Funcional**
- Ingreso extra de un activo parado (el argumento Turo: el carro deja de depreciarse solo).
- Tú fijas precio, días disponibles y apruebas cada reserva.
- Arrendatarios **verificados** (documento, licencia) antes de entregar llaves.
- Respaldo de evidencia: fotos antes/después, contrato firmado, depósito.
- Gestión simple desde el dashboard de propietario + chat directo con el arrendatario.

**Emocional**
- **Tranquilidad**: "no se lo entrego a cualquiera, la plataforma me cubre".
- **Orgullo de dueño**: tu carro bien cuidado, no maltratado por una flota anónima.
- **Empoderamiento**: monetizas sin depender de nadie ni vender tu carro.

---

## 4. Pilares de marca y razones para creer

Cuatro pilares. Cada uno con su "reason to believe" (RTB) anclado en funcionalidad **real del producto**, no en promesas.

### Pilar 1 — **Confianza verificada** (la columna vertebral)
*Combatimos directamente el miedo al fraude de la categoría.*
- RTB: verificación de personas (documento, licencia) y de vehículos (placa, documentos, estados de revisión `documentos_estado`).
- RTB: fotos obligatorias **antes y después** de cada viaje (`fotos_antes` / `fotos_despues`).
- RTB: **contrato firmado** digitalmente (`firma_contrato`) en cada reserva.
- RTB: depósito y proceso explicados en pasos claros.

### Pilar 2 — **Hecho para Medellín** (hiperlocalidad defendible)
*Lo que ningún líder global trae resuelto.*
- RTB: **pico y placa** calculado en la app.
- RTB: **catálogo de lugares** del Área Metropolitana + Rionegro/JMC con recargo transparente (`lib/lugares.ts`).
- RTB: **recogida en aeropuerto JMC** (sin restricción de pico y placa).
- RTB: soporte local, en paisa, en tu zona horaria.

### Pilar 3 — **Premium sin fricción** (la experiencia)
*La categoría P2P es fea y burocrática; nosotros no.*
- RTB: diseño dark/premium (DrivePass Design System: lienzo azul-noche + acento naranja `#F25C2B`).
- RTB: reserva en minutos, calendario táctil, app instalable (PWA).
- RTB: copy sin letra pequeña intimidante, tuteo, verbos de acción.

### Pilar 4 — **Tú tienes el control** (empoderamiento, arquetipo Explorador+Héroe)
*Tanto para quien alquila como para quien publica.*
- RTB (usuario): eliges carro, persona y punto de entrega; ves disponibilidad real.
- RTB (propietario): fijas precio, días y apruebas cada reserva.
- RTB: chat directo entre las partes, sin intermediario opaco.

---

## 5. Framework de mensajes

### 5.1 Mensaje maestro (la idea que todo lo gobierna)

> **DrivePass: el carro de Medellín, con dueño que responde y red que te respalda. Conduce libre.**

### 5.2 Variaciones por audiencia / etapa del funnel

| Audiencia | Etapa | Mensaje |
|---|---|---|
| **Turista / viajero** | Awareness | "¿Llegas a Medellín? Recoge tu carro en el aeropuerto y arranca sin mostrador ni pico y placa." |
| **Turista / viajero** | Consideración | "Carros verificados, dueño real, contrato y fotos. Alquilar entre particulares, pero sin riesgo." |
| **Ejecutivo / local** | Awareness | "Tu carro para esta semana, sin fila, sin flota corporativa cara." |
| **Ejecutivo / local** | Conversión | "Reserva en minutos. El pico y placa ya está resuelto en la app." |
| **Dueño de carro** | Awareness | "Tu carro parado pierde plata. Ponlo a rentar en DrivePass." |
| **Dueño de carro** | Consideración | "Tú pones el precio y los días; nosotros ponemos arrendatarios verificados, contrato y respaldo." |
| **Ambos** | Retención | "Tu próxima vuelta por Antioquia ya tiene carro. Bienvenido de nuevo a DrivePass." |

### 5.3 Headlines candidatos

**Lado usuario**
1. "Tu carro en Medellín, en minutos."
2. "Alquila entre particulares. Sin el miedo."
3. "Recógelo en el aeropuerto. Arranca sin pico y placa."
4. "El carro que quieres, con dueño que responde."
5. "Olvídate del mostrador."

**Lado propietario**
6. "Tu carro parado pierde plata."
7. "Monetiza tu carro. Nosotros ponemos el respaldo."
8. "Tú pones el precio. Nosotros, los arrendatarios verificados."

### 5.4 Taglines candidatos

1. **"Conduce libre."** *(tagline madre — ya consagrado en identidad y design system; mantener)*
2. "El alquiler entre paisas."
3. "Carros con dueño. Viajes con respaldo."
4. "Medellín, en tus manos."
5. "Tu pase para moverte."

> **Recomendación:** **"Conduce libre."** como tagline maestro permanente + **"El alquiler entre paisas."** como descriptor de categoría en contextos donde hay que explicar qué es DrivePass (SEO, bio de redes, vallas).

### 5.5 Elevator pitch (30 segundos)

> "DrivePass es la red de alquiler de carros entre particulares de Medellín. Si necesitas un carro, lo reservas en minutos desde la app —con dueño real, recogida hasta en el aeropuerto y el pico y placa ya resuelto—. Si tienes un carro parado, lo pones a rentar y ganas plata sin riesgo: nosotros verificamos a quién se lo entregas, dejamos todo con fotos y contrato firmado, y te respaldamos. No somos una rentadora cara de mostrador ni un marketplace sin filtro: somos los paisas poniéndole carro a Medellín, con la confianza de un banco y la cercanía de un vecino. Conduce libre."

### 5.6 Manifiesto de marca (corto)

> **Medellín no se mueve en fila.**
>
> Creemos que un carro parado es una libertad desperdiciada —y que pedir uno prestado no debería dar miedo.
>
> Por eso conectamos a los que tienen carro con los que lo necesitan, cara a cara, con nombre y con respaldo. Verificamos a cada quien. Documentamos cada viaje. Resolvemos el pico y placa y te recogemos hasta en el aeropuerto.
>
> No somos un mostrador. No somos un anuncio sin filtro. Somos la red de carros de los paisas: la confianza de siempre, la libertad de ahora.
>
> Sube, que el carro ya tiene dueño y la ruta es tuya.
>
> **DrivePass. Conduce libre.**

---

## 6. Diferenciadores defendibles y cómo comunicarlos

| Diferenciador | Por qué es defendible | Cómo comunicarlo |
|---|---|---|
| **Pico y placa resuelto en la app** | Conocimiento local codificado (`lib/picoYPlaca.ts`); Turo/Getaround no lo tienen, los tradicionales no lo automatizan | Badge en cada carro: "Hoy rueda / hoy descansa". Headline: "El pico y placa ya está resuelto." |
| **Recogida en JMC sin pico y placa** | El aeropuerto está fuera del área metropolitana → ventaja real para turistas; catálogo de lugares con recargo claro | "Recoge en el aeropuerto y arranca sin restricción." Captura turista en awareness. |
| **Evidencia de viaje (fotos antes/después + contrato firmado)** | Construido en el flujo de reserva; convierte "P2P = riesgo" en "P2P = protegido" | Mostrar el flujo de 3 pasos en onboarding. Microcopy: "Todo queda documentado." |
| **Doble verificación (persona + vehículo)** | Documentos, licencia, placa, estados de revisión ya en el modelo de datos | Insignias "Propietario verificado" / "Carro verificado" visibles antes de reservar. |
| **Premium dark + cero burocracia** | Design System propietario; la categoría P2P local (Eva) y los tradicionales son visualmente pobres | Que la marca *se vea* más cara y más fácil que la competencia. La estética ES el argumento. |
| **Foco 100% Medellín** | Mientras Eva se dispersa a 6 ciudades, DrivePass profundiza una sola plaza | "Solo Medellín. Por eso lo hacemos mejor que nadie." (foco como virtud) |
| **Control de ambos lados** | Usuario elige punto de entrega; propietario fija precio/días y aprueba | "Tú decides. Nosotros ponemos el carro / el respaldo." |

**Frente a cada competidor (mensaje de ataque):**
- **vs Localiza:** "Sin mostrador, sin flota cara, sin que te traten como un número." (precio + cercanía + experiencia)
- **vs Eva:** "Verificación rápida y una app que se siente premium —no un trámite de 40 minutos." (fricción + diseño)
- **vs Turo/Getaround:** "Hecho para Medellín: pico y placa, aeropuerto JMC y soporte que habla tu idioma." (hiperlocalidad)
- **vs Marketplace/informal:** "Aquí cada quien está verificado y cada viaje queda con contrato. Eso no lo tiene un grupo de Facebook." (respaldo)

---

## 7. Arquitectura de confianza (categoría con miedo al fraude)

El miedo del **usuario**: "¿y si el carro llega mal, me cobran lo que no rompí, o el dueño no aparece?".
El miedo del **propietario**: "¿y si me dañan el carro, no me pagan, o se lo entrego a un irresponsable?".
La marca **#1 será la que mejor disuelva ambos miedos antes de que aparezcan.** Eva ya marcó el estándar con Sura + DataCrédito; DrivePass debe igualar el respaldo y ganar en experiencia.

### 7.1 Señales de confianza por etapa

**Antes de reservar**
- Perfiles verificados con foto, insignias "Verificado".
- Calificaciones de propietario y de usuario visibles.
- Fotos del carro en HD; estado y documentos del vehículo a la vista.
- Proceso de depósito/seguro explicado en 3 pasos, sin letra pequeña.

**Durante la reserva**
- Progreso visual paso 1→2→3.
- Contrato firmado digitalmente (`firma_contrato`).
- Política de cancelación visible (la paradoja: si sabe que puede cancelar, casi no cancela).

**Al recoger / entregar**
- Flujo de **fotos obligatorias antes y después** (protege a ambos; cada parte tiene evidencia).
- Punto y hora de recogida/entrega registrados, recargo transparente.

**Después**
- Calificación inmediata bidireccional.
- Confirmación con resumen del viaje (correo / WhatsApp).
- Soporte local accesible.

### 7.2 Pruebas que la marca debe exhibir (y construir si faltan)

| Señal | Estado | Acción |
|---|---|---|
| Insignias "Propietario verificado" / "Carro verificado" | Datos existen (`documentos_estado`) | **Hacerlas visibles en UI** |
| Fotos antes/después + contrato firmado | En el producto | Mostrarlo como argumento de venta, no esconderlo |
| **Seguro / respaldo en caso de daño** | **No evidente en el código** | **Brecha crítica:** Eva tiene Sura; DrivePass necesita una póliza o política de respaldo y comunicarla. *Sin esto, la promesa "sin miedo" no es creíble.* |
| Verificación financiera/judicial (tipo DataCrédito) | No evidente | Evaluar integración o, mínimo, verificación de identidad robusta |
| Prueba social ("+800 reservas este mes", calificaciones) | Microcopy ya previsto en DS | Usar **solo números reales**; activarlo al tener volumen |
| Soporte 24h / línea de emergencia | No evidente | Definir SLA de soporte local y comunicarlo |

> **Prioridad #1 para credibilidad:** cerrar la brecha de **seguro/respaldo en daños**. Es el factor que hoy le da a Eva la ventaja de confianza y el que más pesa en la decisión tanto de usuario como de propietario. La narrativa "Conduce libre / sin miedo" no se sostiene sin una respuesta clara a "¿y si pasa algo?".

---

## 8. Resumen accionable (qué hacer ya)

1. **Adoptar `DrivePass` como nombre oficial.** Registrar dominio, redes y marca (SIC clases 39 y 42). RentDrive = legado técnico.
2. **Liderar la categoría "el alquiler entre paisas: premium, verificado y sin mostrador."** No competir en precio raso.
3. **Tagline maestro: "Conduce libre."** + descriptor "El alquiler entre paisas."
4. **Hacer visibles** las insignias de verificación y la evidencia (fotos/contrato): la confianza es el producto.
5. **Cerrar la brecha de seguro/respaldo** antes de escalar marketing de "sin miedo".
6. **Capturar al turista** con el ángulo aeropuerto JMC + pico y placa resuelto: es el terreno donde Turo/Getaround no juegan y los tradicionales son caros.
7. **Foco Medellín como virtud,** mientras Eva se dispersa.

---

## Fuentes

- Turo — posicionamiento, slogan y valores: [Open the door to extraordinary (Turo blog)](https://turo.com/blog/news/open-the-door-to-extraordinary/), [Turo Business Model (FourWeekMBA)](https://fourweekmba.com/turo-business-model/), [Turo taps into the magic of car sharing (Strategy)](https://strategyonline.ca/2022/12/01/turo-taps-into-the-magic-of-car-sharing/)
- Turo — seguro, planes de host, trust & safety: [Trust & Safety | Turo](https://turo.com/us/en/car-rental/united-states/trust-and-safety), [Insurance & protection at Turo](https://turo.com/us/en/car-rental/united-states/insurance), [Earnings plan requirements (Turo Help)](https://help.turo.com/en_us/insurance-and-earnings-plan-requirements-hosts-S1TvINxVq)
- Getaround — posicionamiento, cómo funciona, confianza: [How it works (Getaround)](https://getaround.com/how-it-works), [On the Move: How Getaround Unlocked the Future of Car Sharing](https://www.onestepahead.so/p/on-the-move-how-getaround-unlocked), [What is Getaround? (Miracuves)](https://miracuves.com/blog/what-is-getaround-and-how-does-it-work/)
- Localiza — Colombia/Medellín, propuesta de valor, calificación: [Localiza Colombia](https://www.localiza.com/colombia/es-co), [Localiza Medellín](https://www.localiza.com/colombia/es-co/red-de-agencias/medellin), [¿Qué es Localiza? (Renting Colombia)](https://www.rentingcolombia.com/localiza-corporativo/que-es-localiza)
- Eva — P2P Colombia, verificación DataCrédito, seguro Sura: [EVA](https://www.eva.city/), [Eva, aplicación para arrendar carros (Semana)](https://www.semana.com/tecnologia/articulo/eva-aplicacion-para-arrendar-carros/274112/), [Eva llegará a más ciudades (La República)](https://www.larepublica.co/empresas/eva-la-app-de-alquiler-de-carros-llegara-a-santa-marta-y-cartagena-este-ano-2874088)
- Medellín — pico y placa y aeropuerto JMC: [Pico y placa 2025 Medellín y Rionegro (Rentadora Dinámica)](https://rentadoradinamica.com/pico-y-placa-2025-segundo-semestre-alquiler-de-carros-camionetas-y-motos-en-medellin-y-rionegro/), [Alquiler en JMC (Alamo)](https://www.alamo.com/es/oficinas-de-alquiler-de-autos/co/jose-maria-cordova-intl-airport-k431.html)
- Documentos internos: `Imagen de marca/Identidad_de_Marca_RentDrive.md`, `rentdrive/PROYECTO.md`, `DrivePass Design System/readme.md`
