-- ============================================================
-- RentDrive — Schema completo para Supabase (Postgres)
-- Migración desde SQLite (better-sqlite3) -> Postgres
--
-- Cómo usar:
--   1. Crea (o entra a) tu proyecto en https://supabase.com
--   2. Ve a SQL Editor
--   3. Pega TODO este archivo y ejecuta
--   4. Después corre seed.sql (datos) si quieres preservar los datos
-- ============================================================

-- ─────────────── usuarios ───────────────
CREATE TABLE IF NOT EXISTS usuarios (
  id                    SERIAL PRIMARY KEY,
  nombre                TEXT NOT NULL,
  correo                TEXT UNIQUE NOT NULL,
  password              TEXT NOT NULL,
  rol                   TEXT NOT NULL CHECK (rol IN ('admin','propietario','usuario')),
  admin_nivel           TEXT DEFAULT 'principal',
  permisos_extra        TEXT DEFAULT '{}',   -- excepciones de permisos por empleado (JSON { area: boolean })
  documento_identidad   TEXT DEFAULT '',
  -- 'archivada': cuenta con historial de negocio real (reservas, liquidaciones, remisiones
  -- firmadas, etc.) que no se pudo borrar de verdad al "eliminarla" — ver lib/eliminar.ts.
  estado_cuenta         TEXT DEFAULT 'activa' CHECK (estado_cuenta IN ('activa','inactiva','archivada')),
  celular               TEXT DEFAULT '',
  tipo_documento        TEXT DEFAULT 'cedula',
  fecha_nacimiento      TEXT DEFAULT '',
  direccion             TEXT DEFAULT '',
  ciudad                TEXT DEFAULT 'Medellín',
  numero_licencia       TEXT DEFAULT '',
  contacto_emergencia   TEXT DEFAULT '{}',
  cedula_url            TEXT DEFAULT '',
  google_id             TEXT DEFAULT '',
  -- Verificación de correo por OTP (ver lib/verificacion-correo.ts). DEFAULT 1 para que
  -- una instalación nueva (seed.sql) no arranque con cuentas demo bloqueadas; las cuentas
  -- reales creadas por app/api/auth/registro insertan 0 explícito.
  correo_verificado         INTEGER DEFAULT 1,
  correo_codigo             TEXT DEFAULT '',
  correo_codigo_expira      TEXT DEFAULT '',
  correo_codigo_generado_at TEXT DEFAULT '',
  correo_codigo_intentos    INTEGER DEFAULT 0,
  created_at            TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- ─────────────── gastos (gastos de la empresa) ───────────────
CREATE TABLE IF NOT EXISTS gastos (
  id                    SERIAL PRIMARY KEY,
  categoria             TEXT NOT NULL DEFAULT 'variable' CHECK (categoria IN ('fijo','variable','servicio','producto','otro')),
  proveedor             TEXT DEFAULT '',
  nit_proveedor         TEXT DEFAULT '',
  descripcion           TEXT DEFAULT '',
  numero_factura        TEXT DEFAULT '',
  fecha                 TEXT NOT NULL,
  subtotal              REAL DEFAULT 0,
  iva                   REAL DEFAULT 0,
  total                 REAL NOT NULL DEFAULT 0,
  metodo_pago           TEXT DEFAULT '',
  pagos                 TEXT DEFAULT '[]',
  abonado               REAL DEFAULT 0,
  recurrente            INTEGER DEFAULT 0,
  comprobante_url       TEXT DEFAULT '',
  comprobante_pago_url  TEXT DEFAULT '',
  extraido_ia           INTEGER DEFAULT 0,
  notas                 TEXT DEFAULT '',
  estado                TEXT DEFAULT 'activo',
  anulado_en            TEXT DEFAULT '',
  motivo_anulacion      TEXT DEFAULT '',
  created_by            INTEGER REFERENCES usuarios(id),
  created_at            TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- Catálogo de proveedores — se guardan solos al registrar un gasto (evita
-- retipear) y también se pueden precargar a mano desde Contabilidad → Config.
CREATE TABLE IF NOT EXISTS proveedores (
  id                  SERIAL PRIMARY KEY,
  nombre              TEXT NOT NULL UNIQUE,
  nit                 TEXT DEFAULT '',
  categoria_habitual  TEXT DEFAULT '' CHECK (categoria_habitual IN ('', 'fijo','variable','servicio','producto','otro')),
  notas               TEXT DEFAULT '',
  created_by          INTEGER REFERENCES usuarios(id),
  created_at          TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at          TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- ─────────────── remisiones (documento a nombre del dueño del vehículo) ───────────────
CREATE TABLE IF NOT EXISTS remisiones (
  id                    SERIAL PRIMARY KEY,
  reserva_id            INTEGER NOT NULL UNIQUE REFERENCES reservas(id),
  propietario_id        INTEGER NOT NULL REFERENCES usuarios(id),
  numero                TEXT NOT NULL DEFAULT '',
  propietario_nombre    TEXT DEFAULT '',
  propietario_documento TEXT DEFAULT '',
  vehiculo_descripcion  TEXT DEFAULT '',
  placa                 TEXT DEFAULT '',
  fecha_inicio          TEXT DEFAULT '',
  fecha_fin             TEXT DEFAULT '',
  dias                  INTEGER DEFAULT 0,
  bruto                 REAL DEFAULT 0,
  comision_pct          REAL DEFAULT 0,
  comision_valor        REAL DEFAULT 0,
  neto                  REAL DEFAULT 0,
  -- Firma electrónica simple del propietario sobre la cuenta de cobro: '' = sin firmar.
  -- Es requisito previo al pago (no un recibo posterior) — ver lib/contabilidad.ts → firmarCuentaCobro.
  firmada_en              TEXT DEFAULT '',
  firma_ip                TEXT DEFAULT '',
  firma_user_agent        TEXT DEFAULT '',
  firma_imagen            TEXT DEFAULT '',
  firma_nombre_confirmado TEXT DEFAULT '',
  firma_hash              TEXT DEFAULT '',
  created_at            TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);
-- Nota: liquidaciones necesita además la columna comprobante_url:
--   ALTER TABLE liquidaciones ADD COLUMN IF NOT EXISTS comprobante_url TEXT DEFAULT '';
-- Nota: si la tabla remisiones ya existía antes de este cambio, agregar las columnas de firma:
--   ALTER TABLE remisiones ADD COLUMN IF NOT EXISTS firmada_en TEXT DEFAULT '';
--   ALTER TABLE remisiones ADD COLUMN IF NOT EXISTS firma_ip TEXT DEFAULT '';
--   ALTER TABLE remisiones ADD COLUMN IF NOT EXISTS firma_user_agent TEXT DEFAULT '';
--   ALTER TABLE remisiones ADD COLUMN IF NOT EXISTS firma_imagen TEXT DEFAULT '';
--   ALTER TABLE remisiones ADD COLUMN IF NOT EXISTS firma_nombre_confirmado TEXT DEFAULT '';
--   ALTER TABLE remisiones ADD COLUMN IF NOT EXISTS firma_hash TEXT DEFAULT '';

-- ─────────────── cotizaciones ───────────────
-- reserva_id es NULLABLE a propósito: una cotización puede ser "suelta" (cotizador de
-- venta, prospecto sin cuenta ni reserva) o ligada a una reserva real ya creada. Las
-- sueltas guardan fecha_inicio/fecha_fin/vehiculo_id/cliente_celular propios porque no
-- hay fila de `reservas` de la cual sacarlos (ver lib/contabilidad.ts, generarCotizacionManual).
CREATE TABLE IF NOT EXISTS cotizaciones (
  id                    SERIAL PRIMARY KEY,
  reserva_id            INTEGER REFERENCES reservas(id),
  numero                TEXT NOT NULL DEFAULT '',
  cliente_nombre        TEXT DEFAULT '',
  cliente_correo        TEXT DEFAULT '',
  cliente_celular       TEXT DEFAULT '',
  vehiculo_id           INTEGER REFERENCES vehiculos(id),
  vehiculo_descripcion  TEXT DEFAULT '',
  fecha_inicio          TEXT DEFAULT '',
  fecha_fin             TEXT DEFAULT '',
  dias                  INTEGER DEFAULT 0,
  precio_dia            REAL DEFAULT 0,
  recargo               REAL DEFAULT 0,
  total                 REAL DEFAULT 0,
  estado                TEXT DEFAULT 'enviada' CHECK (estado IN ('enviada','aceptada','vencida','cancelada')),
  enviada_en            TEXT DEFAULT '',
  created_at            TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- ─────────────── facturas (DataICO o borrador local sin credenciales) ───────────────
CREATE TABLE IF NOT EXISTS facturas (
  id                 SERIAL PRIMARY KEY,
  reserva_id         INTEGER NOT NULL REFERENCES reservas(id),
  numero             TEXT NOT NULL DEFAULT '',
  cliente_nombre     TEXT DEFAULT '',
  cliente_documento  TEXT DEFAULT '',
  cliente_correo     TEXT DEFAULT '',
  subtotal           REAL DEFAULT 0,
  iva                REAL DEFAULT 0,
  total              REAL DEFAULT 0,
  estado             TEXT DEFAULT 'borrador' CHECK (estado IN ('borrador','emitida','anulada','error')),
  dataico_id         TEXT DEFAULT '',
  dataico_cufe       TEXT DEFAULT '',
  dataico_pdf_url    TEXT DEFAULT '',
  dataico_error      TEXT DEFAULT '',
  emitida_en         TEXT DEFAULT '',
  created_at         TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- ─────────────── auditoría (bitácora: quién hizo qué y a qué hora) ───────────────
-- El nivel de admin va en usuarios.admin_nivel ('principal' | 'socio' | 'secretaria').
-- Las excepciones por empleado van en usuarios.permisos_extra (JSON { area: boolean });
-- si la tabla ya existía: ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS permisos_extra TEXT DEFAULT '{}';
CREATE TABLE IF NOT EXISTS auditoria (
  id             SERIAL PRIMARY KEY,
  usuario_id     INTEGER REFERENCES usuarios(id),
  usuario_nombre TEXT DEFAULT '',
  usuario_correo TEXT DEFAULT '',
  usuario_nivel  TEXT DEFAULT '',
  area           TEXT DEFAULT '',
  accion         TEXT NOT NULL,
  detalle        TEXT DEFAULT '',
  entidad        TEXT DEFAULT '',
  entidad_id     INTEGER,
  created_at     TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- ─────────────── Panel de Control interno (Tareas / Calendario / Documentos) ───────────────
CREATE TABLE IF NOT EXISTS tareas_equipo (
  id                SERIAL PRIMARY KEY,
  titulo            TEXT NOT NULL,
  descripcion       TEXT DEFAULT '',
  estado            TEXT NOT NULL DEFAULT 'todo' CHECK (estado IN ('todo','proceso','hecho')),
  rol_destino       TEXT DEFAULT '',
  asignado_id       INTEGER REFERENCES usuarios(id),
  asignado_nombre   TEXT DEFAULT '',
  solo_socios       INTEGER DEFAULT 0,
  vence             TEXT DEFAULT '',
  orden             INTEGER DEFAULT 0,
  created_by        INTEGER REFERENCES usuarios(id),
  created_by_nombre TEXT DEFAULT '',
  created_at        TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at        TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS eventos_calendario (
  id                SERIAL PRIMARY KEY,
  titulo            TEXT NOT NULL,
  tipo              TEXT DEFAULT 'general' CHECK (tipo IN ('entrega','devolucion','vencimiento','reunion','general')),
  fecha             TEXT NOT NULL,
  hora              TEXT DEFAULT '',
  nota              TEXT DEFAULT '',
  solo_socios       INTEGER DEFAULT 0,
  created_by        INTEGER REFERENCES usuarios(id),
  created_by_nombre TEXT DEFAULT '',
  created_at        TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS documentos_equipo (
  id                SERIAL PRIMARY KEY,
  nombre            TEXT NOT NULL,
  archivo_url       TEXT DEFAULT '',
  tipo              TEXT DEFAULT 'pdf',
  visible_para      TEXT NOT NULL DEFAULT 'todos' CHECK (visible_para IN ('socios','socios_secretaria','todos')),
  subido_por        INTEGER REFERENCES usuarios(id),
  subido_por_nombre TEXT DEFAULT '',
  estado            TEXT DEFAULT 'activo',
  created_at        TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at        TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- Tableros infinitos colaborativos (tipo Miro) — colaboradores por tablero.
CREATE TABLE IF NOT EXISTS tableros (
  id                SERIAL PRIMARY KEY,
  titulo            TEXT NOT NULL DEFAULT 'Tablero',
  created_by        INTEGER REFERENCES usuarios(id),
  created_by_nombre TEXT DEFAULT '',
  created_at        TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at        TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS tablero_colaboradores (
  id         SERIAL PRIMARY KEY,
  tablero_id INTEGER NOT NULL REFERENCES tableros(id),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  UNIQUE (tablero_id, usuario_id)
);

CREATE TABLE IF NOT EXISTS tablero_elementos (
  id         SERIAL PRIMARY KEY,
  tablero_id INTEGER NOT NULL REFERENCES tableros(id),
  tipo       TEXT NOT NULL,
  x          REAL DEFAULT 0,
  y          REAL DEFAULT 0,
  w          REAL DEFAULT 0,
  h          REAL DEFAULT 0,
  contenido  TEXT DEFAULT '',
  color      TEXT DEFAULT '',
  created_by INTEGER REFERENCES usuarios(id),
  updated_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- ─────────────── moderación de contenido (fotos de vehículo) — modelo ALLOW-LIST ───────────────
-- Registro server-side de TODA foto subida por POST /api/upload (no solo las marcadas),
-- con el resultado de moderación de la IA (misma llamada que detecta la placa) y quién
-- la subió. POST/PUT vehiculos exige que cada URL NUEVA en fotos/fotos_detalle tenga un
-- registro aquí perteneciente al usuario autenticado — así se rechaza cualquier URL que
-- nunca haya pasado por /api/upload (externa inventada) o que pertenezca a otro usuario,
-- sin depender de ningún flag que el cliente pudiera omitir. `url_normalizada` es la
-- clave real de cruce (minúsculas/sin query/sin trailing slash — ver normalizarUrlFoto
-- en lib/moderacion.ts) para que el chequeo no sea evadible con variaciones triviales.
CREATE TABLE IF NOT EXISTS fotos_moderacion (
  id                    SERIAL PRIMARY KEY,
  url                   TEXT UNIQUE NOT NULL,
  url_normalizada       TEXT DEFAULT '',
  usuario_id            INTEGER REFERENCES usuarios(id),
  contenido_inapropiado INTEGER DEFAULT 0,
  motivo                TEXT DEFAULT '',
  created_at            TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);
-- Nota: `vehiculos.contenido_revision` (INTEGER/boolean, default 0) y
-- `vehiculos.contenido_revision_motivo` (TEXT, default '') son columnas nuevas de
-- esta misma feature (moderación de contenido) que pertenecen a la tabla `vehiculos`.
-- ⚠️ IMPORTANTE: a la fecha de este cambio, `vehiculos` YA NO tiene su CREATE TABLE en
-- este archivo (falta desde antes de esta tarea — no es un problema introducido aquí;
-- muchas otras columnas de `vehiculos` usadas por el código real, como `placa`,
-- `documentos`, `documentos_estado`, `en_vitrina`, `valor_comercial`, `precio_manual`,
-- `archivado`, tampoco están documentadas en este schema.sql). Si en algún momento se
-- reconstruye el CREATE TABLE vehiculos para Supabase, agregar ahí también:
--   ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS contenido_revision INTEGER DEFAULT 0;
--   ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS contenido_revision_motivo TEXT DEFAULT '';

-- Tarjetas de presentación virtual (NFC) — una por creador/embajador (y a
-- futuro, por cliente). El HTML autocontenido vive en el volumen persistente
-- y se sirve tal cual en /tarjeta/<slug> para el tag físico.
CREATE TABLE IF NOT EXISTS nfc_cards (
  id              SERIAL PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  usuario_id      INTEGER REFERENCES usuarios(id),
  tipo            TEXT NOT NULL DEFAULT 'embajador' CHECK (tipo IN ('embajador','cliente')),
  creador_nombre  TEXT NOT NULL,
  creador_handle  TEXT DEFAULT '',
  estado          TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','activa','inactiva')),
  audio_manifest  TEXT DEFAULT '[]',
  visitas         INTEGER DEFAULT 0,
  notas           TEXT DEFAULT '',
  created_by      INTEGER REFERENCES usuarios(id),
  created_at      TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at      TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- ═══════════════ Cotizador de Buses (viajes ocasionales) ═══════════════
-- Especificación completa: COTIZADOR-BUSES-SPEC.md (raíz del repo), §3. Reflejo en
-- Postgres del bloque equivalente de lib/db.ts (mismo orden, para comparar lado a lado).
-- Etapa 1 del orden de construcción del spec (§11): solo esquema — todavía no hay
-- endpoints/UI para esto.
--
-- ⚠️ IMPORTANTE (paridad SQLite↔Supabase, gap YA EXISTENTE antes de este cambio, ver nota
-- de `fotos_moderacion` más arriba): este archivo NO tiene `CREATE TABLE vehiculos`, ni
-- `CREATE TABLE config`, ni `CREATE TABLE reservas`. Las tablas de abajo (igual que
-- `cotizaciones`/`remisiones`/`facturas` ya existentes en este archivo) declaran
-- `REFERENCES vehiculos(id)` / `REFERENCES usuarios(id)` siguiendo la misma convención que
-- el resto del archivo, pero ejecutar este script contra un Supabase realmente vacío
-- fallará por la FK a `vehiculos` (tabla inexistente aquí) igual que ya le pasaría hoy a
-- `cotizaciones`/`remisiones`/`facturas`. Esto NO es un problema introducido por este
-- cambio — es el mismo gap preexistente, documentado aquí para que no se repita la
-- sorpresa. Si en algún momento se reconstruye `CREATE TABLE vehiculos` para Supabase,
-- agregar ahí también estas 2 columnas nuevas (COTIZADOR-BUSES-SPEC.md §3):
--   ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS capacidad_pasajeros INTEGER;
--   ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS bus_categoria TEXT;
-- Y si se reconstruye `CREATE TABLE config` (clave/valor), sembrar ahí la clave
-- TOLERANCIA_TARIFA_BUS con valor por defecto '20' (ver lib/db.ts → sembrarConfigBuses).

-- Catálogo fijo de categorías de bus por capacidad de pasajeros (§1 del spec). Semilla de
-- las 6 filas: en Supabase se inserta a mano una sola vez (a diferencia de SQLite, este
-- archivo no corre en cada arranque del proceso), por ejemplo con
-- `INSERT INTO bus_categorias VALUES (...) ON CONFLICT (codigo) DO NOTHING;` — ver la
-- semilla real en lib/db.ts → sembrarBusCategorias() y BUS_CATEGORIAS en
-- lib/busCotizador.ts (las 3 deben quedar sincronizadas).
CREATE TABLE IF NOT EXISTS bus_categorias (
  codigo         TEXT PRIMARY KEY,
  nombre         TEXT NOT NULL,
  capacidad_min  INTEGER NOT NULL,
  capacidad_max  INTEGER NOT NULL,
  orden          INTEGER NOT NULL
);

-- ===== CAPA 1: referencia por categoría (admin, viene del tarifario importado, §9) =====

CREATE TABLE IF NOT EXISTS bus_tarifas_destino_ref (
  id             SERIAL PRIMARY KEY,
  destino        TEXT NOT NULL UNIQUE,
  km             INTEGER,
  px12           REAL, px12_30    REAL,
  px14           REAL, px14_30    REAL,
  px16           REAL, px16_30    REAL,
  px19           REAL, px19_30    REAL,
  px22_25        REAL, px22_25_30 REAL,
  px30_42        REAL, px30_42_30 REAL,
  observaciones  TEXT DEFAULT '',
  activo         INTEGER DEFAULT 1,
  updated_at     TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS bus_tarifas_hora_ref (
  categoria       TEXT PRIMARY KEY REFERENCES bus_categorias(codigo),
  tarifa_hora     REAL NOT NULL DEFAULT 0,
  minimo_horas    REAL NOT NULL DEFAULT 4,
  hora_adicional  REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bus_valor_km_ref (
  categoria               TEXT PRIMARY KEY REFERENCES bus_categorias(codigo),
  valor_km                REAL NOT NULL DEFAULT 0,
  tarifa_minima           REAL NOT NULL DEFAULT 0,
  calculado_de_tarifario  INTEGER DEFAULT 0   -- 1 = promedio automático tarifa/km; 0 = a mano
);

-- ===== CAPA 2: tarifas reales de CADA bus (propietario) =====
-- Un bus ya tiene una categoría fija (vehiculos.bus_categoria), así que aquí solo van los 2
-- precios (base y +30%) de esa categoría por destino — no las 12 columnas de la referencia.

CREATE TABLE IF NOT EXISTS bus_tarifas_destino_veh (
  id             SERIAL PRIMARY KEY,
  vehiculo_id    INTEGER NOT NULL REFERENCES vehiculos(id),
  destino        TEXT NOT NULL,
  km             INTEGER,
  tarifa_base    REAL NOT NULL,
  tarifa_30      REAL NOT NULL,
  observaciones  TEXT DEFAULT '',
  updated_at     TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE (vehiculo_id, destino)
);

CREATE TABLE IF NOT EXISTS bus_tarifas_hora_veh (
  vehiculo_id     INTEGER PRIMARY KEY REFERENCES vehiculos(id),
  tarifa_hora     REAL NOT NULL,
  minimo_horas    REAL NOT NULL,
  hora_adicional  REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bus_valor_km_veh (
  vehiculo_id    INTEGER PRIMARY KEY REFERENCES vehiculos(id),
  valor_km       REAL NOT NULL,
  tarifa_minima  REAL NOT NULL
);

-- ===== Cola de aprobación de cambios de tarifa (§4 del spec) =====
-- `valor_referencia`/`tolerancia_aplicada` (hallazgo auditor-seguridad, ronda post-QA): cada
-- fila queda autocontenida con el valor de referencia y el % de tolerancia vigentes en el
-- MOMENTO de la decisión de auto-aprobar o no — así una auditoría posterior no depende de
-- reconstruir ese contexto desde la tabla `auditoria` (que puede no tener el detalle, o cuya
-- config pudo cambiar después). Ambas quedan NULL cuando el cambio nunca llegó a evaluarse
-- contra una referencia (ej. bug, o flujo que no aplica banda).
CREATE TABLE IF NOT EXISTS bus_tarifas_cambios (
  id                    SERIAL PRIMARY KEY,
  vehiculo_id           INTEGER NOT NULL REFERENCES vehiculos(id),
  propietario_id        INTEGER NOT NULL REFERENCES usuarios(id),
  tipo                  TEXT NOT NULL CHECK (tipo IN ('destino','hora','km')),
  destino               TEXT,                 -- solo si tipo='destino'
  categoria             TEXT NOT NULL,        -- denormalizado, para comparar contra la referencia rápido
  valor_referencia      REAL,                 -- valor de referencia contra el que se comparó al decidir
  tolerancia_aplicada   REAL,                 -- % de tolerancia vigente al momento de la decisión
  valor_anterior        TEXT NOT NULL,        -- JSON: {tarifa_base, tarifa_30} o {tarifa_hora,...} o {valor_km,...}
  valor_propuesto       TEXT NOT NULL,        -- mismo formato
  estado                TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','auto_aprobada','aprobada','rechazada')),
  motivo_admin          TEXT DEFAULT '',
  revisado_por          INTEGER REFERENCES usuarios(id),
  revisado_en           TEXT,
  created_at            TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  CHECK (estado NOT IN ('aprobada','rechazada') OR revisado_por IS NOT NULL)
);

-- Cotizaciones generadas por el cotizador público de buses (log + seguimiento comercial,
-- mismo espíritu que la tabla `cotizaciones` existente para carros).
CREATE TABLE IF NOT EXISTS cotizaciones_bus (
  id               SERIAL PRIMARY KEY,
  numero           TEXT NOT NULL,
  vehiculo_id      INTEGER NOT NULL REFERENCES vehiculos(id),
  categoria        TEXT NOT NULL,
  modo             TEXT NOT NULL CHECK (modo IN ('destino','trayecto','horas')),
  destino          TEXT,
  km               REAL,
  horas            REAL,
  con_recargo      INTEGER DEFAULT 0,
  tarifa_aplicada  REAL NOT NULL,
  recargo_valor    REAL DEFAULT 0,
  total            REAL NOT NULL,
  cliente_nombre   TEXT DEFAULT '',
  cliente_telefono TEXT DEFAULT '',
  fecha_servicio   TEXT DEFAULT '',
  estado           TEXT DEFAULT 'nueva' CHECK (estado IN ('nueva','contactada','confirmada','descartada')),
  created_at       TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);
