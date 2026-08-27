// Lógica central del módulo de contabilidad: cotizaciones → facturas → liquidaciones
// a propietarios. Flujo pensado como el de un marketplace (Airbnb/Uber-style):
// DrivePass factura al cliente por el valor total del alquiler (actúa como
// intermediario/mandatario), y le liquida al propietario el neto (total - comisión
// de la plataforma) — la liquidación es un comprobante interno, no una factura DIAN,
// porque la mayoría de propietarios son personas naturales sin RUT de facturación.
import type Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { getConfig } from './operaciones';
import { emitirFacturaDataico, dataicoHabilitado } from './dataico';
import { enviarCorreo } from './email';

type DB = Database.Database;

export const COMISION_DEFAULT = 0.35;

export function comisionPlataforma(db: DB): number {
  const raw = getConfig(db, 'comision_plataforma_pct');
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : COMISION_DEFAULT;
}

export function datosEmpresa(db: DB) {
  return {
    nombre: getConfig(db, 'empresa_nombre') || 'DrivePass',
    nit: getConfig(db, 'empresa_nit') || '',
  };
}

// Guarda el proveedor en el catálogo si es nuevo (comparación insensible a
// mayúsculas vía la collation NOCASE de la columna). Si ya existía sin NIT y
// ahora llega uno, lo completa. Se llama automáticamente al crear/editar un
// gasto — así el catálogo se arma solo, sin pasos extra.
export function upsertProveedor(db: DB, nombre: string, nit?: string): void {
  const n = (nombre || '').trim();
  if (!n) return;
  const nitLimpio = (nit || '').trim();
  const existente = db.prepare('SELECT id, nit FROM proveedores WHERE nombre = ?').get(n) as { id: number; nit: string } | undefined;
  if (existente) {
    if (nitLimpio && !existente.nit) {
      db.prepare("UPDATE proveedores SET nit = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(nitLimpio, existente.id);
    }
    return;
  }
  try {
    db.prepare('INSERT INTO proveedores (nombre, nit) VALUES (?, ?)').run(n, nitLimpio);
  } catch { /* condición de carrera con la restricción UNIQUE — ya quedó guardado, no pasa nada */ }
}

function numero(prefijo: string, id: number): string {
  return `${prefijo}-${String(id).padStart(6, '0')}`;
}

type ReservaContexto = {
  id: number; fecha_inicio: string; fecha_fin: string; total: number; recargo: number;
  pago_estado: string; estado: string;
  usuario_id: number; usuario_nombre: string; usuario_correo: string; usuario_documento: string; usuario_celular: string;
  vehiculo_id: number; propietario_id: number; marca: string; modelo: string; anio: number; precio_dia: number;
};

function cargarContexto(db: DB, reservaId: number): ReservaContexto | null {
  return db.prepare(`
    SELECT r.id, r.fecha_inicio, r.fecha_fin, r.total, r.recargo, r.pago_estado, r.estado,
           u.id AS usuario_id, u.nombre AS usuario_nombre, u.correo AS usuario_correo,
           COALESCE(u.documento_identidad,'') AS usuario_documento, COALESCE(u.celular,'') AS usuario_celular,
           v.id AS vehiculo_id, v.propietario_id, v.marca, v.modelo, v.anio, v.precio_dia
    FROM reservas r
    JOIN usuarios u ON r.usuario_id = u.id
    JOIN vehiculos v ON r.vehiculo_id = v.id
    WHERE r.id = ?
  `).get(reservaId) as ReservaContexto | undefined || null;
}

// ── Cotizaciones ─────────────────────────────────────────────────────────────
export async function generarCotizacion(db: DB, reservaId: number, enviarCorreoCliente = true) {
  const existente = db.prepare('SELECT id FROM cotizaciones WHERE reserva_id = ?').get(reservaId) as { id: number } | undefined;
  if (existente) return existente;

  const ctx = cargarContexto(db, reservaId);
  if (!ctx) return null;

  const dias = Math.max(1, Math.ceil((new Date(ctx.fecha_fin).getTime() - new Date(ctx.fecha_inicio).getTime()) / 86400000));
  const result = db.prepare(`
    INSERT INTO cotizaciones (reserva_id, numero, cliente_nombre, cliente_correo, vehiculo_descripcion, dias, precio_dia, recargo, total, enviada_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
  `).run(
    reservaId, '', ctx.usuario_nombre, ctx.usuario_correo,
    `${ctx.marca} ${ctx.modelo} ${ctx.anio}`, dias, ctx.precio_dia, ctx.recargo, ctx.total,
  );
  const id = Number(result.lastInsertRowid);
  const num = numero('COT', id);
  db.prepare('UPDATE cotizaciones SET numero = ? WHERE id = ?').run(num, id);

  if (enviarCorreoCliente && ctx.usuario_correo) {
    try {
      await enviarCorreo(ctx.usuario_correo, `Cotización ${num} — DrivePass`,
        `Hola ${ctx.usuario_nombre.split(' ')[0]}, esta es la cotización de tu reserva:\n\n` +
        `Vehículo: ${ctx.marca} ${ctx.modelo} ${ctx.anio}\n` +
        `Del ${ctx.fecha_inicio} al ${ctx.fecha_fin} (${dias} día${dias !== 1 ? 's' : ''})\n` +
        `Tarifa: $${ctx.precio_dia.toLocaleString('es-CO')}/día` +
        (ctx.recargo > 0 ? `\nRecargo por lugar de entrega/recogida: $${ctx.recargo.toLocaleString('es-CO')}` : '') +
        `\nTotal: $${ctx.total.toLocaleString('es-CO')}\n\nCotización ${num}.`);
    } catch (e) {
      console.error('[contabilidad] No se pudo enviar la cotización por correo:', e instanceof Error ? e.message : e);
    }
  }

  return { id, numero: num };
}

// ── Liquidaciones (pago neto al propietario) ─────────────────────────────────
export function generarLiquidacion(db: DB, reservaId: number) {
  const existente = db.prepare('SELECT * FROM liquidaciones WHERE reserva_id = ?').get(reservaId);
  if (existente) return existente;

  const ctx = cargarContexto(db, reservaId);
  if (!ctx) return null;

  const pct = comisionPlataforma(db);
  const bruto = ctx.total;
  const comisionValor = Math.round(bruto * pct);
  const neto = bruto - comisionValor;

  db.prepare(`
    INSERT INTO liquidaciones (reserva_id, propietario_id, bruto, comision_pct, comision_valor, neto)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(reservaId, ctx.propietario_id, bruto, pct, comisionValor, neto);

  return db.prepare('SELECT * FROM liquidaciones WHERE reserva_id = ?').get(reservaId);
}

// ── Remisiones (documento a nombre del dueño del vehículo) ───────────────────
// A la vez es la "cuenta de cobro": el propietario debe firmarla (firma electrónica
// simple) para autorizar el pago — ver `firmarCuentaCobro` más abajo. Mientras
// `firmada_en` esté vacío, la liquidación asociada NO puede marcarse como pagada
// (chequeo en app/api/contabilidad/liquidaciones/route.ts).
export type RemisionRow = {
  id: number; reserva_id: number; propietario_id: number; numero: string;
  propietario_nombre: string; propietario_documento: string;
  vehiculo_descripcion: string; placa: string;
  fecha_inicio: string; fecha_fin: string; dias: number;
  bruto: number; comision_pct: number; comision_valor: number; neto: number;
  firmada_en: string; firma_ip: string; firma_user_agent: string;
  firma_imagen: string; firma_nombre_confirmado: string; firma_hash: string;
  created_at: string;
};

// Se genera automáticamente cuando el cliente paga. Deja constancia formal de que
// DrivePass gestionó el alquiler del vehículo del propietario y del neto a liquidarle.
export function generarRemision(db: DB, reservaId: number) {
  const existente = db.prepare('SELECT * FROM remisiones WHERE reserva_id = ?').get(reservaId);
  if (existente) return existente;

  const ctx = cargarContexto(db, reservaId);
  if (!ctx) return null;

  const prop = db.prepare("SELECT nombre, COALESCE(documento_identidad,'') AS documento FROM usuarios WHERE id = ?")
    .get(ctx.propietario_id) as { nombre: string; documento: string } | undefined;
  const placaRow = db.prepare("SELECT COALESCE(placa,'') AS placa FROM vehiculos WHERE id = ?")
    .get(ctx.vehiculo_id) as { placa: string } | undefined;

  const pct = comisionPlataforma(db);
  const bruto = ctx.total;
  const comisionValor = Math.round(bruto * pct);
  const neto = bruto - comisionValor;
  const dias = Math.max(1, Math.ceil((new Date(ctx.fecha_fin).getTime() - new Date(ctx.fecha_inicio).getTime()) / 86400000));

  const result = db.prepare(`
    INSERT INTO remisiones (reserva_id, propietario_id, numero, propietario_nombre, propietario_documento,
                            vehiculo_descripcion, placa, fecha_inicio, fecha_fin, dias, bruto, comision_pct, comision_valor, neto)
    VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    reservaId, ctx.propietario_id, prop?.nombre || '', prop?.documento || '',
    `${ctx.marca} ${ctx.modelo} ${ctx.anio}`, placaRow?.placa || '',
    ctx.fecha_inicio, ctx.fecha_fin, dias, bruto, pct, comisionValor, neto,
  );
  const id = Number(result.lastInsertRowid);
  db.prepare('UPDATE remisiones SET numero = ? WHERE id = ?').run(numero('REM', id), id);
  return db.prepare('SELECT * FROM remisiones WHERE reserva_id = ?').get(reservaId);
}

// Avisa al propietario que tiene una cuenta de cobro nueva esperando su firma. Se llama
// SOLO cuando la remisión se crea en el flujo normal de pago (procesarPagoConfirmado),
// nunca en el backfill de remisiones viejas (evita notificar "firma pendiente" sobre
// alquileres que ya se pagaron hace tiempo, de antes de existir este requisito).
function notificarNuevaCuentaCobro(db: DB, rem: RemisionRow): void {
  try {
    const titulo = `🧾 Nueva cuenta de cobro: ${rem.vehiculo_descripcion}`;
    const mensaje = `Generamos tu cuenta de cobro por el alquiler del ${rem.fecha_inicio} al ${rem.fecha_fin}: ` +
      `recibirás $${rem.neto.toLocaleString('es-CO')} (neto, ya descontada la comisión del ${(rem.comision_pct * 100).toFixed(0)}%). ` +
      `Fírmala desde tu panel para autorizar el pago.`;
    db.prepare(
      'INSERT INTO notificaciones (destinatario_id, tipo, titulo, mensaje, referencia_id, referencia_tipo) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(rem.propietario_id, 'cuenta_cobro_pendiente', titulo, mensaje, rem.id, 'remision');
  } catch (e) {
    console.error('[contabilidad] no se pudo notificar la nueva cuenta de cobro:', e instanceof Error ? e.message : e);
  }
}

// Hash de integridad sobre los campos "congelados" de la remisión en el momento de
// firmar. Permite detectar si algo se editó después (no debería poder pasar, pero
// sirve como evidencia adicional). SHA-256 sobre una concatenación estable de campos.
export function calcularHashRemision(r: {
  numero: string; propietario_documento: string; vehiculo_descripcion: string; placa: string;
  bruto: number; comision_pct: number; comision_valor: number; neto: number;
  fecha_inicio: string; fecha_fin: string;
}): string {
  const base = [
    r.numero, r.propietario_documento, r.vehiculo_descripcion, r.placa,
    r.bruto, r.comision_pct, r.comision_valor, r.neto, r.fecha_inicio, r.fecha_fin,
  ].join('|');
  return createHash('sha256').update(base).digest('hex');
}

export type FirmarCuentaCobroOk = { ok: true; remision: RemisionRow };
export type FirmarCuentaCobroError = { ok: false; status: number; error: string };

// Prefijo real que produce `canvas.toDataURL('image/png')` en components/FirmaCanvas.tsx.
// Se valida como forma mínima de "es una imagen de verdad" (no una cadena vacía o basura).
const FIRMA_IMAGEN_PREFIJO = 'data:image/png;base64,';

// Techo de tamaño para la imagen de la firma, YA decodificada de base64. 200KB es de sobra
// para un trazo simple (canvas de 40px de alto en el frontend) — un propietario legítimo
// no necesita más, y sin este límite un `firma_imagen` de decenas de MB (basura o un ataque)
// queda guardado tal cual en la BD para siempre (no se puede refirmar/sobrescribir).
const FIRMA_IMAGEN_MAX_BYTES = 200 * 1024;
// Máximo de caracteres base64 equivalente al límite de arriba (base64 infla ~4/3 los bytes
// originales). Se revisa ANTES de decodificar para no gastar tiempo/memoria decodificando
// cadenas absurdamente grandes solo para descartarlas.
const FIRMA_IMAGEN_MAX_BASE64_CHARS = Math.ceil((FIRMA_IMAGEN_MAX_BYTES / 3) * 4) + 8;

// Exportado para que la capa de API pueda hacer un rechazo barato (por longitud total de
// la cadena, prefijo incluido) antes de siquiera llamar a firmarCuentaCobro — misma cota,
// una sola fuente de verdad para el número.
export const FIRMA_IMAGEN_MAX_CHARS_TOTAL = FIRMA_IMAGEN_PREFIJO.length + FIRMA_IMAGEN_MAX_BASE64_CHARS;

// Firma electrónica simple de la cuenta de cobro (remisión) por su propietario.
// Es la autorización previa al pago: mientras no esté firmada, el admin no puede
// marcar la liquidación asociada como pagada (ver liquidaciones/route.ts → PUT).
// No permite refirmar/sobrescribir una firma ya existente.
export function firmarCuentaCobro(
  db: DB, remisionId: number, propietarioId: number,
  opts: { firmaImagen?: string; nombreConfirmado: string; ip: string; userAgent: string },
): FirmarCuentaCobroOk | FirmarCuentaCobroError {
  const rem = db.prepare('SELECT * FROM remisiones WHERE id = ?').get(remisionId) as RemisionRow | undefined;
  if (!rem) return { ok: false, status: 404, error: 'Cuenta de cobro no encontrada.' };
  if (rem.propietario_id !== propietarioId) return { ok: false, status: 403, error: 'No tienes permiso para firmar esta cuenta de cobro.' };
  if (rem.firmada_en) return { ok: false, status: 409, error: 'Esta cuenta de cobro ya fue firmada.' };

  const nombreConfirmado = (opts.nombreConfirmado || '').trim();
  if (!nombreConfirmado) return { ok: false, status: 400, error: 'Debes escribir tu nombre completo para confirmar la firma.' };

  // Fuente de verdad del requisito: sin trazo real de firma, no hay autorización de pago.
  // El botón del frontend ya evita enviar sin trazo, pero eso es cosmético — esto es lo
  // que de verdad lo hace obligatorio ante una llamada directa a la API.
  const firmaImagen = (opts.firmaImagen || '').trim();
  if (!firmaImagen || !firmaImagen.startsWith(FIRMA_IMAGEN_PREFIJO) || firmaImagen.length <= FIRMA_IMAGEN_PREFIJO.length) {
    return { ok: false, status: 400, error: 'Falta el trazo de la firma.' };
  }
  const base64Payload = firmaImagen.slice(FIRMA_IMAGEN_PREFIJO.length);
  if (base64Payload.length > FIRMA_IMAGEN_MAX_BASE64_CHARS) {
    return { ok: false, status: 400, error: 'La imagen de la firma es demasiado pesada.' };
  }
  // Chequeo exacto sobre los bytes ya decodificados (el de arriba es solo un filtro rápido
  // por longitud de cadena, antes de gastar en decodificar algo claramente fuera de rango).
  if (Buffer.from(base64Payload, 'base64').length > FIRMA_IMAGEN_MAX_BYTES) {
    return { ok: false, status: 400, error: 'La imagen de la firma es demasiado pesada.' };
  }

  const hash = calcularHashRemision(rem);
  db.prepare(`
    UPDATE remisiones SET
      firmada_en = datetime('now','localtime'),
      firma_ip = ?, firma_user_agent = ?, firma_imagen = ?, firma_nombre_confirmado = ?, firma_hash = ?
    WHERE id = ?
  `).run(opts.ip || '', opts.userAgent || '', firmaImagen, nombreConfirmado, hash, remisionId);

  const actualizada = db.prepare('SELECT * FROM remisiones WHERE id = ?').get(remisionId) as RemisionRow;
  return { ok: true, remision: actualizada };
}

// ── Facturas (DataICO o borrador local si no hay credenciales) ──────────────
export async function emitirFactura(db: DB, reservaId: number) {
  const existente = db.prepare('SELECT * FROM facturas WHERE reserva_id = ?').get(reservaId);
  if (existente) return existente;

  const ctx = cargarContexto(db, reservaId);
  if (!ctx) return null;

  const dias = Math.max(1, Math.ceil((new Date(ctx.fecha_fin).getTime() - new Date(ctx.fecha_inicio).getTime()) / 86400000));
  const items = [{ descripcion: `Alquiler ${ctx.marca} ${ctx.modelo} ${ctx.anio} (${dias} día${dias !== 1 ? 's' : ''})`, cantidad: 1, valorUnitario: ctx.total - ctx.recargo }];
  if (ctx.recargo > 0) items.push({ descripcion: 'Recargo por lugar de entrega/recogida', cantidad: 1, valorUnitario: ctx.recargo });

  if (dataicoHabilitado()) {
    const resultado = await emitirFacturaDataico({
      cliente: { nombre: ctx.usuario_nombre, documento: ctx.usuario_documento, correo: ctx.usuario_correo, celular: ctx.usuario_celular },
      items,
      observaciones: `Reserva #${ctx.id} — DrivePass`,
    });
    if (resultado.emitida) {
      db.prepare(`
        INSERT INTO facturas (reserva_id, numero, cliente_nombre, cliente_documento, cliente_correo, subtotal, iva, total, estado, dataico_cufe, dataico_pdf_url, emitida_en)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'emitida', ?, ?, datetime('now','localtime'))
      `).run(reservaId, resultado.numero || `DP-${reservaId}`, ctx.usuario_nombre, ctx.usuario_documento, ctx.usuario_correo, ctx.total, ctx.total, resultado.cufe, resultado.pdfUrl);
    } else {
      const id = insertarBorrador(db, ctx, 'error', resultado.error);
      return db.prepare('SELECT * FROM facturas WHERE id = ?').get(id);
    }
  } else {
    insertarBorrador(db, ctx, 'borrador', 'DataICO no configurado — factura en borrador local, sin validez DIAN todavía.');
  }

  return db.prepare('SELECT * FROM facturas WHERE reserva_id = ?').get(reservaId);
}

function insertarBorrador(db: DB, ctx: ReservaContexto, estado: 'borrador' | 'error', nota: string): number {
  const result = db.prepare(`
    INSERT INTO facturas (reserva_id, numero, cliente_nombre, cliente_documento, cliente_correo, subtotal, iva, total, estado, dataico_error)
    VALUES (?, '', ?, ?, ?, ?, 0, ?, ?, ?)
  `).run(ctx.id, ctx.usuario_nombre, ctx.usuario_documento, ctx.usuario_correo, ctx.total, ctx.total, estado, nota);
  const id = Number(result.lastInsertRowid);
  db.prepare('UPDATE facturas SET numero = ? WHERE id = ?').run(numero('DP', id), id);
  return id;
}

// ── Orquestador: se llama cuando una reserva pasa a pago_estado = 'pagado' ──
export async function procesarPagoConfirmado(db: DB, reservaId: number) {
  await generarCotizacion(db, reservaId, false); // por si la reserva es de antes de este módulo
  const factura = await emitirFactura(db, reservaId);
  const liquidacion = generarLiquidacion(db, reservaId);
  const yaExistiaRemision = !!db.prepare('SELECT id FROM remisiones WHERE reserva_id = ?').get(reservaId);
  const remision = generarRemision(db, reservaId); // remisión a nombre del dueño del vehículo = cuenta de cobro
  if (remision && !yaExistiaRemision) notificarNuevaCuentaCobro(db, remision as RemisionRow);
  return { factura, liquidacion, remision };
}

export function marcarLiquidacionesPagadas(db: DB, reservaIds: number[], comprobante: string, comprobanteUrl = '') {
  if (reservaIds.length === 0) return;
  const placeholders = reservaIds.map(() => '?').join(',');
  db.prepare(`UPDATE liquidaciones SET estado = 'pagado', pagado_en = datetime('now','localtime'), comprobante = ?, comprobante_url = ? WHERE reserva_id IN (${placeholders})`)
    .run(comprobante, comprobanteUrl, ...reservaIds);
}
