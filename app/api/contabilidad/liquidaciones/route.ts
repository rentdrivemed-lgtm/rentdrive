import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { registrarAuditoria, registrarAuditoriaEstricta } from '@/lib/permisos';
import {
  marcarLiquidacionesPagadas, generarRemision, editarLiquidacion, listarAjustesPendientes,
  verificarHashRemision, resellarFirmaHeredada,
  type ConceptoRow, type EdicionLiquidacion,
} from '@/lib/contabilidad';

export const dynamic = 'force-dynamic';

// Tope de liquidaciones por llamada al PUT. Sin él, `reserva_ids` con decenas de miles de
// elementos arma un `IN (?,?,…)` que revienta el límite de variables de SQLite (999 por
// defecto en muchas builds) y, con la firma de cada remisión viajando en el mismo SELECT,
// carga megas de imágenes en memoria. Pagar más de 200 servicios de un golpe no es un caso
// real del negocio.
const MAX_RESERVAS_POR_PAGO = 200;

// Normaliza `reserva_ids` venga como venga del cliente: exige array, se queda solo con
// enteros positivos, quita repetidos (un id repetido duplicaría el neto del resumen) y
// acota la cantidad. Antes un objeto en vez de un array reventaba en `.map` con un 500.
function idsDeReservaValidos(body: { reserva_ids?: unknown; reserva_id?: unknown }): { ids: number[]; error: string | null } {
  const crudos: unknown[] = Array.isArray(body.reserva_ids)
    ? body.reserva_ids
    : (body.reserva_ids === undefined || body.reserva_ids === null)
      ? (body.reserva_id === undefined || body.reserva_id === null ? [] : [body.reserva_id])
      : [];
  if (!Array.isArray(body.reserva_ids) && body.reserva_ids !== undefined && body.reserva_ids !== null) {
    return { ids: [], error: 'reserva_ids debe ser una lista de números.' };
  }
  const ids: number[] = [];
  for (const c of crudos) {
    const n = typeof c === 'number' ? c : typeof c === 'string' && /^\d+$/.test(c.trim()) ? Number(c.trim()) : NaN;
    if (!Number.isInteger(n) || n <= 0) return { ids: [], error: 'Cada reserva_id debe ser un número entero positivo.' };
    if (!ids.includes(n)) ids.push(n);
  }
  if (ids.length > MAX_RESERVAS_POR_PAGO) {
    return { ids: [], error: `No se pueden pagar más de ${MAX_RESERVAS_POR_PAGO} liquidaciones en una sola operación.` };
  }
  return { ids, error: null };
}

type LiquidacionRow = {
  id: number; reserva_id: number; propietario_id: number;
  bruto: number; comision_pct: number; comision_valor: number; neto: number;
  estado: string; pagado_en: string; comprobante: string; comprobante_url: string;
  propietario_nombre: string; propietario_correo: string; propietario_documento: string;
  banco: string; numero_cuenta: string; placa: string; remision_numero: string; firmada_en: string;
  remision_version: number;
  marca: string; modelo: string; anio: number; fecha_inicio: string; fecha_fin: string; usuario_nombre: string;
  conceptos: ConceptoRow[];
};

export async function GET(req: NextRequest) {
  const g = await guardArea('contabilidad');
  if ('error' in g) return g.error;
  const { db } = g;

  const { searchParams } = new URL(req.url);
  const soloEstado = searchParams.get('estado') || 'pendiente';

  // Backfill: asegura que cada liquidación tenga su remisión guardada como soporte del propietario.
  const sinRemision = db.prepare(`
    SELECT l.reserva_id FROM liquidaciones l
    LEFT JOIN remisiones rem ON rem.reserva_id = l.reserva_id
    WHERE l.estado = ? AND rem.id IS NULL
  `).all(soloEstado) as Array<{ reserva_id: number }>;
  for (const s of sinRemision) { try { generarRemision(db, s.reserva_id); } catch { /* no bloquea el listado */ } }

  const liquidaciones = db.prepare(`
    SELECT l.*, p.nombre AS propietario_nombre, p.correo AS propietario_correo,
           COALESCE(p.documento_identidad,'') AS propietario_documento,
           COALESCE(p.banco,'') AS banco, COALESCE(p.numero_cuenta,'') AS numero_cuenta,
           COALESCE(v.placa,'') AS placa, COALESCE(rem.numero,'') AS remision_numero, COALESCE(rem.firmada_en,'') AS firmada_en,
           COALESCE(rem.version, 1) AS remision_version,
           v.marca, v.modelo, v.anio, r.fecha_inicio, r.fecha_fin, u.nombre AS usuario_nombre
    FROM liquidaciones l
    JOIN usuarios p ON l.propietario_id = p.id
    JOIN reservas r ON l.reserva_id = r.id
    JOIN vehiculos v ON r.vehiculo_id = v.id
    JOIN usuarios u ON r.usuario_id = u.id
    LEFT JOIN remisiones rem ON rem.reserva_id = l.reserva_id
    WHERE l.estado = ?
    ORDER BY r.fecha_fin DESC
  `).all(soloEstado) as LiquidacionRow[];

  // Desglose (descuentos/adicionales) de todas las liquidaciones listadas, en una sola
  // consulta. Las liquidaciones de siempre (sin conceptos) quedan con [] y se ven y se
  // comportan exactamente igual que antes.
  const conceptosPorLiquidacion: Record<number, ConceptoRow[]> = {};
  if (liquidaciones.length > 0) {
    const ids = liquidaciones.map(l => l.id);
    const filas = db.prepare(
      `SELECT * FROM liquidacion_conceptos WHERE liquidacion_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`
    ).all(...ids) as ConceptoRow[];
    for (const c of filas) {
      (conceptosPorLiquidacion[c.liquidacion_id] ||= []).push(c);
    }
  }
  for (const l of liquidaciones) l.conceptos = conceptosPorLiquidacion[l.id] || [];

  const porPropietario: Record<number, {
    propietario_id: number; propietario_nombre: string; propietario_correo: string;
    banco: string; numero_cuenta: string; total_neto: number; liquidaciones: LiquidacionRow[];
  }> = {};

  for (const l of liquidaciones) {
    if (!porPropietario[l.propietario_id]) {
      porPropietario[l.propietario_id] = {
        propietario_id: l.propietario_id, propietario_nombre: l.propietario_nombre, propietario_correo: l.propietario_correo,
        banco: l.banco, numero_cuenta: l.numero_cuenta, total_neto: 0, liquidaciones: [],
      };
    }
    porPropietario[l.propietario_id].total_neto += l.neto;
    porPropietario[l.propietario_id].liquidaciones.push(l);
  }

  // Ajustes que quedaron pendientes de aplicar (costos detectados DESPUÉS de pagar una
  // liquidación). Van SIEMPRE en la respuesta, aunque el propietario no tenga ninguna
  // liquidación en este filtro: si no se vieran, un ajuste podría quedar olvidado para
  // siempre cuando el propietario deja de tener reservas.
  const ajustesPendientes = listarAjustesPendientes(db);

  return NextResponse.json({
    liquidaciones,
    por_propietario: Object.values(porPropietario),
    total_general: liquidaciones.reduce((s, l) => s + l.neto, 0),
    ajustes_pendientes: ajustesPendientes,
  });
}

// Marca una o varias liquidaciones como pagadas (transferencia manual, ya realizada) y avisa al propietario.
//
// Todo el bloque "leer estado → decidir → pagar → notificar" corre dentro de UNA transacción
// de better-sqlite3 (síncrona): así no puede colarse una edición entre la lectura del neto y
// el registro del pago. Si la edición llegó primero, esta transacción lee el neto YA nuevo;
// si llegó después, se encuentra la liquidación en estado 'pagado' y la rechaza.
export async function PUT(req: NextRequest) {
  const g = await guardArea('contabilidad');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const body = await req.json().catch(() => ({})) as { reserva_ids?: unknown; reserva_id?: unknown; comprobante?: string; comprobante_url?: string };
  const { ids, error: errorIds } = idsDeReservaValidos(body);
  if (errorIds) return NextResponse.json({ error: errorIds }, { status: 400 });
  if (ids.length === 0) return NextResponse.json({ error: 'Se requiere al menos un reserva_id' }, { status: 400 });

  type Fila = {
    reserva_id: number; propietario_id: number; neto: number; marca: string; modelo: string;
    fecha_inicio: string; fecha_fin: string; firmada_en: string;
    // Campos de la cuenta de cobro firmada: el pago tiene que comprobar que la firma cubre
    // ESTE monto, no solo que exista una firma.
    rem_id: number | null; rem_numero: string; rem_neto: number; rem_bruto: number;
    rem_comision_valor: number; rem_comision_pct: number; rem_version: number;
    rem_conceptos_json: string; rem_firma_hash: string;
    rem_propietario_nombre: string; rem_propietario_documento: string;
    rem_vehiculo_descripcion: string; rem_placa: string;
    rem_fecha_inicio: string; rem_fecha_fin: string; rem_dias: number;
    rem_firma_nombre_confirmado: string; rem_firma_imagen: string;
    liq_bruto: number; liq_comision_valor: number;
  };
  type Omitido = { reserva_id: number; marca: string; modelo: string; motivo: string };

  const pagar = db.transaction((): { status: number; body: Record<string, unknown> } => {
    const rows = db.prepare(`
      SELECT l.reserva_id, l.propietario_id, l.neto, v.marca, v.modelo, r.fecha_inicio, r.fecha_fin,
             l.bruto AS liq_bruto, l.comision_valor AS liq_comision_valor,
             COALESCE(rem.firmada_en, '') AS firmada_en,
             rem.id AS rem_id, COALESCE(rem.numero,'') AS rem_numero,
             COALESCE(rem.neto, 0) AS rem_neto, COALESCE(rem.bruto, 0) AS rem_bruto,
             COALESCE(rem.comision_valor, 0) AS rem_comision_valor, COALESCE(rem.comision_pct, 0) AS rem_comision_pct,
             COALESCE(rem.version, 1) AS rem_version, COALESCE(rem.conceptos_json, '[]') AS rem_conceptos_json,
             COALESCE(rem.firma_hash, '') AS rem_firma_hash,
             COALESCE(rem.propietario_nombre,'') AS rem_propietario_nombre,
             COALESCE(rem.propietario_documento,'') AS rem_propietario_documento,
             COALESCE(rem.vehiculo_descripcion,'') AS rem_vehiculo_descripcion,
             COALESCE(rem.placa,'') AS rem_placa,
             COALESCE(rem.fecha_inicio,'') AS rem_fecha_inicio, COALESCE(rem.fecha_fin,'') AS rem_fecha_fin,
             COALESCE(rem.dias, 0) AS rem_dias,
             COALESCE(rem.firma_nombre_confirmado,'') AS rem_firma_nombre_confirmado,
             COALESCE(rem.firma_imagen,'') AS rem_firma_imagen
      FROM liquidaciones l
      JOIN reservas r ON l.reserva_id = r.id
      JOIN vehiculos v ON r.vehiculo_id = v.id
      LEFT JOIN remisiones rem ON rem.reserva_id = l.reserva_id
      WHERE l.reserva_id IN (${ids.map(() => '?').join(',')}) AND l.estado = 'pendiente'
    `).all(...ids) as Fila[];

    if (rows.length === 0) return { status: 400, body: { error: 'No hay liquidaciones pendientes con esos IDs' } };

    // Requisito previo al pago: el propietario tiene que haber firmado su cuenta de cobro
    // (remisión) autorizando el monto exacto. Si la liquidación se editó después de firmada,
    // `sincronizarCuentaCobro` dejó `firmada_en` vacío en la cuenta vigente — así que este
    // mismo guard bloquea el pago hasta la firma NUEVA, sin lógica adicional.
    // Las que no cumplen se excluyen del pago (no se rechazan las demás) y se informan.
    const omitidos: Omitido[] = [];
    const pagables: Fila[] = [];
    // Evento de integridad: algo firmado no cuadra con lo que se iba a transferir. No es un
    // "pendiente de firma" cualquiera — es la señal de que alguien escribió en la BD por
    // fuera del código. Se registra con auditoría ESTRICTA (si no se puede dejar constancia,
    // la transacción entera se revierte y no se paga nada).
    const integridad = (r: Fila, detalle: string) => registrarAuditoriaEstricta(db, { ...user, nivel }, {
      area: 'contabilidad', accion: 'integridad_cuenta_cobro', entidad: 'remision', entidad_id: r.rem_id,
      detalle: `Pago BLOQUEADO de la liquidación de la reserva #${r.reserva_id}`
        + (r.rem_numero ? ` (cuenta ${r.rem_numero})` : '')
        + `: ${detalle}. Neto de la liquidación ${Math.round(r.neto)}, neto firmado ${Math.round(r.rem_neto)}.`,
    });
    // Campos de la cuenta firmada tal como entran al sello de integridad.
    const sellable = (r: Fila) => ({
      reserva_id: r.reserva_id, numero: r.rem_numero, version: r.rem_version,
      propietario_nombre: r.rem_propietario_nombre, propietario_documento: r.rem_propietario_documento,
      vehiculo_descripcion: r.rem_vehiculo_descripcion, placa: r.rem_placa,
      fecha_inicio: r.rem_fecha_inicio, fecha_fin: r.rem_fecha_fin, dias: r.rem_dias,
      bruto: r.rem_bruto, comision_pct: r.rem_comision_pct, comision_valor: r.rem_comision_valor, neto: r.rem_neto,
      conceptos_json: r.rem_conceptos_json,
      firma_nombre_confirmado: r.rem_firma_nombre_confirmado, firma_imagen: r.rem_firma_imagen,
      firma_hash: r.rem_firma_hash,
    });
    // Verifica y, si la firma venía con el sello heredado v1, la re-sella con el HMAC v2
    // (migración perezosa — ver lib/contabilidad.ts → resellarFirmaHeredada).
    const selloDe = (r: Fila) => {
      const v = verificarHashRemision(sellable(r));
      if (v.ok && v.alg === 'v1' && r.rem_id) resellarFirmaHeredada(db, 'remisiones', r.rem_id, sellable(r));
      return v;
    };
    const omitir = (r: Fila, motivo: string) => omitidos.push({ reserva_id: r.reserva_id, marca: r.marca, modelo: r.modelo, motivo });

    for (const r of rows) {
      if (!r.firmada_en) {
        omitir(r, 'El propietario todavía no ha firmado su cuenta de cobro.');
        continue;
      }

      // La firma AUTORIZA UN MONTO, no "la existencia de una liquidación". Antes solo se
      // comprobaba que `firmada_en` no estuviera vacío y se transfería `l.neto`, sin
      // compararlo nunca con lo firmado: cualquier escritura en `liquidaciones` por fuera
      // del flujo (script, backfill, arreglo a mano, ruta futura) producía una
      // transferencia que el propietario jamás firmó, dada por autorizada.
      if (
        Math.round(r.rem_neto) !== Math.round(r.neto)
        || Math.round(r.rem_bruto) !== Math.round(r.liq_bruto)
        || Math.round(r.rem_comision_valor) !== Math.round(r.liq_comision_valor)
      ) {
        integridad(r, 'la cuenta de cobro firmada no corresponde al monto actual de la liquidación');
        omitir(r, 'La cuenta firmada no corresponde al monto actual de la liquidación: hay que reemitirla y volverla a firmar.');
        continue;
      }

      // Los importes cuadran, pero eso solo dice que quien tocó la BD fue coherente. El
      // sello (HMAC con FIRMA_SECRET) es lo que dice si el documento firmado sigue siendo
      // el mismo, y no se puede recalcular sin el secreto del servidor.
      const sello = selloDe(r);
      if (!sello.ok) {
        integridad(r, `el sello de integridad de la firma no verifica (${sello.motivo})`);
        omitir(r, `No se paga: ${sello.motivo}.`);
        continue;
      }

      // Un neto negativo (los descuentos superaron el bruto) no es una transferencia:
      // es un saldo a favor de DrivePass. Se cobra por fuera o se deja como ajuste
      // pendiente para la próxima liquidación; nunca se "paga".
      if (r.neto < 0) {
        omitir(r, 'El neto quedó negativo: no hay nada que transferir. Regístralo como ajuste pendiente.');
        continue;
      }

      pagables.push(r);
    }

    if (pagables.length === 0) {
      // El motivo se arma con los de verdad presentes (falta de firma y/o neto negativo):
      // dar siempre "falta la firma" mandaría al admin a perseguir una firma que ya existe.
      const motivos = [...new Set(omitidos.map(o => o.motivo))].join(' ');
      return {
        status: 409,
        body: { error: `No se pudo pagar ninguna. ${motivos}`, omitidos },
      };
    }

    const comprobante = body.comprobante || '';
    const comprobanteUrl = body.comprobante_url || '';
    const cambiadas = marcarLiquidacionesPagadas(db, pagables.map(r => r.reserva_id), comprobante, comprobanteUrl);
    if (cambiadas === 0) {
      return { status: 409, body: { error: 'Esas liquidaciones ya no estaban pendientes — recarga la lista.', omitidos } };
    }

    const totalPagadoGlobal = pagables.reduce((s, r) => s + r.neto, 0);
    registrarAuditoria(db, { ...user, nivel }, {
      area: 'contabilidad', accion: 'pagar_liquidacion', entidad: 'liquidacion',
      detalle: `Pagó ${pagables.length} liquidación(es) a propietarios · neto $${totalPagadoGlobal.toLocaleString('es-CO')}${comprobante ? ` · ref: ${comprobante}` : ''}`
        + (omitidos.length > 0 ? ` · ${omitidos.length} omitida(s): ${omitidos.map(o => o.motivo).join('; ')}` : ''),
    });

    const propGrupos: Record<number, Fila[]> = {};
    for (const r of pagables) {
      if (!propGrupos[r.propietario_id]) propGrupos[r.propietario_id] = [];
      propGrupos[r.propietario_id].push(r);
    }

    const insNotif = db.prepare(
      'INSERT INTO notificaciones (destinatario_id, tipo, titulo, mensaje, referencia_id, referencia_tipo) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const comprobanteTxt = comprobante ? ` Comprobante: ${comprobante}.` : '';

    for (const [pidStr, filas] of Object.entries(propGrupos)) {
      const pid = Number(pidStr);
      const totalPagado = filas.reduce((s, r) => s + r.neto, 0);
      const n = filas.length;
      const titulo = n === 1 ? `💰 Pago recibido: ${filas[0].marca} ${filas[0].modelo}` : `💰 ${n} pagos realizados`;
      const mensaje = n === 1
        ? `DrivePass transfirió $${totalPagado.toLocaleString('es-CO')} (neto, ya descontada la comisión) por el alquiler del ${filas[0].fecha_inicio} al ${filas[0].fecha_fin}.${comprobanteTxt}`
        : `DrivePass transfirió $${totalPagado.toLocaleString('es-CO')} (neto) por ${n} alquileres completados.${comprobanteTxt}`;
      insNotif.run(pid, 'pago_realizado', titulo, mensaje, filas[0].reserva_id, 'reserva');
    }

    return { status: 200, body: { ok: true, actualizados: pagables.length, omitidos } };
  });

  // La transacción lanza a propósito si la bitácora no se puede escribir (auditoría
  // estricta del evento de integridad): en ese caso NO se paga nada y se revierte todo.
  let resultado: { status: number; body: Record<string, unknown> };
  try {
    resultado = pagar();
  } catch (e) {
    console.error('[liquidaciones] el pago se revirtió:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'No se pudo registrar el pago. No se modificó ninguna liquidación.' }, { status: 500 });
  }

  return NextResponse.json(resultado.body, { status: resultado.status });
}

// Edita una liquidación PENDIENTE: conceptos (descuentos/adicionales), bruto y comisión de
// esa liquidación. El neto se recalcula solo y la cuenta de cobro se regenera (o se anula y
// se reemite con número nuevo, si ya estaba firmada). Ver lib/contabilidad.ts → editarLiquidacion.
export async function PATCH(req: NextRequest) {
  const g = await guardArea('contabilidad');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const body = await req.json().catch(() => ({})) as EdicionLiquidacion & { reserva_id?: number };
  const reservaId = Number(body.reserva_id);
  if (!reservaId) return NextResponse.json({ error: 'Falta reserva_id' }, { status: 400 });

  // `editarLiquidacion` relanza lo que no sea un error de negocio (p. ej. si la bitácora
  // obligatoria no se pudo escribir): en ese caso la transacción ya revirtió TODO, y aquí
  // se responde un 500 con cuerpo JSON en vez de dejar caer una excepción sin explicación.
  let r: ReturnType<typeof editarLiquidacion>;
  try {
    r = editarLiquidacion(db, reservaId, { ...user, nivel }, body);
  } catch (e) {
    console.error('[liquidaciones] la edición se revirtió:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'No se pudo guardar la edición. No se modificó nada.' }, { status: 500 });
  }
  if (!r.ok) {
    return NextResponse.json({
      error: r.error,
      ...(r.requiere_confirmacion ? { requiere_confirmacion: true, preview: r.preview } : {}),
      ...(r.ya_pagada ? { ya_pagada: true, propietario_id: r.propietario_id } : {}),
    }, { status: r.status });
  }

  return NextResponse.json({
    ok: true,
    liquidacion: r.liquidacion,
    conceptos: r.conceptos,
    totales: r.totales,
    cambios: r.cambios,
    cuenta_cobro: r.cuenta ? {
      accion: r.cuenta.accion,
      numero: r.cuenta.remision.numero,
      neto: r.cuenta.remision.neto,
      requiere_firma: !r.cuenta.remision.firmada_en,
      anulada: r.cuenta.anulada,
    } : null,
  });
}
