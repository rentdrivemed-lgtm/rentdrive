# RentDrive — Contexto integral del proyecto

> Documento maestro de contexto. Se carga en cada sesión vía `CLAUDE.md`.
> Última actualización del contenido: **2026-07-09**. **Si cambias arquitectura, schema, auth o despliegue, actualiza este archivo.**

## 0. Estado actual y pendientes (al 2026-07-09)

Marca/objetivo del dueño (Victor): ser **el #1 de alquiler de carros en Medellín**. Comunicación en **español**; suele delegar decisiones ("hazlo", "sí", "continúa") y valora que las cosas **funcionen** y se le expliquen los pasos manuales.

**Construido en las últimas sesiones (cada uno tiene su sección detallada abajo):**
- **Gastos de la empresa (Contabilidad)**: sub-pestaña **Gastos** para registrar gastos fijos, variables, facturas de servicios y productos. Se puede **subir PDF/foto** (archivo o cámara) y la IA (Claude vision) **extrae** proveedor, NIT, fecha, subtotal, IVA, total y valor abonado; la imagen **queda guardada como soporte** (Cloudinary). Soporta **pago mixto** (un campo por medio de pago), **total vs. abonado/saldo**, **ver/editar**, **anular** (con confirmación → van a "Anulados", no se borran), **descargar PDF** del gasto y **subir comprobante de pago**. Resumen y filtros por defecto desde el **inicio del año** (no solo mes actual). Thumbnails optimizados con transformaciones Cloudinary (carga rápida).
- **Remisiones automáticas**: al confirmarse el pago del cliente se genera una **remisión a nombre del dueño del vehículo** (`lib/contabilidad.ts` → `generarRemision`, tabla `remisiones`). Al pagar la liquidación al propietario se puede **subir el comprobante** y queda en el historial como soporte.
- **Roles dentro del admin + auditoría** (correos independientes → trazabilidad). Sub-nivel `usuarios.admin_nivel`: **principal** (dueño, todo), **socio** (todo menos crear cuentas de equipo, editar config y ver bitácora completa según matriz), **secretaria** (punto de atención: reservas, operaciones, leads y soporte; **sin** contabilidad, usuarios, config ni auditoría). Matriz única en `lib/permisos.ts` (`AREA_NIVELES`, `puede()`), compartida por cliente (oculta pestañas) y servidor (`lib/guard.ts` → `guardArea()` devuelve 403). Toda acción sensible se registra en la tabla **`auditoria`** (`registrarAuditoria`) y se ve en la pestaña **🧾 Bitácora** (`AuditoriaPanel`): quién, qué, correo, área y hora. El **principal** crea cuentas del equipo y cambia niveles desde Usuarios (con auto-protecciones: no puede quitarse su propio principal ni desactivarse a sí mismo).
- **Soporte iniciado por el admin**: el admin ahora **puede iniciar una conversación** con un propietario o usuario ("＋ Nueva conversación" en SoportePanel → busca contacto en `/api/soporte/contactos`, escribe y envía por `/api/soporte`). Antes solo podía responder conversaciones existentes.
- **Verificador de documentos con IA** (Claude vision): vehículo + arrendador + arrendatario; modo **híbrido** (auto-aprueba alta confianza, resto a revisión humana). Cruce **foto-contra-foto** de tarjeta de propiedad vs. cédula del propietario.
- **Visualización de documentos en admin**: cédula del propietario (Usuarios → perfil) y **cédula + licencia del cliente** (tarjeta de reserva → "Documentos del cliente").
- **Operaciones / logística**: al confirmar una reserva se crea un servicio con checklist (lavar, tanquear, entregar, recibir, inspección); pestaña **Operaciones** (asignar mensajero, checklist, notas, reenvío).
- **Acceso del mensajero por formal enlace/token** (`/m/<token>`, sin contraseña, móvil): ve sus servicios, marca checklist, sube fotos y corre la inspección.
- **Inspección de daños con IA**: compara fotos de **salida vs. entrada** y detecta daños nuevos (rayones, abolladuras, vidrios, etc.).
- **WhatsApp** (helper `lib/whatsapp.ts`): **apagado por defecto** (`WHATSAPP_ENABLED`); usa el bridge personal de hermes en `localhost:3000`.
- **Pico y placa**: editor de rotación manual (pestaña **Configuración**), resaltado de carros restringidos hoy en la lista, y avisos a propietario+cliente (cron 6am vía `CRON_SECRET` + `scripts/pico-placa-cron.sh`).
- **Fix**: `POST /api/vehiculos` no guardaba `placa` (bug); ya guarda. Campo de placa editable en cada carro del dashboard del propietario.

**Pendientes del lado del usuario (manual):**
1. Poner `ANTHROPIC_API_KEY` en `rentdrive/.env.local` → activa verificador e inspección IA (sin ella, esos endpoints dan 503 amable). `.env.local` ya existe con la línea vacía.
2. **Llenar las placas** de los 4 carros existentes (Corolla, CX-5, Spark, Tucson) → requisito del pico y placa (sin placa no hay dígito que comparar).
3. Activar el **cron de pico y placa** (comando en la entrega) y/o `WHATSAPP_ENABLED=true` para envíos reales.
4. Para que el **enlace del mensajero*j abra desde el celular: misma WiFi + `APP_URL` con la IP LAN de la Mac (hoy `192.168.1.34:3100`) o un dominio/túnel en producción.
5. **Crear las cuentas del equipo** desde Admin → **Usuarios** (solo el dueño/**principal**): la **secretaria** (nivel `secretaria`) y los **2 socios** (nivel `socio`) con sus correos independientes. La empresa son **3 socios (60/20/20)** + secretaria en punto de atención + mensajero. Cada cuenta con su correo → la **Bitácora** registra quién hizo cada cambio. (El reparto 60/20/20 es societario/contable; el sistema no lo automatiza hoy.)

**Tema en pausa (asesoría dada, sin construir):** integración de **comparendos/fotomultas**. NO hay API pública del RUNT/SIMIT (captcha, solo entidades autorizadas). Quedó la recomendación: chequeo manual semanal del SIMIT por placa, o contratar una API comercial y enchufarla a un conector + cron. Las fotomultas tardan **15–30 días** en aparecer. Cláusula de contrato: el **arrendatario** asume infracciones durante el alquiler.

**Gotchas operativos (IMPORTANTE para no repetir errores):**
- Dev server en **puerto 3100** (`next dev -p 3100`); el 3000 es el bridge de WhatsApp de hermes. **No correr `npm run build` con el dev activo** (corrompe `.next`).
- Validar con `npx tsc --noEmit` y `eslint`. Hay errores de eslint **preexistentes en todo el proyecto** (`react-hooks/set-state-in-effect`, `immutability` en los `useEffect` de carga, `no-img-element`): NO son míos, no bloquean dev/build. tsc debe quedar en 0.
- Las **migraciones `ALTER TABLE` no se aplican solas** a `rentdrive.db` porque la conexión es un singleton; tras editar `lib/db.ts` hay que aplicar el ALTER también a la BD viva con un script node puntual (better-sqlite3) o reiniciar el server.
- A veces el sandbox no alcanza `localhost:3100` por curl; verificar por `tsc`/lint/disco y por el log del dev. Cuando sí responde: 403/404 = la ruta compiló y el gating funciona; 500 = error real.
- Modelo de la API de Claude: `claude-opus-4-8`, visión por base64, salida estructurada `output_config.format.json_schema` + `effort:'high'` + `thinking:{type:'adaptive'}`.

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
- **Lugares de recogida/entrega**: `lib/lugares.ts` (catálogo de munici*
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
