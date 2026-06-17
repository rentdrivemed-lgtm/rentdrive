import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

// GET — total de mensajes no leídos del usuario actual (de otros, no propios)
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ total: 0 });

  const db = getDb();

  const row = db.prepare(`
    SELECT COUNT(*) as total
    FROM mensajes m
    JOIN conversaciones c ON m.conversacion_id = c.id
    LEFT JOIN lecturas l ON l.usuario_id = ? AND l.conversacion_id = m.conversacion_id
    WHERE (c.propietario_id = ? OR c.usuario_id = ?)
      AND m.remitente_id != ?
      AND m.id > COALESCE(l.ultimo_leido_id, 0)
  `).get(user.id, user.id, user.id, user.id) as { total: number | string } | undefined;

  return NextResponse.json({ total: Number(row?.total ?? 0) });
}
