import Database from 'better-sqlite3';
import path from 'path';
import bcrypt from 'bcryptjs';
import { getConfig, setConfig } from './operaciones';
import { normalizarUrlFoto } from './moderacion';

const DB_PATH = process.env.NODE_ENV === 'production'
  ? '/app/data/rentdrive.db'
  : path.join(process.cwd(), 'rentdrive.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initDb(db);
  }
  return db;
}

function initDb(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      correo TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      rol TEXT NOT NULL CHECK(rol IN ('admin','propietario','usuario')),
      documento_identidad TEXT,
      -- 'archivada': tiene historial de negocio real (reservas, liquidaciones, remisiones firmadas,
      -- etc.) y por eso NO se puede borrar de verdad; se oculta de listados normales pero se
      -- conserva íntegra (reversible). Ver lib/eliminar.ts. Bases ya existentes se migran con
      -- migrarUsuariosEstadoArchivada() más abajo (SQLite no permite ALTER de un CHECK).
      estado_cuenta TEXT DEFAULT 'activa' CHECK(estado_cuenta IN ('activa','inactiva','archivada')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS vehiculos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      propietario_id INTEGER NOT NULL REFERENCES usuarios(id),
      marca TEXT NOT NULL,
      modelo TEXT NOT NULL,
      anio INTEGER NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'sedan',
      ubicacion TEXT NOT NULL DEFAULT 'Medellín',
      precio_dia REAL NOT NULL,
      descripcion TEXT,
      fotos TEXT DEFAULT '[]',
      disponible INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      propietario_id INTEGER NOT NULL REFERENCES usuarios(id),
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(propietario_id, usuario_id)
    );

    CREATE TABLE IF NOT EXISTS mensajes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversacion_id INTEGER NOT NULL REFERENCES conversaciones(id),
      remitente_id INTEGER NOT NULL REFERENCES usuarios(id),
      contenido TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS lecturas (
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      conversacion_id INTEGER NOT NULL REFERENCES conversaciones(id),
      ultimo_leido_id INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (usuario_id, conversacion_id)
    );

    CREATE TABLE IF NOT EXISTS reservas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      vehiculo_id INTEGER NOT NULL REFERENCES vehiculos(id),
      fecha_inicio TEXT NOT NULL,
      fecha_fin TEXT NOT NULL,
      total REAL NOT NULL,
      pago_estado TEXT DEFAULT 'pendiente' CHECK(pago_estado IN ('pendiente','pagado','cancelado')),
      estado TEXT DEFAULT 'pendiente' CHECK(estado IN ('pendiente','confirmada','en_curso','completada','cancelada')),
      fotos_antes TEXT DEFAULT '[]',
      fotos_despues TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notificaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      destinatario_id INTEGER NOT NULL REFERENCES usuarios(id),
      tipo TEXT NOT NULL,
      titulo TEXT NOT NULL,
      mensaje TEXT NOT NULL,
      referencia_id INTEGER DEFAULT NULL,
      referencia_tipo TEXT DEFAULT NULL,
      leida INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS mensajeros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      celular TEXT NOT NULL DEFAULT '',
      activo INTEGER DEFAULT 1,
      token TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS operaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reserva_id INTEGER NOT NULL UNIQUE REFERENCES reservas(id),
      mensajero_id INTEGER DEFAULT NULL REFERENCES mensajeros(id),
      estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','asignada','en_proceso','finalizada')),
      notas TEXT DEFAULT '',
      wa_admin TEXT DEFAULT '',
      wa_mensajero TEXT DEFAULT '',
      fotos_salida TEXT DEFAULT '[]',
      fotos_entrada TEXT DEFAULT '[]',
      inspeccion_ia TEXT DEFAULT '',
      inspeccion_estado TEXT DEFAULT 'pendiente',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS operacion_tareas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operacion_id INTEGER NOT NULL REFERENCES operaciones(id),
      tipo TEXT NOT NULL,
      titulo TEXT NOT NULL,
      detalle TEXT DEFAULT '',
      estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','hecho')),
      orden INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS config (
      clave TEXT PRIMARY KEY,
      valor TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS pico_placa_avisos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reserva_id INTEGER NOT NULL REFERENCES reservas(id),
      fecha TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(reserva_id, fecha)
    );

    CREATE TABLE IF NOT EXISTS competidores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      url TEXT NOT NULL,
      activo INTEGER DEFAULT 1,
      ajuste_pct REAL DEFAULT -5,
      auto_actualizar INTEGER DEFAULT 0,
      ultimo_check TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS precios_mercado (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      competidor_id INTEGER NOT NULL REFERENCES competidores(id),
      sedan REAL,
      suv REAL,
      compacto REAL,
      pickup REAL,
      encontrado INTEGER DEFAULT 0,
      nota TEXT DEFAULT '',
      datos_raw TEXT DEFAULT '{}',
      fecha TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS leads_propietarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      correo TEXT NOT NULL,
      celular TEXT NOT NULL,
      tipo_vehiculo TEXT DEFAULT '',
      origen TEXT DEFAULT 'calculadora',
      canal_verificacion TEXT DEFAULT '',
      codigo TEXT DEFAULT '',
      codigo_expira TEXT DEFAULT '',
      codigo_generado_at TEXT DEFAULT '',
      codigo_intentos INTEGER DEFAULT 0,
      verificado INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS whatsapp_mensajes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telefono TEXT NOT NULL,
      usuario_id INTEGER,
      rol TEXT DEFAULT '',
      entrante TEXT NOT NULL,
      respuesta TEXT DEFAULT '',
      wa_message_id TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS cotizaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      -- reserva_id es NULLABLE: una cotización puede ser "suelta" (prospecto que aún no
      -- reservó nada, herramienta de venta) o ligada a una reserva real ya creada.
      reserva_id INTEGER REFERENCES reservas(id),
      numero TEXT NOT NULL,
      cliente_nombre TEXT DEFAULT '',
      cliente_correo TEXT DEFAULT '',
      cliente_celular TEXT DEFAULT '',
      -- vehiculo_id: solo se llena si la cotización suelta referencia un carro real del
      -- inventario (para tomar su precio/día vigente); si no aplica queda NULL y se usa
      -- vehiculo_descripcion como texto libre.
      vehiculo_id INTEGER REFERENCES vehiculos(id),
      vehiculo_descripcion TEXT DEFAULT '',
      -- fecha_inicio/fecha_fin: las cotizaciones ligadas a una reserva sacan las fechas del
      -- JOIN con reservas; las sueltas las necesitan guardadas aquí porque no hay reserva.
      fecha_inicio TEXT DEFAULT '',
      fecha_fin TEXT DEFAULT '',
      dias INTEGER DEFAULT 0,
      precio_dia REAL DEFAULT 0,
      recargo REAL DEFAULT 0,
      total REAL DEFAULT 0,
      estado TEXT DEFAULT 'enviada' CHECK(estado IN ('enviada','aceptada','vencida','cancelada')),
      enviada_en TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS facturas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reserva_id INTEGER NOT NULL REFERENCES reservas(id),
      numero TEXT NOT NULL,
      cliente_nombre TEXT DEFAULT '',
      cliente_documento TEXT DEFAULT '',
      cliente_correo TEXT DEFAULT '',
      subtotal REAL DEFAULT 0,
      iva REAL DEFAULT 0,
      total REAL DEFAULT 0,
      estado TEXT DEFAULT 'borrador' CHECK(estado IN ('borrador','emitida','anulada','error')),
      dataico_id TEXT DEFAULT '',
      dataico_cufe TEXT DEFAULT '',
      dataico_pdf_url TEXT DEFAULT '',
      dataico_error TEXT DEFAULT '',
      emitida_en TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS liquidaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reserva_id INTEGER NOT NULL UNIQUE REFERENCES reservas(id),
      propietario_id INTEGER NOT NULL REFERENCES usuarios(id),
      bruto REAL NOT NULL,
      comision_pct REAL NOT NULL,
      comision_valor REAL NOT NULL,
      neto REAL NOT NULL,
      estado TEXT DEFAULT 'pendiente' CHECK(estado IN ('pendiente','pagado')),
      pagado_en TEXT DEFAULT '',
      comprobante TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS referidos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_id INTEGER NOT NULL REFERENCES usuarios(id),
      referido_id INTEGER NOT NULL UNIQUE REFERENCES usuarios(id),
      estado TEXT DEFAULT 'pendiente' CHECK(estado IN ('pendiente','acreditado')),
      recompensa_referrer REAL DEFAULT 0,
      recompensa_referido REAL DEFAULT 0,
      reserva_id_disparador INTEGER DEFAULT NULL,
      acreditado_en TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS conversaciones_soporte (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      solicitante_id INTEGER NOT NULL UNIQUE REFERENCES usuarios(id),
      solicitante_rol TEXT NOT NULL CHECK(solicitante_rol IN ('propietario','usuario')),
      estado TEXT DEFAULT 'ia' CHECK(estado IN ('ia','escalada','resuelta')),
      motivo_escalada TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      actualizado_en TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS mensajes_soporte (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversacion_id INTEGER NOT NULL REFERENCES conversaciones_soporte(id),
      remitente_tipo TEXT NOT NULL CHECK(remitente_tipo IN ('solicitante','admin','ia')),
      remitente_admin_id INTEGER REFERENCES usuarios(id),
      contenido TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS gastos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      categoria TEXT NOT NULL DEFAULT 'variable' CHECK(categoria IN ('fijo','variable','servicio','producto','otro')),
      proveedor TEXT DEFAULT '',
      nit_proveedor TEXT DEFAULT '',
      descripcion TEXT DEFAULT '',
      numero_factura TEXT DEFAULT '',
      fecha TEXT NOT NULL,
      subtotal REAL DEFAULT 0,
      iva REAL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      metodo_pago TEXT DEFAULT '',
      pagos TEXT DEFAULT '[]',
      abonado REAL DEFAULT 0,
      recurrente INTEGER DEFAULT 0,
      comprobante_url TEXT DEFAULT '',
      comprobante_pago_url TEXT DEFAULT '',
      extraido_ia INTEGER DEFAULT 0,
      notas TEXT DEFAULT '',
      estado TEXT DEFAULT 'activo',
      anulado_en TEXT DEFAULT '',
      motivo_anulacion TEXT DEFAULT '',
      created_by INTEGER REFERENCES usuarios(id),
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    -- Catálogo de proveedores — se guardan solos al registrar un gasto (evita
    -- retipear) y también se pueden precargar a mano desde Contabilidad → Config.
    CREATE TABLE IF NOT EXISTS proveedores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL COLLATE NOCASE UNIQUE,
      nit TEXT DEFAULT '',
      categoria_habitual TEXT DEFAULT '' CHECK(categoria_habitual IN ('', 'fijo','variable','servicio','producto','otro')),
      notas TEXT DEFAULT '',
      created_by INTEGER REFERENCES usuarios(id),
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS remisiones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reserva_id INTEGER NOT NULL UNIQUE REFERENCES reservas(id),
      propietario_id INTEGER NOT NULL REFERENCES usuarios(id),
      numero TEXT NOT NULL DEFAULT '',
      propietario_nombre TEXT DEFAULT '',
      propietario_documento TEXT DEFAULT '',
      vehiculo_descripcion TEXT DEFAULT '',
      placa TEXT DEFAULT '',
      fecha_inicio TEXT DEFAULT '',
      fecha_fin TEXT DEFAULT '',
      dias INTEGER DEFAULT 0,
      bruto REAL DEFAULT 0,
      comision_pct REAL DEFAULT 0,
      comision_valor REAL DEFAULT 0,
      neto REAL DEFAULT 0,
      -- Firma electrónica simple del propietario (cuenta de cobro): '' = sin firmar.
      -- Es la autorización previa al pago, no un recibo posterior (ver lib/contabilidad.ts → firmarCuentaCobro).
      firmada_en TEXT DEFAULT '',
      firma_ip TEXT DEFAULT '',
      firma_user_agent TEXT DEFAULT '',
      firma_imagen TEXT DEFAULT '',
      firma_nombre_confirmado TEXT DEFAULT '',
      firma_hash TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS auditoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER REFERENCES usuarios(id),
      usuario_nombre TEXT DEFAULT '',
      usuario_correo TEXT DEFAULT '',
      usuario_nivel TEXT DEFAULT '',
      area TEXT DEFAULT '',
      accion TEXT NOT NULL,
      detalle TEXT DEFAULT '',
      entidad TEXT DEFAULT '',
      entidad_id INTEGER,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    -- ─────────── Panel de Control interno del equipo (Tareas / Calendario / Documentos) ───────────
    -- Kanban de tareas del equipo (Por hacer / En proceso / Hecho).
    CREATE TABLE IF NOT EXISTS tareas_equipo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL,
      descripcion TEXT DEFAULT '',
      estado TEXT NOT NULL DEFAULT 'todo' CHECK(estado IN ('todo','proceso','hecho')),
      rol_destino TEXT DEFAULT '',          -- mensajero | secretaria | socio | '' (etiqueta/color)
      asignado_id INTEGER REFERENCES usuarios(id),
      asignado_nombre TEXT DEFAULT '',
      solo_socios INTEGER DEFAULT 0,        -- 1 = solo la ven dueño/socios (oculto a secretaria)
      vence TEXT DEFAULT '',
      orden INTEGER DEFAULT 0,
      created_by INTEGER REFERENCES usuarios(id),
      created_by_nombre TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    -- Eventos de calendario manuales (los de reservas/vencimientos se derivan en la consulta).
    CREATE TABLE IF NOT EXISTS eventos_calendario (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL,
      tipo TEXT DEFAULT 'general' CHECK(tipo IN ('entrega','devolucion','vencimiento','reunion','general')),
      fecha TEXT NOT NULL,                  -- YYYY-MM-DD
      hora TEXT DEFAULT '',
      nota TEXT DEFAULT '',
      solo_socios INTEGER DEFAULT 0,
      created_by INTEGER REFERENCES usuarios(id),
      created_by_nombre TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    -- Repositorio de documentos del equipo con control de acceso por rol.
    CREATE TABLE IF NOT EXISTS documentos_equipo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      archivo_url TEXT DEFAULT '',
      tipo TEXT DEFAULT 'pdf',              -- pdf | xls | img | link | otro
      visible_para TEXT NOT NULL DEFAULT 'todos' CHECK(visible_para IN ('socios','socios_secretaria','todos')),
      subido_por INTEGER REFERENCES usuarios(id),
      subido_por_nombre TEXT DEFAULT '',
      estado TEXT DEFAULT 'activo',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    -- Tableros infinitos colaborativos (tipo Miro). Cada tablero tiene sus
    -- colaboradores invitados; no todo el equipo ve todos los tableros.
    CREATE TABLE IF NOT EXISTS tableros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL DEFAULT 'Tablero',
      created_by INTEGER REFERENCES usuarios(id),
      created_by_nombre TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS tablero_colaboradores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tablero_id INTEGER NOT NULL REFERENCES tableros(id),
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      UNIQUE(tablero_id, usuario_id)
    );

    CREATE TABLE IF NOT EXISTS tablero_elementos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tablero_id INTEGER NOT NULL REFERENCES tableros(id),
      tipo TEXT NOT NULL,                   -- sticky | text | rect | circle | link | path
      x REAL DEFAULT 0, y REAL DEFAULT 0,
      w REAL DEFAULT 0, h REAL DEFAULT 0,
      contenido TEXT DEFAULT '',            -- texto, html (link) o JSON de puntos (path)
      color TEXT DEFAULT '',
      created_by INTEGER REFERENCES usuarios(id),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    -- Tarjetas de presentación virtual (NFC) — una por creador/embajador (y a
    -- futuro, por cliente). El HTML autocontenido vive en el volumen persistente
    -- (lib/storage.ts) y se sirve tal cual en /tarjeta/<slug> para el tag físico.
    CREATE TABLE IF NOT EXISTS nfc_cards (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      slug            TEXT UNIQUE NOT NULL,
      usuario_id      INTEGER REFERENCES usuarios(id),
      tipo            TEXT NOT NULL DEFAULT 'embajador' CHECK(tipo IN ('embajador','cliente')),
      creador_nombre  TEXT NOT NULL,
      creador_handle  TEXT DEFAULT '',
      estado          TEXT NOT NULL DEFAULT 'borrador' CHECK(estado IN ('borrador','activa','inactiva')),
      audio_manifest  TEXT DEFAULT '[]',    -- JSON [{ nombre, url, public_id }] (Cloudinary)
      visitas         INTEGER DEFAULT 0,
      notas           TEXT DEFAULT '',
      created_by      INTEGER REFERENCES usuarios(id),
      created_at      TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at      TEXT DEFAULT (datetime('now', 'localtime'))
    );

    -- Moderación de contenido (lib/moderacion.ts) — modelo ALLOW-LIST: registro
    -- server-side de TODA foto subida por POST /api/upload (no solo las marcadas),
    -- con el resultado de la IA (misma llamada que detecta la placa, ver
    -- lib/blur-placas.ts) y quién la subió. POST/PUT /api/vehiculos exige que cada
    -- URL nueva en fotos/fotos_detalle tenga un registro aquí perteneciente al
    -- usuario autenticado — así una URL externa inventada, o una que nunca pasó por
    -- /api/upload, se rechaza en vez de aceptarse por defecto. url_normalizada es
    -- la clave real de cruce (minúsculas/sin query/sin trailing slash, ver
    -- normalizarUrlFoto) para que el chequeo no sea evadible con variaciones
    -- triviales de la misma URL.
    CREATE TABLE IF NOT EXISTS fotos_moderacion (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      url                    TEXT UNIQUE NOT NULL,
      url_normalizada        TEXT DEFAULT '',
      usuario_id             INTEGER REFERENCES usuarios(id),
      contenido_inapropiado  INTEGER DEFAULT 0,
      motivo                 TEXT DEFAULT '',
      created_at             TEXT DEFAULT (datetime('now', 'localtime'))
    );

    -- ═══════════════ Cotizador de Buses (viajes ocasionales) ═══════════════
    -- Especificación completa: COTIZADOR-BUSES-SPEC.md (raíz del repo). Etapa 1 del
    -- orden de construcción sugerido en su §11: solo esquema + permisos + lógica pura
    -- de cotización (lib/busCotizador.ts) — todavía NO hay endpoints/UI para esto.

    -- Catálogo fijo de categorías de bus por capacidad de pasajeros (§1 del spec).
    -- Semilla de las 6 filas más abajo (INSERT OR IGNORE, idempotente). Si cambias esta
    -- semilla, cambia también BUS_CATEGORIAS en lib/busCotizador.ts — deben quedar
    -- sincronizadas (la tabla es la fuente para el backend, la constante es el reflejo
    -- para que la UI cliente muestre nombres sin ir a la DB).
    CREATE TABLE IF NOT EXISTS bus_categorias (
      codigo TEXT PRIMARY KEY,           -- 'px12' | 'px14' | 'px16' | 'px19' | 'px22_25' | 'px30_42'
      nombre TEXT NOT NULL,
      capacidad_min INTEGER NOT NULL,
      capacidad_max INTEGER NOT NULL,
      orden INTEGER NOT NULL
    );

    -- ===== CAPA 1: referencia por categoría (admin, viene del tarifario importado, §9) =====

    CREATE TABLE IF NOT EXISTS bus_tarifas_destino_ref (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      destino TEXT NOT NULL,
      km INTEGER,
      px12 REAL, px12_30 REAL, px14 REAL, px14_30 REAL, px16 REAL, px16_30 REAL,
      px19 REAL, px19_30 REAL, px22_25 REAL, px22_25_30 REAL, px30_42 REAL, px30_42_30 REAL,
      observaciones TEXT DEFAULT '',
      activo INTEGER DEFAULT 1,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(destino)
    );

    CREATE TABLE IF NOT EXISTS bus_tarifas_hora_ref (
      categoria TEXT PRIMARY KEY REFERENCES bus_categorias(codigo),
      tarifa_hora REAL NOT NULL DEFAULT 0,
      minimo_horas REAL NOT NULL DEFAULT 4,
      hora_adicional REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS bus_valor_km_ref (
      categoria TEXT PRIMARY KEY REFERENCES bus_categorias(codigo),
      valor_km REAL NOT NULL DEFAULT 0,
      tarifa_minima REAL NOT NULL DEFAULT 0,
      calculado_de_tarifario INTEGER DEFAULT 0  -- 1 = promedio automático tarifa/km; 0 = a mano
    );

    -- ===== CAPA 2: tarifas reales de CADA bus (propietario) =====
    -- Un bus ya tiene una categoría fija (vehiculos.bus_categoria), así que aquí solo van
    -- los 2 precios (base y +30%) de esa categoría por destino — no las 12 columnas de la
    -- tabla de referencia.

    CREATE TABLE IF NOT EXISTS bus_tarifas_destino_veh (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehiculo_id INTEGER NOT NULL REFERENCES vehiculos(id),
      destino TEXT NOT NULL,
      km INTEGER,
      tarifa_base REAL NOT NULL,
      tarifa_30 REAL NOT NULL,
      observaciones TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(vehiculo_id, destino)
    );

    CREATE TABLE IF NOT EXISTS bus_tarifas_hora_veh (
      vehiculo_id INTEGER PRIMARY KEY REFERENCES vehiculos(id),
      tarifa_hora REAL NOT NULL,
      minimo_horas REAL NOT NULL,
      hora_adicional REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS bus_valor_km_veh (
      vehiculo_id INTEGER PRIMARY KEY REFERENCES vehiculos(id),
      valor_km REAL NOT NULL,
      tarifa_minima REAL NOT NULL
    );

    -- ===== Cola de aprobación de cambios de tarifa (§4 del spec) =====
    -- valor_referencia/tolerancia_aplicada (hallazgo auditor-seguridad, ronda post-QA):
    -- cada fila queda autocontenida con el valor de referencia y el % de tolerancia vigentes
    -- en el MOMENTO de la decisión de auto-aprobar o no -- así una auditoría posterior no
    -- depende de reconstruir ese contexto desde la tabla 'auditoria' (que puede no tener el
    -- detalle, o cuya config pudo cambiar después). Ambas quedan NULL cuando el cambio nunca
    -- llegó a evaluarse contra una referencia (ej. bug, o flujo que no aplica banda).
    CREATE TABLE IF NOT EXISTS bus_tarifas_cambios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehiculo_id INTEGER NOT NULL REFERENCES vehiculos(id),
      propietario_id INTEGER NOT NULL REFERENCES usuarios(id),
      tipo TEXT NOT NULL CHECK(tipo IN ('destino','hora','km')),
      destino TEXT,                       -- solo si tipo='destino'
      categoria TEXT NOT NULL,            -- denormalizado, para comparar contra la referencia rápido
      valor_referencia REAL,              -- valor de referencia contra el que se comparó al decidir
      tolerancia_aplicada REAL,           -- % de tolerancia vigente al momento de la decisión
      valor_anterior TEXT NOT NULL,       -- JSON: {tarifa_base, tarifa_30} o {tarifa_hora,...} o {valor_km,...}
      valor_propuesto TEXT NOT NULL,      -- mismo formato
      estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','auto_aprobada','aprobada','rechazada')),
      motivo_admin TEXT DEFAULT '',
      revisado_por INTEGER REFERENCES usuarios(id),
      revisado_en TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      CHECK (estado NOT IN ('aprobada','rechazada') OR revisado_por IS NOT NULL)
    );

    -- Cotizaciones generadas por el cotizador público de buses (log + seguimiento
    -- comercial, mismo espíritu que la tabla 'cotizaciones' existente para carros).
    CREATE TABLE IF NOT EXISTS cotizaciones_bus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT NOT NULL,
      vehiculo_id INTEGER NOT NULL REFERENCES vehiculos(id),
      categoria TEXT NOT NULL,
      modo TEXT NOT NULL CHECK(modo IN ('destino','trayecto','horas')),
      destino TEXT, km REAL, horas REAL,
      con_recargo INTEGER DEFAULT 0,
      tarifa_aplicada REAL NOT NULL,
      recargo_valor REAL DEFAULT 0,
      total REAL NOT NULL,
      cliente_nombre TEXT DEFAULT '',
      cliente_telefono TEXT DEFAULT '',
      fecha_servicio TEXT DEFAULT '',
      estado TEXT DEFAULT 'nueva' CHECK(estado IN ('nueva','contactada','confirmada','descartada')),
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  try { db.exec("ALTER TABLE liquidaciones ADD COLUMN comprobante_url TEXT DEFAULT ''"); } catch { /* ya existe */ }
  // Firma electrónica simple de la cuenta de cobro (remisión) — requisito previo al pago.
  try { db.exec("ALTER TABLE remisiones ADD COLUMN firmada_en TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE remisiones ADD COLUMN firma_ip TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE remisiones ADD COLUMN firma_user_agent TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE remisiones ADD COLUMN firma_imagen TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE remisiones ADD COLUMN firma_nombre_confirmado TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE remisiones ADD COLUMN firma_hash TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE gastos ADD COLUMN pagos TEXT DEFAULT '[]'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE gastos ADD COLUMN abonado REAL DEFAULT 0"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE gastos ADD COLUMN comprobante_pago_url TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE gastos ADD COLUMN estado TEXT DEFAULT 'activo'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE gastos ADD COLUMN anulado_en TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE gastos ADD COLUMN motivo_anulacion TEXT DEFAULT ''"); } catch { /* ya existe */ }

  try { db.exec("ALTER TABLE vehiculos ADD COLUMN dias_disponibles TEXT DEFAULT '[]'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN fotos_detalle TEXT DEFAULT '{}'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN placa TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN documentos TEXT DEFAULT '{}'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN documentos_estado TEXT DEFAULT 'sin_documentos'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN documentos_nota TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN documentos_revisiones TEXT DEFAULT '{}'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN en_vitrina INTEGER DEFAULT 0"); } catch { /* ya existe */ }
  // Precio automático de mercado: el propietario ingresa el valor comercial y la categoría,
  // y el precio/día se calcula solo (lib/precioMercado.ts). `precio_ajuste_pct` afina alta/baja
  // demanda; `precio_manual=1` marca que el admin fijó un precio a mano y NO debe recalcularse.
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN valor_comercial REAL DEFAULT 0"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN precio_ajuste_pct REAL DEFAULT 0"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN precio_manual INTEGER DEFAULT 0"); } catch { /* ya existe */ }
  // Archivado (distinto de `disponible`, que es el toggle operativo del día a día tipo "en
  // mantenimiento"): 1 = el vehículo tiene historial de negocio real (reservas) y por eso no se
  // pudo borrar de verdad al "eliminarlo" — se ocultó de listados públicos/admin pero se conserva
  // íntegro y es reversible. Ver lib/eliminar.ts.
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN archivado INTEGER DEFAULT 0"); } catch { /* ya existe */ }
  // Moderación de contenido de fotos (distinto de `disponible`, que es el toggle operativo
  // del propietario/admin, y distinto de `archivado`): 1 = alguna de las fotos del vehículo
  // fue marcada por la IA como posible contenido sexual/explícito al subirla — el vehículo
  // NO se lista públicamente (GET /api/vehiculos lo excluye igual que archivado) hasta que
  // el equipo lo revise a mano y lo apruebe (PUT { contenido_revision: 0 }). Ver lib/moderacion.ts.
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN contenido_revision INTEGER DEFAULT 0"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN contenido_revision_motivo TEXT DEFAULT ''"); } catch { /* ya existe */ }
  // Cotizador de buses (COTIZADOR-BUSES-SPEC.md §3): un bus reutiliza la tabla `vehiculos`
  // con tipo='bus'. `bus_categoria` se CALCULA desde `capacidad_pasajeros` con
  // categoriaPorPasajeros() (lib/busCotizador.ts) — no es editable a mano, para que un
  // propietario no pueda declarar una categoría más barata/cara que la capacidad real.
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN capacidad_pasajeros INTEGER"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN bus_categoria TEXT"); } catch { /* ya existe */ }

  // Datos que se transcriben de la tarjeta de propiedad (ver lib/vehiculo-campos.ts).
  // `combustible`: uno de gasolina|diesel|hibrido|electrico|gas, o '' si no se declaró.
  // Además de ser informativo, decide —junto con `exencion_pico_placa_inscrita` de más
  // abajo— la exención de pico y placa de Medellín (ver placaRestringida en
  // lib/pico-placa.ts) — por eso el servidor solo acepta valores de esa lista, nunca
  // texto libre.
  // `clase_vehiculo`: la "clase" tal como la imprime el RUNT ('Automóvil', 'Campero',
  // 'Camioneta'…). NO reemplaza a `tipo` (categoría comercial de precio/filtros), es
  // texto descriptivo recortado a 40 caracteres.
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN combustible TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN clase_vehiculo TEXT DEFAULT ''"); } catch { /* ya existe */ }

  // `exencion_pico_placa_inscrita` (0/1): el propietario confirma que YA inscribió la
  // exención de pico y placa ante la Secretaría de Movilidad de Medellín. Solo aplica a
  // híbridos y gas natural (GNV) — su exención NO es automática, requiere ese trámite; los
  // eléctricos quedan exentos por el solo registro en el RUNT. Default 0 = "no inscrita",
  // que deja a todos los vehículos ya existentes exactamente como estaban (restringidos).
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN exencion_pico_placa_inscrita INTEGER DEFAULT 0"); } catch { /* ya existe */ }

  // fotos_moderacion — pasó de "solo registrar fotos sospechosas" a un modelo allow-list
  // (registrar TODA foto subida, ver lib/moderacion.ts). Columnas nuevas para bases ya
  // existentes (una base creada desde cero ya las trae en el CREATE TABLE de arriba).
  try { db.exec("ALTER TABLE fotos_moderacion ADD COLUMN url_normalizada TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE fotos_moderacion ADD COLUMN usuario_id INTEGER REFERENCES usuarios(id)"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE fotos_moderacion ADD COLUMN contenido_inapropiado INTEGER DEFAULT 0"); } catch { /* ya existe */ }
  migrarFotosModeracionNormalizada(db);

  try { db.exec("ALTER TABLE usuarios ADD COLUMN celular TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE usuarios ADD COLUMN tipo_documento TEXT DEFAULT 'cedula'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE usuarios ADD COLUMN fecha_nacimiento TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE usuarios ADD COLUMN direccion TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE usuarios ADD COLUMN ciudad TEXT DEFAULT 'Medellín'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE usuarios ADD COLUMN numero_licencia TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE usuarios ADD COLUMN contacto_emergencia TEXT DEFAULT '{}'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE usuarios ADD COLUMN cedula_url TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE usuarios ADD COLUMN banco TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE usuarios ADD COLUMN numero_cuenta TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE usuarios ADD COLUMN certificado_bancario_url TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE usuarios ADD COLUMN reset_token TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE usuarios ADD COLUMN reset_token_expira TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE usuarios ADD COLUMN celular_indicativo TEXT DEFAULT '+57'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE usuarios ADD COLUMN cedula_url_dorso TEXT DEFAULT ''"); } catch { /* ya existe */ }
  // Foto de cédula/licencia leída con IA en el atajo del registro (app/api/registro/
  // extraer-documento) o en completar-perfil: antes se descartaba siempre; ahora se
  // guarda (best-effort) para no pedírsela de nuevo en la próxima reserva (ver
  // app/pago/page.tsx, que precarga desde acá). `cedula_url`/`cedula_url_dorso` ya
  // existían (arriba) pero solo se usaban para la cédula del PROPIETARIO en su
  // perfil — ahora también se llenan desde el atajo de registro del arrendatario.
  // `licencia_url_dorso` nunca se llena desde el atajo del registro (esa foto solo
  // pide el frente); solo `reservas.licencia_url_dorso` (ya existente) captura el
  // dorso, en cada reserva.
  try { db.exec("ALTER TABLE usuarios ADD COLUMN licencia_url TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE usuarios ADD COLUMN licencia_url_dorso TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE usuarios ADD COLUMN admin_nivel TEXT DEFAULT 'principal'"); } catch { /* ya existe */ }
  // Permisos por empleado: excepciones explícitas al nivel, como mapa JSON { area: boolean }.
  // '{}' (sin excepciones) = la cuenta se comporta exactamente igual que su nivel.
  // Ver lib/permisos.ts — `usuarios_gestion` nunca es asignable por esta vía.
  try { db.exec("ALTER TABLE usuarios ADD COLUMN permisos_extra TEXT DEFAULT '{}'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE usuarios ADD COLUMN codigo_referido TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE usuarios ADD COLUMN referido_por INTEGER DEFAULT NULL"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE usuarios ADD COLUMN creditos_referido REAL DEFAULT 0"); } catch { /* ya existe */ }
  // Login con Google (Identity Services): id de cuenta de Google (`sub` del ID token
  // verificado) para cuentas que entraron/vincularon por ese medio. `password` puede
  // quedar '' para cuentas 100% Google (bcrypt.compareSync('x','') simplemente da
  // false, no lanza excepción, así que el login con correo+contraseña sigue seguro).
  try { db.exec("ALTER TABLE usuarios ADD COLUMN google_id TEXT DEFAULT ''"); } catch { /* ya existe */ }
  // Defensa en profundidad: las cuentas admin nunca deben poder entrar por Google
  // (app/api/auth/google/route.ts ya lo bloquea en runtime), pero por si alguna
  // fila quedó con google_id seteado a mano o por una versión anterior del flujo,
  // se limpia en cada arranque. Idempotente, no falla si la columna aún no existe
  // en la primera corrida (el ALTER de arriba ya la crea antes de llegar aquí).
  try { db.exec("UPDATE usuarios SET google_id = '' WHERE rol = 'admin' AND google_id != ''"); } catch { /* noop */ }

  // Verificación de correo por OTP (ver lib/verificacion-correo.ts). `correo_verificado`
  // usa DEFAULT 1 a propósito: en SQLite, un ALTER TABLE ... ADD COLUMN ... DEFAULT
  // también rellena las filas YA existentes con ese valor — así ninguna cuenta creada
  // antes de esta migración queda retroactivamente bloqueada para reservar/publicar.
  // Las cuentas nuevas creadas después (app/api/auth/registro) insertan explícitamente
  // correo_verificado = 0 y sí pasan por el flujo de código; las creadas por Google
  // (app/api/auth/google) insertan 1 directo, porque Google ya verificó ese correo.
  try { db.exec("ALTER TABLE usuarios ADD COLUMN correo_verificado INTEGER DEFAULT 1"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE usuarios ADD COLUMN correo_codigo TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE usuarios ADD COLUMN correo_codigo_expira TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE usuarios ADD COLUMN correo_codigo_generado_at TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE usuarios ADD COLUMN correo_codigo_intentos INTEGER DEFAULT 0"); } catch { /* ya existe */ }

  try { db.exec("ALTER TABLE reservas ADD COLUMN documento_id_url TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN licencia_url TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN documento_id_url_dorso TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN licencia_url_dorso TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN documento_es_pasaporte INTEGER DEFAULT 0"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN creditos_usados REAL DEFAULT 0"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN firma_contrato TEXT DEFAULT '{}'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN recogida TEXT DEFAULT '{}'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN entrega TEXT DEFAULT '{}'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN recargo REAL DEFAULT 0"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN cancelacion_pct REAL DEFAULT NULL"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN cancelacion_motivo TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN cancelado_en TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN no_show INTEGER DEFAULT 0"); } catch { /* ya existe */ }

  // ── Reserva creada en el punto de atención ("mostrador") ───────────────────
  // Trazabilidad del canal por el que nació la reserva y del pago recibido en
  // persona (ver app/api/admin/reservas y lib/reserva-core.ts). Las filas ya
  // existentes quedan con los valores por defecto: `origen = ''` significa "la
  // app" (el flujo público de siempre), que es exactamente lo que eran.
  //
  // ⚠️ DESPLIEGUE: `insertarReserva` nombra estas 5 columnas en TODA reserva,
  // también en el checkout público. Sobre una base SIN ellas (Postgres/Supabase)
  // no se cae solo el mostrador: no puede reservar NADIE. En SQLite los ALTER de
  // abajo las crean solas; para Postgres están en supabase/schema.sql y hay que
  // aplicarlos ANTES de desplegar.
  //
  // `metodo_pago` va como columna NUEVA y NO como un valor más de `pago_estado`
  // a propósito: `pago_estado` tiene un CHECK (pendiente|pagado|cancelado) y
  // SQLite no permite alterar un CHECK con ALTER TABLE — habría que recrear la
  // tabla entera (patrón `migrarCotizacionesReservaOpcional`), que es un riesgo
  // innecesario para un dato que es ortogonal al estado del pago. La lista de
  // valores válidos (efectivo|transferencia|datafono|otro) se valida en el
  // servidor: ver METODOS_PAGO en lib/reserva-core.ts.
  try { db.exec("ALTER TABLE reservas ADD COLUMN origen TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN creada_por_admin_id INTEGER DEFAULT NULL REFERENCES usuarios(id)"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN metodo_pago TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN pago_referencia TEXT DEFAULT ''"); } catch { /* ya existe */ }
  // Hoy siempre coincide con `creada_por_admin_id` (el mismo empleado que crea la
  // reserva en el mostrador registra el pago en el mismo acto). Se guarda aparte
  // para que mañana se pueda registrar un pago sobre una reserva que nació en la
  // app sin perder quién lo hizo.
  try { db.exec("ALTER TABLE reservas ADD COLUMN pago_registrado_por INTEGER DEFAULT NULL REFERENCES usuarios(id)"); } catch { /* ya existe */ }

  try { db.exec("ALTER TABLE mensajeros ADD COLUMN token TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE operaciones ADD COLUMN fotos_salida TEXT DEFAULT '[]'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE operaciones ADD COLUMN fotos_entrada TEXT DEFAULT '[]'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE operaciones ADD COLUMN inspeccion_ia TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE operaciones ADD COLUMN inspeccion_estado TEXT DEFAULT 'pendiente'"); } catch { /* ya existe */ }

  // Cotizaciones sueltas (cotizador de venta, sin reserva ni cuenta de usuario): columnas
  // nuevas para bases ya existentes (una base creada desde cero ya las trae en el CREATE TABLE).
  try { db.exec("ALTER TABLE cotizaciones ADD COLUMN cliente_celular TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE cotizaciones ADD COLUMN vehiculo_id INTEGER REFERENCES vehiculos(id)"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE cotizaciones ADD COLUMN fecha_inicio TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE cotizaciones ADD COLUMN fecha_fin TEXT DEFAULT ''"); } catch { /* ya existe */ }
  migrarCotizacionesReservaOpcional(db);
  migrarUsuariosEstadoArchivada(db);
  migrarPicoPlacaActivar(db);
  sembrarBusCategorias(db);
  sembrarConfigBuses(db);
  revertirFotoMalTapadaVehiculo10(db);

  const adminExists = db.prepare("SELECT id FROM usuarios WHERE rol='admin' LIMIT 1").get();
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(`INSERT INTO usuarios (nombre, correo, password, rol) VALUES (?, ?, ?, ?)`)
      .run('Administrador', 'admin@rentdrive.com', hash, 'admin');

    const hashOwner = bcrypt.hashSync('owner123', 10);
    db.prepare(`INSERT INTO usuarios (nombre, correo, password, rol) VALUES (?, ?, ?, ?)`)
      .run('Carlos Propietario', 'propietario@rentdrive.com', hashOwner, 'propietario');

    const propietarioId = (db.prepare("SELECT id FROM usuarios WHERE correo='propietario@rentdrive.com'").get() as { id: number }).id;

    // Flota demo: modelos comunes en el mercado colombiano con fotos reales del modelo
    // (public/uploads/*.jpg, versionadas como fixtures) y precios coherentes con el motor
    // de mercado (lib/precioMercado). Reemplazó a las fotos de stock exóticas anteriores.
    const flotaDemo = [
      { marca: 'Mazda',     modelo: '3',        anio: 2020, tipo: 'sedan',      valor: 100_000_000, precio: 380_000, placa: 'HXR421', foto: '/uploads/mazda3.jpg?v=2',
        desc: 'Mazda 3 2020 blanco, hatchback automático. Motor SkyActiv económico, pantalla táctil con Android Auto y CarPlay, cámara de reversa y control crucero. Ágil y elegante para ciudad y viajes.' },
      { marca: 'Chevrolet', modelo: 'Tracker',  anio: 2021, tipo: 'suv',        valor: 95_000_000,  precio: 300_000, placa: 'KMV872', foto: '/uploads/tracker.jpg?v=2',
        desc: 'Chevrolet Tracker 2021 gris, SUV turbo automática. Amplia y de bajo consumo, con pantalla táctil, cámara de reversa y buen baúl. Ideal para familia y carretera.' },
      { marca: 'Kia',       modelo: 'Picanto',  anio: 2015, tipo: 'sedan',      valor: 42_000_000,  precio: 210_000, placa: 'FDS194', foto: '/uploads/picanto.jpg?v=2',
        desc: 'Kia Picanto 2015 azul, hatchback económico y automático. Súper fácil de parquear y de muy bajo consumo, perfecto para moverse por Medellín. Aire acondicionado y bluetooth.' },
      { marca: 'Toyota',    modelo: 'Fortuner', anio: 2018, tipo: 'camioneta7', valor: 175_000_000, precio: 550_000, placa: 'MTG503', foto: '/uploads/fortuner.jpg?v=2',
        desc: 'Toyota Fortuner 2018 negra, 4x4 automática de 7 puestos. Robusta y confiable para viajes largos, carretera y familia grande. Excelente rendimiento y espacio.' },
      { marca: 'Ford',      modelo: 'Explorer', anio: 2010, tipo: 'camioneta7', valor: 80_000_000,  precio: 400_000, placa: 'NPU667', foto: '/uploads/explorer.jpg?v=2',
        desc: 'Ford Explorer 2010 negra, SUV grande de 7 puestos automática. Espaciosa y cómoda, ideal para viajes en familia con todo el equipaje. Mucho espacio interior.' },
    ];
    const insVeh = db.prepare(`INSERT INTO vehiculos (propietario_id, marca, modelo, anio, tipo, ubicacion, precio_dia, valor_comercial, placa, descripcion, fotos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const v of flotaDemo) {
      insVeh.run(propietarioId, v.marca, v.modelo, v.anio, v.tipo, 'Medellín', v.precio, v.valor, v.placa, v.desc, JSON.stringify([v.foto]));
    }

    const hashUser = bcrypt.hashSync('user123', 10);
    db.prepare(`INSERT INTO usuarios (nombre, correo, password, rol) VALUES (?, ?, ?, ?)`)
      .run('María Usuario', 'usuario@rentdrive.com', hashUser, 'usuario');
  }

  // ── Migración de fotos (corre en CADA arranque, también en producción) ──
  // El seed viejo sembró fotos de stock exóticas (Bugatti, Porsche, Camry deportivo) y muchos
  // carros quedaron SIN foto (mostrando el respaldo). Aquí se reemplazan por fotos realistas del
  // modelo (public/uploads/*.jpg, versionadas) o por un placeholder neutro. NUNCA se toca una foto
  // real subida por el propietario (solo se corrigen las exóticas conocidas y los vehículos vacíos).
  const FOTOS_EXOTICAS = [
    'photo-1621007947382-bb3c3994e3fb', // "Corolla" → Camry deportivo
    'photo-1544636331-e26879cd4d9b',    // "CX-5" → Bugatti Chiron
    'photo-1503376780353-7e6692767b70', // "Spark"/respaldo → Porsche Panamera
  ];
  const PLACEHOLDER_FOTO = '/uploads/placeholder-car.svg';
  // clave = (marca+modelo) sin espacios/guiones/mayúsculas → foto realista del modelo
  const FOTOS_POR_MODELO: Record<string, string> = {
    mazda3: '/uploads/mazda3.jpg',
    chevrolettracker: '/uploads/tracker.jpg',
    kiapicanto: '/uploads/picanto.jpg',
    toyotafortuner: '/uploads/fortuner.jpg',
    fordexplorer: '/uploads/explorer.jpg',
    mazdacx5: '/uploads/cx5.jpg',
    mazdacx30: '/uploads/cx30.jpg',
    renaultduster: '/uploads/duster.jpg',
    daciaduster: '/uploads/duster.jpg',
    chevroletspark: '/uploads/spark.jpg',
    toyotacorolla: '/uploads/corolla.jpg',
    toyota4runner: '/uploads/4runner.jpg',
  };
  const normModelo = (marca: string, modelo: string) =>
    `${marca || ''}${modelo || ''}`.toLowerCase().replace(/[^a-z0-9]/g, '');
  const setFoto = db.prepare('UPDATE vehiculos SET fotos = ? WHERE id = ?');
  for (const v of db.prepare('SELECT id, marca, modelo, fotos FROM vehiculos').all() as
       { id: number; marca: string; modelo: string; fotos: string }[]) {
    let fotos: string[] = [];
    try { fotos = JSON.parse(v.fotos || '[]'); } catch { fotos = []; }
    const tieneExotica = fotos.some(f => FOTOS_EXOTICAS.some(e => (f || '').includes(e)));
    const vacio = fotos.length === 0 || fotos.every(f => !f);
    if (!tieneExotica && !vacio) continue; // respeta fotos reales subidas por el propietario
    const nueva = FOTOS_POR_MODELO[normModelo(v.marca, v.modelo)] || PLACEHOLDER_FOTO;
    setFoto.run(JSON.stringify([nueva]), v.id);
  }
}

// SQLite no permite quitar un NOT NULL con ALTER TABLE directo (a diferencia de agregar
// columnas). Para bases ya existentes donde `cotizaciones.reserva_id` todavía es NOT NULL
// (de antes del cotizador de venta), hay que reconstruir la tabla: crear una nueva con el
// schema correcto (reserva_id nullable), copiar los datos, borrar la vieja y renombrar.
// Es un no-op seguro en bases nuevas (creadas ya con el CREATE TABLE de arriba) porque el
// PRAGMA nunca encontrará notnull=1 ahí.
function migrarCotizacionesReservaOpcional(db: Database.Database) {
  const fkEstabaActivo = !!db.pragma('foreign_keys', { simple: true });
  try {
    const cols = db.prepare("PRAGMA table_info(cotizaciones)").all() as Array<{ name: string; notnull: number }>;
    const reservaCol = cols.find(c => c.name === 'reserva_id');
    if (!reservaCol || reservaCol.notnull !== 1) return; // ya es nullable (o la tabla no existe todavía)

    // Patrón oficial de SQLite para reconstruir una tabla con foreign keys de por medio:
    // las FK se desactivan ANTES de abrir la transacción (un PRAGMA foreign_keys dentro de
    // una transacción es un no-op hasta que termina) y se reactivan después.
    if (fkEstabaActivo) db.pragma('foreign_keys = OFF');

    // db.transaction() (no BEGIN/COMMIT manual): better-sqlite3 hace ROLLBACK automático
    // si el callback lanza una excepción a mitad de camino. Con el patrón manual anterior,
    // un fallo dejaba `db.inTransaction` en true de forma PERMANENTE (getDb() es un
    // singleton) y cualquier escritura posterior de la app quedaba metida silenciosamente
    // en esa transacción nunca confirmada. Verificado que SQLite permite DDL (CREATE/DROP/
    // ALTER TABLE) dentro de una transacción explícita, así que este patrón aplica limpio.
    const reconstruir = db.transaction(() => {
      db.exec(`
        CREATE TABLE cotizaciones_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          reserva_id INTEGER REFERENCES reservas(id),
          numero TEXT NOT NULL,
          cliente_nombre TEXT DEFAULT '',
          cliente_correo TEXT DEFAULT '',
          cliente_celular TEXT DEFAULT '',
          vehiculo_id INTEGER REFERENCES vehiculos(id),
          vehiculo_descripcion TEXT DEFAULT '',
          fecha_inicio TEXT DEFAULT '',
          fecha_fin TEXT DEFAULT '',
          dias INTEGER DEFAULT 0,
          precio_dia REAL DEFAULT 0,
          recargo REAL DEFAULT 0,
          total REAL DEFAULT 0,
          estado TEXT DEFAULT 'enviada' CHECK(estado IN ('enviada','aceptada','vencida','cancelada')),
          enviada_en TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now', 'localtime'))
        );

        INSERT INTO cotizaciones_new (
          id, reserva_id, numero, cliente_nombre, cliente_correo, cliente_celular,
          vehiculo_id, vehiculo_descripcion, fecha_inicio, fecha_fin, dias, precio_dia,
          recargo, total, estado, enviada_en, created_at
        )
        SELECT id, reserva_id, numero, cliente_nombre, cliente_correo, cliente_celular,
               vehiculo_id, vehiculo_descripcion, fecha_inicio, fecha_fin, dias, precio_dia,
               recargo, total, estado, enviada_en, created_at
        FROM cotizaciones;

        DROP TABLE cotizaciones;
        ALTER TABLE cotizaciones_new RENAME TO cotizaciones;
      `);
    });
    reconstruir();
    console.log('[db] Migración: cotizaciones.reserva_id ahora es opcional (cotizador de venta).');
  } catch (e) {
    console.error('[db] Migración cotizaciones.reserva_id nullable falló:', e instanceof Error ? e.message : e);
  } finally {
    if (fkEstabaActivo) db.pragma('foreign_keys = ON');
  }
}

// SQLite tampoco permite ampliar los valores de un CHECK existente con ALTER TABLE directo.
// `usuarios.estado_cuenta` necesitó un tercer valor ('archivada', ver lib/eliminar.ts — "eliminar
// inteligente" de cuentas) además de 'activa'/'inactiva'. Mismo patrón de reconstrucción que
// migrarCotizacionesReservaOpcional: crear una tabla nueva con el CHECK correcto, copiar los datos,
// borrar la vieja y renombrar. Es un no-op seguro en bases nuevas (el CREATE TABLE de arriba ya
// trae 'archivada' en el CHECK, así que `sql` de sqlite_master ya la contiene).
//
// A diferencia de `cotizaciones` (pocas columnas fijas), `usuarios` ha ido acumulando ~20 columnas
// por ALTER TABLE a lo largo de las sesiones. En vez de copiarlas todas a mano (fácil de desactualizar
// y de olvidar una), las columnas "base" (las del CREATE TABLE original, con sus constraints reales:
// UNIQUE, NOT NULL, CHECK) se reescriben a mano, y el resto se toman dinámicamente de
// PRAGMA table_info — todas esas columnas agregadas después son siempre nullable con un DEFAULT
// simple (sin CHECK ni UNIQUE propios), así que copiar solo nombre+tipo+default es fiel y seguro.
function migrarUsuariosEstadoArchivada(db: Database.Database) {
  const fkEstabaActivo = !!db.pragma('foreign_keys', { simple: true });
  try {
    const tabla = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='usuarios'").get() as { sql?: string } | undefined;
    if (!tabla?.sql || /archivada/.test(tabla.sql)) return; // ya migrada, o la tabla no existe todavía

    const cols = db.prepare('PRAGMA table_info(usuarios)').all() as
      { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }[];

    const BASE = new Set(['id', 'nombre', 'correo', 'password', 'rol', 'documento_identidad', 'estado_cuenta', 'created_at']);
    const extra = cols.filter(c => !BASE.has(c.name));
    const extraDef = extra
      .map(c => `${c.name} ${c.type || 'TEXT'}${c.dflt_value === null ? '' : ` DEFAULT ${c.dflt_value}`}`)
      .join(',\n        ');

    if (fkEstabaActivo) db.pragma('foreign_keys = OFF');
    const reconstruir = db.transaction(() => {
      db.exec(`
        CREATE TABLE usuarios_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nombre TEXT NOT NULL,
          correo TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          rol TEXT NOT NULL CHECK(rol IN ('admin','propietario','usuario')),
          documento_identidad TEXT,
          estado_cuenta TEXT DEFAULT 'activa' CHECK(estado_cuenta IN ('activa','inactiva','archivada')),
          created_at TEXT DEFAULT (datetime('now'))${extra.length ? ',\n        ' + extraDef : ''}
        );

        INSERT INTO usuarios_new SELECT * FROM usuarios;

        DROP TABLE usuarios;
        ALTER TABLE usuarios_new RENAME TO usuarios;
      `);
    });
    reconstruir();
    console.log('[db] Migración: usuarios.estado_cuenta ahora admite "archivada".');
  } catch (e) {
    console.error('[db] Migración usuarios.estado_cuenta archivada falló:', e instanceof Error ? e.message : e);
  } finally {
    if (fkEstabaActivo) db.pragma('foreign_keys = ON');
  }
}

// Siembra UNA SOLA VEZ la config de pico y placa (Medellín, particulares) con la rotación
// vigente del 3 de agosto al 31 de diciembre de 2026, para corregir un valor de prueba/
// basura que había quedado en `config.pico_placa` en producción (incompleto o inactivo).
//
// IMPORTANTE: esta migración corre en CADA arranque del proceso (getDb() → initDb()), así
// que NO puede decidir si debe sembrar mirando la FORMA de `pico_placa` en cada corrida —
// el panel admin (components/PicoPlacaConfig.tsx / PUT /api/config) permite legítimamente
// desactivar el pico y placa (`activo:false`, ej. medidas especiales o vacaciones) o dejar
// un día laboral sin ningún dígito restringido (`dias['5']=[]`); si la migración siguiera
// "vigilando" eso, revertiría en silencio una decisión real de Victor en el próximo reinicio.
//
// En vez de eso, se usa un marcador de control separado (`pico_placa_seed_v1` en `config`,
// NO expuesto en CLAVES de app/api/config/route.ts — es interno, no editable desde la UI):
// si ya existe, esta función es un no-op total sin importar qué tenga `pico_placa` en ese
// momento (fue corregido antes, o Victor lo cambió después — de cualquier forma ya no es
// responsabilidad de esta migración). Si no existe, es la primera corrida: ahí sí sabemos
// que el valor en producción es basura de prueba vieja (no una decisión real), se siembra
// la rotación real, y se marca el seed como hecho para nunca más re-evaluar el dato.
function migrarPicoPlacaActivar(db: Database.Database) {
  try {
    if (getConfig(db, 'pico_placa_seed_v1')) return; // ya se corrigió una vez — no volver a tocar pico_placa jamás

    const actual = parsePicoPlacaSeguro(getConfig(db, 'pico_placa'));
    const diasCompletos = ['1', '2', '3', '4', '5'].every(d => Array.isArray(actual?.dias?.[d]) && actual.dias[d].length > 0);
    const esBasuraDePrueba = !actual || !actual.activo || !diasCompletos;

    if (esBasuraDePrueba) {
      const valor = JSON.stringify({
        activo: true,
        vigencia: '3 de agosto - 31 de diciembre de 2026',
        dias: { '1': [5, 8], '2': [1, 4], '3': [0, 2], '4': [3, 6], '5': [7, 9] },
      });
      setConfig(db, 'pico_placa', valor);
      console.log('[db] Migración: pico y placa Medellín activado (rotación 2° semestre 2026).');
    }

    setConfig(db, 'pico_placa_seed_v1', '1'); // marca esta corrección como hecha para siempre, pase lo que pase después
  } catch (e) {
    console.error('[db] Migración pico_placa activar falló:', e instanceof Error ? e.message : e);
  }
}

// Semilla del catálogo fijo de categorías de bus (COTIZADOR-BUSES-SPEC.md §1). `INSERT OR
// IGNORE` sobre la PRIMARY KEY (codigo) ya es idempotente por sí solo — no hace falta un
// marcador de "ya corrida" como en migrarPicoPlacaActivar, porque este catálogo nunca se
// edita desde la UI (no hay riesgo de pisar una decisión posterior de Victor). Si cambias
// estos valores, cambia también BUS_CATEGORIAS en lib/busCotizador.ts (deben quedar
// sincronizados: esta tabla es la fuente para el backend, esa constante es el reflejo que
// usa la UI de cliente sin ir a la DB).
function sembrarBusCategorias(db: Database.Database) {
  try {
    const ins = db.prepare(
      'INSERT OR IGNORE INTO bus_categorias (codigo, nombre, capacidad_min, capacidad_max, orden) VALUES (?, ?, ?, ?, ?)'
    );
    const CATEGORIAS: [string, string, number, number, number][] = [
      ['px12', 'Buseta 12 pasajeros', 1, 12, 1],
      ['px14', 'Buseta 14 pasajeros', 13, 14, 2],
      ['px16', 'Buseta 16 pasajeros', 15, 16, 3],
      ['px19', 'Microbús 19 pasajeros', 17, 19, 4],
      ['px22_25', 'Busetón 22-25 pasajeros', 20, 25, 5],
      ['px30_42', 'Bus 30-42 pasajeros', 26, 42, 6],
    ];
    for (const [codigo, nombre, capacidad_min, capacidad_max, orden] of CATEGORIAS) {
      ins.run(codigo, nombre, capacidad_min, capacidad_max, orden);
    }
  } catch (e) {
    console.error('[db] Semilla bus_categorias falló:', e instanceof Error ? e.message : e);
  }
}

// Valor por defecto de la tolerancia de auto-aprobación de tarifas de bus (COTIZADOR-BUSES-
// SPEC.md §4). Mismo patrón de lectura con fallback que `comisionPlataforma()` en
// lib/contabilidad.ts: NO se sobrescribe si el admin ya la cambió (getConfig no vacío), así
// que esto es un no-op seguro en cada arranque después de la primera vez. Se guarda como
// string numérico en PORCENTAJE ENTERO ('20' = ±20%), NO como fracción — a diferencia de
// `comision_plataforma_pct` (que sí es fracción, 0.35). Ver el comentario en
// lib/busCotizador.ts (dentroDeBanda) para la misma convención en el lado de la lógica pura.
function sembrarConfigBuses(db: Database.Database) {
  try {
    if (!getConfig(db, 'TOLERANCIA_TARIFA_BUS')) {
      setConfig(db, 'TOLERANCIA_TARIFA_BUS', '20');
    }
  } catch (e) {
    console.error('[db] Semilla TOLERANCIA_TARIFA_BUS falló:', e instanceof Error ? e.message : e);
  }
}

// Corrección puntual: al probar /api/admin/reprocesar-placas contra un vehículo real
// (id 10, Ford Explorer, placa MFW073), la detección de placa dio un falso positivo en
// una foto de perfil lateral donde la placa no era visible, y el rectángulo amarillo
// quedó tapando el edificio de fondo en vez del vehículo. Esto revierte esa única foto
// (fotos_detalle.lado_derecho) a su URL original. Es idempotente por construcción: el
// WHERE exige que el campo contenga la URL corrupta exacta, así que una vez corregida
// la fila deja de calzar y la migración pasa a ser un no-op para siempre.
function revertirFotoMalTapadaVehiculo10(db: Database.Database) {
  try {
    const URL_CORRUPTA = 'https://res.cloudinary.com/dvtmbf1oe/image/upload/v1787930955/uploads/reproc-placa-10-1787930954481-t1tobgufg0h.jpg';
    const URL_ORIGINAL = 'https://res.cloudinary.com/dvtmbf1oe/image/upload/v1787885327/uploads/1787885323031-36zutopq53d.jpg';

    const fila = db.prepare('SELECT id, fotos_detalle FROM vehiculos WHERE id = 10').get() as
      { id: number; fotos_detalle: string | null } | undefined;
    if (!fila?.fotos_detalle || !fila.fotos_detalle.includes(URL_CORRUPTA)) return; // ya corregido, o no aplica

    let detalle: Record<string, string>;
    try {
      detalle = JSON.parse(fila.fotos_detalle);
    } catch {
      console.error('[db] revertirFotoMalTapadaVehiculo10: fotos_detalle no es JSON válido, se aborta sin tocar nada.');
      return;
    }

    if (detalle.lado_derecho !== URL_CORRUPTA) {
      // La URL corrupta aparece en el texto pero no en el campo esperado — no arriesgar
      // una sobre-escritura genérica de todo el JSON, solo se corrige el campo exacto conocido.
      console.error('[db] revertirFotoMalTapadaVehiculo10: la URL corrupta no está en lado_derecho como se esperaba, se aborta.');
      return;
    }

    detalle.lado_derecho = URL_ORIGINAL;
    db.prepare('UPDATE vehiculos SET fotos_detalle = ? WHERE id = 10').run(JSON.stringify(detalle));
    console.log('[db] Migración: revertida foto mal tapada (falso positivo de placa) del vehículo id=10.');
  } catch (e) {
    console.error('[db] Migración revertirFotoMalTapadaVehiculo10 falló:', e instanceof Error ? e.message : e);
  }
}

// Backfill de `fotos_moderacion.url_normalizada` para filas creadas ANTES del modelo
// allow-list (ver lib/moderacion.ts): esas filas solo tenían `url` (raw) y, por venir
// todas del flujo viejo (que únicamente registraba fotos ya marcadas como sospechosas),
// también se marcan como `contenido_inapropiado = 1` — no había forma de que una fila
// vieja existiera sin haber sido sospechosa. Corre en cada arranque pero es un no-op
// para filas ya migradas (url_normalizada no vacía), así que es seguro repetirlo.
function migrarFotosModeracionNormalizada(db: Database.Database) {
  try {
    const pendientes = db.prepare(
      "SELECT id, url FROM fotos_moderacion WHERE url_normalizada IS NULL OR url_normalizada = ''"
    ).all() as { id: number; url: string }[];
    if (pendientes.length === 0) return;
    const upd = db.prepare('UPDATE fotos_moderacion SET url_normalizada = ?, contenido_inapropiado = 1 WHERE id = ?');
    for (const fila of pendientes) {
      const normalizada = normalizarUrlFoto(fila.url);
      if (normalizada) upd.run(normalizada, fila.id);
    }
    console.log(`[db] Migración: ${pendientes.length} fila(s) de fotos_moderacion con url_normalizada backfilleada.`);
  } catch (e) {
    console.error('[db] Migración fotos_moderacion.url_normalizada falló:', e instanceof Error ? e.message : e);
  }
}

function parsePicoPlacaSeguro(valor: string | undefined): { activo?: boolean; dias?: Record<string, number[]> } | null {
  if (!valor || valor.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(valor);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null; // no es el shape esperado (ej. "123", "[1,2,3]")
    return parsed as { activo?: boolean; dias?: Record<string, number[]> };
  } catch {
    return null;
  }
}
