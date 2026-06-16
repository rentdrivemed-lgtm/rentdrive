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

-- ─────────────── vehiculos ───────────────
CREATE TABLE IF NOT EXISTS vehiculos (
  id                       SERIAL PRIMARY KEY,
  propietario_id           INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  marca                    TEXT NOT NULL,
  modelo                   TEXT NOT NULL,
  anio                     INTEGER NOT NULL,
  tipo                     TEXT NOT NULL DEFAULT 'sedan',
  ubicacion                TEXT NOT NULL DEFAULT 'Medellín',
  precio_dia               DOUBLE PRECISION NOT NULL,
  descripcion              TEXT DEFAULT '',
  fotos                    TEXT DEFAULT '[]',
  disponible               INTEGER DEFAULT 1,
  dias_disponibles         TEXT DEFAULT '[]',
  fotos_detalle            TEXT DEFAULT '{}',
  placa                    TEXT DEFAULT '',
  documentos               TEXT DEFAULT '{}',
  documentos_estado        TEXT DEFAULT 'sin_documentos',
  documentos_nota          TEXT DEFAULT '',
  documentos_revisiones    TEXT DEFAULT '{}',
  created_at               TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_vehiculos_propietario ON vehiculos(propietario_id);

-- ─────────────── conversaciones ───────────────
CREATE TABLE IF NOT EXISTS conversaciones (
  id                SERIAL PRIMARY KEY,
  propietario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  usuario_id        INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  created_at        TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE (propietario_id, usuario_id)
);

-- ─────────────── mensajes ───────────────
CREATE TABLE IF NOT EXISTS mensajes (
  id                SERIAL PRIMARY KEY,
  conversacion_id   INTEGER NOT NULL REFERENCES conversaciones(id) ON DELETE CASCADE,
  remitente_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  contenido         TEXT NOT NULL,
  created_at        TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_mensajes_conv ON mensajes(conversacion_id, id);

-- ─────────────── lecturas ───────────────
CREATE TABLE IF NOT EXISTS lecturas (
  usuario_id         INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  conversacion_id    INTEGER NOT NULL REFERENCES conversaciones(id) ON DELETE CASCADE,
  ultimo_leido_id    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (usuario_id, conversacion_id)
);

-- ─────────────── reservas ───────────────
CREATE TABLE IF NOT EXISTS reservas (
  id                  SERIAL PRIMARY KEY,
  usuario_id          INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  vehiculo_id         INTEGER NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
  fecha_inicio        TEXT NOT NULL,
  fecha_fin           TEXT NOT NULL,
  total               DOUBLE PRECISION NOT NULL,
  pago_estado         TEXT DEFAULT 'pendiente' CHECK (pago_estado IN ('pendiente','pagado','cancelado')),
  estado              TEXT DEFAULT 'pendiente' CHECK (estado IN ('pendiente','confirmada','en_curso','completada','cancelada')),
  fotos_antes         TEXT DEFAULT '[]',
  fotos_despues       TEXT DEFAULT '[]',
  documento_id_url    TEXT DEFAULT '',
  licencia_url        TEXT DEFAULT '',
  firma_contrato      TEXT DEFAULT '{}',
  recogida            TEXT DEFAULT '{}',
  entrega             TEXT DEFAULT '{}',
  recargo             DOUBLE PRECISION DEFAULT 0,
  created_at          TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_reservas_usuario ON reservas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_reservas_vehiculo ON reservas(vehiculo_id);

-- ─────────────── notificaciones ───────────────
CREATE TABLE IF NOT EXISTS notificaciones (
  id                SERIAL PRIMARY KEY,
  destinatario_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo              TEXT NOT NULL,
  titulo            TEXT NOT NULL,
  mensaje           TEXT NOT NULL,
  referencia_id     INTEGER DEFAULT NULL,
  referencia_tipo   TEXT DEFAULT NULL,
  leida             INTEGER DEFAULT 0,
  created_at        TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_notif_destinatario ON notificaciones(destinatario_id, leida);

-- ─────────────── operaciones / logística ───────────────
CREATE TABLE IF NOT EXISTS mensajeros (
  id          SERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL,
  celular     TEXT NOT NULL DEFAULT '',
  activo      INTEGER DEFAULT 1,
  token       TEXT DEFAULT '',
  created_at  TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS operaciones (
  id            SERIAL PRIMARY KEY,
  reserva_id    INTEGER NOT NULL UNIQUE REFERENCES reservas(id) ON DELETE CASCADE,
  mensajero_id  INTEGER DEFAULT NULL REFERENCES mensajeros(id),
  estado        TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','asignada','en_proceso','finalizada')),
  notas         TEXT DEFAULT '',
  wa_admin      TEXT DEFAULT '',
  wa_mensajero  TEXT DEFAULT '',
  fotos_salida      TEXT DEFAULT '[]',
  fotos_entrada     TEXT DEFAULT '[]',
  inspeccion_ia     TEXT DEFAULT '',
  inspeccion_estado TEXT DEFAULT 'pendiente',
  created_at    TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS operacion_tareas (
  id            SERIAL PRIMARY KEY,
  operacion_id  INTEGER NOT NULL REFERENCES operaciones(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL,
  titulo        TEXT NOT NULL,
  detalle       TEXT DEFAULT '',
  estado        TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','hecho')),
  orden         INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS config (
  clave  TEXT PRIMARY KEY,
  valor  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS pico_placa_avisos (
  id          SERIAL PRIMARY KEY,
  reserva_id  INTEGER NOT NULL REFERENCES reservas(id) ON DELETE CASCADE,
  fecha       TEXT NOT NULL,
  created_at  TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE(reserva_id, fecha)
);

-- ============================================================
-- Storage bucket para uploads (fotos vehículos, documentos, etc.)
-- Crear bucket público llamado "uploads" desde el Dashboard:
--   Storage -> New bucket -> name: uploads, public: ON
-- O ejecutar:
INSERT INTO storage.buckets (id, name, public)
VALUES ('uploads', 'uploads', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Policy: lectura pública del bucket
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Public read uploads'
  ) THEN
    CREATE POLICY "Public read uploads"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'uploads');
  END IF;
END $$;
