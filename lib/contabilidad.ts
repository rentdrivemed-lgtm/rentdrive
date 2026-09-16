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
import { calcularDiasAlquiler, calcularTotalAlquiler } from './lugares';
import { construirFacturaPDF } from './contabilidad-pdf';
import {
  calcularTotalesLiquidacion, redondearPeso, montoConceptoValido, comisionPctValido, brutoValido,
  valorNumerico, netoValido,
  MONTO_MAX_CONCEPTO, CONCEPTO_MAX_CHARS, MOTIVO_MAX_CHARS, MAX_LINEAS_POR_EDICION, NETO_MAX_ABS,
  type ConceptoLinea, type TipoConcepto, type TotalesLiquidacion,
} from './liquidacion-calculo';
import { registrarAuditoriaEstricta } from './permisos';
import { igualesEnTiempoConstante, sellarHmac } from './firma-sello';

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
// El neto NUNCA se escribe a mano: siempre sale de
//   bruto − comisión − descuentos + adicionales   (lib/liquidacion-calculo.ts)
// donde descuentos/adicionales son las filas de `liquidacion_conceptos` de esa
// liquidación. Una liquidación sin conceptos (todas las que existían antes de este
// módulo) da exactamente el mismo número que antes: bruto − comisión.

export type LiquidacionRow = {
  id: number; reserva_id: number; propietario_id: number;
  bruto: number; comision_pct: number; comision_valor: number; neto: number;
  estado: 'pendiente' | 'pagado'; pagado_en: string; comprobante: string; comprobante_url: string;
  created_at: string;
};

export type ConceptoRow = {
  id: number; liquidacion_id: number; tipo: TipoConcepto; concepto: string; monto: number;
  motivo: string; origen_ajuste_id: number | null;
  created_by: number | null; created_by_nombre: string; created_at: string;
};

export type AjusteRow = {
  id: number; propietario_id: number; tipo: TipoConcepto; concepto: string; monto: number;
  motivo: string; reserva_origen_id: number | null; estado: 'pendiente' | 'aplicado' | 'anulado';
  aplicado_en_liquidacion_id: number | null; aplicado_en: string;
  anulado_en: string; motivo_anulacion: string;
  created_by: number | null; created_by_nombre: string; created_at: string;
  // Solo lo trae `listarAjustesPendientes` (JOIN con usuarios), para pintarlo en el panel.
  propietario_nombre?: string;
};

// Actor que ejecuta la acción (admin del panel, o el sistema en los flujos automáticos).
export type ActorContable = { id: number | null; nombre?: string; correo?: string; nivel?: string };
export const ACTOR_SISTEMA: ActorContable = { id: null, nombre: 'Sistema', nivel: 'sistema' };

export function listarConceptos(db: DB, liquidacionId: number): ConceptoRow[] {
  return db.prepare(
    'SELECT * FROM liquidacion_conceptos WHERE liquidacion_id = ? ORDER BY id'
  ).all(liquidacionId) as ConceptoRow[];
}

function lineas(conceptos: ConceptoRow[]): ConceptoLinea[] {
  return conceptos.map(c => ({ tipo: c.tipo, monto: c.monto }));
}

// Desglose que se congela dentro de la remisión/cuenta de cobro (`conceptos_json`).
// Se guarda el texto que el propietario tiene que poder leer al firmar; el `motivo`
// interno también viaja, para que el soporte de un reclamo esté en el mismo documento.
export type ConceptoSnapshot = { tipo: TipoConcepto; concepto: string; monto: number; motivo: string };

export function snapshotConceptos(db: DB, liquidacionId: number): ConceptoSnapshot[] {
  return listarConceptos(db, liquidacionId).map(c => ({
    tipo: c.tipo, concepto: c.concepto, monto: c.monto, motivo: c.motivo,
  }));
}

export function parsearConceptosJson(raw: unknown): ConceptoSnapshot[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((c): c is ConceptoSnapshot => !!c && (c.tipo === 'descuento' || c.tipo === 'adicional'))
      .map(c => ({ tipo: c.tipo, concepto: String(c.concepto || ''), monto: Number(c.monto) || 0, motivo: String(c.motivo || '') }));
  } catch {
    return [];
  }
}

// Recalcula y GUARDA comisión y neto de una liquidación a partir de su bruto, su
// porcentaje y sus conceptos. Única vía por la que `liquidaciones.neto` cambia de valor.
export function recalcularLiquidacion(db: DB, liquidacionId: number): TotalesLiquidacion | null {
  const liq = db.prepare('SELECT bruto, comision_pct FROM liquidaciones WHERE id = ?')
    .get(liquidacionId) as { bruto: number; comision_pct: number } | undefined;
  if (!liq) return null;

  const totales = calcularTotalesLiquidacion(liq.bruto, liq.comision_pct, lineas(listarConceptos(db, liquidacionId)));
  db.prepare('UPDATE liquidaciones SET bruto = ?, comision_valor = ?, neto = ? WHERE id = ?')
    .run(totales.bruto, totales.comision_valor, totales.neto, liquidacionId);
  return totales;
}

/**
 * Consume los ajustes que quedaron pendientes para un propietario (costos detectados
 * DESPUÉS de haberle pagado una liquidación — ver la regla C del diseño) y los convierte
 * en conceptos de esta liquidación.
 *
 * Dos garantías contra la doble aplicación:
 *   1. el UPDATE de `estado` es condicional (`... AND estado = 'pendiente'`) y solo se
 *      inserta el concepto si marcó exactamente 1 fila;
 *   2. índice ÚNICO parcial sobre `liquidacion_conceptos.origen_ajuste_id` (lib/db.ts):
 *      aunque alguien intentara insertarlo dos veces, la BD lo rechaza.
 *
 * Un descuento que dejaría el neto NEGATIVO no se aplica: se queda `pendiente` para la
 * siguiente liquidación (un daño de $2.000.000 no puede convertir un alquiler de $300.000
 * en una cuenta de cobro impagable). Los ajustes se evalúan en orden de creación, así que
 * uno pequeño puede entrar aunque el grande de antes no quepa. No se parten en cuotas a
 * propósito: media línea de un daño confundiría al propietario al firmar.
 */
function consumirAjustesPendientes(db: DB, liquidacionId: number, propietarioId: number, actor: ActorContable = ACTOR_SISTEMA): number {
  const liq = db.prepare('SELECT bruto, comision_pct FROM liquidaciones WHERE id = ?')
    .get(liquidacionId) as { bruto: number; comision_pct: number } | undefined;
  if (!liq) return 0;

  const pendientes = db.prepare(
    "SELECT * FROM ajustes_propietario WHERE propietario_id = ? AND estado = 'pendiente' ORDER BY id"
  ).all(propietarioId) as AjusteRow[];
  if (pendientes.length === 0) return 0;

  const acumuladas = lineas(listarConceptos(db, liquidacionId));
  const marcar = db.prepare(
    "UPDATE ajustes_propietario SET estado = 'aplicado', aplicado_en_liquidacion_id = ?, aplicado_en = datetime('now','localtime') WHERE id = ? AND estado = 'pendiente'"
  );
  const insertar = db.prepare(`
    INSERT INTO liquidacion_conceptos (liquidacion_id, tipo, concepto, monto, motivo, origen_ajuste_id, created_by, created_by_nombre)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let aplicados = 0;
  for (const a of pendientes) {
    const candidato: ConceptoLinea[] = [...acumuladas, { tipo: a.tipo, monto: a.monto }];
    if (calcularTotalesLiquidacion(liq.bruto, liq.comision_pct, candidato).neto < 0) continue;

    if (marcar.run(liquidacionId, a.id).changes !== 1) continue; // otro proceso ya lo tomó
    insertar.run(
      liquidacionId, a.tipo, a.concepto, redondearPeso(a.monto),
      a.motivo || `Ajuste pendiente #${a.id}${a.reserva_origen_id ? ` (reserva #${a.reserva_origen_id})` : ''}`,
      a.id, a.created_by ?? null, a.created_by_nombre || '',
    );
    acumuladas.push({ tipo: a.tipo, monto: a.monto });
    aplicados++;

    // Bitácora obligatoria: esto descuenta (o suma) plata de la liquidación de un
    // propietario de forma AUTOMÁTICA, sin que nadie apriete un botón. Antes no dejaba
    // ni una línea de rastro. Estricta a propósito: corre dentro de la transacción de
    // `generarLiquidacion`, así que si no se puede registrar, el ajuste no se aplica.
    registrarAuditoriaEstricta(db, actor, {
      area: 'contabilidad', accion: 'aplicar_ajuste_pendiente', entidad: 'ajuste_propietario', entidad_id: a.id,
      detalle: `Ajuste pendiente #${a.id} (${a.tipo} "${a.concepto}" ${cop(a.monto)}) del propietario #${propietarioId}`
        + ` se aplicó automáticamente a la liquidación #${liquidacionId}`
        + (a.reserva_origen_id ? ` · corresponde a la reserva #${a.reserva_origen_id}` : '')
        + (a.motivo ? ` · motivo: ${a.motivo}` : ''),
    });
  }
  return aplicados;
}

export function generarLiquidacion(db: DB, reservaId: number) {
  const existente = db.prepare('SELECT * FROM liquidaciones WHERE reserva_id = ?').get(reservaId);
  if (existente) return existente;

  const ctx = cargarContexto(db, reservaId);
  if (!ctx) return null;

  const pct = comisionPlataforma(db);
  const bruto = redondearPeso(ctx.total);
  const comisionValor = Math.round(bruto * pct);

  // Todo en una transacción: o queda la liquidación CON sus ajustes consumidos, o no
  // queda nada. Si reventara a la mitad, un ajuste podría quedar marcado 'aplicado' sin
  // concepto que lo respalde — es decir, plata que se pierde silenciosamente.
  db.transaction(() => {
    const res = db.prepare(`
      INSERT INTO liquidaciones (reserva_id, propietario_id, bruto, comision_pct, comision_valor, neto)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(reservaId, ctx.propietario_id, bruto, pct, comisionValor, bruto - comisionValor);
    const liquidacionId = Number(res.lastInsertRowid);
    if (consumirAjustesPendientes(db, liquidacionId, ctx.propietario_id) > 0) {
      recalcularLiquidacion(db, liquidacionId);
    }
  })();

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
  conceptos_json: string; version: number;
  created_at: string;
};

// Se genera automáticamente cuando el cliente paga. Deja constancia formal de que
// DrivePass gestionó el alquiler del vehículo del propietario y del neto a liquidarle.
//
// Los importes se toman de la LIQUIDACIÓN si ya existe (es la cifra real que se le va a
// pagar, con sus conceptos y su comisión propia) y solo se recalculan desde la reserva
// cuando todavía no hay liquidación. Antes se recalculaban siempre desde la reserva con
// la comisión GLOBAL vigente, lo que hacía que una remisión generada por el backfill
// pudiera mostrar un neto distinto del de la liquidación que soporta.
export function generarRemision(db: DB, reservaId: number) {
  const existente = db.prepare('SELECT * FROM remisiones WHERE reserva_id = ?').get(reservaId);
  if (existente) return existente;

  const ctx = cargarContexto(db, reservaId);
  if (!ctx) return null;

  const prop = db.prepare("SELECT nombre, COALESCE(documento_identidad,'') AS documento FROM usuarios WHERE id = ?")
    .get(ctx.propietario_id) as { nombre: string; documento: string } | undefined;
  const placaRow = db.prepare("SELECT COALESCE(placa,'') AS placa FROM vehiculos WHERE id = ?")
    .get(ctx.vehiculo_id) as { placa: string } | undefined;

  const liq = db.prepare('SELECT id, bruto, comision_pct, comision_valor, neto FROM liquidaciones WHERE reserva_id = ?')
    .get(reservaId) as Pick<LiquidacionRow, 'id' | 'bruto' | 'comision_pct' | 'comision_valor' | 'neto'> | undefined;

  const pct = liq ? liq.comision_pct : comisionPlataforma(db);
  const bruto = liq ? liq.bruto : redondearPeso(ctx.total);
  const comisionValor = liq ? liq.comision_valor : Math.round(bruto * pct);
  const neto = liq ? liq.neto : bruto - comisionValor;
  const conceptosJson = JSON.stringify(liq ? snapshotConceptos(db, liq.id) : []);
  const dias = calcularDiasAlquiler(ctx.fecha_inicio, ctx.fecha_fin);

  const result = db.prepare(`
    INSERT INTO remisiones (reserva_id, propietario_id, numero, propietario_nombre, propietario_documento,
                            vehiculo_descripcion, placa, fecha_inicio, fecha_fin, dias, bruto, comision_pct, comision_valor, neto, conceptos_json, version)
    VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    reservaId, ctx.propietario_id, prop?.nombre || '', prop?.documento || '',
    `${ctx.marca} ${ctx.modelo} ${ctx.anio}`, placaRow?.placa || '',
    ctx.fecha_inicio, ctx.fecha_fin, dias, bruto, pct, comisionValor, neto, conceptosJson,
  );
  const id = Number(result.lastInsertRowid);
  db.prepare('UPDATE remisiones SET numero = ? WHERE id = ?').run(numero('REM', id), id);
  return db.prepare('SELECT * FROM remisiones WHERE reserva_id = ?').get(reservaId);
}

// ── Reemisión de la cuenta de cobro tras editar una liquidación ──────────────
export type ResultadoCuentaCobro = {
  accion: 'creada' | 'actualizada' | 'reemplazada';
  remision: RemisionRow;
  // Solo en 'reemplazada': la cuenta firmada que quedó anulada (para informarlo en la
  // respuesta de la API, en la bitácora y en el aviso al propietario).
  anulada: { numero: string; neto: number; firmada_en: string } | null;
};

/**
 * Deja la cuenta de cobro (remisión) del propietario alineada con la liquidación:
 *
 *   · sin remisión todavía      → la crea con los valores de la liquidación;
 *   · remisión SIN firmar       → la actualiza en sitio (mismo número: nadie ha
 *                                 autorizado nada todavía, es el mismo documento);
 *   · remisión YA FIRMADA       → copia la firmada íntegra a `remisiones_anuladas`
 *                                 (constancia de qué se firmó y cuándo) y reemite la
 *                                 vigente con número nuevo (REM-000012 → REM-000012-R2),
 *                                 versión +1 y firma en blanco. Como el guard de pago
 *                                 exige `remisiones.firmada_en`, el pago queda bloqueado
 *                                 automáticamente hasta que el propietario firme la nueva.
 *
 * Se mantiene UNA fila por reserva en `remisiones` (la vigente) a propósito: es lo que
 * asume la restricción UNIQUE(reserva_id) y todos los LEFT JOIN existentes, así que el
 * guard de firma y los listados siguen mirando siempre el documento correcto sin tocar
 * ni una consulta más.
 */
export function sincronizarCuentaCobro(
  db: DB, reservaId: number, actor: ActorContable, motivo: string,
): ResultadoCuentaCobro | null {
  const liq = db.prepare('SELECT * FROM liquidaciones WHERE reserva_id = ?').get(reservaId) as LiquidacionRow | undefined;
  if (!liq) return null;

  const conceptosJson = JSON.stringify(snapshotConceptos(db, liq.id));
  const previa = db.prepare('SELECT * FROM remisiones WHERE reserva_id = ?').get(reservaId) as RemisionRow | undefined;

  if (!previa) {
    const creada = generarRemision(db, reservaId) as RemisionRow | null;
    // Si no se pudo crear el documento, la liquidación quedaría editada pero SIN cuenta de
    // cobro que firmar — y como el pago exige firma, impagable para siempre. Se lanza para
    // revertir toda la edición en vez de responder `ok` con una cuenta nula.
    if (!creada) {
      throw new ErrorEdicion(500, 'No se pudo generar la cuenta de cobro de esta liquidación; no se guardó ningún cambio.');
    }
    return { accion: 'creada', remision: creada, anulada: null };
  }

  if (!previa.firmada_en) {
    db.prepare(`
      UPDATE remisiones SET bruto = ?, comision_pct = ?, comision_valor = ?, neto = ?, conceptos_json = ?
      WHERE id = ?
    `).run(liq.bruto, liq.comision_pct, liq.comision_valor, liq.neto, conceptosJson, previa.id);
    return {
      accion: 'actualizada',
      remision: db.prepare('SELECT * FROM remisiones WHERE id = ?').get(previa.id) as RemisionRow,
      anulada: null,
    };
  }

  // Firmada y nada material cambió (mismos importes Y mismo desglose palabra por palabra):
  // NO se anula. Antes bastaba con "editar" algo que no movía un peso —un concepto de $0,4,
  // que redondea a $0— para tumbar la firma del propietario y reemitir la cuenta por el
  // mismo neto, copiando de paso la imagen de la firma a `remisiones_anuladas` cada vuelta,
  // repetible sin límite. La firma solo se invalida cuando lo que el propietario autorizó
  // dejó de ser cierto.
  const mismoImporte = redondearPeso(previa.neto) === redondearPeso(liq.neto)
    && redondearPeso(previa.bruto) === redondearPeso(liq.bruto)
    && redondearPeso(previa.comision_valor) === redondearPeso(liq.comision_valor)
    && Number(previa.comision_pct) === Number(liq.comision_pct);
  // Comparación del desglose ya normalizado por las dos vías (parsear + volver a serializar),
  // para que una diferencia de formato del JSON guardado no se confunda con un cambio real.
  const mismoDesglose = JSON.stringify(parsearConceptosJson(previa.conceptos_json)) === JSON.stringify(parsearConceptosJson(conceptosJson));
  if (mismoImporte && mismoDesglose) {
    return {
      accion: 'actualizada',
      remision: previa,
      anulada: null,
    };
  }

  // Firmada: la firma cubría un monto que ya no es el que se va a pagar → se anula.
  db.prepare(`
    INSERT INTO remisiones_anuladas (
      remision_id, reserva_id, propietario_id, numero, version, propietario_nombre, propietario_documento,
      vehiculo_descripcion, placa, fecha_inicio, fecha_fin, dias, bruto, comision_pct, comision_valor, neto,
      conceptos_json, firmada_en, firma_ip, firma_user_agent, firma_imagen, firma_nombre_confirmado, firma_hash,
      emitida_en, anulada_por, anulada_por_nombre, motivo_anulacion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    previa.id, previa.reserva_id, previa.propietario_id, previa.numero, previa.version || 1,
    previa.propietario_nombre, previa.propietario_documento, previa.vehiculo_descripcion, previa.placa,
    previa.fecha_inicio, previa.fecha_fin, previa.dias, previa.bruto, previa.comision_pct,
    previa.comision_valor, previa.neto, previa.conceptos_json || '[]',
    previa.firmada_en, previa.firma_ip, previa.firma_user_agent, previa.firma_imagen,
    previa.firma_nombre_confirmado, previa.firma_hash, previa.created_at,
    actor.id ?? null, actor.nombre || '', motivo,
  );

  const nuevaVersion = (previa.version || 1) + 1;
  // El número base se recalcula SIEMPRE desde el id (no del número actual) para que una
  // segunda reemisión sea REM-000012-R3 y no REM-000012-R2-R3.
  const nuevoNumero = `${numero('REM', previa.id)}-R${nuevaVersion}`;
  db.prepare(`
    UPDATE remisiones SET
      numero = ?, version = ?, bruto = ?, comision_pct = ?, comision_valor = ?, neto = ?, conceptos_json = ?,
      firmada_en = '', firma_ip = '', firma_user_agent = '', firma_imagen = '', firma_nombre_confirmado = '', firma_hash = '',
      created_at = datetime('now','localtime')
    WHERE id = ?
  `).run(nuevoNumero, nuevaVersion, liq.bruto, liq.comision_pct, liq.comision_valor, liq.neto, conceptosJson, previa.id);

  return {
    accion: 'reemplazada',
    remision: db.prepare('SELECT * FROM remisiones WHERE id = ?').get(previa.id) as RemisionRow,
    anulada: { numero: previa.numero, neto: previa.neto, firmada_en: previa.firmada_en },
  };
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

/**
 * Avisa al propietario de que su liquidación cambió. Va por `notificaciones` (bandeja
 * privada del propietario, el mismo canal de `notificarNuevaCuentaCobro` y del aviso de
 * pago) y NO por `avisarPorChat`: ese chat es la conversación propietario↔CLIENTE, y el
 * cliente no tiene por qué ver cuánto se le paga al dueño del carro ni por qué se le
 * descontó una lavada.
 *
 * Si la cuenta firmada quedó anulada, el mensaje lo dice explícitamente y avisa de que el
 * pago está detenido hasta la firma nueva.
 */
function notificarLiquidacionEditada(
  db: DB, rem: RemisionRow, anulada: { numero: string; neto: number } | null, resumenCambios: string,
): void {
  try {
    const netoTxt = `$${rem.neto.toLocaleString('es-CO')}`;
    const titulo = anulada
      ? `✍️ Firma de nuevo tu cuenta de cobro: ${rem.vehiculo_descripcion}`
      : `🧾 Actualizamos tu cuenta de cobro: ${rem.vehiculo_descripcion}`;
    const mensaje = anulada
      ? `Ajustamos la liquidación del alquiler del ${rem.fecha_inicio} al ${rem.fecha_fin}. ` +
        `La cuenta ${anulada.numero} que firmaste (por $${anulada.neto.toLocaleString('es-CO')}) quedó ANULADA y emitimos la ${rem.numero} por ${netoTxt}. ` +
        `${resumenCambios} El pago está detenido hasta que firmes la nueva cuenta desde tu panel.`
      : `Ajustamos tu cuenta de cobro ${rem.numero} del alquiler del ${rem.fecha_inicio} al ${rem.fecha_fin}: ahora recibirás ${netoTxt}. ` +
        `${resumenCambios} Revísala y fírmala desde tu panel.`;
    db.prepare(
      'INSERT INTO notificaciones (destinatario_id, tipo, titulo, mensaje, referencia_id, referencia_tipo) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(rem.propietario_id, 'cuenta_cobro_pendiente', titulo, mensaje, rem.id, 'remision');
  } catch (e) {
    console.error('[contabilidad] no se pudo notificar la liquidación editada:', e instanceof Error ? e.message : e);
  }
}

// ── Sello de integridad de la firma (firma_hash) ────────────────────────────
//
// Qué es y qué NO es. Es un MAC (HMAC-SHA256 con secreto de servidor) sobre los campos
// congelados de la cuenta de cobro en el instante de firmar. Sirve para detectar que la
// fila firmada se alteró DESPUÉS de la firma —por un script, un backfill, un arreglo a
// mano en la BD o una ruta futura— por parte de alguien que puede escribir en la tabla
// pero no conoce `FIRMA_SECRET`. NO es una firma digital del propietario (no hay clave
// suya de por medio) ni prueba nada frente a quien controle el servidor entero.
//
// Antes esto era SHA-256 SIN clave sobre campos públicos: quien pudiera escribir la fila
// podía recalcular el hash con el algoritmo que está en este mismo repo. Y nadie lo
// comparaba nunca: el valor se guardaba y jamás se volvía a leer.
//
// MIGRACIÓN (importante): ya hay firmas en producción con el esquema viejo. El algoritmo
// va VERSIONADO en el propio valor guardado:
//   · `v2:<hex>`  → HMAC-SHA256 con FIRMA_SECRET sobre la base canónica ampliada (abajo).
//                   Es lo único que se emite de ahora en adelante.
//   · `<hex>` a secas (64 chars, sin prefijo) → esquema v1 heredado. Se sigue ACEPTANDO al
//                   verificar, para no dejar impagables las cuentas ya firmadas. Nunca se
//                   emite de nuevo.
//   · vacío → anomalía: `firmarCuentaCobro` SIEMPRE escribió un hash (la columna nació en
//                   el mismo commit que `firmada_en`), así que una firma sin sello no es
//                   "legado", es una fila escrita por fuera del código.
// Se versiona con prefijo en vez de una columna nueva a propósito: no toca el schema, así
// que no abre una brecha de paridad SQLite↔Supabase.

const FIRMA_HASH_PREFIJO_V2 = 'v2:';

// El secreto del MAC (`FIRMA_SECRET`) y la comparación en tiempo constante viven en
// lib/firma-sello.ts desde que hay un segundo documento firmable en la plataforma (los
// contratos digitales, lib/contratos-firma.ts): las dos familias tienen que usar el
// MISMO secreto. La BASE CANÓNICA sí sigue siendo propia de cada documento y se calcula
// aquí abajo.
//
// ⚠️ DESPLIEGUE: hay que crear `FIRMA_SECRET` en Railway ANTES de desplegar esto. Sin la
// variable, en producción no se podrá firmar ninguna cuenta de cobro nueva (error 500
// explícito). Las firmas v1 que ya existen se siguen verificando y pagando sin el secreto.

// Campos que entran en el sello. Se pide la fila entera de `remisiones` (o de
// `remisiones_anuladas`, que copia las mismas columnas) para que verificar sea siempre
// "toma la fila y recalcula", sin que el llamador tenga que acordarse de qué incluir.
export type RemisionSellable = {
  reserva_id: number; numero: string; version?: number;
  propietario_nombre?: string; propietario_documento: string;
  vehiculo_descripcion: string; placa: string;
  fecha_inicio: string; fecha_fin: string; dias?: number;
  bruto: number; comision_pct: number; comision_valor: number; neto: number;
  conceptos_json?: string;
  firma_nombre_confirmado?: string; firma_imagen?: string;
};

// Esquema v1 heredado, tal cual era. Se conserva SOLO para verificar firmas antiguas.
// No lo llames para sellar nada nuevo.
function hashRemisionV1(r: RemisionSellable): string {
  const base = [
    r.numero, r.propietario_documento, r.vehiculo_descripcion, r.placa,
    r.bruto, r.comision_pct, r.comision_valor, r.neto, r.fecha_inicio, r.fecha_fin,
  ].join('|');
  const conceptos = parsearConceptosJson(r.conceptos_json);
  const extra = conceptos.length > 0
    ? '|' + conceptos.map(c => `${c.tipo}:${c.concepto}:${redondearPeso(c.monto)}`).join(';')
    : '';
  return createHash('sha256').update(base + extra).digest('hex');
}

/**
 * Base canónica del sello v2.
 *
 * Canonicalización por JSON.stringify de una estructura normalizada, NO por concatenación
 * con separadores. El esquema viejo unía campos con '|' y los conceptos con ':' y ';' sin
 * escapar nada, así que era AMBIGUO: `[{A,100},{B,200}]` y `[{"A:100;descuento:B",200}]`
 * producían exactamente el mismo hash, y un `vehiculo_descripcion` con un '|' podía
 * desplazar el resto de los campos. JSON.stringify escapa comillas y separadores, y el
 * orden de claves es fijo porque el objeto se construye literal aquí.
 *
 * Qué se añadió respecto de v1 (sin esto la firma es TRASPLANTABLE de una remisión a otra
 * a nivel de BD):
 *   · `reserva_id` y `version` → atan el sello a ESTE documento y a ESTA reemisión;
 *   · `dias` y `propietario_nombre` → salen impresos en el PDF que se firma;
 *   · el `motivo` de cada concepto → también se imprime en el PDF y antes quedaba fuera;
 *   · `firma_nombre_confirmado` y un digest de `firma_imagen` → atan el sello al acto de
 *     firma concreto, no solo a las cifras.
 */
function baseCanonicaV2(r: RemisionSellable): string {
  const conceptos = parsearConceptosJson(r.conceptos_json).map(c => ({
    tipo: c.tipo, concepto: c.concepto, monto: redondearPeso(c.monto), motivo: c.motivo,
  }));
  return JSON.stringify({
    v: 2,
    reserva_id: Number(r.reserva_id) || 0,
    numero: String(r.numero || ''),
    version: Number(r.version) || 1,
    propietario_nombre: String(r.propietario_nombre || ''),
    propietario_documento: String(r.propietario_documento || ''),
    vehiculo_descripcion: String(r.vehiculo_descripcion || ''),
    placa: String(r.placa || ''),
    fecha_inicio: String(r.fecha_inicio || ''),
    fecha_fin: String(r.fecha_fin || ''),
    dias: Number(r.dias) || 0,
    bruto: redondearPeso(r.bruto),
    comision_pct: Number(r.comision_pct) || 0,
    comision_valor: redondearPeso(r.comision_valor),
    neto: redondearPeso(r.neto),
    conceptos,
    firma_nombre_confirmado: String(r.firma_nombre_confirmado || ''),
    // De la imagen se guarda su digest, no la imagen: el sello queda corto y estable, y
    // cambiar el trazo por otro igualmente invalida la verificación.
    firma_imagen_sha256: createHash('sha256').update(String(r.firma_imagen || '')).digest('hex'),
  });
}

function hashRemisionV2(r: RemisionSellable): string {
  return FIRMA_HASH_PREFIJO_V2 + sellarHmac(baseCanonicaV2(r));
}

// Sella una remisión que se acaba de firmar. Siempre emite v2.
export function calcularHashRemision(r: RemisionSellable): string {
  return hashRemisionV2(r);
}

export type VerificacionFirma = {
  ok: boolean;
  // 'v2' = sello actual; 'v1' = sello heredado aceptado por compatibilidad;
  // 'ninguno' = la fila está firmada pero no tiene sello (anomalía, no legado).
  alg: 'v1' | 'v2' | 'ninguno';
  motivo: string;
};

/**
 * Verifica el sello de integridad de una cuenta de cobro FIRMADA (o de su copia anulada).
 * Se usa al pagar (bloquea la transferencia si no cuadra) y al listarle al propietario sus
 * cuentas firmadas.
 *
 * Nota de compatibilidad: el camino v1 no toca `FIRMA_SECRET`, así que las firmas que ya
 * existen se siguen verificando y pagando aunque la variable de entorno todavía no esté
 * puesta. Solo firmar (emitir un sello v2 nuevo) la exige.
 */
export function verificarHashRemision(r: RemisionSellable & { firma_hash?: string }): VerificacionFirma {
  const guardado = String(r.firma_hash || '').trim();
  if (!guardado) {
    return { ok: false, alg: 'ninguno', motivo: 'la cuenta figura firmada pero no tiene sello de integridad' };
  }
  if (guardado.startsWith(FIRMA_HASH_PREFIJO_V2)) {
    let esperado: string;
    try {
      esperado = hashRemisionV2(r);
    } catch {
      // Falta FIRMA_SECRET en producción. No se puede afirmar que la cuenta esté bien NI
      // que esté manipulada: se bloquea igual, pero con un motivo que apunte al problema
      // real (configuración del servidor) y no a una sospecha de fraude.
      return { ok: false, alg: 'v2', motivo: 'no se pudo verificar el sello: falta configurar FIRMA_SECRET en el servidor' };
    }
    return igualesEnTiempoConstante(guardado, esperado)
      ? { ok: true, alg: 'v2', motivo: '' }
      : { ok: false, alg: 'v2', motivo: 'el sello de integridad no corresponde al contenido actual de la cuenta firmada' };
  }
  if (!ACEPTAR_SELLO_V1) {
    return { ok: false, alg: 'v1', motivo: 'el sello de integridad usa un esquema heredado que ya no se acepta' };
  }
  return igualesEnTiempoConstante(guardado, hashRemisionV1(r))
    ? { ok: true, alg: 'v1', motivo: '' }
    : { ok: false, alg: 'v1', motivo: 'el sello heredado de integridad no corresponde al contenido actual de la cuenta firmada' };
}

/**
 * Re-sella con el esquema v2 una firma heredada que acaba de verificar bien con v1
 * (migración perezosa: la fila se actualiza la primera vez que alguien la lee o la paga).
 *
 * POR QUÉ es necesario, y no solo cosmético: v1 NO tiene clave. Mientras la verificación
 * acepte v1, quien pueda escribir en la tabla puede "degradar" una firma —borrar el
 * prefijo `v2:` y poner un SHA-256 que él mismo calcula sobre el contenido manipulado— y
 * pasar el control. Aceptar v1 es el precio de no dejar impagables las cuentas ya firmadas
 * en producción; este re-sello reduce ese precio a la ventana mínima: en cuanto una cuenta
 * heredada se consulta o se paga una sola vez, queda protegida por el HMAC.
 *
 * Cuando en producción ya no queden filas con sello v1
 *   SELECT COUNT(*) FROM remisiones WHERE firmada_en <> '' AND firma_hash NOT LIKE 'v2:%';
 *   SELECT COUNT(*) FROM remisiones_anuladas WHERE firmada_en <> '' AND firma_hash NOT LIKE 'v2:%';
 * se puede cerrar del todo poniendo ACEPTAR_SELLO_V1 = false (abajo) y desplegando.
 *
 * Nunca revienta el flujo que la llama: si no se puede re-sellar (p. ej. FIRMA_SECRET aún
 * no está puesto), queda en logs y la verificación v1 sigue valiendo.
 */
export const ACEPTAR_SELLO_V1: boolean = true;

export function resellarFirmaHeredada(
  db: DB, tabla: 'remisiones' | 'remisiones_anuladas', id: number, r: RemisionSellable,
): void {
  try {
    db.prepare(`UPDATE ${tabla} SET firma_hash = ? WHERE id = ? AND firma_hash NOT LIKE 'v2:%'`)
      .run(hashRemisionV2(r), id);
  } catch (e) {
    console.error('[contabilidad] no se pudo re-sellar la firma heredada:', e instanceof Error ? e.message : e);
  }
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
  opts: { firmaImagen?: string; nombreConfirmado: string; ip: string; userAgent: string; version?: number },
): FirmarCuentaCobroOk | FirmarCuentaCobroError {
  const rem = db.prepare('SELECT * FROM remisiones WHERE id = ?').get(remisionId) as RemisionRow | undefined;
  if (!rem) return { ok: false, status: 404, error: 'Cuenta de cobro no encontrada.' };
  if (rem.propietario_id !== propietarioId) return { ok: false, status: 403, error: 'No tienes permiso para firmar esta cuenta de cobro.' };
  if (rem.firmada_en) return { ok: false, status: 409, error: 'Esta cuenta de cobro ya fue firmada.' };

  // El propietario firma el documento que TIENE EN PANTALLA. Si entre que se le cargó y
  // que apretó "Firmar" la liquidación se editó (reemisión con otro monto), su firma
  // cubriría una cifra que nunca vio: se rechaza y se le pide recargar.
  if (opts.version !== undefined && Number(opts.version) !== (rem.version || 1)) {
    return { ok: false, status: 409, error: 'Esta cuenta de cobro cambió mientras la revisabas. Recarga la página para ver el monto actualizado antes de firmar.' };
  }

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

  // El sello cubre TAMBIÉN el acto de firma (nombre confirmado + trazo), así que se calcula
  // sobre los valores que se están a punto de escribir, no sobre la fila tal como estaba.
  const hash = calcularHashRemision({ ...rem, firma_nombre_confirmado: nombreConfirmado, firma_imagen: firmaImagen });
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
  const yaExistiaRemision = !!db.prepare('SELECT id FROM remisiones WHERE reserva_id = ?').get(reservaId);
  const remision = generarRemision(db, reservaId); // remisión a nombre del dueño del vehículo = cuenta de cobro
  if (remision && !yaExistiaRemision) notificarNuevaCuentaCobro(db, remision as RemisionRow);
  return { factura, liquidacion, remision };
}

// `AND estado = 'pendiente'`: nunca reescribe la fecha/comprobante de un pago que ya
// estaba registrado (doble clic, reintento del cliente o dos administradores a la vez).
// Devuelve cuántas filas cambiaron de verdad.
export function marcarLiquidacionesPagadas(db: DB, reservaIds: number[], comprobante: string, comprobanteUrl = ''): number {
  if (reservaIds.length === 0) return 0;
  const placeholders = reservaIds.map(() => '?').join(',');
  const r = db.prepare(`UPDATE liquidaciones SET estado = 'pagado', pagado_en = datetime('now','localtime'), comprobante = ?, comprobante_url = ? WHERE reserva_id IN (${placeholders}) AND estado = 'pendiente'`)
    .run(comprobante, comprobanteUrl, ...reservaIds);
  return r.changes;
}

// ── Edición de liquidaciones ────────────────────────────────────────────────
// Reglas de negocio (decididas por el dueño, ver PROYECTO.md):
//   A · PENDIENTE y sin firmar → se edita libre; se recalcula el neto y se regenera la
//       cuenta de cobro (mismo número: nadie autorizó nada todavía).
//   B · PENDIENTE y YA FIRMADA → se edita, pero la cuenta firmada queda ANULADA (copiada
//       a `remisiones_anuladas`), se emite una nueva con número nuevo, se avisa al
//       propietario y el pago queda bloqueado hasta que firme la nueva.
//   C · PAGADA → NO se toca. El costo se registra como ajuste pendiente (`ajustes_propietario`)
//       y lo consume la SIGUIENTE liquidación de ese propietario.

export type EdicionConcepto = { tipo: TipoConcepto; concepto: string; monto: number; motivo: string };
export type EdicionLiquidacion = {
  bruto?: number; motivo_bruto?: string;
  comision_pct?: number; motivo_comision?: string;
  agregar?: EdicionConcepto[];
  quitar?: Array<{ id: number; motivo: string }>;
  confirmar_neto_negativo?: boolean;
};

export type EdicionOk = {
  ok: true;
  liquidacion: LiquidacionRow;
  conceptos: ConceptoRow[];
  totales: TotalesLiquidacion;
  cuenta: ResultadoCuentaCobro | null;
  cambios: string[];
};
export type EdicionError = {
  ok: false; status: number; error: string;
  // Solo cuando el neto quedaría negativo: el llamador debe reenviar con
  // `confirmar_neto_negativo: true` si de verdad es lo que quiere.
  requiere_confirmacion?: boolean;
  preview?: TotalesLiquidacion;
  // Solo cuando la liquidación ya estaba pagada (regla C): el panel usa estos datos para
  // ofrecer registrar el costo como ajuste pendiente del propietario.
  ya_pagada?: boolean;
  propietario_id?: number;
};

// Error de negocio dentro de la transacción: lanzarlo revierte TODO lo escrito (que es
// justo lo que queremos si, por ejemplo, el neto quedó negativo sin confirmación).
class ErrorEdicion extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(status: number, mensaje: string, extra: Record<string, unknown> = {}) {
    super(mensaje);
    this.status = status;
    this.extra = extra;
  }
}

function cop(n: number): string { return `$${redondearPeso(n).toLocaleString('es-CO')}`; }

// Normaliza un texto que viene de fuera antes de validarlo/guardarlo: solo acepta strings
// (un objeto o un array no se convierten a "[object Object]" y se cuelan como descripción)
// y colapsa los espacios, para que el tope de longitud no se pueda esquivar con relleno.
function textoPlano(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(/\s+/g, ' ').trim();
}

/**
 * Edita una liquidación PENDIENTE: agrega/quita conceptos, corrige el bruto y/o el
 * porcentaje de comisión de ESA liquidación, recalcula el neto y deja la cuenta de cobro
 * alineada (regenerándola o reemitiéndola si ya estaba firmada).
 *
 * Todo ocurre dentro de una única transacción de better-sqlite3 (síncrona, así que ningún
 * otro request puede colarse en medio): el estado se revalida DENTRO, de modo que si el
 * pago entró primero, la edición se rechaza con 409 y no escribe nada.
 *
 * NUNCA toca `reservas.total` ni las facturas del cliente: el bruto editable es la base de
 * liquidación al propietario, no lo que pagó el cliente.
 */
export function editarLiquidacion(
  db: DB, reservaId: number, actor: ActorContable, edicion: EdicionLiquidacion,
): EdicionOk | EdicionError {
  const agregar = Array.isArray(edicion.agregar) ? edicion.agregar : [];
  const quitar = Array.isArray(edicion.quitar) ? edicion.quitar : [];

  // ── Validación de forma (fuera de la transacción: no toca BD) ──
  // Topes de volumen ANTES de recorrer nada: sin ellos, un `agregar` de mil líneas se
  // inserta entero, se replica en el `conceptos_json` de la remisión vigente, en el de la
  // anulada y en el PDF, y se sirve en cada carga del panel del propietario.
  if (agregar.length > MAX_LINEAS_POR_EDICION) {
    return { ok: false, status: 400, error: `No puedes agregar más de ${MAX_LINEAS_POR_EDICION} conceptos en una sola edición.` };
  }
  if (quitar.length > MAX_LINEAS_POR_EDICION) {
    return { ok: false, status: 400, error: `No puedes quitar más de ${MAX_LINEAS_POR_EDICION} conceptos en una sola edición.` };
  }
  for (const a of agregar) {
    if (!a || (a.tipo !== 'descuento' && a.tipo !== 'adicional')) {
      return { ok: false, status: 400, error: 'Cada concepto debe ser "descuento" o "adicional".' };
    }
    const cTxt = textoPlano(a.concepto);
    if (!cTxt) return { ok: false, status: 400, error: 'Cada concepto necesita una descripción (ej. "Lavada", "Gasolina").' };
    if (cTxt.length > CONCEPTO_MAX_CHARS) return { ok: false, status: 400, error: `La descripción del concepto no puede pasar de ${CONCEPTO_MAX_CHARS} caracteres.` };
    // `montoConceptoValido` mira el valor CRUDO: rechaza "abc", true, [5], "0x10", {} y
    // también lo que redondee a $0 (un ajuste de $0,4 no mueve plata pero sí tumbaba la firma).
    if (!montoConceptoValido(a.monto)) {
      return { ok: false, status: 400, error: `El monto de "${cTxt}" debe ser un número positivo de al menos $1 y hasta ${cop(MONTO_MAX_CONCEPTO)}.` };
    }
    const mTxt = textoPlano(a.motivo);
    if (!mTxt) return { ok: false, status: 400, error: `Falta el motivo del concepto "${cTxt}". Es obligatorio: es plata de un tercero.` };
    if (mTxt.length > MOTIVO_MAX_CHARS) return { ok: false, status: 400, error: `El motivo no puede pasar de ${MOTIVO_MAX_CHARS} caracteres.` };
  }
  for (const q of quitar) {
    if (!q || !Number.isInteger(Number(q.id)) || Number(q.id) <= 0) return { ok: false, status: 400, error: 'Falta el id del concepto que quieres quitar.' };
    const mTxt = textoPlano(q.motivo);
    if (!mTxt) return { ok: false, status: 400, error: 'Falta el motivo para quitar el concepto. Es obligatorio.' };
    if (mTxt.length > MOTIVO_MAX_CHARS) return { ok: false, status: 400, error: `El motivo no puede pasar de ${MOTIVO_MAX_CHARS} caracteres.` };
  }
  // El bruto se valida CRUDO y solo después se redondea. Al revés (como estaba) no servía
  // de nada: `redondearPeso` convierte cualquier cosa no finita en 0 y `brutoValido(0)` es
  // true, así que `{"bruto":"1'000.000"}` dejaba la base de liquidación en $0 sin un error.
  const brutoCrudo = edicion.bruto === undefined || edicion.bruto === null ? null : edicion.bruto;
  if (brutoCrudo !== null && !brutoValido(brutoCrudo)) {
    return { ok: false, status: 400, error: `El bruto debe ser un número entre 0 y ${cop(500_000_000)}.` };
  }
  const brutoNuevo = brutoCrudo === null ? null : redondearPeso(valorNumerico(brutoCrudo));
  if (brutoNuevo !== null) {
    const mTxt = textoPlano(edicion.motivo_bruto);
    if (!mTxt) return { ok: false, status: 400, error: 'Falta el motivo del cambio de bruto. Es obligatorio.' };
    if (mTxt.length > MOTIVO_MAX_CHARS) return { ok: false, status: 400, error: `El motivo no puede pasar de ${MOTIVO_MAX_CHARS} caracteres.` };
  }
  const pctCrudo = edicion.comision_pct === undefined || edicion.comision_pct === null ? null : edicion.comision_pct;
  if (pctCrudo !== null && !comisionPctValido(pctCrudo)) {
    return { ok: false, status: 400, error: 'La comisión debe estar entre 0 y 1 (ej. 0.35 = 35%).' };
  }
  const pctNuevo = pctCrudo === null ? null : (valorNumerico(pctCrudo) as number);
  if (pctNuevo !== null) {
    const mTxt = textoPlano(edicion.motivo_comision);
    if (!mTxt) return { ok: false, status: 400, error: 'Falta el motivo del cambio de comisión. Es obligatorio.' };
    if (mTxt.length > MOTIVO_MAX_CHARS) return { ok: false, status: 400, error: `El motivo no puede pasar de ${MOTIVO_MAX_CHARS} caracteres.` };
  }
  if (agregar.length === 0 && quitar.length === 0 && brutoNuevo === null && pctNuevo === null) {
    return { ok: false, status: 400, error: 'No enviaste ningún cambio.' };
  }

  try {
    return db.transaction((): EdicionOk => {
      // Revalidación DENTRO de la transacción: es lo que hace imposible editar y pagar a la vez.
      const liq = db.prepare('SELECT * FROM liquidaciones WHERE reserva_id = ?').get(reservaId) as LiquidacionRow | undefined;
      if (!liq) throw new ErrorEdicion(404, 'No existe una liquidación para esa reserva.');
      if (liq.estado === 'pagado') {
        throw new ErrorEdicion(409,
          'Esta liquidación ya fue pagada y no se puede modificar. Registra el costo como ajuste pendiente: se aplicará a la siguiente liquidación de este propietario.',
          { ya_pagada: true, propietario_id: liq.propietario_id });
      }

      const cambios: string[] = [];
      // Auditoría ESTRICTA: esto mueve plata de un tercero. Si la bitácora no se puede
      // escribir, la excepción revienta la transacción y no queda ni el cambio ni un
      // movimiento sin rastro (la variante tolerante se tragaba el error en silencio).
      const auditar = (accion: string, detalle: string) => registrarAuditoriaEstricta(db, actor, {
        area: 'contabilidad', accion, entidad: 'liquidacion', entidad_id: liq.id, detalle,
      });

      // 1) Quitar conceptos
      for (const q of quitar) {
        const c = db.prepare('SELECT * FROM liquidacion_conceptos WHERE id = ? AND liquidacion_id = ?')
          .get(Number(q.id), liq.id) as ConceptoRow | undefined;
        if (!c) throw new ErrorEdicion(404, `El concepto #${q.id} no pertenece a esta liquidación.`);
        db.prepare('DELETE FROM liquidacion_conceptos WHERE id = ?').run(c.id);
        // Si la línea venía de un ajuste pendiente, vuelve a la cola en vez de perderse.
        if (c.origen_ajuste_id) {
          db.prepare("UPDATE ajustes_propietario SET estado = 'pendiente', aplicado_en_liquidacion_id = NULL, aplicado_en = '' WHERE id = ? AND estado = 'aplicado'")
            .run(c.origen_ajuste_id);
        }
        cambios.push(`se quitó el ${c.tipo} "${c.concepto}" (${cop(c.monto)})`);
        auditar('editar_liquidacion_quitar_concepto',
          `Liquidación #${liq.id} (reserva #${reservaId}) · quitó ${c.tipo} "${c.concepto}" · valor anterior ${cop(c.monto)} → 0 · motivo: ${textoPlano(q.motivo)}`
          + (c.origen_ajuste_id ? ` · el ajuste pendiente #${c.origen_ajuste_id} vuelve a quedar pendiente` : ''));
      }

      // 2) Agregar conceptos
      const insConcepto = db.prepare(`
        INSERT INTO liquidacion_conceptos (liquidacion_id, tipo, concepto, monto, motivo, created_by, created_by_nombre)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const a of agregar) {
        const monto = redondearPeso(valorNumerico(a.monto));
        const concepto = textoPlano(a.concepto);
        const motivo = textoPlano(a.motivo);
        insConcepto.run(liq.id, a.tipo, concepto, monto, motivo, actor.id ?? null, actor.nombre || '');
        cambios.push(`se agregó el ${a.tipo} "${concepto}" (${cop(monto)})`);
        auditar('editar_liquidacion_agregar_concepto',
          `Liquidación #${liq.id} (reserva #${reservaId}) · agregó ${a.tipo} "${concepto}" · valor anterior 0 → ${cop(monto)} · motivo: ${motivo}`);
      }

      // 3) Bruto
      if (brutoNuevo !== null && brutoNuevo !== redondearPeso(liq.bruto)) {
        db.prepare('UPDATE liquidaciones SET bruto = ? WHERE id = ?').run(brutoNuevo, liq.id);
        cambios.push(`la base de liquidación pasó de ${cop(liq.bruto)} a ${cop(brutoNuevo)}`);
        auditar('editar_liquidacion_bruto',
          `Liquidación #${liq.id} (reserva #${reservaId}) · bruto anterior ${cop(liq.bruto)} → nuevo ${cop(brutoNuevo)} · motivo: ${textoPlano(edicion.motivo_bruto)} · NO cambia reservas.total ni la factura del cliente`);
      }

      // 4) Comisión de ESTA liquidación (no toca la comisión global de la plataforma)
      if (pctNuevo !== null && pctNuevo !== liq.comision_pct) {
        db.prepare('UPDATE liquidaciones SET comision_pct = ? WHERE id = ?').run(pctNuevo, liq.id);
        cambios.push(`la comisión pasó de ${(liq.comision_pct * 100).toFixed(1)}% a ${(pctNuevo * 100).toFixed(1)}%`);
        auditar('editar_liquidacion_comision',
          `Liquidación #${liq.id} (reserva #${reservaId}) · comisión anterior ${(liq.comision_pct * 100).toFixed(2)}% → nueva ${(pctNuevo * 100).toFixed(2)}% · motivo: ${textoPlano(edicion.motivo_comision)} · solo esta liquidación, la comisión global no cambia`);
      }

      if (cambios.length === 0) throw new ErrorEdicion(400, 'Ningún valor cambió respecto a lo que ya estaba guardado.');

      // 5) Recalcular el neto (nunca se escribe a mano)
      const totales = recalcularLiquidacion(db, liq.id);
      if (!totales) throw new ErrorEdicion(500, 'No se pudo recalcular la liquidación.');

      // Neto negativo: los descuentos superaron bruto − comisión. No se bloquea (puede ser
      // real: un daño mayor al alquiler), pero exige confirmación explícita porque implica
      // que el propietario le QUEDA DEBIENDO a DrivePass y la cuenta no se podrá pagar.
      // Techo defensivo del resultado: ni la transferencia ni el saldo en contra pueden
      // salirse del rango razonable del negocio, por más que cada línea suelta sea válida.
      if (!netoValido(totales.neto)) {
        throw new ErrorEdicion(400,
          `Con estos cambios el neto quedaría en ${cop(totales.neto)}, fuera del rango permitido (máximo ${cop(NETO_MAX_ABS)} en valor absoluto). Revisa los importes.`);
      }

      if (totales.neto < 0 && !edicion.confirmar_neto_negativo) {
        throw new ErrorEdicion(400,
          `Con estos cambios el neto quedaría en ${cop(totales.neto)} (negativo): los descuentos superan el bruto menos la comisión. ` +
          'Confirma explícitamente si es lo que quieres, o deja el excedente como ajuste pendiente para la próxima liquidación.',
          { requiere_confirmacion: true, preview: totales });
      }

      // 6) Cuenta de cobro alineada + aviso al propietario
      const motivoDoc = [edicion.motivo_bruto, edicion.motivo_comision, ...agregar.map(a => a.motivo), ...quitar.map(q => q.motivo)]
        .map(textoPlano).filter(Boolean).join(' · ').slice(0, MOTIVO_MAX_CHARS * 2);
      const cuenta = sincronizarCuentaCobro(db, reservaId, actor, motivoDoc || 'Edición de la liquidación');
      // Se avisa SIEMPRE, también cuando la edición CREÓ la cuenta de cobro (liquidación
      // vieja que no tenía documento): esa cuenta nace sin firmar y el pago queda bloqueado
      // hasta que el propietario la firme — si no se le avisa, se queda esperando una
      // transferencia que nadie le va a poder hacer.
      if (cuenta?.accion === 'creada') {
        notificarNuevaCuentaCobro(db, cuenta.remision);
      } else if (cuenta) {
        notificarLiquidacionEditada(db, cuenta.remision, cuenta.anulada, `Cambios: ${cambios.join('; ')}.`);
      }

      auditar('editar_liquidacion',
        `Liquidación #${liq.id} (reserva #${reservaId}) · neto anterior ${cop(liq.neto)} → nuevo ${cop(totales.neto)} · ${cambios.join('; ')}`
        + (cuenta?.anulada
          ? ` · ANULÓ la cuenta de cobro firmada ${cuenta.anulada.numero} (${cop(cuenta.anulada.neto)}, firmada ${cuenta.anulada.firmada_en}) y emitió ${cuenta.remision.numero}; el pago queda bloqueado hasta la nueva firma`
          : cuenta ? ` · cuenta de cobro ${cuenta.remision.numero} ${cuenta.accion}` : ''));

      return {
        ok: true,
        liquidacion: db.prepare('SELECT * FROM liquidaciones WHERE id = ?').get(liq.id) as LiquidacionRow,
        conceptos: listarConceptos(db, liq.id),
        totales,
        cuenta,
        cambios,
      };
    })();
  } catch (e) {
    if (e instanceof ErrorEdicion) {
      return { ok: false, status: e.status, error: e.message, ...e.extra } as EdicionError;
    }
    throw e;
  }
}

// ── Ajustes pendientes por propietario (regla C) ────────────────────────────
export function listarAjustesPendientes(db: DB, propietarioId?: number): AjusteRow[] {
  const sql = `
    SELECT a.*, COALESCE(u.nombre,'') AS propietario_nombre
    FROM ajustes_propietario a
    JOIN usuarios u ON a.propietario_id = u.id
    WHERE a.estado = 'pendiente'${propietarioId ? ' AND a.propietario_id = ?' : ''}
    ORDER BY a.id
  `;
  return (propietarioId ? db.prepare(sql).all(propietarioId) : db.prepare(sql).all()) as AjusteRow[];
}

// `concepto`, `monto` y `motivo` se declaran `unknown` A PROPÓSITO: llegan crudos del JSON
// de la petición y quien los valida es esta función (parser estricto + topes), no el
// llamador. Tiparlos como string/number invitaba a que la capa de API los "arreglara" con
// String()/Number() antes de tiempo, que es justo lo que colaba `true` como $1.
export type CrearAjusteInput = {
  propietario_id: number; tipo: TipoConcepto; concepto: unknown; monto: unknown;
  motivo: unknown; reserva_origen_id?: number | null;
};

export function crearAjustePendiente(
  db: DB, actor: ActorContable, input: CrearAjusteInput,
): { ok: true; ajuste: AjusteRow } | { ok: false; status: number; error: string } {
  const propietarioId = Number(input.propietario_id);
  if (!Number.isInteger(propietarioId) || propietarioId <= 0) return { ok: false, status: 400, error: 'Falta el propietario.' };
  if (input.tipo !== 'descuento' && input.tipo !== 'adicional') return { ok: false, status: 400, error: 'El ajuste debe ser "descuento" o "adicional".' };
  const concepto = textoPlano(input.concepto);
  if (!concepto) return { ok: false, status: 400, error: 'Falta la descripción del ajuste (ej. "Lavada", "Multa").' };
  if (concepto.length > CONCEPTO_MAX_CHARS) return { ok: false, status: 400, error: `La descripción no puede pasar de ${CONCEPTO_MAX_CHARS} caracteres.` };
  if (!montoConceptoValido(input.monto)) return { ok: false, status: 400, error: `El monto debe ser un número de al menos $1 y hasta ${cop(MONTO_MAX_CONCEPTO)}.` };
  const motivo = textoPlano(input.motivo);
  if (!motivo) return { ok: false, status: 400, error: 'El motivo es obligatorio.' };
  if (motivo.length > MOTIVO_MAX_CHARS) return { ok: false, status: 400, error: `El motivo no puede pasar de ${MOTIVO_MAX_CHARS} caracteres.` };

  const prop = db.prepare("SELECT id, nombre, rol FROM usuarios WHERE id = ?").get(propietarioId) as { id: number; nombre: string; rol: string } | undefined;
  if (!prop) return { ok: false, status: 404, error: 'Propietario no encontrado.' };
  // El `rol` se leía y no se usaba: se podía crear un descuento contra CUALQUIER usuario
  // (un cliente, otro admin) como si fuera propietario.
  if (prop.rol !== 'propietario') {
    return { ok: false, status: 400, error: 'Ese usuario no es propietario: no se le pueden registrar ajustes de liquidación.' };
  }

  const reservaOrigen = Number(input.reserva_origen_id) || null;
  if (reservaOrigen) {
    if (!Number.isInteger(reservaOrigen) || reservaOrigen <= 0) return { ok: false, status: 400, error: 'La reserva indicada no es válida.' };
    // Antes solo se comprobaba que la reserva EXISTIERA. Con eso se podía cargarle un
    // descuento de $2.000.000 al propietario A citando una reserva del propietario B, con
    // toda la apariencia de trazabilidad (el número de reserva sale impreso en la cuenta
    // de cobro donde el ajuste se aplique). El dueño del vehículo de esa reserva tiene que
    // ser el mismo propietario al que se le carga el ajuste.
    const r = db.prepare(`
      SELECT r.id, v.propietario_id
      FROM reservas r JOIN vehiculos v ON r.vehiculo_id = v.id
      WHERE r.id = ?
    `).get(reservaOrigen) as { id: number; propietario_id: number } | undefined;
    if (!r) return { ok: false, status: 404, error: 'La reserva indicada no existe.' };
    if (Number(r.propietario_id) !== propietarioId) {
      return { ok: false, status: 400, error: `La reserva #${reservaOrigen} no es de este propietario: el ajuste no puede citarla como origen.` };
    }
  }

  const monto = redondearPeso(valorNumerico(input.monto));

  // Insert + bitácora en UNA transacción, con auditoría estricta: un ajuste es plata que se
  // le descontará al propietario en su próxima liquidación, así que no puede quedar guardado
  // sin rastro de quién lo creó.
  const id = db.transaction((): number => {
    const res = db.prepare(`
      INSERT INTO ajustes_propietario (propietario_id, tipo, concepto, monto, motivo, reserva_origen_id, created_by, created_by_nombre)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(propietarioId, input.tipo, concepto, monto, motivo, reservaOrigen, actor.id ?? null, actor.nombre || '');
    const nuevoId = Number(res.lastInsertRowid);

    registrarAuditoriaEstricta(db, actor, {
      area: 'contabilidad', accion: 'crear_ajuste_pendiente', entidad: 'ajuste_propietario', entidad_id: nuevoId,
      detalle: `Ajuste pendiente #${nuevoId} para ${prop.nombre} (#${propietarioId}) · ${input.tipo} "${concepto}" ${cop(monto)}`
        + (reservaOrigen ? ` · corresponde a la reserva #${reservaOrigen}` : '')
        + ` · motivo: ${motivo} · se aplicará a su próxima liquidación`,
    });
    return nuevoId;
  })();

  return { ok: true, ajuste: db.prepare('SELECT * FROM ajustes_propietario WHERE id = ?').get(id) as AjusteRow };
}

// Un ajuste pendiente NO caduca: si el propietario no vuelve a tener reservas, se queda
// visible en el panel (Contabilidad → Liquidaciones) hasta que alguien lo cobre por fuera
// y lo anule a mano con su motivo. Nunca desaparece solo.
export function anularAjustePendiente(
  db: DB, actor: ActorContable, ajusteId: number, motivo: unknown,
): { ok: true } | { ok: false; status: number; error: string } {
  const m = textoPlano(motivo);
  if (!m) return { ok: false, status: 400, error: 'El motivo de anulación es obligatorio.' };
  if (m.length > MOTIVO_MAX_CHARS) return { ok: false, status: 400, error: `El motivo no puede pasar de ${MOTIVO_MAX_CHARS} caracteres.` };
  const a = db.prepare('SELECT * FROM ajustes_propietario WHERE id = ?').get(ajusteId) as AjusteRow | undefined;
  if (!a) return { ok: false, status: 404, error: 'Ajuste no encontrado.' };
  if (a.estado !== 'pendiente') return { ok: false, status: 409, error: `Este ajuste ya está ${a.estado} y no se puede anular.` };

  // Anulación + bitácora en una sola transacción con auditoría estricta: anular un ajuste
  // le perdona plata a alguien, no puede pasar sin rastro.
  const cambio = db.transaction((): boolean => {
    const r = db.prepare("UPDATE ajustes_propietario SET estado = 'anulado', anulado_en = datetime('now','localtime'), motivo_anulacion = ? WHERE id = ? AND estado = 'pendiente'")
      .run(m, ajusteId);
    if (r.changes !== 1) return false;

    registrarAuditoriaEstricta(db, actor, {
      area: 'contabilidad', accion: 'anular_ajuste_pendiente', entidad: 'ajuste_propietario', entidad_id: ajusteId,
      detalle: `Anuló el ajuste pendiente #${ajusteId} (${a.tipo} "${a.concepto}" ${cop(a.monto)}) del propietario #${a.propietario_id} · motivo: ${m}`,
    });
    return true;
  })();
  if (!cambio) return { ok: false, status: 409, error: 'El ajuste cambió de estado mientras lo anulabas.' };
  return { ok: true };
}
