import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { generarCotizacion, generarCotizacionManual } from '@/lib/contabilidad';

export const dynamic = 'force-dynamic';

export async function GET() {
  const g = await guardArea('contabilidad');
  if ('error' in g) return g.error;
  const { db } = g;
  // LEFT JOIN (no INNER): las cotizaciones "sueltas" del cotizador de venta no tienen
  // reserva_id, así que no deben desaparecer de la lista. fecha_inicio/fecha_fin usan la
  // columna propia de la cotización si la trae (sueltas) o la de la reserva (automáticas,
  // de antes de que existieran esas columnas en `cotizaciones`).
  const cotizaciones = db.prepare(`
    SELECT c.*, r.estado AS reserva_estado, r.pago_estado,
           COALESCE(NULLIF(c.fecha_inicio, ''), r.fecha_inicio, '') AS fecha_inicio,
           COALESCE(NULLIF(c.fecha_fin, ''), r.fecha_fin, '') AS fecha_fin
    FROM cotizaciones c LEFT JOIN reservas r ON c.reserva_id = r.id
    ORDER BY c.id DESC LIMIT 200
  `).all();

  // Reservas que todavía no tienen cotización (ej. de antes de este módulo, o si el
  // enganche automático falló) — para poder generarla manualmente desde el panel.
  const reservasSinCotizacion = db.prepare(`
    SELECT r.id, r.fecha_inicio, r.fecha_fin, r.total, r.estado, r.pago_estado,
           u.nombre AS usuario_nombre, v.marca, v.modelo, v.anio
    FROM reservas r
    JOIN usuarios u ON r.usuario_id = u.id
    JOIN vehiculos v ON r.vehiculo_id = v.id
    LEFT JOIN cotizaciones c ON c.reserva_id = r.id
    WHERE c.id IS NULL AND r.estado != 'cancelada'
    ORDER BY r.id DESC
  `).all();

  return NextResponse.json({ cotizaciones, reservas_sin_cotizacion: reservasSinCotizacion });
}

// POST tiene dos usos:
//  1) Reenviar/generar la cotización de una reserva REAL ya existente → { reserva_id }.
//  2) Crear una cotización MANUAL para un prospecto sin cuenta ni reserva (cotizador de
//     venta) → sin reserva_id, con los datos del prospecto sueltos.
export async function POST(req: NextRequest) {
  const g = await guardArea('contabilidad');
  if ('error' in g) return g.error;
  const { db } = g;

  const body = await req.json().catch(() => ({}));

  if (!body.reserva_id) {
    const clienteNombre = String(body.cliente_nombre || '').trim();
    const fechaInicio = String(body.fecha_inicio || '').trim();
    const fechaFin = String(body.fecha_fin || '').trim();
    const vehiculoId = body.vehiculo_id ? Number(body.vehiculo_id) : null;
    const vehiculoDescripcion = String(body.vehiculo_descripcion || '').trim();

    if (!clienteNombre) return NextResponse.json({ error: 'Falta el nombre del cliente/prospecto' }, { status: 400 });
    if (!fechaInicio || !fechaFin) return NextResponse.json({ error: 'Faltan las fechas del alquiler' }, { status: 400 });
    if (new Date(fechaFin).getTime() <= new Date(fechaInicio).getTime()) {
      return NextResponse.json({ error: 'La fecha de fin debe ser posterior a la de inicio' }, { status: 400 });
    }
    if (!vehiculoId && !vehiculoDescripcion) {
      return NextResponse.json({ error: 'Elige un vehículo del inventario o descríbelo' }, { status: 400 });
    }

    const totalOverrideRaw = body.total_override;
    const totalOverride = totalOverrideRaw !== undefined && totalOverrideRaw !== null && totalOverrideRaw !== ''
      ? Number(totalOverrideRaw) : null;
    if (totalOverride !== null && !Number.isFinite(totalOverride)) {
      return NextResponse.json({ error: 'El precio ajustado no es un número válido' }, { status: 400 });
    }
    if (totalOverride !== null && totalOverride < 0) {
      return NextResponse.json({ error: 'El precio ajustado no puede ser negativo' }, { status: 400 });
    }

    const recargoRaw = body.recargo;
    const recargoPresente = recargoRaw !== undefined && recargoRaw !== null && recargoRaw !== '';
    const recargo = recargoPresente ? Number(recargoRaw) : 0;
    if (recargoPresente && !Number.isFinite(recargo)) {
      return NextResponse.json({ error: 'El recargo no es un número válido' }, { status: 400 });
    }
    if (recargo < 0) {
      return NextResponse.json({ error: 'El recargo no puede ser negativo' }, { status: 400 });
    }

    const cot = await generarCotizacionManual(db, {
      clienteNombre,
      clienteCorreo: String(body.cliente_correo || '').trim(),
      clienteCelular: String(body.cliente_celular || '').trim(),
      vehiculoId,
      vehiculoDescripcion,
      fechaInicio,
      fechaFin,
      recargo,
      totalOverride,
    });
    return NextResponse.json({ ok: true, cotizacion: cot }, { status: 201 });
  }

  // Reenviar (o generar, si por algún motivo no existe) la cotización de una reserva real.
  const reservaId = Number(body.reserva_id);
  if (!reservaId) return NextResponse.json({ error: 'Falta reserva_id' }, { status: 400 });

  const existe = db.prepare('SELECT id FROM reservas WHERE id = ?').get(reservaId);
  if (!existe) return NextResponse.json({ error: 'Esa reserva no existe' }, { status: 404 });

  db.prepare('DELETE FROM cotizaciones WHERE reserva_id = ?').run(reservaId); // permite regenerar/reenviar
  const cot = await generarCotizacion(db, reservaId, true);
  return NextResponse.json({ ok: true, cotizacion: cot });
}
