import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { generarCotizacion } from '@/lib/contabilidad';

export const dynamic = 'force-dynamic';

export async function GET() {
  const g = await guardArea('contabilidad');
  if ('error' in g) return g.error;
  const { db } = g;
  const cotizaciones = db.prepare(`
    SELECT c.*, r.estado AS reserva_estado, r.pago_estado
    FROM cotizaciones c JOIN reservas r ON c.reserva_id = r.id
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

// Reenviar (o generar, si por algún motivo no existe) la cotización de una reserva.
export async function POST(req: NextRequest) {
  const g = await guardArea('contabilidad');
  if ('error' in g) return g.error;
  const { db } = g;

  const body = await req.json().catch(() => ({}));
  const reservaId = Number(body.reserva_id);
  if (!reservaId) return NextResponse.json({ error: 'Falta reserva_id' }, { status: 400 });

  const existe = db.prepare('SELECT id FROM reservas WHERE id = ?').get(reservaId);
  if (!existe) return NextResponse.json({ error: 'Esa reserva no existe' }, { status: 404 });

  db.prepare('DELETE FROM cotizaciones WHERE reserva_id = ?').run(reservaId); // permite regenerar/reenviar
  const cot = await generarCotizacion(db, reservaId, true);
  return NextResponse.json({ ok: true, cotizacion: cot });
}
