# RentDrive — Contexto integral del proyecto

> Documento maestro de contexto. Se carga en cada sesión vía `CLAUDE.md`.
> Última actualización del contenido: **2026-06-06**. **Si cambias arquitectura, schema, auth o despliegue, actualiza este archivo.**

## 0. Estado actual y pendientes (al 2026-06-06)

Marca/objetivo del dueño (Victor): ser **el #1 de alquiler de carros en Medellín**. Comunicación en **español**; suele delegar decisiones ("hazlo", "sí", "continúa") y valora que las cosas **funcionen** y se le expliquen los pasos manuales.

**Construido en las últimas sesiones (cada uno tiene su sección detallada abajo):**
- **Verificador de documentos con IA** (Claude vision): vehículo + arrendador + arrendatario; modo **híbrido** (auto-aprueba alta confianza, resto a revisión humana). Cruce **foto-contra-foto** de tarjeta de propiedad vs. cédula del propietario.
- **Visualización de documentos en admin**: cédula del propietario (Usuarios → perfil) y **cédula + licencia del cliente** (tarjeta de reserva → "Documentos del cliente").
- **Operaciones / logística**: al confirmar una reserva se crea un servicio con checklist (lavar, tanquear, entregar, recibir, inspección); pestaña **Operaciones** (asignar mensajero, checklist, notas, reenvío).
- **Acceso del mensajero por enlace/token** (`/m/<token>`, sin contraseña, móvil): ve sus servicios, marca checklist, sube fotos y corre la inspección.
- **Inspección de daños con IA**: compara fotos de **salida vs. entrada** y detecta daños nuevos (rayones, abolladuras, vidrios, etc.).
- **WhatsApp** (helper `lib/whatsapp.ts`): **apagado por defecto** (`WHATSAPP_ENABLED`); usa el bridge personal de hermes en `localhost:3000`.
- **Pico y placa**: editor de rotación manual (pestaña **Configuración**), resaltado de carros restringidos hoy en la lista, y avisos a propietario+cliente (cron 6am vía `CRON_SECRET` + `scripts/pico-placa-cron.sh`).
- **Fix**: `POST /api/vehiculos` no guardaba `placa` (bug); ya guarda. Campo de placa editable en cada carro del dashboard del propietario.

**Pendientes del lado del usuario (manual):**
1. Poner `ANTHROPIC_API_KEY` en `rentdrive/.env.local` → activa verificador e inspección IA (sin ella, esos endpoints dan 503 amable). `.env.local` ya existe con la línea vacía.
2. **Llenar las placas** de los 4 carros existentes (Corolla, CX-5, Spark, Tucson) → requisito del pico y placa (sin placa no hay dígito que comparar).
3. Activar el **cron de pico y placa** (comando en la entrega) y/o `WHATSAPP_ENABLED=true` para envíos reales.
4. Para que el **enlace del mensajero** abra desde el celular: misma WiFi + `APP_URL` con la IP LAN de la Mac (hoy `192.168.1.34:3100`) o un dominio/túnel en producción.

**Tema en pausa (asesoría dada, sin construir):** integración de **comparendos/fotomultas**. NO hay API pública del RUNT/SIMIT (captcha, solo entidades autorizadas). Quedó la recomendación: chequeo manual semanal del SIMIT por placa, o contratar una API comercial y enchufarla a un conector + cron. Las fotomultas tardan **15–30 días** en aparecer. Cláusula de contrato: el **arrendatario** asume infracciones durante el alquiler.

**Gotchas operativos (IMPORTANTE para no repetir errores):**
- Dev server en **puerto 3100** (`next dev -p 3100`); el 3000 es el bridge de WhatsApp de hermes. **No correr `npm run build` con el dev activo** (corrompe `.next`).
- Validar con `npx tsc --noEmit` y `eslint`. Hay errores de eslint **preexistentes en todo el proyecto** (`react-hooks/set-state-in-effect`, `immutability` en los `useEffect` de carga, `no-img-element`): NO son míos, no bloquean dev/build. tsc debe quedar en 0.
- Las **migraciones `ALTER TABLE` no se aplican solas** a `rentdrive.db` porque la conexión es un singleton; tras editar `lib/db.ts` hay que aplicar el ALTER también a la BD viva con un script node puntual (better-sqlite3) o reiniciar el server.
- A veces el sandbox no alcanza `localhost:3100` por curl; verificar por `tsc`/lint/disco y por el log del dev. Cuando sí responde: 403/404 = la ruta compiló y el gating funciona; 500 = error real.
- Modelo de la API de Claude: `claude-opus-4-8`, vision por base64, salida estructurada `output_config.format.json_schema` + `effort:'high'` + `thinking:{type:'adaptive'}`.

## 1. Qué es

**RentDrive** (marca también referida como *DrivePass*) es una plataforma web de **alquiler de carros entre particulares** en Colombia (Medellín por defecto). Conecta **propietarios** que publican vehículos con **usuarios** que los reservan, con un **admin** que supervisa. Incluye chat entre las partes, gestión de documentos/licencias, reservas con fotos antes/después, contratos firmados y notificaciones.

## 2. Stack y estructura

- **Framework**: Next.js **16** (App Router) + React **19** + TypeScript.
- **Estilos**: Tailwind CSS 4 (`@tailwindcss/postcss`).
- **DB (realidad actual del código)**: **SQLite** vía `better-sqlite3`, archivo `rentdrive.db` en la raíz de `rentdrive/`. El schema se crea/migra en `lib/db.ts` (`CREATE TABLE IF NOT EXISTS` + `ALTER TABLE` defensivos).
- **DB (destino de despliegue)**: **Postgres en Supabase**. El schema equivalente vive en `supabase/schema.sql` y datos en `supabase/seed.sql`. ⚠️ **Hay divergencia**: el código corre en SQLite; Supabase es el plan de producción. Mantén ambos en paridad cuando cambies el schema.
- **Auth**: JWT propio (`jsonwebtoken`) + `bcryptjs`. Token en cookie `httpOnly`. **No** usa Supabase Auth.
- **Storage (realidad actual)**: filesystem local `public/uploads/` (`lib/storage.ts`). En producción el README plantea Supabase Storage (aún no implementado en el código).
- **PWA**: `public/manifest.json` + `public/sw.js` + `components/SwRegistrar.tsx`.
- **i18n**: `contexts/LanguageContext.tsx` + `lib/i18n.ts`.
- **Exportación**: `lib/export.ts` con `jspdf` / `xlsx` (PDF/Excel de reservas).
- **Reglas locales**: `lib/picoYPlaca.ts` (pico y placa Colombia).
- **Lugares de recogida/entrega**: `lib/lugares.ts` (catálogo de municipios del Área Metropolitana + Rionegro/aeropuerto, barrios, recargo y helpers `calcularRecargo`/`lugarValido`/`lugarResumen` + persistencia en `sessionStorage`). Componente UI reutilizable: `components/LugarSelector.tsx`. El flujo inicio → detalle → pago comparte la selección vía `sessionStorage` (`drivepass_lugares`); el recargo se calcula **server-side** en `/api/reservas`.

### Carpetas clave (`rentdrive/`)
```
app/                 App Router (páginas + API)
  api/               Endpoints backend
  (auth)/            login, registro
  dashboard/         admin | propietario | usuario
  vehiculos/[id]/    detalle de vehículo
  chat/, historial/, pago/, ...
components/          UI compartida (Navbar, BottomNav, cards, uploads, calendarios)
contexts/            SessionContext, LanguageContext
lib/                 db, auth, storage, export, i18n, picoYPlaca, sound
supabase/            schema.sql, seed.sql, _export_data.py (paridad Postgres)
public/uploads/      archivos subidos (local)
rentdrive.db         base SQLite local
```

## 3. Modelo de datos (tablas)

Definidas en `lib/db.ts` (SQLite) y `supabase/schema.sql` (Postgres):

- **usuarios** — `id, nombre, correo (unique), password (bcrypt), rol(admin|propietario|usuario), documento_identidad, estado_cuenta(activa|inactiva)`, + campos perfil: `celular, tipo_documento, fecha_nacimiento, direccion, ciudad, numero_licencia, contacto_emergencia`.
- **vehiculos** — `id, propietario_id→usuarios, marca, modelo, anio, tipo, ubicacion, precio_dia, descripcion, fotos(JSON), disponible`, + `dias_disponibles(JSON), fotos_detalle(JSON), placa, documentos(JSON), documentos_estado, documentos_nota, documentos_revisiones(JSON)`.
- **reservas** — `id, usuario_id, vehiculo_id, fecha_inicio, fecha_fin, total, pago_estado(pendiente|pagado|cancelado), estado(pendiente|confirmada|en_curso|completada|cancelada), fotos_antes(JSON), fotos_despues(JSON)`, + `documento_id_url, licencia_url, firma_contrato(JSON)`, + **`recogida(JSON {municipio,barrio,direccion,hora})`, `entrega(JSON)`, `recargo(REAL)`** (lugar/hora de recogida y entrega; `recargo` = $100.000 por trayecto cuando el extremo es el aeropuerto JMC de Rionegro).
- **conversaciones** — `id, propietario_id, usuario_id, UNIQUE(propietario_id, usuario_id)`.
- **mensajes** — `id, conversacion_id, remitente_id, contenido, created_at`.
- **lecturas** — `usuario_id, conversacion_id, ultimo_leido_id` (control de no leídos).
- **notificaciones** — `id, destinatario_id, tipo, titulo, mensaje, referencia_id, referencia_tipo, leida`.

> Muchos campos JSON se guardan como **texto** y se parsean con `JSON.parse`. Siempre envolver en `try/catch`.

## 4. API (rutas en `app/api/`)

- `auth/` → `login`, `registro`, `logout`, `me`.
- `vehiculos/` (GET listar con filtros tipo/ubicación/precio/fechas, POST crear) + `vehiculos/[id]` (detalle/editar).
- `reservas/` (+ `reservas/[id]`).
- `chat/` → `conversaciones`, `mensajes`, `stream` (SSE polling ~1.5s), `leer`, `no-leidos`.
- `upload/` (+ `upload/documento`).
- `notificaciones/`.
- `admin/usuarios/`.
- `verificar-documentos/` → verificación de documentos con IA (Claude). Ver sección dedicada abajo.
- `operaciones/` (+ `operaciones/[id]`), `mensajeros/` (+ `mensajeros/[id]`), `config/` → módulo de operaciones/logística. Ver sección dedicada abajo.
- `m/[token]/` (+ `m/[token]/upload`) → acceso del mensajero por token (no usa sesión).
- `pico-placa/alertas/` → avisos de pico y placa (admin o `x-cron-secret`).

### Disponibilidad y calendario de reserva
- `GET /api/vehiculos/[id]` devuelve `ocupadas` (días ocupados por reservas activas, rango **inclusivo**, mismo criterio que el chequeo de conflictos del POST).
- El listado público `GET /api/vehiculos` oculta vehículos inactivos (`disponible=1`, salvo cuando se filtra por `propietarioId`) y, si se buscan fechas, excluye los que tienen una reserva que solapa el rango.
- En el detalle, `components/CalendarioReserva.tsx` permite **seleccionar el rango tocando el calendario**, respetando: días del propietario (`dias_disponibles`; vacío = cualquier día futuro), `ocupadas`, días pasados y carro inactivo. El propietario sigue definiendo su disponibilidad con `CalendarioDisponibilidad.tsx`.

### Verificador de documentos con IA (Claude)
Revisa y autoriza los documentos cargados usando visión de Claude (`claude-opus-4-8`), de forma **híbrida**: auto-aprueba solo lo limpio de alta confianza y manda el resto a revisión humana.

- **Backend**: `POST /api/verificar-documentos` (admin o el propietario dueño del vehículo).
  - `{ vehiculo_id }` → revisa SOAT, tecno-mecánica, tarjeta de propiedad y seguro todo riesgo. Contrasta contra la **placa** registrada y el **nombre/documento del arrendador** (propietario). Si el propietario subió la **foto de su cédula** (`usuarios.cedula_url`), también se adjunta para que la IA cruce la tarjeta de propiedad **foto contra foto** contra esa cédula (no solo el texto registrado). Persiste auto-aprobaciones de alta confianza en `documentos_revisiones` y recalcula `documentos_estado` (la cédula del propietario no cuenta para ese estado).
  - `{ reserva_id }` → revisa la **cédula y licencia del arrendatario** contra su nombre/documento/licencia registrados (vigencia, categoría apta para automóvil, nombre que coincide). No persiste; es solo informe.
  - Devuelve `503` si falta `ANTHROPIC_API_KEY` (el resto de la app funciona igual).
- **Motor**: `lib/verificacion-docs.ts` (lee imágenes/PDF desde `public/uploads`, arma el prompt en español con la fecha de hoy y las reglas por documento, salida estructurada vía JSON Schema con `effort:'high'` + `thinking:{type:'adaptive'}`); `decisionHibrida()` aplica el criterio auto-aprobar/revisión. Cliente lazy en `lib/anthropic.ts`.
- **UI (admin)**: en el modal de documentos del vehículo, botón **«Verificar con IA»**; en cada tarjeta de reserva, **«Verificar arrendatario (IA)»**. El componente `ResultadoIA` muestra veredicto global, datos extraídos, verificaciones ✓/✗ y cruces entre documentos. La decisión final siempre es humana.
- **Cédula del propietario**: el propietario sube la foto de su cédula en la pestaña **«Mi perfil»** del dashboard (`app/dashboard/propietario/page.tsx`), que guarda `usuarios.cedula_url` vía `PUT /api/auth/me` (whitelist de campos editables del propio perfil). Esa imagen alimenta el cruce foto-contra-foto del verificador.
- **Config**: requiere `ANTHROPIC_API_KEY` en `.env.local` (ver `.env.example`). Costo ≈ unos pocos centavos de USD por documento.

### Visualización de documentos en el panel admin
- **Cédula del propietario (arrendador)**: Usuarios → clic en el propietario → modal de perfil, sección «Foto de la cédula» (`usuarios.cedula_url`; el API `admin/usuarios` la incluye en el SELECT).
- **Documentos del cliente (arrendatario)**: en cada tarjeta de reserva, botón **«📄 Documentos del cliente»** → modal con la cédula (`documento_id_url`) y la licencia (`licencia_url`) que el cliente subió al reservar. Imagen ampliable o enlace si es PDF.

### Pico y placa (restricción vehicular de Medellín)
La rotación la define el admin manualmente (cambia cada cierto tiempo) y el sistema resalta los carros restringidos y avisa a propietario y cliente.
- **Lógica pura** (`lib/pico-placa.ts`, sin BD, usable en cliente y servidor): tipos, `parsePicoPlaca`, `ultimoDigitoPlaca`, `digitosRestringidos`, `placaRestringida`, `fechaISOLocal`.
- **Config**: se guarda en `config['pico_placa']` (JSON `{ activo, vigencia, dias: { "1".."5": [dígitos] } }`) vía `GET/PUT /api/config`.
- **UI admin**: pestaña **«Configuración»** (`components/PicoPlacaConfig.tsx`): editor de rotación (toggle activo + dígitos restringidos por día Lun-Vie), muestra los dígitos restringidos de hoy, botón «Ver afectadas hoy» y «Avisar pico y placa de hoy». En la lista de **Vehículos**, los carros con pico y placa hoy se resaltan (borde y badge rojo **«🚦 Pico y placa hoy»**).
- **Avisos**: `GET /api/pico-placa/alertas` (previsualiza afectadas) y `POST` (envía). Afectadas = reservas `confirmada`/`en_curso` activas hoy cuyo vehículo está restringido. Crea notificación in-app a cliente y propietario + WhatsApp (si está habilitado). Idempotente por `pico_placa_avisos (reserva_id, fecha)`.
- **Automático cada mañana**: el endpoint acepta `getCurrentUser` admin **o** el header `x-cron-secret == CRON_SECRET`. `scripts/pico-placa-cron.sh` hace el `POST` con el secreto; se programa con cron (ver `.env.example` y el README/entrega). El WhatsApp real solo sale con `WHATSAPP_ENABLED=true`; las notificaciones in-app llegan siempre.

### Operaciones / logística (tablero + WhatsApp)
Al **confirmar** una reserva (`PUT /api/reservas/[id]` con `estado:'confirmada'`) se genera automáticamente un **servicio operativo** con un checklist y se notifica al administrador; luego se asigna un mensajero que recibe sus tareas por WhatsApp.

- **Disparador**: dentro del handler de confirmación (`app/api/reservas/[id]/route.ts`), aislado en try/catch, se llama `crearOperacionParaReserva()` (idempotente) y se avisa al admin (notificación in-app + WhatsApp si hay número configurado).
- **Checklist por defecto** (`lib/operaciones.ts` → `plantillaTareas`): lavar, tanquear, entregar (con lugar/hora de recogida del cliente), inspección con fotos, recibir (con lugar/hora de devolución).
- **Tablas** (`lib/db.ts` + `supabase/schema.sql`): `mensajeros` (registro de mensajeros: nombre, celular, activo), `operaciones` (un servicio por reserva: `reserva_id` único, `mensajero_id`, `estado` pendiente/asignada/en_proceso/finalizada, `notas`, `wa_admin`, `wa_mensajero`), `operacion_tareas` (checklist: tipo, titulo, detalle, estado pendiente/hecho, orden), y `config` (clave/valor; p. ej. `admin_whatsapp`).
- **API**: `GET /api/operaciones` (tablero + mensajeros activos + `admin_whatsapp` + `whatsapp_habilitado`); `PUT /api/operaciones/[id]` con `accion` = `asignar` (asigna mensajero y le envía WhatsApp), `estado`, `tarea` (marca/desmarca y recalcula el estado), `notas`, `reenviar` (`destino` mensajero/admin). `GET/POST /api/mensajeros` y `PUT/DELETE /api/mensajeros/[id]` (al estar en uso se desactiva en vez de borrar). `GET/PUT /api/config`.
- **UI (admin)**: pestaña **«Operaciones»** (`components/OperacionesPanel.tsx`): configura el WhatsApp del admin, gestiona mensajeros, y muestra cada servicio como tarjeta con datos, asignación de mensajero, checklist con casillas, notas y reenvío. Estado del envío («enviado» / «no enviado: …») visible por tarjeta.
- **WhatsApp** (`lib/whatsapp.ts`): **apagado por defecto**. Solo envía si `WHATSAPP_ENABLED=true`; usa el bridge `POST {WHATSAPP_BRIDGE_URL}/send { chatId, message }` (por defecto el bridge local de hermes en `localhost:3000`, que envía desde el WhatsApp personal del operador). Convierte celulares CO a JID (`57XXXXXXXXXX@s.whatsapp.net`). Si está apagado o el bridge falla, el tablero igual funciona y queda registrado el motivo. Ver `.env.example`.

### Inspección de daños con IA (comparación de fotos)
Compara fotos de **salida** (cuando el carro deja la sede) vs. **entrada** (cuando lo devuelven) y detecta **daños nuevos**: rayones, abolladuras, vidrios/espejos rotos, hundidos, faros, llantas, etc.
- **Motor** (`lib/inspeccion-vehiculo.ts`): Claude vision (`claude-opus-4-8`) con salida estructurada (JSON Schema) → `{ hay_danos_nuevos, severidad_general, hallazgos[], zonas_no_comparables, resumen, recomendacion }`. Ignora suciedad/reflejos/ángulos no comparables; no inventa daños. `lib/operaciones.ts → ejecutarInspeccion()` orquesta y guarda `operaciones.inspeccion_ia`/`inspeccion_estado`.
- **Datos**: `operaciones.fotos_salida` / `fotos_entrada` (arrays JSON de URLs), `inspeccion_ia` (resultado JSON), `inspeccion_estado` (pendiente/sin_danos/con_danos).
- **API**: acción `inspeccion` en `PUT /api/operaciones/[id]` (admin) y en `PUT /api/m/[token]` (mensajero); 503 si falta `ANTHROPIC_API_KEY`. Acción `fotos` ({fase: salida|entrada, urls}) para guardar las fotos.
- **UI**: componente compartido `components/InspeccionResultado.tsx` (severidad, hallazgos, recomendación). Disponible en el panel admin y en la página del mensajero.

### Acceso del mensajero (enlace personal con token)
Cada mensajero tiene un **enlace propio sin contraseña**: `/m/<token>` (`mensajeros.token`, generado al crear y con backfill). Pensado para móvil y para enviarse por WhatsApp.
- **Página** (`app/m/[token]/page.tsx`, cliente, sin cookie): el mensajero ve solo **sus** servicios asignados, marca el checklist, sube fotos de salida/entrada y ejecuta la inspección con IA.
- **API por token** (no usa `getCurrentUser`, valida el token): `GET /api/m/[token]` (sus operaciones + `ia_disponible`), `PUT /api/m/[token]` (acciones `tarea`/`fotos`/`inspeccion`, siempre validando que la operación sea suya), `POST /api/m/[token]/upload` (subida de fotos por token).
- **Admin**: en «Operaciones», cada mensajero tiene botón **«Copiar acceso»** (`{APP_URL}/m/<token>`); al asignarlo, su WhatsApp incluye ese enlace (`appBaseUrl()` ← `APP_URL`/`NEXT_PUBLIC_APP_URL`).
- Seguridad: el token (32 hex) es la credencial; da acceso solo a los servicios de ese mensajero. Para login con contraseña sería una evolución futura.

### Patrón estándar de un API route
1. `const user = await getCurrentUser()` (de `@/lib/auth`) cuando aplica.
2. Validar rol/ownership → `403` si no autorizado, `401` si no hay token.
3. Validar entrada → `400` si faltan datos.
4. `const db = getDb()` y **query parametrizada** `db.prepare('... WHERE x = ?').get/all/run(valor)`.
5. `NextResponse.json(data, { status })`. Creación → `201`.

Roles: `admin`, `propietario`, `usuario`. Usuarios semilla (creados en `initDb`):
`admin@rentdrive.com/admin123`, `propietario@rentdrive.com/owner123`, `usuario@rentdrive.com/user123`.

## 5. Cómo correr y validar

```bash
cd rentdrive
npm install
npm run dev        # http://localhost:3100  (puerto dedicado, ver nota abajo)
npm run build      # build de producción
npm run lint       # eslint
npx tsc --noEmit   # chequeo de tipos
```

> **Puerto 3100 (no 3000).** El puerto 3000 lo usa otro servicio del equipo (bridge de WhatsApp de `hermes-agent`). Para evitar que peleen por el puerto, RentDrive corre en **3100** (`next dev -p 3100` en `package.json`). Si "no cargan los vehículos / no entran los perfiles" y la API responde 404 de Express, es que el dev server no está corriendo o algo tomó el puerto: relanza `npm run dev` y usa `localhost:3100`.
> **No corras `npm run build` con `npm run dev` activo**: comparten la carpeta `.next` y el build puede corromper el estado del dev server.
Inspeccionar DB: `sqlite3 rentdrive.db '.tables'`. Regenerar seed Postgres: `python3 supabase/_export_data.py`.

## 6. ⚠️ Riesgos y deudas conocidas (tener presente al implementar)

1. **Divergencia SQLite ↔ Supabase**: cambios de schema deben replicarse en `supabase/schema.sql`.
2. **`JWT_SECRET` con fallback hardcodeado** en `lib/auth.ts` → forzar env en producción.
3. **Uploads al filesystem público** sin validación robusta de tipo/tamaño/nombre; documentos sensibles (cédulas, licencias) quedan en carpeta pública.
4. **Sin tests automatizados**: la verificación es manual (lint + build + smoke tests por rol).
5. **SSE en Vercel Hobby** se corta a ~10s; el cliente debe reconectar.
6. **Datos personales sensibles**: tratar IDOR y exposición de campos (`password`) con cuidado.
7. **Service Worker / PWA (resuelto 2026-06-05)**: el SW (`public/sw.js`) cacheaba HTML cache-first con versión fija → al reiniciar `npm run dev` servía HTML/JS obsoletos y el login quedaba "muerto" en el navegador (botón sin efecto, sin hidratar). **Fix de raíz**: `sw.js` ahora es network-first para navegaciones (cache `drivepass-v2`) y `SwRegistrar` **no** registra el SW en desarrollo —además desregistra y limpia cachés para auto-sanar navegadores afectados. Si el login vuelve a "no responder" en el navegador pero `curl` al endpoint sí responde, sospechar siempre del Service Worker/caché del navegador (hard reload: Cmd+Shift+R).

## 7. Flujo de trabajo seguro con agentes

Para implementar cambios con red de seguridad, usar los subagentes de `.claude/agents/`:

| Agente | Para qué | Permisos |
|---|---|---|
| `implementador-rentdrive` | Escribe el código del cambio siguiendo convenciones | edita |
| `verificador-qa` | Corre lint + tipos + build + smoke tests; veredicto APRUEBA/RECHAZA | solo lectura/bash |
| `revisor-codigo` | Revisa el diff: bugs, regresiones, roles, SQL | solo lectura |
| `auditor-seguridad` | Audita auth, uploads, IDOR, secretos | solo lectura |
| `analista-competencia` | Compara alquileres nacionales/internacionales (Turo, Localiza, Getaround…) y propone mejoras priorizadas | lectura + web |
| `estratega-seo` | Audita y mejora posicionamiento (SEO técnico, local Medellín, JSON-LD, sitemap); muestra plan y puede implementar | lectura + web + edita |
| `explorador-creativo` | Trae conceptos novedosos/UX de cualquier industria con mockups y factibilidad | lectura + web |
| `estratega-marca` | Posicionamiento para ser #1, propuesta de valor, framework de mensajes | lectura + web + Write |
| `director-campanas` | Campañas completas (canales, embudo, copys, presupuesto, KPIs) que venden | lectura + web + Write |
| `growth-lanzamiento` | Go-to-market y lanzamiento para dominar Medellín; arranque en frío, loops, alianzas | lectura + web + Write |
| `captacion-propietarios` | Capta y retiene propietarios (lado oferta): value prop, incentivos, embudo | lectura + web + Write |

> Los agentes de investigación/marketing entregan reportes/estrategias para que decidas qué implementar (luego lo ejecuta `implementador-rentdrive`). Los de marketing guardan sus entregables en `rentdrive/marketing/`. `estratega-seo` puede implementar quick wins técnicos tras tu visto bueno.

**Secuencia recomendada para cualquier cambio no trivial:**
1. `implementador-rentdrive` hace el cambio.
2. En paralelo: `verificador-qa` (¿funciona?) + `revisor-codigo` (¿es correcto?).
3. Si el cambio toca auth/uploads/roles/permisos: además `auditor-seguridad`.
4. Solo se da por bueno cuando QA = APRUEBA y revisor = LISTO PARA MERGE.

## 7.bis Línea gráfica / Design System (tema oscuro)

Se está aplicando el **"DrivePass Design System"** (carpeta hermana `../DrivePass Design System/`), un sistema **premium/oscuro**: lienzo azul-negro, texto claro, un único acento naranja `#F25C2B` con disciplina (CTAs, precios, estados activos).

- **Tokens** en `app/globals.css` (`@theme inline`): `--color-bg #0A1422`, `surface #0F1E33`, `surface-2 #16263F` (tarjetas), `surface-3 #1B3356`, texto `ink/ink-soft/ink-muted`, bordes sutiles blancos, semánticos `success/warning/danger/info`, + utilidades de marca `.glass`, `.glow-accent`, `.gradient-hero`, `.fade-up`, `.shimmer`.
- **Mapa de migración de clases** (claro → oscuro): `bg-white`→`bg-surface-2`, `text-brand`→`text-ink`, rojos→`danger`, amarillos→`warning`, verdes→`success`. `bg-brand` (azul) se conserva para hero/botones.
- **Galería del vehículo**: `components/GaleriaVehiculo.tsx` en `app/vehiculos/[id]` (columna izquierda) — muestra las fotos del propietario (`fotos` + `fotos_detalle`) con transición crossfade + autoplay, miniaturas, flechas y dots. El vehículo 4 (Hyundai Tucson 2023) tiene 5 fotos demo generadas con IA (higgsfield, `public/uploads/tucson23-1..5.jpg`).
- **Banner inicial (hero slider)**: `components/HeroSlider.tsx` (importado en `app/page.tsx`) — banner full-bleed diseñado en Claude Design: slider de 4 vehículos (`public/hero/wide1-4.jpg`, 1600×900, con color grade premium), autoplay 5s + ken burns, fundido a plano azul `#0A1422` a la izquierda (texto legible), copy rotativo + CTA a la derecha, badges glass de confianza y controles (flechas/dots con barra de progreso). CSS del slider en `globals.css` (`.hs-bgslide`/`.hs-scrim`/`dp-kenburns`/`dp-dot-progress`).
- **Logo (nuevo, vectorial)**: `components/Logo.tsx` exporta `<LogoMark>` (tile azul con dos vías blanca+naranja, autocontenido) y `<LogoWordmark>` (mark + texto DrivePass), inline SVG fieles a `assets/logo-*.svg` del DS. Se usan en Navbar, Footer, login, registro, acceso-drivepass y el hero del inicio. Los SVG también están en `public/brand/logo-mark.svg` / `logo-wordmark.svg` para favicon (layout) y el ícono de notificaciones. Los PNG antiguos (`logo-dark/ruta/full/light.png`) quedaron sin uso. **Íconos PWA del logo nuevo** generados con `sharp` (full-bleed, zona segura maskable) en `public/icons/` (`icon-192.png`, `icon-512.png`, `apple-touch-icon.png` 180); `manifest.json` los referencia (any + maskable, `background_color #0A1422`) y `layout.tsx` usa `apple-touch-icon.png`.
- **Fuentes**: Geist Sans + Mono auto-hospedados vía paquete `geist`. **Geist Mono NO se descarga** (la red de fonts está bloqueada en build y colgaba la compilación) → se usa pila monoespaciada del sistema. Para Geist Mono real: auto-hospedar el `.woff2` y anteponerlo en `--font-mono`.
- **Estado: TODA la app convertida a oscuro.**
  - Fase 1: base + chrome (Navbar, BottomNav, Footer) + flujo de cliente (inicio, detalle, login, registro, pago) + componentes (VehiculoCard, LugarSelector, DocUpload, CalendarioDisponibilidad).
  - Fase 2: dashboards (admin/propietario/usuario), chat, historial, páginas informativas (para-usuarios, propietarios-info, términos), acceso-drivepass, CalendarioReservas, FotoUpload.
  - Verificado: 0 clases de color claras numéricas restantes, `tsc` limpio, todas las páginas 200.

## 8. Convenciones a respetar (resumen)
- DB siempre vía `getDb()` y **parametrizada**; nunca concatenar SQL.
- Auth siempre vía `getCurrentUser()`; validar rol **y** ownership.
- Reutilizar helpers de `lib/` antes de escribir nuevos.
- Cambios mínimos y enfocados; TypeScript tipado (evitar `any`).
- Next.js 16 tiene breaking changes → ante dudas, consultar `node_modules/next/dist/docs/`.
- Idioma del producto y de la documentación: español.
