// Lo que a MÍ me falta firmar de una reserva, en orden.
//
// Es lo que hay detrás del enlace único del aviso: en vez de mandar a la persona a
// buscar sus documentos uno por uno, se le da la lista ya ordenada y se la lleva de uno
// al siguiente.
//
// Cada quien ve SOLO sus propios bloques. Un propietario no tiene por qué saber qué le
// falta firmar al cliente, ni al revés. El equipo con el área `contratos` sí ve todo,
// porque es quien tiene que destrabar una entrega bloqueada.
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { adminTieneArea } from '@/lib/guard';
import { firmasPendientesDeLaOperacion, bloqueoParaEntregar } from '@/lib/contratos-operacion';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id } = await params;
  const reservaId = Number(id);
  if (!Number.isInteger(reservaId) || reservaId <= 0) {
    return NextResponse.json({ error: 'Reserva inválida' }, { status: 400 });
  }

  const db = getDb();
  const reserva = db.prepare(`
    SELECT r.id, r.estado, r.usuario_id, v.propietario_id
    FROM reservas r JOIN vehiculos v ON v.id = r.vehiculo_id WHERE r.id = ?
  `).get(reservaId) as { id: number; estado: string; usuario_id: number; propietario_id: number } | undefined;

  // 404 —y no 403— cuando no es suya: responder «existe pero no es tuya» permitiría
  // recorrer identificadores para saber qué reservas hay. Mismo criterio que
  // `accesoContrato` en lib/contratos-acceso.ts.
  const esParte = !!reserva
    && (Number(reserva.usuario_id) === Number(user.id) || Number(reserva.propietario_id) === Number(user.id));
  const esEquipo = user.rol === 'admin' && adminTieneArea(db, user.id, 'contratos');
  if (!reserva || (!esParte && !esEquipo)) {
    return NextResponse.json({ error: 'La reserva no existe.' }, { status: 404 });
  }

  const todas = firmasPendientesDeLaOperacion(db, reservaId);
  // El equipo ve todo; una parte ve solo lo suyo.
  const mias = esEquipo ? todas : todas.filter(f => Number(f.usuarioEsperadoId) === Number(user.id));

  return NextResponse.json({
    reserva: { id: reserva.id, estado: reserva.estado },
    pendientes: mias,
    // Solo para el equipo: el motivo por el que la entrega está trabada.
    ...(esEquipo ? { bloqueo: bloqueoParaEntregar(db, reservaId) } : {}),
  });
}
