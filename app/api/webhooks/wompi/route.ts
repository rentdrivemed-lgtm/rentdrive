import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verificarFirmaEvento } from '@/lib/pagos';

export const dynamic = 'force-dynamic';

type EventoWompi = {
  event: string;
  data: { transaction: { id: string; status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'ERROR' | 'VOIDED' } };
  timestamp: number;
  signature: { properties: string[]; checksum: string };
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as EventoWompi | null;
  if (!body?.signature?.checksum) return NextResponse.json({ error: 'Payload inválido' }, { status: 400 });

  if (!verificarFirmaEvento(body)) {
    console.error('[webhooks/wompi] Firma inválida, evento descartado');
    return NextResponse.json({ error: 'Firma inválida' }, { status: 401 });
  }

  if (body.event === 'transaction.updated') {
    const { id, status } = body.data.transaction;
    const db = getDb();

    const pagoEstado = status === 'APPROVED' ? 'pagado'
      : (status === 'DECLINED' || status === 'ERROR' || status === 'VOIDED') ? 'cancelado'
      : null;

    if (pagoEstado) {
      const reserva = db.prepare('SELECT id FROM reservas WHERE wompi_transaccion_id = ?').get(id) as { id: number } | undefined;
      if (reserva) {
        db.prepare('UPDATE reservas SET pago_estado = ? WHERE id = ?').run(pagoEstado, reserva.id);
      }
    }

    const cargoEstado = status === 'APPROVED' ? 'cobrado'
      : (status === 'DECLINED' || status === 'ERROR' || status === 'VOIDED') ? 'fallido'
      : null;

    if (cargoEstado) {
      db.prepare("UPDATE cargos_extra SET estado = ? WHERE wompi_transaccion_id = ? AND estado = 'pendiente'").run(cargoEstado, id);
    }
  }

  return NextResponse.json({ ok: true });
}
