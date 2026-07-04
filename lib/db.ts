import Database from 'better-sqlite3';
import path from 'path';
import bcrypt from 'bcryptjs';

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
      estado_cuenta TEXT DEFAULT 'activa' CHECK(estado_cuenta IN ('activa','inactiva')),
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
  `);

  try { db.exec("ALTER TABLE vehiculos ADD COLUMN dias_disponibles TEXT DEFAULT '[]'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN fotos_detalle TEXT DEFAULT '{}'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN placa TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN documentos TEXT DEFAULT '{}'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN documentos_estado TEXT DEFAULT 'sin_documentos'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN documentos_nota TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN documentos_revisiones TEXT DEFAULT '{}'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE vehiculos ADD COLUMN en_vitrina INTEGER DEFAULT 0"); } catch { /* ya existe */ }

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

  try { db.exec("ALTER TABLE reservas ADD COLUMN documento_id_url TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN licencia_url TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN firma_contrato TEXT DEFAULT '{}'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN recogida TEXT DEFAULT '{}'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN entrega TEXT DEFAULT '{}'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN recargo REAL DEFAULT 0"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN cancelacion_pct REAL DEFAULT NULL"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN cancelacion_motivo TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN cancelado_en TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE reservas ADD COLUMN no_show INTEGER DEFAULT 0"); } catch { /* ya existe */ }

  try { db.exec("ALTER TABLE mensajeros ADD COLUMN token TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE operaciones ADD COLUMN fotos_salida TEXT DEFAULT '[]'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE operaciones ADD COLUMN fotos_entrada TEXT DEFAULT '[]'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE operaciones ADD COLUMN inspeccion_ia TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE operaciones ADD COLUMN inspeccion_estado TEXT DEFAULT 'pendiente'"); } catch { /* ya existe */ }

  const adminExists = db.prepare("SELECT id FROM usuarios WHERE rol='admin' LIMIT 1").get();
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(`INSERT INTO usuarios (nombre, correo, password, rol) VALUES (?, ?, ?, ?)`)
      .run('Administrador', 'admin@rentdrive.com', hash, 'admin');

    const hashOwner = bcrypt.hashSync('owner123', 10);
    db.prepare(`INSERT INTO usuarios (nombre, correo, password, rol) VALUES (?, ?, ?, ?)`)
      .run('Carlos Propietario', 'propietario@rentdrive.com', hashOwner, 'propietario');

    const propietarioId = (db.prepare("SELECT id FROM usuarios WHERE correo='propietario@rentdrive.com'").get() as { id: number }).id;

    db.prepare(`INSERT INTO vehiculos (propietario_id, marca, modelo, anio, tipo, ubicacion, precio_dia, descripcion, fotos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(propietarioId, 'Toyota', 'Corolla', 2022, 'sedan', 'Medellín', 120000, 'Vehículo en excelente estado, aire acondicionado, bluetooth.', JSON.stringify(['https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?w=400']));

    db.prepare(`INSERT INTO vehiculos (propietario_id, marca, modelo, anio, tipo, ubicacion, precio_dia, descripcion, fotos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(propietarioId, 'Mazda', 'CX-5', 2023, 'suv', 'Medellín', 180000, 'SUV espaciosa perfecta para familia o viajes largos.', JSON.stringify(['https://images.unsplash.com/photo-1544636331-e26879cd4d9b?w=400']));

    db.prepare(`INSERT INTO vehiculos (propietario_id, marca, modelo, anio, tipo, ubicacion, precio_dia, descripcion, fotos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(propietarioId, 'Chevrolet', 'Spark', 2021, 'compacto', 'Medellín', 80000, 'Compacto ideal para la ciudad, bajo consumo de combustible.', JSON.stringify(['https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=400']));

    const hashUser = bcrypt.hashSync('user123', 10);
    db.prepare(`INSERT INTO usuarios (nombre, correo, password, rol) VALUES (?, ?, ?, ?)`)
      .run('María Usuario', 'usuario@rentdrive.com', hashUser, 'usuario');
  }

  // Las fotos demo se sembraron con ancho bajo (?w=400) y se ven pixeladas al mostrarse
  // en tamaños grandes (vitrina del inicio). Se reemplazan por versiones de mayor resolución
  // solo si el vehículo sigue con esa foto exacta (si el propietario ya la cambió, no se toca).
  const fotosBajaRes: Record<string, string> = {
    'https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?w=400': 'https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?w=1600&q=80&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1544636331-e26879cd4d9b?w=400': 'https://images.unsplash.com/photo-1544636331-e26879cd4d9b?w=1600&q=80&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=400': 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1600&q=80&auto=format&fit=crop',
  };
  for (const [vieja, nueva] of Object.entries(fotosBajaRes)) {
    db.prepare(`UPDATE vehiculos SET fotos = ? WHERE fotos = ?`).run(JSON.stringify([nueva]), JSON.stringify([vieja]));
  }
}
