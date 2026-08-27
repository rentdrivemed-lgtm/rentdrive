import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { datosEmpresa } from '@/lib/contabilidad';

export const dynamic = 'force-dynamic';

// Endpoint de solo lectura para que el cliente vea/descargue SU PROPIA factura desde su
// cuenta (dashboard/usuario). A diferencia de /api/contabilidad/facturas (equipo, todas las
// facturas), este SIEMPRE verifica que la reserva sea del usuario autenticado — nunca se
// expone la factura de otra persona, sin importar el rol.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const { id } = await params;
  const reservaId = Number(id);
  if (!reservaId) return NextResponse.json({ error: 'Reserva inválida' }, { status: 400 });

  const db = getDb();
  const reserva = db.prepare('SELECT id, usuario_id FROM reservas WHERE id = ?').get(reservaId) as { id: number; usuario_id: number } | undefined;
  if (!reserva) return NextResponse.json({ error: 'Reserva no encontrada' }, { status: 404 });

  // Pertenencia estricta: solo el dueño de la reserva puede ver su factura (dato financiero
  // y personal). Ni siquiera se distingue por rol — un admin/propietario usa otras rutas.
  if (reserva.usuario_id !== user.id) {
    return NextResponse.json({ error: 'No tienes permiso para ver esta factura' }, { status: 403 });
  }

  const factura = db.prepare(`
    SELECT f.id, f.reserva_id, f.numero, f.cliente_nombre, f.cliente_documento, f.cliente_correo,
           f.subtotal, f.total, f.estado, f.dataico_cufe, f.created_at,
           r.fecha_inicio, r.fecha_fin, v.marca, v.modelo, v.anio
    FROM facturas f
    JOIN reservas r ON f.reserva_id = r.id
    JOIN vehiculos v ON r.vehiculo_id = v.id
    WHERE f.reserva_id = ?
  `).get(reservaId);

  // La reserva puede estar pagada y todavía no tener factura (ej. el enganche automático
  // falló) — se devuelve null explícito, no un error, para que la UI muestre un estado
  // razonable ("en proceso") sin culpar al cliente ni exponer detalles internos.
  // Se incluyen los datos de la empresa (nombre/NIT) para poder armar el PDF en el
  // navegador con descargarFacturaPDF sin exponerle al cliente ningún endpoint de admin.
  return NextResponse.json({ factura: factura || null, empresa: datosEmpresa(db) });
}
