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