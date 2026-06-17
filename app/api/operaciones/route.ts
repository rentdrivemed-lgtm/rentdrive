import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { cargarDetalleServicio, getConfig, crearOperacionParaReserva } from '@/lib/operaciones';
import { whatsappHabilitado } from '@/lib/whatsapp';
import { tieneClaveAnthropic } from '@/lib/anthropic';

export const dynamic = 'force-dynamic';

type OperacionRow = {
  id: number; reserva_id: number; mensajero_id: number | null;
  estado: string; notas: string; wa_admin: string; wa_mensajero: string; created_at: string;
  mensajero_nombre: string | null; mensajero_celular: string | null;
};

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const db = getDb();

  // Backfill idempotente: crea la operación para reservas confirmadas/en curso que
  // aún no la tengan (p. ej. confirmadas antes de existir este módulo). Sin WhatsApp.
  const faltantes = db.prepare(`
    SELECT r.id FROM reservas r
    LEFT JOIN operaciones o ON o.reserva_id = r.id
    WHERE o.id IS NULL AND r.estado IN ('confirmada','en_curso')
  `).all() as { id: number }[];
  for (const f of faltantes) {
    try { crearOperacionParaReserva(db, f.id); } catch { /* ignorar reservas problemáticas */ }
  }

  const ops = db.prepare(`
    SELECT o.*, m.nombre AS mensajero_nombre, m.celular AS mensajero_celular
    FROM operaciones o
    LEFT JOIN mensajeros m ON o.mensajero_id = m.id
    ORDER BY o.created_at DESC, o.id DESC
  `).all() as OperacionRow[];

  const tareasStmt = db.prepare('SELECT id, tipo, titulo, detalle, estado, orden FROM operacion_tareas WHERE operacion_id = ? ORDER BY orden, id');

  const operaciones = ops.map(o => ({
    ...o,
    detalle: cargarDetalleServicio(db, o.reserva_id) || null,
    tareas: tareasStmt.all(o.id),
  }));

  const mensajeros = db.prepare('SELECT id, nombre, celular, activo FROM mensajeros WHERE activo = 1 ORDER BY nombre').all();
  const admin_whatsapp = getConfig(db, 'admin_whatsapp');

  return NextResponse.json({ operaciones, mensajeros, admin_whatsapp, whatsapp_habilitado: whatsappHabilitado(), ia_disponible: tieneClaveAnthropic() });
}
