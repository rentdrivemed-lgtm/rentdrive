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