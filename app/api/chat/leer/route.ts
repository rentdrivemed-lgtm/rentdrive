import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

// POST — marcar mensajes leídos hasta el mensaje dado
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const { conversacion_id, ultimo_id } = await req.json();
  if (!conversacion_id || !ultimo_id) {
    return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
  }

  const db = getDb();

  // Verificar acceso
  const conv = await db.prepare(
    'SELECT id FROM conversaciones WHERE id = ? AND (propietario_id = ? OR usuario_id = ?)'
  ).get(conversacion_id, user.id, user.id);
  if (!conv) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  await db.prepare(`
    INSERT INTO lecturas (usuario_id, conversacion_id, ultimo_leido_id)
    VALUES (?, ?, ?)
    ON CONFLICT (usuario_id, conversacion_id) DO UPDATE
      SET ultimo_leido_id = EXCLUDED.ultimo_leido_id
      WHERE EXCLUDED.ultimo_leido_id > lecturas.ultimo_leido_id
  `).run(user.id, conversacion_id, ultimo_id);

  return NextResponse.json({ ok: true });
}
