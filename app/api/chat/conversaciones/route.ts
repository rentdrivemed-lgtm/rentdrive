import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

// GET — lista de conversaciones del usuario actual
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const db = getDb();

  const conversaciones = await db.prepare(`
    SELECT c.*,
      p.nombre AS propietario_nombre,
      u.nombre AS usuario_nombre,
      (SELECT contenido FROM mensajes WHERE conversacion_id = c.id ORDER BY id DESC LIMIT 1) AS ultimo_mensaje,
      (SELECT created_at FROM mensajes WHERE conversacion_id = c.id ORDER BY id DESC LIMIT 1) AS ultimo_at,
      (
        SELECT COUNT(*) FROM mensajes m
        LEFT JOIN lecturas l ON l.usuario_id = ? AND l.conversacion_id = m.conversacion_id
        WHERE m.conversacion_id = c.id
          AND m.remitente_id != ?
          AND m.id > COALESCE(l.ultimo_leido_id, 0)
      ) AS no_leidos
    FROM conversaciones c
    JOIN usuarios p ON c.propietario_id = p.id
    JOIN usuarios u ON c.usuario_id = u.id
    WHERE c.propietario_id = ? OR c.usuario_id = ?
    ORDER BY ultimo_at DESC NULLS LAST
  `).all(user.id, user.id, user.id, user.id);

  return NextResponse.json({ conversaciones });
}

// POST — crear o recuperar conversación entre propietario y usuario
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const { propietario_id, usuario_id } = await req.json();
  if (!propietario_id || !usuario_id) {
    return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
  }

  // Solo el usuario o el propietario involucrado pueden crear/acceder
  if (user.id !== propietario_id && user.id !== usuario_id) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const db = getDb();
  const existing = db.prepare(
    'SELECT id FROM conversaciones WHERE propietario_id = ? AND usuario_id = ?'
  ).get(propietario_id, usuario_id) as { id: number } | undefined;

  if (existing) return NextResponse.json({ id: existing.id });

  const result = await db.prepare(
    'INSERT INTO conversaciones (propietario_id, usuario_id) VALUES (?, ?)'
  ).run(propietario_id, usuario_id);

  return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 });
}
