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
  documento_identidad   TEXT DEFAULT '',
  estado_cuenta         TEXT DEFAULT 'activa' CHECK (estado_cuenta IN ('activa','inactiva')),
  celular               TEXT DEFAULT '',
  tipo_documento        TEXT DEFAULT 'cedula',
  fecha_nacimiento      TEXT DEFAULT '',
  direccion             TEXT DEFAULT '',
  ciudad                TEXT DEFAULT 'Medellín',
  numero_licencia       TEXT DEFAULT '',
  contacto_emergencia   TEXT DEFAULT '{}',
  cedula_url            TEXT DEFAULT '',
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
  extraido_ia           INTEGER DEFAULT 0,
  notas                 TEXT DEFAULT '',
  created_by            INTEGER REFERENCES usuarios(id),
  created_at            TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
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
  created_at            TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);
-- Nota: liquidaciones necesita además la columna comprobante_url:
--   ALTER TABLE liquidaciones ADD COLUMN IF NOT EXISTS comprobante_url TEXT DEFAULT '';