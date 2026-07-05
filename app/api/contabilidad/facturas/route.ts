import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { emitirFactura } from '@/lib/contabilidad';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const db = getDb();
  const facturas = db.prepare(`
    SELECT f.*, r.fecha_inicio, r.fecha_fin, v.marca, v.modelo, v.anio
    FROM facturas f
    JOIN reservas r ON f.reserva_id = r.id
    JOIN vehiculos v ON r.vehiculo_id = v.id
    ORDER BY f.id DESC LIMIT 200
  `).all();

  // Reservas ya pagadas que todavía no tienen factura (el enganche automático
  // debería cubrir esto siempre, pero se deja como respaldo manual).
  const reservasSinFactura = db.prepare(`
    SELECT r.id, r.fecha_inicio, r.fecha_fin, r.total, u.nombre AS usuario_nombre, v.marca, v.modelo, v.anio
    FROM reservas r
    JOIN usuarios u ON r.usuario_id = u.id
    JOIN vehiculos v ON r.vehiculo_id = v.id
    LEFT JOIN facturas f ON f.reserva_id = r.id
    WHERE r.pago_estado = 'pagado' AND f.id IS NULL
    ORDER BY r.id DESC
  `).all();

  return NextResponse.json({ facturas, reservas_sin_factura: reservasSinFactura });
}

// Emitir (o reintentar) la factura de una reserva ya pagada — manual, por si el
// enganche automático falló (ej. DataICO estaba caído) o para reservas de antes
// de este módulo.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const reservaId = Number(body.reserva_id);
  if (!reservaId) return NextResponse.json({ error: 'Falta reserva_id' }, { status: 400 });

  const db = getDb();
  const reserva = db.prepare('SELECT id, pago_estado FROM reservas WHERE id = ?').get(reservaId) as { id: number; pago_estado: string } | undefined;
  if (!reserva) return NextResponse.json({ error: 'Esa reserva no existe' }, { status: 404 });
  if (reserva.pago_estado !== 'pagado') {
    return NextResponse.json({ error: 'Solo se puede facturar una reserva con el pago ya confirmado.' }, { status: 400 });
  }

  const existente = db.prepare('SELECT id, estado FROM facturas WHERE reserva_id = ?').get(reservaId) as { id: number; estado: string } | undefined;
  if (existente && existente.estado !== 'error') {
    return NextResponse.json({ error: 'Esta reserva ya tiene una factura.' }, { status: 409 });
  }
  if (existente) db.prepare('DELETE FROM facturas WHERE id = ?').run(existente.id); // reintentar tras error

  const factura = await emitirFactura(db, reservaId);
  return NextResponse.json({ ok: true, factura });
}
