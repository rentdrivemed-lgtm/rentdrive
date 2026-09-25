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

/**
 * Crea el esquema completo sobre una conexión ya abierta.
 *
 * Exportada para las PRUEBAS: `tests/util/db.ts` abre una base en memoria y la levanta
 * con esta misma función, de modo que la suite corre contra el esquema real —con sus
 * CHECK, sus índices únicos parciales y sus migraciones— y no contra una copia a mano
 * que se desincronizaría al primer ALTER. En la aplicación la sigue llamando `getDb()`
 * y nadie más debería llamarla.
 */
export function initDb(db: Database.Database) {
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
      -- Fotos de cada fase. Conviven DOS formatos y los dos son válidos (ver
      -- lib/fotos-servicio.ts): el legado ["url", "url"] de las operaciones que ya
      -- estaban en producción, y el actual [{"casilla":"tablero","url":"..."}] con
      -- las 8 casillas guiadas. Nunca se reescriben las filas viejas: todo lo que
      -- lee estas columnas pasa por parseFotosServicio(), que acepta los dos.
      fotos_salida TEXT DEFAULT '[]',
      fotos_entrada TEXT DEFAULT '[]',
      -- Casillas que el mensajero NO pudo fotografiar, con el motivo escrito a
      -- mano, quién lo escribió y cuándo: [{fase, casilla, motivo, autor,
      -- autor_tipo, fecha}]. Es la única forma de cerrar una fase sin las 8 fotos,
      -- y sale impresa en el acta de respaldo.
      fotos_omitidas TEXT DEFAULT '[]',
      -- ¿A este servicio se le exigen las 8 casillas por fase?
      -- 0 = no (operaciones que ya existían cuando se lanzaron las casillas, o que
      -- estaban a medio hacer: bloquearlas retroactivamente dejaría servicios en
      -- curso imposibles de cerrar, con el cliente esperando).
      -- 1 = sí (operaciones creadas a partir de ese momento).
      -- El ALTER de abajo deja en 0 todo lo que ya existía y
      -- crearOperacionParaReserva() pone 1 explícitamente en cada INSERT nuevo: el
      -- DEFAULT se queda en 0 a propósito para que el corte sea la fecha de
      -- creación de la operación y no un descuido.
      fotos_guiadas INTEGER DEFAULT 0,
      -- PASO 1 (al ENTREGAR): inventario del estado en que SALE el vehículo, hecho
      -- solo con las fotos de salida. JSON de EstadoEntregaResultado
      -- (lib/inspeccion-vehiculo.ts): {marcas, zonas_no_cubiertas, resumen}. NO es un
      -- veredicto de daños; es la referencia de lo que el carro ya traía, y se le pasa
      -- al paso 2 para que una marca previa no se cuente como daño nuevo.
      entrega_ia TEXT DEFAULT '',
      -- 'pendiente' | 'sin_marcas' | 'con_marcas'.
      entrega_estado TEXT DEFAULT 'pendiente',
      -- PASO 2 (al RECIBIR): el veredicto de la comparación salida vs. entrada.
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

    -- ── Acta de respaldo del servicio (una FOTOGRAFÍA CONGELADA) ────────────
    -- Las fotos de salida/entrada viven en operaciones.fotos_salida/fotos_entrada
    -- y se pueden quitar con el botón × de la miniatura, sin que quede constancia
    -- de nada. Un respaldo que se puede borrar no es un respaldo: por eso el acta
    -- guarda, EN EL MOMENTO EN QUE SE GENERA, una copia de los datos del servicio
    -- (columna datos, JSON) y de la lista de fotos (columna fotos, JSON con
    -- {url, fase}). Quitar después una foto de la operación NO altera ningún acta
    -- ya generada, y lib/limpieza-documentos.ts tiene prohibido borrar de
    -- Cloudinary cualquier URL referenciada acá (si no, el respaldo quedaría con
    -- fotos rotas).
    --
    -- El PDF NO se guarda: se arma al vuelo desde este snapshot
    -- (lib/acta-servicio-pdf.ts), así que lo que se descarga siempre corresponde a
    -- la versión congelada, no a los datos de hoy.
    --
    -- Nunca se pisa una versión: cada generación inserta una fila nueva con la
    -- versión siguiente de esa operación (historial completo y auditable).
    CREATE TABLE IF NOT EXISTS actas_servicio (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operacion_id INTEGER NOT NULL REFERENCES operaciones(id),
      reserva_id INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      datos TEXT NOT NULL DEFAULT '{}',
      fotos TEXT NOT NULL DEFAULT '[]',
      -- 'sistema' = se generó sola al cerrarse el servicio; 'admin' = alguien pulsó
      -- "Generar respaldo" en el panel de Operaciones.
      generada_por TEXT NOT NULL DEFAULT 'sistema' CHECK(generada_por IN ('sistema','admin')),
      generada_por_id INTEGER DEFAULT NULL REFERENCES usuarios(id),
      generada_por_nombre TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(operacion_id, version)
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
      -- Desglose congelado (JSON) de los conceptos que componen el neto EN EL MOMENTO de
      -- emitir/reemitir esta cuenta de cobro: [{tipo,concepto,monto}]. Lo que el propietario
      -- ve y firma tiene que quedar guardado con el documento, no recalcularse después.
      conceptos_json TEXT DEFAULT '[]',
      -- 1 = documento original; 2, 3… = reemisión tras editar la liquidación (la versión
      -- anterior queda copiada íntegra en remisiones_anuladas). El número cambia con la
      -- versión: REM-000012 → REM-000012-R2.
      version INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    -- Copia íntegra de una cuenta de cobro (remisión) YA FIRMADA que quedó anulada porque
    -- la liquidación se editó después de firmarla. NO se borra nunca: es la constancia de
    -- qué monto autorizó el propietario y cuándo. La tabla remisiones conserva una sola fila por
    -- reserva (la vigente, que es la que se puede firmar y pagar); el histórico vive aquí.
    CREATE TABLE IF NOT EXISTS remisiones_anuladas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      remision_id INTEGER NOT NULL REFERENCES remisiones(id),
      reserva_id INTEGER NOT NULL REFERENCES reservas(id),
      propietario_id INTEGER NOT NULL REFERENCES usuarios(id),
      numero TEXT NOT NULL DEFAULT '',
      version INTEGER DEFAULT 1,
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
      conceptos_json TEXT DEFAULT '[]',
      firmada_en TEXT DEFAULT '',
      firma_ip TEXT DEFAULT '',
      firma_user_agent TEXT DEFAULT '',
      firma_imagen TEXT DEFAULT '',
      firma_nombre_confirmado TEXT DEFAULT '',
      firma_hash TEXT DEFAULT '',
      emitida_en TEXT DEFAULT '',
      anulada_en TEXT DEFAULT (datetime('now', 'localtime')),
      anulada_por INTEGER REFERENCES usuarios(id),
      anulada_por_nombre TEXT DEFAULT '',
      motivo_anulacion TEXT DEFAULT ''
    );

    -- Ajuste (descuento/adicional) que quedó PENDIENTE de aplicar a un propietario porque
    -- la liquidación del servicio al que corresponde YA SE PAGÓ (lo pagado no se toca: es
    -- constancia histórica). generarLiquidacion los consume al crear la siguiente
    -- liquidación de ese propietario. Ver lib/contabilidad.ts → consumirAjustesPendientes.
    CREATE TABLE IF NOT EXISTS ajustes_propietario (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      propietario_id INTEGER NOT NULL REFERENCES usuarios(id),
      tipo TEXT NOT NULL CHECK(tipo IN ('descuento','adicional')),
      concepto TEXT NOT NULL,
      monto REAL NOT NULL,
      motivo TEXT NOT NULL DEFAULT '',
      -- A qué reserva/servicio corresponde el ajuste (queda impreso en la cuenta de cobro
      -- donde finalmente se aplique, para que el propietario sepa de dónde sale).
      reserva_origen_id INTEGER REFERENCES reservas(id),
      estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','aplicado','anulado')),
      aplicado_en_liquidacion_id INTEGER REFERENCES liquidaciones(id),
      aplicado_en TEXT DEFAULT '',
      anulado_en TEXT DEFAULT '',
      motivo_anulacion TEXT DEFAULT '',
      created_by INTEGER REFERENCES usuarios(id),
      created_by_nombre TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    -- Líneas que ajustan el neto de UNA liquidación concreta. El neto nunca se escribe a
    -- mano: siempre es bruto − comisión − descuentos + adicionales (lib/liquidacion-calculo.ts).
    CREATE TABLE IF NOT EXISTS liquidacion_conceptos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      liquidacion_id INTEGER NOT NULL REFERENCES liquidaciones(id),
      tipo TEXT NOT NULL CHECK(tipo IN ('descuento','adicional')),
      concepto TEXT NOT NULL,
      monto REAL NOT NULL,
      motivo TEXT NOT NULL DEFAULT '',
      -- Si la línea nació de un ajuste pendiente (caso C: costo detectado después de pagar),
      -- aquí queda el vínculo. El índice único parcial de más abajo es la garantía a nivel
      -- de BD de que un mismo ajuste NO se pueda aplicar dos veces.
      origen_ajuste_id INTEGER REFERENCES ajustes_propietario(id),
      created_by INTEGER REFERENCES usuarios(id),
      created_by_nombre TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_liq_conceptos_liq ON liquidacion_conceptos(liquidacion_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_liq_conceptos_ajuste_unico
      ON liquidacion_conceptos(origen_ajuste_id) WHERE origen_ajuste_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_ajustes_prop_pendientes ON ajustes_propietario(propietario_id, estado);
    CREATE INDEX IF NOT EXISTS idx_remisiones_anuladas_reserva ON remisiones_anuladas(reserva_id);

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

    -- Accesos a documentos de identidad (área 'documentos_id', ver
    -- lib/documentos-acceso.ts). Cada apertura de una cédula, licencia o certificado
    -- consulta esta tabla ANTES de escribir, para no repetir una línea idéntica dentro
    -- de la ventana de deduplicación; sin índice esa consulta sería un recorrido
    -- completo de la bitácora en cada imagen que se pinta en el panel.
    CREATE INDEX IF NOT EXISTS idx_auditoria_doc_acceso
      ON auditoria(area, accion, entidad, entidad_id, created_at);

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
      -- Tapado MANUAL de placa (app/api/admin/tapar-placa): cuando la detección
      -- automática falla, un admin marca los rectángulos a mano sobre la foto y el
      -- servidor estampa el sello de marca. placa_origen_url es la foto ORIGINAL
      -- (la que estaba publicada antes del primer tapado manual): se conserva en
      -- Cloudinary y cada tapado nuevo se deriva de ELLA, nunca de la ya tapada —
      -- si no, los sellos se apilarían uno sobre otro.
      placa_origen_url       TEXT DEFAULT '',
      placa_manual           INTEGER DEFAULT 0,
      placa_manual_usuario_id INTEGER REFERENCES usuarios(id),
      placa_manual_at        TEXT DEFAULT '',
      placa_manual_zonas     TEXT DEFAULT '',
      -- Sellado AUTOMÁTICO de placa (app/api/admin/reprocesar-placas). Comparte
      -- placa_origen_url con el camino manual, y por el MISMO motivo: el sello se estampa
      -- siempre sobre la foto original sin tapar, nunca sobre una ya sellada — si no, cada
      -- corrida le apila un logo más encima a la anterior (pasó de verdad en producción con
      -- el vehículo 13: tres sellos superpuestos). placa_auto_zonas guarda los rectángulos
      -- que se estamparon y sobre qué lienzo, para reconocer que un reproceso nuevo da el
      -- MISMO resultado y no volver a subir la foto (idempotencia real, no solo "no apila").
      placa_auto_zonas       TEXT DEFAULT '',
      -- Retención de placa DIFERIDA. La retención normal escribe
      -- contenido_inapropiado = 1, y eso saca al vehículo de la vitrina pública
      -- (vehiculos.contenido_revision). En un reproceso MASIVO eso puede tumbar media
      -- flota de golpe, así que ese endpoint admite un modo que aplica los sellos y deja la
      -- revisión anotada ACÁ —visible y contable en el panel de placas— sin retirar el
      -- vehículo hasta que una persona la mire. Nunca se difiere una marca de contenido
      -- inapropiado ni un "no se pudo moderar": esas siguen siendo fail-closed.
      placa_revision_pendiente INTEGER DEFAULT 0,
      placa_revision_motivo    TEXT DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS fuentes_pago (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      wompi_fuente_id INTEGER NOT NULL,
      marca TEXT DEFAULT '',
      ultimos4 TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    -- Enlace de un solo uso para que un cliente presencial guarde su tarjeta
    -- SIN cobrarle nada (ver app/guardar-tarjeta/[token] y lib/pagos.ts). El
    -- admin lo genera desde la ficha del cliente y se lo manda por su cuenta
    -- (WhatsApp, SMS, lo que sea) — RentDrive no envía nada automáticamente.
    CREATE TABLE IF NOT EXISTS enlaces_tarjeta (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      usado INTEGER DEFAULT 0,
      creado_por INTEGER NOT NULL REFERENCES usuarios(id),
      expira_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS cargos_extra (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reserva_id INTEGER NOT NULL REFERENCES reservas(id),
      tipo TEXT NOT NULL CHECK(tipo IN ('multa','dano','otro')),
      descripcion TEXT NOT NULL,
      monto REAL NOT NULL,
      estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','cobrado','fallido')),
      wompi_transaccion_id TEXT DEFAULT '',
      creado_por INTEGER NOT NULL REFERENCES usuarios(id),
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
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
  // Liquidaciones editables: desglose congelado y versión del documento (ver la tabla
  // `liquidacion_conceptos` y lib/contabilidad.ts → sincronizarCuentaCobro).
  try { db.exec("ALTER TABLE remisiones ADD COLUMN conceptos_json TEXT DEFAULT '[]'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE remisiones ADD COLUMN version INTEGER DEFAULT 1"); } catch { /* ya existe */ }
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
  // Tapado manual de placa (ver el CREATE TABLE de arriba y app/api/admin/tapar-placa).
  try { db.exec("ALTER TABLE fotos_moderacion ADD COLUMN placa_origen_url TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE fotos_moderacion ADD COLUMN placa_manual INTEGER DEFAULT 0"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE fotos_moderacion ADD COLUMN placa_manual_usuario_id INTEGER REFERENCES usuarios(id)"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE fotos_moderacion ADD COLUMN placa_manual_at TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE fotos_moderacion ADD COLUMN placa_manual_zonas TEXT DEFAULT ''"); } catch { /* ya existe */ }
  // Sellado automático seguro + retención diferida (ver el CREATE TABLE de arriba y
  // app/api/admin/reprocesar-placas).
  try { db.exec("ALTER TABLE fotos_moderacion ADD COLUMN placa_auto_zonas TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE fotos_moderacion ADD COLUMN placa_revision_pendiente INTEGER DEFAULT 0"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE fotos_moderacion ADD COLUMN placa_revision_motivo TEXT DEFAULT ''"); } catch { /* ya existe */ }
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

  // ── Autorización para alquilar UN SOLO DÍA (sep-2026) ─────────────────────
  //
  // Por la web el mínimo son 2 noches (`MIN_NOCHES_POR_VIA`), y existe para evitar
  // alquileres de un día pedidos a ciegas por internet. Decisión del dueño: un cliente
  // concreto SÍ puede pedir un día suelto si el equipo lo autoriza antes.
  //
  // La autorización es DE UN SOLO USO: habilita una reserva y se consume al crearla.
  // Se modela como bandera + metadatos (quién, cuándo, por qué) en vez de una tabla
  // aparte porque es un atributo del cliente, no una entidad con vida propia; los
  // metadatos existen para que en la bitácora se pueda responder «¿quién autorizó
  // esto?» sin tener que cruzar tablas.
  //
  // `dia_suelto_usado_en` / `dia_suelto_reserva_id` NO se borran al consumirla: son el
  // rastro de en qué reserva se gastó la última autorización concedida.
  for (const col of [
    'dia_suelto_autorizado INTEGER DEFAULT 0',
    'dia_suelto_autorizado_por INTEGER REFERENCES usuarios(id)',
    "dia_suelto_autorizado_por_nombre TEXT DEFAULT ''",
    "dia_suelto_autorizado_en TEXT DEFAULT ''",
    "dia_suelto_motivo TEXT DEFAULT ''",
    "dia_suelto_usado_en TEXT DEFAULT ''",
    'dia_suelto_reserva_id INTEGER',
  ]) {
    try { db.exec(`ALTER TABLE usuarios ADD COLUMN ${col}`); } catch { /* ya existe */ }
  }

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
  try { db.exec("ALTER TABLE reservas ADD COLUMN wompi_transaccion_id TEXT DEFAULT ''"); } catch { /* ya existe */ }

  try { db.exec("ALTER TABLE mensajeros ADD COLUMN token TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE operaciones ADD COLUMN fotos_salida TEXT DEFAULT '[]'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE operaciones ADD COLUMN fotos_entrada TEXT DEFAULT '[]'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE operaciones ADD COLUMN inspeccion_ia TEXT DEFAULT ''"); } catch { /* ya existe */ }
  // Casillas guiadas de fotos (ver el CREATE TABLE de arriba y lib/fotos-servicio.ts).
  // `fotos_guiadas` entra con DEFAULT 0 a propósito: TODAS las operaciones que ya
  // existían quedan exentas del bloqueo de las 8 fotos. Las que ya están cerradas no
  // se pueden "descerrar" para cumplir un requisito que no existía, y las que están a
  // medio hacer tienen al mensajero en la calle con el cliente delante. Solo las
  // operaciones creadas a partir de acá nacen con 1 (lo pone el INSERT de
  // `crearOperacionParaReserva`, no el DEFAULT).
  try { db.exec("ALTER TABLE operaciones ADD COLUMN fotos_omitidas TEXT DEFAULT '[]'"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE operaciones ADD COLUMN fotos_guiadas INTEGER DEFAULT 0"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE operaciones ADD COLUMN inspeccion_estado TEXT DEFAULT 'pendiente'"); } catch { /* ya existe */ }
  // Análisis del estado de ENTREGA (paso 1, ver el CREATE TABLE de arriba). Las
  // operaciones que ya existían quedan con '' y 'pendiente': nunca se les corrió, y la
  // comparación (paso 2) sigue funcionando igual sin inventario.
  try { db.exec("ALTER TABLE operaciones ADD COLUMN entrega_ia TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE operaciones ADD COLUMN entrega_estado TEXT DEFAULT 'pendiente'"); } catch { /* ya existe */ }

  // ── El reporte que alimenta el ACTA (sep-2026) ──
  //
  // Hasta ahora el acta de entrega y devolución imprimía su inventario, el kilometraje
  // y el nivel de combustible EN BLANCO, para llenar a mano, mientras el mensajero
  // tomaba fotos en la app. Los mismos datos, dos veces, y uno de los dos en papel.
  //
  // Estas columnas son ese dato, ya estructurado, para que el acta lo imprima en vez de
  // dejar rayas. Van por FASE —salida = entrega al cliente, entrada = devolución—
  // igual que las fotos, con las que comparten el momento en que se recogen.
  //
  //   · kilometraje_*  → número del odómetro (NULL = todavía no se tomó).
  //   · combustible_*  → nivel en octavos, 0 a 8 (NULL = todavía no se tomó). En
  //     octavos y no en texto libre porque es lo que marca la aguja y lo que el
  //     contrato exige comparar entre la entrega y la devolución.
  //   · inventario_*   → JSON { "<ítem>": { "estado": "B"|"R"|"M", "nota": "..." } }
  //     con los ítems de ITEMS_ESTADO_VEHICULO.
  //   · *_confirmado_* → el CLIENTE confirma lo que anotó el mensajero. Si no puede
  //     (no está, no tiene el celular a mano), el mensajero deja constancia en
  //     `*_constancia` y la entrega sigue: no se bloquea la operación por eso.
  for (const fase of ['salida', 'entrada']) {
    try { db.exec(`ALTER TABLE operaciones ADD COLUMN kilometraje_${fase} INTEGER`); } catch { /* ya existe */ }
    try { db.exec(`ALTER TABLE operaciones ADD COLUMN combustible_${fase} INTEGER`); } catch { /* ya existe */ }
    try { db.exec(`ALTER TABLE operaciones ADD COLUMN inventario_${fase} TEXT DEFAULT '{}'`); } catch { /* ya existe */ }
    try { db.exec(`ALTER TABLE operaciones ADD COLUMN ${fase}_confirmado_en TEXT DEFAULT ''`); } catch { /* ya existe */ }
    try { db.exec(`ALTER TABLE operaciones ADD COLUMN ${fase}_confirmado_por INTEGER REFERENCES usuarios(id)`); } catch { /* ya existe */ }
    try { db.exec(`ALTER TABLE operaciones ADD COLUMN ${fase}_constancia TEXT DEFAULT ''`); } catch { /* ya existe */ }
  }

  // Quién intervino en el reporte, cuándo y qué hizo.
  //
  // La bitácora general (`auditoria`) no sirve para esto: solo cubría cuatro acciones
  // del módulo —no registraba subir una foto ni editar el inventario— y además solo la
  // ven `principal` y `socio`, mientras que esto tiene que verse en el ACTA y en la
  // ficha de la reserva, que es donde importa saber quién entregó y quién recibió.
  //
  // `usuario_id` va en NULL para el MENSAJERO, que entra por token y no tiene cuenta:
  // su identidad es el nombre asociado al token, que es lo que se guarda en `nombre`.
  db.exec(`
    CREATE TABLE IF NOT EXISTS operacion_intervenciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operacion_id INTEGER NOT NULL REFERENCES operaciones(id),
      -- '' para el mensajero (no tiene cuenta); el id de la cuenta para el equipo.
      usuario_id INTEGER REFERENCES usuarios(id),
      nombre TEXT NOT NULL DEFAULT '',
      -- 'mensajero' | 'principal' | 'socio' | 'secretaria'
      rol TEXT NOT NULL DEFAULT '',
      -- 'fotos_entrega' | 'fotos_devolucion' | 'inventario_entrega' |
      -- 'inventario_devolucion' | 'confirmacion_cliente' | 'constancia'
      accion TEXT NOT NULL,
      fase TEXT NOT NULL DEFAULT '' CHECK(fase IN ('', 'salida', 'entrada')),
      detalle TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_intervenciones_operacion
      ON operacion_intervenciones(operacion_id, created_at);
  `);

  // Cotizaciones sueltas (cotizador de venta, sin reserva ni cuenta de usuario): columnas
  // nuevas para bases ya existentes (una base creada desde cero ya las trae en el CREATE TABLE).
  try { db.exec("ALTER TABLE cotizaciones ADD COLUMN cliente_celular TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE cotizaciones ADD COLUMN vehiculo_id INTEGER REFERENCES vehiculos(id)"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE cotizaciones ADD COLUMN fecha_inicio TEXT DEFAULT ''"); } catch { /* ya existe */ }
  try { db.exec("ALTER TABLE cotizaciones ADD COLUMN fecha_fin TEXT DEFAULT ''"); } catch { /* ya existe */ }
  // ── Contratos digitales (fase 2: la firma) ─────────────────────────────────
  // Va al FINAL y con `CREATE TABLE IF NOT EXISTS` en un `exec` propio —y no dentro
  // del bloque grande de arriba— para que una base ya existente lo reciba igual y
  // para no chocar con otras migraciones en curso sobre este mismo archivo.
  // Reflejo en Postgres: supabase/schema.sql, bloque «contratos digitales».
  crearTablasContratos(db);
  // Los DATOS que rellenan los contratos y que hasta ahora no tenían dónde vivir
  // (motor, chasis, color, carátula de la póliza, categoría y vigencia de la
  // licencia) + el parche por operación. Ver lib/contratos-campos.ts.
  crearColumnasDatosContrato(db);

  migrarCotizacionesReservaOpcional(db);
  migrarUsuariosEstadoArchivada(db);
  migrarContratosVinculacion(db);
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

// ── Contratos de VINCULACIÓN (los que se firman al registrarse) ─────────────
//
// Hasta sep-2026 TODO contrato colgaba de una reserva y de un vehículo concretos:
// `reserva_id` y `vehiculo_id` eran NOT NULL. Los dos documentos nuevos —el que
// firma el cliente y el que firma el propietario al crear su cuenta— no tienen ni
// lo uno ni lo otro: se firman ANTES de que exista ninguna reserva.
//
// Se reutiliza la tabla `contratos` en vez de crear una paralela, a propósito: el
// motor de firmas (bloques, sellos HMAC, anulación con reemisión, vía papel, PDF)
// ya está construido y auditado sobre ella. Una tabla aparte obligaría a duplicarlo
// y a mantener dos verdades sobre qué es un documento firmado.
//
// Cómo se representan las partes, sin columnas nuevas:
//
//   · vinculacion-cliente      → cliente_id = el titular · propietario_id = NULL
//   · vinculacion-propietario  → propietario_id = el titular · cliente_id = NULL
//
// Eso encaja tal cual con `accesoContrato()` (lib/contratos-acceso.ts), que decide
// el papel comparando la cuenta contra esas dos columnas, y con los roles de bloque
// 'cliente'/'propietario'/'agente' que ya existen.
//
// El `UNIQUE(reserva_id, tipo, version)` de la tabla NO sirve para estos: en SQLite
// dos NULL nunca colisionan, así que no impediría emitir el mismo documento dos
// veces. Por eso abajo van dos índices únicos PARCIALES, uno por cada titular.
function migrarContratosVinculacion(db: Database.Database) {
  const fkEstabaActivo = !!db.pragma('foreign_keys', { simple: true });
  try {
    const tabla = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='contratos'").get() as { sql?: string } | undefined;
    if (!tabla?.sql) return;                                   // la tabla todavía no existe
    if (!/autorizacion-datos/.test(tabla.sql)) {
      // Columnas BASE reescritas a mano (conservan sus constraints reales); el resto
      // —las añadidas por ALTER a lo largo de las sesiones: via_firma, papel_*,
      // datos_revision— se copian dinámicamente, igual que en la migración de
      // `usuarios`. Todas ellas son nullable con un DEFAULT simple.
      const cols = db.prepare('PRAGMA table_info(contratos)').all() as
        { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }[];

      const BASE = [
        'id', 'reserva_id', 'vehiculo_id', 'propietario_id', 'cliente_id', 'tipo', 'numero',
        'version', 'estado', 'texto', 'datos_json', 'faltantes_json', 'generado_por',
        'generado_por_nombre', 'firmado_en', 'anulado_en', 'anulado_por', 'anulado_por_nombre',
        'motivo_anulacion', 'created_at',
      ];
      const baseSet = new Set(BASE);
      const extra = cols.filter(c => !baseSet.has(c.name));
      const extraDef = extra
        .map(c => `${c.name} ${c.type || 'TEXT'}${c.dflt_value === null ? '' : ` DEFAULT ${c.dflt_value}`}`)
        .join(',\n          ');

      // Lista explícita de columnas para el INSERT (nunca `SELECT *`): en una base que
      // ya recibió ALTERs, el orden físico de la tabla vieja no tiene por qué coincidir
      // con el de la nueva.
      const copiadas = [...BASE.filter(n => cols.some(c => c.name === n)), ...extra.map(c => c.name)];
      const listaCols = copiadas.join(', ');

      if (fkEstabaActivo) db.pragma('foreign_keys = OFF');
      const reconstruir = db.transaction(() => {
        db.exec(`
          CREATE TABLE contratos_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            -- Opcionales desde sep-2026: los contratos de vinculación no tienen reserva
            -- ni vehículo. Para los otros seis tipos siguen llegando siempre llenos.
            reserva_id INTEGER REFERENCES reservas(id),
            vehiculo_id INTEGER REFERENCES vehiculos(id),
            -- También opcionales: en un contrato de vinculación solo hay UNA parte
            -- además de DrivePass (el cliente o el propietario, según el tipo).
            propietario_id INTEGER REFERENCES usuarios(id),
            cliente_id INTEGER REFERENCES usuarios(id),
            -- Los dos 'vinculacion-*' ya no se emiten (los sustituyó 'autorizacion-datos',
            -- ver lib/contratos-registro-texto.ts) pero SIGUEN en la lista: quitarlos
            -- haría fallar la copia de cualquier base que tenga uno emitido, y esta
            -- migración no puede perder documentos.
            tipo TEXT NOT NULL CHECK(tipo IN ('agencia','otrosi-agencia','arrendamiento','otrosi-arrendamiento','acta-entrega','pagare','vinculacion-cliente','vinculacion-propietario','autorizacion-datos')),
            numero TEXT NOT NULL DEFAULT '',
            version INTEGER NOT NULL DEFAULT 1,
            estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','firmado','anulado')),
            texto TEXT NOT NULL,
            datos_json TEXT NOT NULL DEFAULT '{}',
            faltantes_json TEXT NOT NULL DEFAULT '[]',
            generado_por INTEGER REFERENCES usuarios(id),
            generado_por_nombre TEXT DEFAULT '',
            firmado_en TEXT DEFAULT '',
            anulado_en TEXT DEFAULT '',
            anulado_por INTEGER REFERENCES usuarios(id),
            anulado_por_nombre TEXT DEFAULT '',
            motivo_anulacion TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now', 'localtime'))${extra.length ? ',\n            ' + extraDef : ''},
            UNIQUE(reserva_id, tipo, version)
          );

          INSERT INTO contratos_new (${listaCols}) SELECT ${listaCols} FROM contratos;

          DROP TABLE contratos;
          ALTER TABLE contratos_new RENAME TO contratos;

          CREATE INDEX IF NOT EXISTS idx_contratos_reserva ON contratos(reserva_id);
          CREATE INDEX IF NOT EXISTS idx_contratos_cliente ON contratos(cliente_id);
          CREATE INDEX IF NOT EXISTS idx_contratos_propietario ON contratos(propietario_id);
        `);
      });
      reconstruir();
      console.log('[db] Migración: contratos admite la autorización de datos del registro.');
    }

    // Unicidad de los documentos SIN reserva. Cada familia tiene su propia IDENTIDAD, y
    // por eso son tres índices y no uno: mezclarlas hacía chocar documentos legítimos.
    //
    //   · autorizacion-datos → una por titular. No tiene vehículo, así que la identidad
    //     es la persona (en cliente_id o en propietario_id, según su rol).
    //   · agencia            → uno por VEHÍCULO. El propietario se deduce del vehículo;
    //     incluirlo en la clave no añade nada.
    //   · arrendamiento      → uno por vehículo y CLIENTE. El marco nombra la placa, así
    //     que un cliente que alquile dos carros suscribe dos marcos, y dos clientes del
    //     MISMO carro suscriben uno cada uno. Esto último es lo que rompía la versión
    //     anterior de estos índices, que solo miraba al propietario.
    db.exec(`
      DROP INDEX IF EXISTS idx_contratos_vinculacion_cliente;
      DROP INDEX IF EXISTS idx_contratos_vinculacion_propietario;
      DROP INDEX IF EXISTS idx_contratos_sin_reserva_cliente;
      DROP INDEX IF EXISTS idx_contratos_sin_reserva_propietario;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_contratos_autorizacion_cliente
        ON contratos(tipo, version, cliente_id)
        WHERE reserva_id IS NULL AND tipo = 'autorizacion-datos' AND cliente_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_contratos_autorizacion_propietario
        ON contratos(tipo, version, propietario_id)
        WHERE reserva_id IS NULL AND tipo = 'autorizacion-datos' AND propietario_id IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_contratos_marco_agencia
        ON contratos(version, vehiculo_id)
        WHERE reserva_id IS NULL AND tipo = 'agencia';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_contratos_marco_arrendamiento
        ON contratos(version, vehiculo_id, cliente_id)
        WHERE reserva_id IS NULL AND tipo = 'arrendamiento';
    `);
  } catch (e) {
    console.error('[db] Migración contratos de vinculación falló:', e instanceof Error ? e.message : e);
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

// ── Contratos digitales: documento congelado + sus bloques de firma ─────────
//
// Fase 2 del módulo de contratos (la fase 1 solo generaba texto al vuelo, sin
// guardar nada). Ver lib/contratos-firma.ts para el detalle de cómo se usa.
//
// Dos ideas que explican la forma de estas dos tablas:
//
//  1. UN CONTRATO FIRMADO ES INMUTABLE. `contratos.texto` guarda el documento
//     palabra por palabra tal como se firmó, y `datos_json` el snapshot del que
//     salió — mismo criterio que `actas_servicio`. Si después cambia la dirección
//     del cliente o el precio del vehículo, el documento firmado sigue diciendo lo
//     que decía. No hay edición ni regeneración en sitio: para cambiarlo se anula
//     (estado 'anulado', la fila NO se borra) y se emite otro con `version` +1.
//
//  2. UN DOCUMENTO TIENE VARIAS FIRMAS, DE PERSONAS DISTINTAS Y EN MOMENTOS
//     DISTINTOS. Por eso las firmas viven en su propia tabla y no en columnas de
//     `contratos` (que es como están hoy las cuentas de cobro, donde SOLO firma el
//     propietario). El caso que lo obliga es el acta de entrega y devolución: sus
//     firmas de devolución se recogen días después, en otro lugar.
//
// `contrato_firmas.firma_hash` es el sello de integridad (HMAC-SHA256 con
// FIRMA_SECRET) y cubre el TEXTO ÍNTEGRO del documento: alterar una cláusula en la
// base después de firmada hace que el sello deje de verificar.
function crearTablasContratos(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contratos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      -- Opcionales desde sep-2026, y la razón está en la autorización de tratamiento
      -- de datos que se firma AL CREAR LA CUENTA: no tiene reserva, ni vehículo, ni
      -- dos partes. Para los seis documentos de operación siguen llegando siempre
      -- llenos. Misma forma que deja migrarContratosVinculacion en las bases que ya
      -- existían; si acá volviera a ponerse NOT NULL, una base nueva y una migrada
      -- tendrían esquemas distintos.
      reserva_id INTEGER REFERENCES reservas(id),
      vehiculo_id INTEGER REFERENCES vehiculos(id),
      -- Partes congeladas: quién era el propietario y quién el cliente EN EL MOMENTO
      -- de emitir. Se guardan aquí (y no se recalculan desde la reserva) para que un
      -- cambio de dueño del vehículo no reescriba quién firmó. En la autorización de
      -- datos solo va una de las dos, según el rol de la cuenta.
      propietario_id INTEGER REFERENCES usuarios(id),
      cliente_id INTEGER REFERENCES usuarios(id),
      tipo TEXT NOT NULL CHECK(tipo IN ('agencia','otrosi-agencia','arrendamiento','otrosi-arrendamiento','acta-entrega','pagare','vinculacion-cliente','vinculacion-propietario','autorizacion-datos')),
      -- Consecutivo propio del archivo (CAR-000012, CAR-000012-R2…). Es distinto del
      -- número que el texto del documento cita en sus cláusulas.
      numero TEXT NOT NULL DEFAULT '',
      -- 1 = original; 2, 3… = reemisión tras anular la anterior, que se conserva.
      version INTEGER NOT NULL DEFAULT 1,
      estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','firmado','anulado')),
      texto TEXT NOT NULL,
      datos_json TEXT NOT NULL DEFAULT '{}',
      -- Campos que quedaron en blanco al emitir, con su origen. Los subsanables
      -- bloquean la firma; los estructurales se le muestran al firmante.
      faltantes_json TEXT NOT NULL DEFAULT '[]',
      generado_por INTEGER REFERENCES usuarios(id),
      generado_por_nombre TEXT DEFAULT '',
      -- Fecha en que se completó el ÚLTIMO bloque de firma. '' mientras falte alguno.
      firmado_en TEXT DEFAULT '',
      anulado_en TEXT DEFAULT '',
      anulado_por INTEGER REFERENCES usuarios(id),
      anulado_por_nombre TEXT DEFAULT '',
      motivo_anulacion TEXT DEFAULT '',
      -- ── Vía por la que se firmó (fase 4: el mostrador) ────────────────────
      -- '' = todavía sin decidir · 'digital' = firma electrónica por bloques ·
      -- 'papel' = se imprimió, se firmó a mano y se subió el escaneado.
      -- Las dos vías son EXCLUYENTES: en cuanto se pone el primer trazo digital la
      -- columna queda en 'digital' y el escaneado se rechaza, y al revés. Ver
      -- lib/contratos-papel.ts.
      via_firma TEXT NOT NULL DEFAULT '' CHECK(via_firma IN ('','digital','papel')),
      -- Metadatos del escaneado (los BYTES viven en contrato_escaneos, para que un
      -- SELECT * FROM contratos de un listado no arrastre varios MB por fila).
      papel_subido_en TEXT DEFAULT '',
      papel_subido_por INTEGER REFERENCES usuarios(id),
      papel_subido_por_nombre TEXT DEFAULT '',
      papel_nombre_archivo TEXT DEFAULT '',
      papel_mime TEXT DEFAULT '',
      papel_bytes INTEGER NOT NULL DEFAULT 0,
      -- SHA-256 de los bytes del escaneado (hex).
      papel_sha256 TEXT DEFAULT '',
      -- Sello HMAC-SHA256 ('cp1:<hex>') del acto de firma en papel: cubre el texto
      -- íntegro del documento Y la huella del escaneado. Ver lib/contratos-papel.ts.
      papel_sello TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(reserva_id, tipo, version)
    );

    CREATE INDEX IF NOT EXISTS idx_contratos_reserva ON contratos(reserva_id);
    CREATE INDEX IF NOT EXISTS idx_contratos_cliente ON contratos(cliente_id);
    CREATE INDEX IF NOT EXISTS idx_contratos_propietario ON contratos(propietario_id);

    CREATE TABLE IF NOT EXISTS contrato_firmas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contrato_id INTEGER NOT NULL REFERENCES contratos(id),
      -- Identificador del bloque dentro del documento ('arrendatario',
      -- 'devolucion-agente'…). Ver lib/contratos-bloques.ts.
      bloque TEXT NOT NULL,
      etiqueta TEXT NOT NULL DEFAULT '',
      rol TEXT NOT NULL CHECK(rol IN ('agente','cliente','propietario','codeudor')),
      momento TEXT NOT NULL DEFAULT 'suscripcion' CHECK(momento IN ('suscripcion','entrega','devolucion')),
      orden INTEGER NOT NULL DEFAULT 1,
      -- Quién DEBE firmar. NULL cuando no es una cuenta concreta: EL AGENTE (lo firma
      -- cualquier admin con el permiso 'contratos_firmar_agente') y los codeudores.
      usuario_esperado_id INTEGER REFERENCES usuarios(id),
      nombre_esperado TEXT DEFAULT '',
      documento_esperado TEXT DEFAULT '',
      -- '' = bloque pendiente. Un bloque firmado NO se puede volver a firmar.
      firmada_en TEXT NOT NULL DEFAULT '',
      firmada_por_id INTEGER REFERENCES usuarios(id),
      firma_nombre_confirmado TEXT DEFAULT '',
      -- PNG en data URI (trazo en pantalla o imagen cargada y normalizada).
      firma_imagen TEXT DEFAULT '',
      firma_metodo TEXT DEFAULT '',
      firma_ip TEXT DEFAULT '',
      firma_user_agent TEXT DEFAULT '',
      -- Cuenta del equipo que presenció la firma en el mostrador (NULL = la persona
      -- firmó sola desde su propio dispositivo). NO sustituye al firmante: quien
      -- traza sigue siendo el titular del bloque (ver puedeFirmarBloque).
      asistida_por_id INTEGER REFERENCES usuarios(id),
      asistida_por_nombre TEXT DEFAULT '',
      -- Sello HMAC-SHA256 ('cf1:<hex>') sobre el texto íntegro del documento y el
      -- acto de firma. Ver lib/contratos-firma.ts → calcularSelloFirma.
      firma_hash TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(contrato_id, bloque)
    );

    CREATE INDEX IF NOT EXISTS idx_contrato_firmas_contrato ON contrato_firmas(contrato_id);

    -- ── El escaneado del contrato firmado A MANO (fase 4: el mostrador) ──────
    -- El dueño lo pidió así: «debe permitir descargar para imprimir, que se firme y
    -- que se escanee para ser guardado dentro de la misma base de datos». Por eso el
    -- archivo se guarda AQUÍ y no en Cloudinary: es el original probatorio de un
    -- contrato, y una dirección de CDN puede caducar, cambiar o ser sustituida sin
    -- que el sello se entere. Guardando los bytes, el sello cubre el archivo mismo.
    --
    -- Tabla aparte (1 a 1) a propósito: la tabla contratos se lee con SELECT * en los
    -- listados, y un escaneado de varios MB por fila haría que listar los documentos
    -- de una reserva cargara decenas de MB en memoria.
    --
    -- INMUTABLE, igual que una firma: una vez registrado no se reemplaza (UNIQUE por
    -- contrato e inserción única). Si el escaneado quedó mal, se anula el documento y
    -- se emite otro — que es el único camino que admite este módulo para cambiar algo.
    CREATE TABLE IF NOT EXISTS contrato_escaneos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contrato_id INTEGER NOT NULL REFERENCES contratos(id),
      -- Contenido del archivo en base64 (PDF o imagen). El tipo se reconoce por los
      -- BYTES, nunca por lo que declare el cliente (ver lib/contratos-papel.ts).
      contenido_base64 TEXT NOT NULL,
      mime TEXT NOT NULL DEFAULT '',
      bytes INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT '',
      nombre_archivo TEXT DEFAULT '',
      subido_por INTEGER REFERENCES usuarios(id),
      subido_por_nombre TEXT DEFAULT '',
      subido_ip TEXT DEFAULT '',
      subido_user_agent TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(contrato_id)
    );
  `);

  // Bases que ya recibieron la fase 2 (la tabla `contratos` sin las columnas del
  // mostrador): mismo patrón defensivo que el resto del archivo. Reflejo en Postgres:
  // supabase/schema.sql, bloque «contratos digitales».
  //
  // ⚠️ El CHECK de `via_firma` NO viaja en el ALTER: SQLite no admite añadir una
  // restricción a una tabla existente y reconstruirla por esto sería desproporcionado.
  // Quien escribe esa columna es siempre lib/contratos-papel.ts / lib/contratos-firma.ts,
  // con valores cerrados; las bases nuevas sí nacen con el CHECK.
  for (const col of [
    "via_firma TEXT NOT NULL DEFAULT ''",
    "papel_subido_en TEXT DEFAULT ''",
    'papel_subido_por INTEGER REFERENCES usuarios(id)',
    "papel_subido_por_nombre TEXT DEFAULT ''",
    "papel_nombre_archivo TEXT DEFAULT ''",
    "papel_mime TEXT DEFAULT ''",
    'papel_bytes INTEGER NOT NULL DEFAULT 0',
    "papel_sha256 TEXT DEFAULT ''",
    "papel_sello TEXT DEFAULT ''",
  ]) {
    try { db.exec(`ALTER TABLE contratos ADD COLUMN ${col}`); } catch { /* ya existe */ }
  }

  // ── Firma ASISTIDA en el mostrador (sep-2026) ─────────────────────────────
  // Quien traza sigue siendo el firmante —`firmada_por_id` no cambia de significado
  // y `puedeFirmarBloque()` sigue exigiendo que sea la persona del bloque—, pero
  // cuando la firma se recoge en el punto de atención queda registrado QUÉ cuenta
  // del equipo abrió y presenció el acto. Es la diferencia entre "firmó desde su
  // celular" y "firmó en el mostrador con la secretaria delante", y es justo lo
  // que habría que poder demostrar si el cliente desconoce la firma.
  for (const col of [
    'asistida_por_id INTEGER REFERENCES usuarios(id)',
    "asistida_por_nombre TEXT DEFAULT ''",
  ]) {
    try { db.exec(`ALTER TABLE contrato_firmas ADD COLUMN ${col}`); } catch { /* ya existe */ }
  }

  // Contratos que ya tenían firmas electrónicas ANTES de que existiera `via_firma`: se
  // les marca la vía que efectivamente usaron, para que la exclusión con el mostrador
  // funcione también con ellos. Idempotente (solo toca los que están en '').
  try {
    db.exec(`
      UPDATE contratos SET via_firma = 'digital'
      WHERE via_firma = ''
        AND EXISTS (SELECT 1 FROM contrato_firmas f WHERE f.contrato_id = contratos.id AND f.firmada_en <> '')
    `);
  } catch { /* la tabla de firmas todavía no existe */ }
}

// ── Los datos que rellenan los contratos (edición de datos, sep-2026) ───────
//
// Hasta ahora `lib/contratos-datos.ts` declaraba un inventario de campos que los
// seis documentos exigen y que NO tenían dónde vivir en la base: el número de
// motor, el chasis, el color, el valor asegurado, los datos de la carátula de la
// póliza y la categoría y vigencia de la licencia. Se imprimían como espacios en
// blanco y no había forma de llenarlos. Estas columnas son esa casa.
//
// El reparto sigue el criterio del dueño y está explicado en lib/contratos-campos.ts:
//   · lo que es del VEHÍCULO  → `vehiculos` (sirve para todos sus contratos);
//   · lo que es de la PERSONA → `usuarios`  (ídem);
//   · lo que es de ESTA operación → `contratos.overrides_json`, un parche que se
//     aplica sobre el snapshot al regenerar el texto. No es texto: son datos.
//
// Va al FINAL del archivo, en su propia función, para no chocar con las otras
// ramas que están tocando las columnas de `vehiculos` en paralelo. El patrón es el
// de siempre (ALTER dentro de try/catch: si la columna ya existe, no pasa nada), lo
// cual además hace que coincidir con otra rama en `vehiculos.color` sea inofensivo.
//
// Reflejo en Postgres: supabase/schema.sql, bloque «datos editables de contratos».
function crearColumnasDatosContrato(db: Database.Database) {
  const columnas: Array<[tabla: string, definicion: string]> = [
    // Ficha del vehículo: la matrícula.
    ['vehiculos', "color TEXT DEFAULT ''"],
    ['vehiculos', "numero_motor TEXT DEFAULT ''"],
    ['vehiculos', "numero_chasis TEXT DEFAULT ''"],
    // Valor ASEGURADO de la carátula. Es OTRO número distinto de `valor_comercial`
    // (que es el precio del carro en el mercado y alimenta la tarifa).
    ['vehiculos', 'valor_asegurado REAL DEFAULT 0'],
    // Carátula de la póliza. El archivo y su fecha de vencimiento siguen viviendo en
    // `vehiculos.documentos.poliza` (lib/poliza-vehiculo.ts, que sigue siendo la
    // única fuente de verdad de ESE archivo); lo que va aquí son los datos que el
    // contrato cita dentro de sus cláusulas y que la carátula no guardaba.
    ['vehiculos', "poliza_numero TEXT DEFAULT ''"],
    ['vehiculos', "poliza_aseguradora TEXT DEFAULT ''"],
    ['vehiculos', "poliza_aseguradora_nit TEXT DEFAULT ''"],
    ['vehiculos', "poliza_expedida_el TEXT DEFAULT ''"],
    ['vehiculos', "poliza_vigencia_desde TEXT DEFAULT ''"],
    // Si está vacía se usa `documentos.poliza.vence` (ver lib/contratos.ts).
    ['vehiculos', "poliza_vigencia_hasta TEXT DEFAULT ''"],
    ['vehiculos', "poliza_codigo_clausulado TEXT DEFAULT ''"],
    ['vehiculos', "poliza_nota_tecnica TEXT DEFAULT ''"],
    ['vehiculos', "poliza_deducible TEXT DEFAULT ''"],
    // Ficha de la persona: la licencia de conducción. El número ya existía
    // (`numero_licencia`); faltaban la categoría y la vigencia, que el acta exige.
    ['usuarios', "licencia_categoria TEXT DEFAULT ''"],
    ['usuarios', "licencia_vence TEXT DEFAULT ''"],
    // Parche de ESTA operación (canon, depósito, kilometraje, horas y lugares,
    // conductores autorizados, fecha de suscripción) + rastro del último cambio.
    ['contratos', "overrides_json TEXT NOT NULL DEFAULT '{}'"],
    // Contador de ediciones de datos. Sube +1 cada vez que se regenera el texto con
    // datos nuevos y viaja hasta el formulario de firma: si alguien editó los datos
    // mientras el firmante leía el documento, la firma se rechaza y hay que releerlo.
    ['contratos', 'datos_revision INTEGER NOT NULL DEFAULT 0'],
    ['contratos', "datos_editados_en TEXT DEFAULT ''"],
    ['contratos', 'datos_editados_por INTEGER REFERENCES usuarios(id)'],
    ['contratos', "datos_editados_por_nombre TEXT DEFAULT ''"],
  ];
  for (const [tabla, definicion] of columnas) {
    try { db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${definicion}`); } catch { /* ya existe */ }
  }
}
