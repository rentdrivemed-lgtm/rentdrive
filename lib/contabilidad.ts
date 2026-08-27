// Lógica central del módulo de contabilidad: cotizaciones → facturas → liquidaciones
// a propietarios. Flujo pensado como el de un marketplace (Airbnb/Uber-style):
// DrivePass factura al cliente por el valor total del alquiler (actúa como
// intermediario/mandatario), y le liquida al propietario el neto (total - comisión
// de la plataforma) — la liquidación es un comprobante interno, no una factura DIAN,
// porque la mayoría de propietarios son personas naturales sin RUT de facturación.
import type Database from 'better-sqlite3';
import { getConfig } from './operaciones';
import { emitirFacturaDataico, dataicoHabilitado } from './dataico';
import { enviarCorreo } from './email';
import { calcularDiasAlquiler, calcularTotalAlquiler } from './lugares';
import { construirFacturaPDF } from './contabilidad-pdf';

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
// Texto del correo compartido entre la cotización automática (ligada a una reserva real)
// y la cotización manual del cotizador de venta (prospecto sin reserva) — para no tener
// dos redacciones que se desincronicen con el tiempo.
async function enviarCotizacionPorCorreo(
  correo: string, nombreCliente: string, num: string, vehiculoDescripcion: string,
  fechaInicio: string, fechaFin: string, dias: number, precioDia: number, recargo: number, total: number,
): Promise<void> {
  if (!correo) return;
  try {
    await enviarCorreo(correo, `Cotización ${num} — DrivePass`,
      `Hola ${nombreCliente.split(' ')[0] || nombreCliente}, esta es tu cotización:\n\n` +
      `Vehículo: ${vehiculoDescripcion}\n` +
      `Del ${fechaInicio} al ${fechaFin} (${dias} día${dias !== 1 ? 's' : ''})\n` +
      `Tarifa: $${precioDia.toLocaleString('es-CO')}/día` +
      (recargo > 0 ? `\nRecargo por lugar de entrega/recogida: $${recargo.toLocaleString('es-CO')}` : '') +
      `\nTotal: $${total.toLocaleString('es-CO')}\n\nCotización ${num}.`);
  } catch (e) {
    console.error('[contabilidad] No se pudo enviar la cotización por correo:', e instanceof Error ? e.message : e);
  }
}

export async function generarCotizacion(db: DB, reservaId: number, enviarCorreoCliente = true) {
  const existente = db.prepare('SELECT id FROM cotizaciones WHERE reserva_id = ?').get(reservaId) as { id: number } | undefined;
  if (existente) return existente;

  const ctx = cargarContexto(db, reservaId);
  if (!ctx) return null;

  const dias = calcularDiasAlquiler(ctx.fecha_inicio, ctx.fecha_fin);
  const vehiculoDescripcion = `${ctx.marca} ${ctx.modelo} ${ctx.anio}`;
  const result = db.prepare(`
    INSERT INTO cotizaciones (reserva_id, numero, cliente_nombre, cliente_correo, vehiculo_id, vehiculo_descripcion, fecha_inicio, fecha_fin, dias, precio_dia, recargo, total, enviada_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
  `).run(
    reservaId, '', ctx.usuario_nombre, ctx.usuario_correo,
    ctx.vehiculo_id, vehiculoDescripcion, ctx.fecha_inicio, ctx.fecha_fin, dias, ctx.precio_dia, ctx.recargo, ctx.total,
  );
  const id = Number(result.lastInsertRowid);
  const num = numero('COT', id);
  db.prepare('UPDATE cotizaciones SET numero = ? WHERE id = ?').run(num, id);

  if (enviarCorreoCliente) {
    await enviarCotizacionPorCorreo(ctx.usuario_correo, ctx.usuario_nombre, num, vehiculoDescripcion, ctx.fecha_inicio, ctx.fecha_fin, dias, ctx.precio_dia, ctx.recargo, ctx.total);
  }

  return { id, numero: num };
}

// Cotización "suelta" del cotizador de venta: para un prospecto que todavía NO tiene
// cuenta ni reserva (no hay fila en `reservas` de la cual sacar fechas/vehículo/precio).
// Reutiliza calcularDiasAlquiler/calcularTotalAlquiler — la MISMA fórmula del flujo real
// de reserva (app/api/reservas/route.ts) — para que el precio nunca se desincronice.
export type CotizacionManualInput = {
  clienteNombre: string;
  clienteCorreo?: string;
  clienteCelular?: string;
  vehiculoId?: number | null;
  vehiculoDescripcion?: string; // texto libre si no hay vehiculoId (o no se encontró)
  fechaInicio: string;
  fechaFin: string;
  recargo?: number;
  totalOverride?: number | null; // ajuste manual del admin/contadora (descuento, etc.)
};

export async function generarCotizacionManual(db: DB, input: CotizacionManualInput) {
  const dias = calcularDiasAlquiler(input.fechaInicio, input.fechaFin);

  let precioDia = 0;
  let vehiculoId: number | null = null;
  let vehiculoDescripcion = (input.vehiculoDescripcion || '').trim();

  if (input.vehiculoId) {
    const veh = db.prepare('SELECT id, marca, modelo, anio, precio_dia FROM vehiculos WHERE id = ?').get(input.vehiculoId) as
      { id: number; marca: string; modelo: string; anio: number; precio_dia: number } | undefined;
    if (veh) {
      vehiculoId = veh.id;
      precioDia = veh.precio_dia;
      vehiculoDescripcion = `${veh.marca} ${veh.modelo} ${veh.anio}`;
    }
  }
  if (!vehiculoDescripcion) vehiculoDescripcion = 'Vehículo por definir';

  const recargo = Number(input.recargo) || 0;
  const totalCalculado = calcularTotalAlquiler(dias, precioDia, recargo);
  const total = (input.totalOverride !== null && input.totalOverride !== undefined && Number.isFinite(input.totalOverride))
    ? Number(input.totalOverride)
    : totalCalculado;

  const clienteCorreo = (input.clienteCorreo || '').trim();
  const clienteCelular = (input.clienteCelular || '').trim();

  const result = db.prepare(`
    INSERT INTO cotizaciones (reserva_id, numero, cliente_nombre, cliente_correo, cliente_celular, vehiculo_id, vehiculo_descripcion, fecha_inicio, fecha_fin, dias, precio_dia, recargo, total, enviada_en)
    VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
  `).run(
    '', input.clienteNombre, clienteCorreo, clienteCelular,
    vehiculoId, vehiculoDescripcion, input.fechaInicio, input.fechaFin, dias, precioDia, recargo, total,
  );
  const id = Number(result.lastInsertRowid);
  const num = numero('COT', id);
  db.prepare('UPDATE cotizaciones SET numero = ? WHERE id = ?').run(num, id);

  await enviarCotizacionPorCorreo(clienteCorreo, input.clienteNombre, num, vehiculoDescripcion, input.fechaInicio, input.fechaFin, dias, precioDia, recargo, total);

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
  const dias = calcularDiasAlquiler(ctx.fecha_inicio, ctx.fecha_fin);

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

// ── Facturas (DataICO o borrador local si no hay credenciales) ──────────────
type FacturaRow = {
  id: number; reserva_id: number; numero: string;
  cliente_nombre: string; cliente_documento: string; cliente_correo: string;
  subtotal: number; iva: number; total: number; estado: 'borrador' | 'emitida' | 'anulada' | 'error';
  dataico_cufe: string; dataico_pdf_url: string; dataico_error: string;
  emitida_en: string; created_at: string;
};

export async function emitirFactura(db: DB, reservaId: number) {
  const existente = db.prepare('SELECT * FROM facturas WHERE reserva_id = ?').get(reservaId);
  if (existente) return existente;

  const ctx = cargarContexto(db, reservaId);
  if (!ctx) return null;

  const dias = calcularDiasAlquiler(ctx.fecha_inicio, ctx.fecha_fin);
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
      insertarBorrador(db, ctx, 'error', resultado.error);
    }
  } else {
    insertarBorrador(db, ctx, 'borrador', 'DataICO no configurado — factura en borrador local, sin validez DIAN todavía.');
  }

  const factura = db.prepare('SELECT * FROM facturas WHERE reserva_id = ?').get(reservaId) as FacturaRow | undefined;

  // El correo con el PDF adjunto solo aplica a facturas realmente emitidas/en borrador
  // (no a 'error': ahí no hay nada válido que mandarle al cliente, el equipo debe reintentar).
  if (factura && factura.estado !== 'error') {
    await enviarFacturaPorCorreoConAdjunto(db, ctx, factura, dias);
  }

  return factura ?? null;
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

// Envía la factura por correo con el PDF adjunto. Si la factura se emitió de verdad vía
// DataICO (con PDF oficial ante la DIAN), se intenta adjuntar ESE PDF descargándolo de
// `dataico_pdf_url`; si no hay DataICO (borrador local) o la descarga falla, se genera el
// PDF en el servidor con jsPDF (misma construcción que usa el botón "PDF" del admin,
// lib/contabilidad-pdf.ts) — jsPDF no necesita DOM/Canvas, corre igual en Node.
// Nunca revienta la emisión de la factura: cualquier fallo de correo queda solo en logs
// (mismo patrón defensivo que generarCotizacion).
async function enviarFacturaPorCorreoConAdjunto(db: DB, ctx: ReservaContexto, factura: FacturaRow, dias: number): Promise<void> {
  if (!ctx.usuario_correo) return;
  try {
    const empresa = datosEmpresa(db);
    let adjunto: { filename: string; content: Buffer } | null = null;

    if (factura.estado === 'emitida' && factura.dataico_pdf_url) {
      try {
        const res = await fetch(factura.dataico_pdf_url, { signal: AbortSignal.timeout(15000) });
        if (res.ok) adjunto = { filename: `${factura.numero || 'factura'}.pdf`, content: Buffer.from(await res.arrayBuffer()) };
      } catch (e) {
        console.error('[contabilidad] No se pudo descargar el PDF oficial de DataICO, se genera uno local:', e instanceof Error ? e.message : e);
      }
    }

    if (!adjunto) {
      const doc = construirFacturaPDF(empresa, {
        numero: factura.numero, created_at: factura.created_at, estado: factura.estado,
        cliente_nombre: factura.cliente_nombre, cliente_documento: factura.cliente_documento, cliente_correo: factura.cliente_correo,
        subtotal: factura.subtotal, total: factura.total,
        marca: ctx.marca, modelo: ctx.modelo, anio: ctx.anio, fecha_inicio: ctx.fecha_inicio, fecha_fin: ctx.fecha_fin,
        dataico_cufe: factura.dataico_cufe,
      });
      adjunto = { filename: `${factura.numero || 'factura'}.pdf`, content: Buffer.from(doc.output('arraybuffer')) };
    }

    await enviarCorreo(ctx.usuario_correo, `Factura ${factura.numero || ''} — DrivePass`,
      `Hola ${ctx.usuario_nombre.split(' ')[0]}, adjuntamos la factura de tu alquiler ${ctx.marca} ${ctx.modelo} ${ctx.anio} ` +
      `(${ctx.fecha_inicio} a ${ctx.fecha_fin}, ${dias} día${dias !== 1 ? 's' : ''}) por $${factura.total.toLocaleString('es-CO')}.` +
      (factura.estado === 'borrador' ? '\n\nEsta es una factura en borrador — se emitirá oficialmente ante la DIAN en cuanto esté activa la facturación electrónica.' : ''),
      [adjunto]);
  } catch (e) {
    console.error('[contabilidad] No se pudo enviar la factura por correo:', e instanceof Error ? e.message : e);
  }
}

// ── Orquestador: se llama cuando una reserva pasa a pago_estado = 'pagado' ──
export async function procesarPagoConfirmado(db: DB, reservaId: number) {
  await generarCotizacion(db, reservaId, false); // por si la reserva es de antes de este módulo
  const factura = await emitirFactura(db, reservaId);
  const liquidacion = generarLiquidacion(db, reservaId);
  const remision = generarRemision(db, reservaId); // remisión a nombre del dueño del vehículo
  return { factura, liquidacion, remision };
}

export function marcarLiquidacionesPagadas(db: DB, reservaIds: number[], comprobante: string, comprobanteUrl = '') {
  if (reservaIds.length === 0) return;
  const placeholders = reservaIds.map(() => '?').join(',');
  db.prepare(`UPDATE liquidaciones SET estado = 'pagado', pagado_en = datetime('now','localtime'), comprobante = ?, comprobante_url = ? WHERE reserva_id IN (${placeholders})`)
    .run(comprobante, comprobanteUrl, ...reservaIds);
}
